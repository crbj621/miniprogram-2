"""Import reviewed CET Markdown; no model guesses or unreviewed answers are published.

Usage: python scripts/import-cet-exams.py --sources <download-cache> --output server/data/english/exams
The cache contains wamich/CET4|CET6/YYYY.MM/*.md and the verification PDFs.
Requires only Python's standard library. PDF/OCR inspection happens before review.
"""
import argparse
import hashlib
import html
import json
import re
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent.parent
REVIEWS = Path(__file__).with_name("cet-exam-review.json")


def clean(text):
    text = re.sub(r"<u>\s*(?:&emsp;)?\s*(\d{2})\s*(?:&emsp;)?\s*</u>", r"[\1] ____", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text).replace("\u2003", " ")
    text = re.sub(r"\*\*|(?<!_)_(?!_)", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def body_without_directions(text):
    return clean(re.sub(r"\*\*Directions(?::\*\*|\*\*:)[^\n]*(?:\n|$)", "", text))


def parse_markdown(text):
    parts = re.split(r"(?m)^## Part [IV]+ / ", text)
    sections = {}
    for part in parts[1:]:
        name, _, body = part.partition("\n")
        sections[name.split(" / ")[0].strip()] = body
    reading = sections["Reading Comprehension"]
    a, b, c = [re.split(r"(?m)^### Section [ABC]\s*$", reading)[i] for i in (1, 2, 3)]
    bank_matches = list(re.finditer(r"\b([A-O])\)\s*([^|\n]+)", a))
    bank = sorted({m[1]: clean(m[2]) for m in bank_matches}.items())
    if len(bank) != 15:
        raise ValueError(f"word bank must contain A–O, got {bank}")
    passage_a = body_without_directions(a[:bank_matches[0].start()].rstrip("| \n"))
    # Markdown table separator rows are not passage text.
    passage_a = re.sub(r"(?m)^\|.*$", "", passage_a).strip()
    first_match = re.search(r"(?m)^\s*36\.\s", b)
    if not first_match:
        raise ValueError("matching section does not start at 36")
    passage_b = body_without_directions(b[:first_match.start()])
    paras = list(re.finditer(r"(?m)^\s*([A-Z])\)\s*", passage_b))
    paragraphs = {m[1]: passage_b[m.end():paras[i + 1].start() if i + 1 < len(paras) else len(passage_b)].strip()
                  for i, m in enumerate(paras)}
    if len(paragraphs) < 10:
        raise ValueError("matching paragraphs missing")
    result = {}
    for number in range(26, 36):
        if f"[{number}]" not in passage_a:
            raise ValueError(f"missing blank {number}")
        result[number] = {"type": "single_choice", "skill": "reading", "section": "reading_word_bank",
                          "prompt": f"选词填空：为第 {number} 空选择合适的单词。每个选项最多使用一次。",
                          "passage": passage_a, "options": [{"id": k, "text": v} for k, v in bank]}
    statements = list(re.finditer(r"(?m)^\s*(\d{2})\.\s*([^\n]+)", b[first_match.start():]))
    for m in statements:
        number = int(m[1])
        result[number] = {"type": "single_choice", "skill": "reading", "section": "reading_matching",
                          "prompt": clean(m[2]), "passage": passage_b,
                          "options": [{"id": k, "text": f"{k} 段"} for k in paragraphs]}
    passages = re.split(r"(?m)^#### Passage (?:One|Two)\s*$", c)[1:]
    if len(passages) != 2:
        raise ValueError("two close-reading passages required")
    for passage in passages:
        matches = list(re.finditer(r"(?m)^\s*(\d{2})\.\s*", passage))
        body = clean(re.sub(r"\*\*Questions [^\n]+\n", "", passage[:matches[0].start()]))
        for i, m in enumerate(matches):
            block = passage[m.end():matches[i + 1].start() if i + 1 < len(matches) else len(passage)]
            opt = list(re.finditer(r"\b([A-D])\)\s*", block))
            options = [{"id": o[1], "text": clean(block[o.end():opt[j + 1].start() if j + 1 < len(opt) else len(block)])}
                       for j, o in enumerate(opt)]
            if len(options) != 4:
                raise ValueError(f"question {m[1]} has {len(options)} options")
            result[int(m[1])] = {"type": "single_choice", "skill": "reading", "section": "reading_comprehension",
                                "prompt": clean(block[:opt[0].start()]), "passage": body,
                                "options": sorted(options, key=lambda o: o["id"])}
    listening = sections.get("Listening Comprehension", "")
    matches = list(re.finditer(r"(?m)^\s*(\d{1,2})\.\s*", listening))
    for i, m in enumerate(matches):
        block = listening[m.end():matches[i + 1].start() if i + 1 < len(matches) else len(listening)]
        block = re.split(r"(?m)^\*\*Questions |^### Section ", block)[0]
        opt = list(re.finditer(r"\b([A-D])\)\s*", block))
        options = [{"id": o[1], "text": clean(block[o.end():opt[j + 1].start() if j + 1 < len(opt) else len(block)])}
                   for j, o in enumerate(opt)]
        if len(options) != 4:
            raise ValueError(f"listening question {m[1]} has {len(options)} options")
        result[int(m[1])] = {"type": "single_choice", "skill": "listening", "section": "listening",
                            "prompt": f"听力第 {m[1]} 题：听录音后选择最佳答案。", "passage": "",
                            "options": sorted(options, key=lambda o: o["id"])}
    return result, sections, paragraphs


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def import_review(review, sources):
    md = sources / review["markdown"]
    for key in ("markdown", "answerPdf"):
        if sha(sources / review[key]) != review["sourceHashes"][key]:
            raise ValueError(f"{review['id']}: {key} changed since review; re-review required")
    text = md.read_text("utf-8")
    for old, new in review.get("replacements", {}).items():
        if text.count(old) != 1:
            raise ValueError(f"correction must match exactly once: {old}")
        text = text.replace(old, new)
    parsed, sections, paragraphs = parse_markdown(text)
    paper_id = review["id"]
    questions = []
    for number, note in sorted(review["answers"].items(), key=lambda x: int(x[0])):
        number = int(number)
        q = dict(parsed[number])
        if note["answer"] not in {o["id"] for o in q["options"]}:
            raise ValueError(f"{paper_id}/{number}: answer not in options")
        q.update(id=f"{paper_id}-q{number}", number=number, level=review["level"],
                 correctAnswer=note["answer"], hint=note["hint"], explanation=note["explanation"],
                 authenticity="past_exam", sourceId=paper_id)
        if number < 26:
            group = next((g for g in review["listening"] if number in g["numbers"]), None)
            if not group or not group["transcript"]:
                raise ValueError(f"{paper_id}/{number}: listening transcript missing")
            q.update(audioUrl=f"/api/english/resource?paperId={paper_id}&type=audio", listeningTranscript=group["transcript"])
            q["prompt"] = note["prompt"]
        questions.append(q)
    for skill in ("writing", "translation"):
        if skill not in review:
            continue
        note = review[skill]
        body = sections["Writing" if skill == "writing" else "Translation"]
        questions.append({"id": f"{paper_id}-{skill}", "number": "I" if skill == "writing" else "IV",
                          "level": review["level"], "section": skill, "skill": skill,
                          "type": "short_text_self_check", "prompt": clean(body), "options": [],
                          "hint": note["hint"], "explanation": note["explanation"],
                          "correctAnswer": note["referenceAnswer"], "referenceAnswer": note["referenceAnswer"],
                          "rubric": note["rubric"], "guidance": "参考范文为本项目编写，允许其他正确表达；完成后按要点自评，不计入客观正确率。",
                          "authenticity": "past_exam", "sourceId": paper_id})
    questions.sort(key=lambda q: 0 if q["number"] == "I" else 56 if q["number"] == "IV" else q["number"])
    full = review.get("isFullExam", False)
    expected = set(range(1 if full else 26, 56))
    if set(map(int, review["answers"])) != expected:
        raise ValueError(f"{paper_id}: expected exact objective coverage {sorted(expected)}")
    if full and not all(k in review for k in ("writing", "translation", "audioUrl")):
        raise ValueError(f"{paper_id}: full exam subjective/audio missing")
    for q in questions:
        if len(q["hint"]) < 12 or len(q["explanation"]) < 45:
            raise ValueError(f"{q['id']}: substantive hint/explanation required")
    year, month = map(int, review["period"].split("."))
    answer_path = sources / review["answerPdf"]
    source = {"id": paper_id, "textRepository": "https://github.com/wamich/english-exem-md",
              "textLicense": "GPL-2.0", "textUrl": "https://github.com/wamich/english-exem-md/blob/main/" + review["markdown"].removeprefix("wamich/"),
              "textSha256": sha(md), "verificationRepository": "https://github.com/0609x/CET46-Resources",
              "answerPdfUrl": "https://raw.githubusercontent.com/0609x/CET46-Resources/main/" + quote(review["answerPdf"].removeprefix("0609x/")),
              "answerPdfSha256": sha(answer_path), "answerRights": "Third-party reference material; repository grants no blanket license. Used to verify answer facts; commercial explanatory prose is not copied.",
              "rightsUrl": "https://github.com/0609x/CET46-Resources/blob/main/RIGHTS.md",
              "reviewedAt": "2026-10-03", "answerStatus": "institution_reference_verified_against_options",
              "explanations": "Project-authored explanations grounded in the question passages and verified answer keys.",
              "referenceEssays": "Project-authored examples, not official model answers.",
              "audioSourceUrl": review.get("audioSourceUrl", "https://github.com/0609x/CET46-Resources"),
              "corrections": review.get("corrections", [])}
    title = f"{year}年{month}月英语{'四' if review['level'] == 'CET4' else '六'}级第{review['set']}套真题"
    if not full:
        title += "·阅读专项"
    paper = {"id": paper_id, "level": review["level"], "year": year, "month": month, "set": review["set"],
             "title": title, "authenticity": "past_exam", "questionIds": [q["id"] for q in questions],
             "durationSeconds": (7500 if review["level"] == "CET4" else 7800) if full else 2400,
             "description": "真实题面与机构参考答案已核对，解析和参考作文为本项目编写。" + ("含55道客观题、写作与翻译；听力使用原音。" if full else "仅含第26–55题阅读部分，不是完整考试卷。"),
             "sourceId": paper_id, "resources": ([{"id": f"{paper_id}-audio", "title": "原卷听力音频", "type": "audio", "url": review["audioUrl"], "downloadUrl": f"/api/english/resource?paperId={paper_id}&type=audio"}] if full else []) + review.get("resources", []),
             "coverage": {"isFullExam": full, "fullPaper": full, "objectiveNumbers": sorted(expected), "objectiveCount": len(expected),
                          "subjectiveCount": 2 if full else 0, "sections": ["listening", "reading_word_bank", "reading_matching", "reading_comprehension", "writing", "translation"] if full else ["reading_word_bank", "reading_matching", "reading_comprehension"]}}
    return {"schemaVersion": 1, "status": "verified_structured", "source": source, "papers": [paper], "questions": questions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "server/data/english/exams")
    parser.add_argument("--check", action="store_true", help="Validate/reproduce in memory without writing files")
    parser.add_argument("--fetch", action="store_true", help="Download exact reviewed source files to an external cache; hashes must still match")
    args = parser.parse_args()
    reviews = json.loads(REVIEWS.read_text("utf-8"))
    if args.fetch:
        if args.check or args.sources.resolve().is_relative_to(ROOT):
            parser.error("--fetch requires a cache outside the project and cannot be combined with --check")
        for review in reviews:
            for key, repo in (("markdown", "wamich/english-exem-md"), ("answerPdf", "0609x/CET46-Resources")):
                path = args.sources / review[key]
                if path.exists():
                    if sha(path) != review["sourceHashes"][key]:
                        parser.error(f"source changed: {path}; re-review before importing")
                    continue
                repo_path = review[key].split("/", 1)[1]
                url = f"https://raw.githubusercontent.com/{repo}/main/{quote(repo_path)}"
                with urlopen(url, timeout=60) as response:
                    blob = response.read()
                if hashlib.sha256(blob).hexdigest() != review["sourceHashes"][key]:
                    parser.error(f"upstream source changed: {url}; re-review before importing")
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(blob)
    if not args.sources.is_dir():
        parser.error("downloaded source cache not found")
    count = 0
    for review in reviews:
        data = import_review(review, args.sources)
        if not args.check:
            args.output.mkdir(parents=True, exist_ok=True)
            (args.output / f"{review['id']}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf-8")
        count += len(data["questions"])
        print(f"{review['id']}: verified {len(data['questions'])} questions; full={review.get('isFullExam', False)}")
    print(f"Validated {len(reviews)} papers / {count} questions")


if __name__ == "__main__":
    main()
