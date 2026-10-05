"""Import non-listening CET papers from publicly rendered original-paper pages.

Source caches belong outside the project. BeautifulSoup parses the source DOM;
JSON-LD answer facts are checked against the actual numbered question/options.
No commercial explanation prose or model essays are copied. Generated evidence
notes are explicitly labelled, and subjective references remain marked outlines
until project-authored reviewed references are supplied with --references.
"""
import argparse
import concurrent.futures
import functools
import hashlib
import json
import re
import time
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parent.parent
SITE = "https://english-exam.lazynote.cn"
SLUGS = ("part3-section-a", "part3-section-b", "part3-section-c-1", "part3-section-c-2")
READING_SOURCE_CORRECTIONS = {
    "cet4-2020-09-3": {"sourceSet": "2020-09-2", "url": "https://raw.githubusercontent.com/0609x/CET46-Resources/main/四级真题/2020.09/真题PDF/cet4_2020_09_3.pdf",
                        "reason": "Original third-set PDF states that all except writing and translation match set 2. Set 2's Asian-American textbooks passage matches public-collection set 2, not the set 1 incorrectly linked by its set 3 page."},
    "cet4-2022-06-3": {"sourceSet": "2022-06-2", "url": "https://m.koolearn.com/cet4/20220611/878470.html",
                        "reason": "Institutional original set 3 states that all except writing and translation match set 2. The original second-set PDF has the Fake holiday villa websites passage, matching public-collection set 2, not its set 1."},
    "cet6-2020-09-3": {"sourceSet": "2020-09-2", "url": "https://raw.githubusercontent.com/0609x/CET46-Resources/main/六级真题/2020.09/真题PDF/2020.09六级真题第2、3套【可复制可搜索，打印首选】.pdf",
                        "reason": "The original combined second/third-set PDF explicitly says the third-set objective parts match set 2. Its How Telemedicine Is Transforming Healthcare and Organic agriculture passages match public-collection set 2, not the set 1 incorrectly linked by its set 3 page."},
    "cet6-2022-06-3": {"sourceSet": "2022-06-2", "url": "https://cet6.koolearn.com/20220613/861769.html",
                        "reason": "Institutional original set 3 pairs the helping-needy writing and Zhaozhou Bridge translation with the Thinking kind thoughts word bank, Saving Our Planet matching and AI music/science communication passages. These are public-collection set 2, not the set 1 linked by its set 3 page."}
}
SHARED_READING_CONFIRMATIONS = {
    "cet4-2022-09-2": "https://raw.githubusercontent.com/0609x/CET46-Resources/main/四级真题/2022.09/真题PDF/cet4_2022_09_2-3.pdf",
    "cet4-2022-09-3": "https://raw.githubusercontent.com/0609x/CET46-Resources/main/四级真题/2022.09/真题PDF/cet4_2022_09_2-3.pdf",
    "cet6-2022-09-2": "https://wyxy.jxufe.edu.cn/uploadfile/120/Attachment/3161897541.pdf",
    "cet6-2022-09-3": "https://wyxy.jxufe.edu.cn/uploadfile/120/Attachment/3161897541.pdf",
    "cet4-2023-03-2": "https://raw.githubusercontent.com/0609x/CET46-Resources/main/四级真题/2023.03/真题PDF/cet4_2023_03_2-3.pdf",
    "cet4-2023-03-3": "https://raw.githubusercontent.com/0609x/CET46-Resources/main/四级真题/2023.03/真题PDF/cet4_2023_03_2-3.pdf",
    "cet6-2023-03-2": "https://cet6.koolearn.com/20230310/870260.html",
    "cet6-2023-03-3": "https://cet6.koolearn.com/20230310/870260.html"
}
WORDCRAM_REPLACEMENT = {"section": "part3-section-a", "sourcePaper": "cet6-2021-12-1",
                        "url": "https://www.wordcram.com.cn/tests/cet6/2021-12-1",
                        "answerImageUrl": "https://www.wordcram.com.cn/assets/practice-tests/images/cet6/2021-12-1-cet6-answers.png",
                        "reason": "The public collection incorrectly links an optimism/longevity word bank. The complete original reading arrangement pairs the Why facts don't change our minds passage with the Sharon Draper/clothing word bank. Collection set numbering differs, so the original writing and translation are retained by prompt, not replaced by set number.",
                        "transcriptionCorrections": {"thus oping": "thus opting", "____ shit your mood": "____ shift your mood"}}
INDEPENDENT_ANSWER_CHECKS = {
    "cet4-2026-06-1": {"section": "reading_word_bank", "questionNumbers": list(range(26, 36)), "answerKey": "NAIKFOCGJD",
                       "url": "https://oss-hqwx-video.hqwx.com/2026%E5%B9%B46%E6%9C%88%E8%8B%B1%E8%AF%AD%E5%9B%9B%E7%BA%A7%E9%98%85%E8%AF%BB%E7%90%86%E8%A7%A3%E5%8F%82%E8%80%83%E7%AD%94%E6%A1%88%EF%BC%88%E4%B8%80%E3%80%81%E4%BA%8C%E3%80%81%E4%B8%89%E5%A5%97%E5%85%A8%EF%BC%89_7cd5e513838e42cad71f139a5f3119396d967099.pdf",
                       "note": "The institution's compact numbered key is used; its individual OCR bullet headings mislabel questions 27/28. This spot check does not imply independent manual review of every new reading question."}
}
STOP_WORDS = set("the a an is are was were of to in on for and or but with from it this that their they its as at by be have has had do does what which who how why one people can could would should may will more most than not".split())
CHART_TEXT = {
    "cet6-2021-06-1-nonlistening": "原卷图表数据：Degree of Urbanization in China from 1980 to 2019\n年份 | 城镇化率（%）\n1980 | 19.39\n1985 | 23.71\n1990 | 26.41\n1995 | 29.04\n2000 | 36.22\n2005 | 42.99\n2010 | 49.95\n2011 | 51.27\n2012 | 52.57\n2013 | 53.73\n2014 | 54.77\n2015 | 56.10\n2016 | 57.35\n2017 | 58.52\n2018 | 59.58\n2019 | 60.60\n数据逐项人工对照源图抄录，表格用于无图时作答。",
    "cet6-2021-06-2-nonlistening": "原卷图表数据：Gross Enrolment Ratio in Higher Education in China (1990–2019)\n来源：Ministry of Education\n年份 | 高等教育毛入学率（%）\n1990 | 3.40\n1995 | 6.86\n2000 | 11.00\n2001 | 13.30\n2002 | 15.00\n2003 | 17.00\n2004 | 19.00\n2005 | 21.00\n2006 | 22.00\n2007 | 23.00\n2008 | 23.30\n2009 | 24.20\n2010 | 26.00\n2011 | 26.50\n2012 | 30.00\n2013 | 34.50\n2014 | 37.50\n2015 | 40.00\n2016 | 42.70\n2017 | 45.70\n2018 | 48.10\n2019 | 51.60\n数据逐项人工对照源图抄录，表格用于无图时作答。",
    "cet6-2021-06-3-nonlistening": "原卷图表：Rural Population in Poverty\n横轴为2012–2020年。蓝色柱形：农村贫困人口，左轴单位为百万，刻度0、25、50、75、100。红色折线：农村贫困发生率，右轴单位为%，刻度0、3、6、9、12。两项均连续逐年下降，2020年降至0。原图没有给每年柱形/点位标注精确数值，因此不编造逐年精确表；请结合原图概述总体趋势。\n来源：China's National Bureau of Statistics; China's State Council Leading Group Office of Poverty Alleviation and Development。"
}


def plain(node):
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip() if node else ""


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def get(url, path):
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Campus-English-Source-Review/1.0"})
            data = urllib.request.urlopen(request, timeout=40).read()
            if not data:
                raise ValueError("empty source")
            path.write_bytes(data)
            return path
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


@functools.lru_cache(maxsize=None)
def soup(path):
    return BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")


def source_url(level, date_set, slug=None):
    return f"{SITE}/{level}/{'sections' if slug else 'paper'}/{date_set}/{slug + '/' if slug else ''}"


def paper_path(cache, level, date_set):
    return cache / "lazy" / level / date_set / "paper.html"


def reading_sources(page, level, date_set):
    sources = {}
    for slug in SLUGS:
        if module_slug(page, slug):
            sources[slug] = date_set
            continue
        links = page.select(f'#paper a[href$="/{slug}/"]')
        dates = {re.search(r"/paper/(\d{4}-\d{2}-[123])/", link["href"])[1] for link in links}
        if len(dates) != 1:
            raise ValueError(f"{level} {date_set} missing explicit source for {slug}")
        sources[slug] = dates.pop()
    return sources


def module_slug(page, slug):
    if page.find(id="mod-" + slug):
        return slug
    if slug == "part3-section-c-1" and page.find(id="mod-part3-section-c"):
        return "part3-section-c"
    return None


def answer_facts(path, expected):
    page = soup(path)
    quizzes = []
    for tag in page.select('script[type="application/ld+json"]'):
        value = json.loads(tag.string)
        if value.get("@type") == "Quiz":
            quizzes.append(value)
    if len(quizzes) != 1:
        raise ValueError(f"expected one Quiz answer source: {path}")
    answers = {}
    for item in quizzes[0].get("hasPart", []):
        number = int(item["position"])
        raw = item["acceptedAnswer"]["text"]
        match = re.match(r"\s*([A-Z])(?:\)|[：:])", raw)
        if not match:
            raise ValueError(f"unrecognized answer {number}: {raw}")
        answers[number] = {"id": match[1], "text": raw, "stem": re.sub(r"^\d+\.\s*", "", item["text"])}
    if set(answers) != set(expected):
        raise ValueError(f"answer numbers differ: {path}: {sorted(answers)}")
    return answers


def paragraphs(module, slug):
    result = []
    for node in module.select(f'[id^="p-{slug}-"]'):
        if not re.fullmatch(r"p-" + re.escape(slug) + r"-\d+", node["id"]):
            continue
        for blank in node.select("u"):
            value = plain(blank)
            if re.fullmatch(r"\d{2}", value):
                blank.replace_with(f"[{value}] ____")
        result.append(plain(node))
    if not result or any(not text for text in result):
        raise ValueError(f"empty passage: {slug}")
    return result


def replacement_word_bank(cache):
    source = cache / "wordcram" / "cet6-2021-12-1.html"
    page = soup(source)
    start = next(node for node in page.find_all("p") if plain(node).startswith("According to psychologist Sharon Draper"))
    nodes = [start]
    for node in start.find_all_next(["p", "h5"]):
        if node.name == "h5":
            break
        nodes.append(node)
    paras = []
    for node in nodes:
        for blank in node.select(".fill-in"):
            number = int(plain(blank))
            blank.replace_with(f"[{number}] ____")
        text = plain(node)
        for before, after in WORDCRAM_REPLACEMENT["transcriptionCorrections"].items():
            text = text.replace(before, after)
        paras.append(text)
    bank = start.find_next("ul")
    options = []
    for node in bank.find_all("li"):
        match = re.fullmatch(r"([A-O])\)\s+(.+)", plain(node))
        if not match:
            raise ValueError("replacement original word bank option cannot be parsed")
        options.append({"id": match[1], "text": match[2]})
    if [option["id"] for option in options] != list("ABCDEFGHIJKLMNO"):
        raise ValueError("replacement original word bank is incomplete")
    # Manually transcribed from the cached reference-answer image, also present
    # as numbered answer facts on page 14 of its downloadable original PDF.
    answers = {number: {"id": letter, "text": letter + ") " + next(option["text"] for option in options if option["id"] == letter)} for number, letter in zip(range(26, 36), "BDOAIEGJMF")}
    return paras, options, answers, {"section": "part3-section-a", "url": WORDCRAM_REPLACEMENT["url"],
                                   "sha256": sha(source), "answerImageUrl": WORDCRAM_REPLACEMENT["answerImageUrl"],
                                   "answerImageSha256": sha(source.parent / "cet6-2021-12-1-answers.png"),
                                   "answerExtraction": "Manually transcribed numbered reference key, checked against the actual A-O options."}


def token_set(text):
    return {word.rstrip("s") for word in re.findall(r"[a-z]+", text.lower()) if word not in STOP_WORDS and len(word) > 2}


def evidence_sentence(paras, stem, answer):
    terms = token_set(stem + " " + answer)
    candidates = []
    for index, paragraph in enumerate(paras, 1):
        for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z\"'])", paragraph):
            tokens = token_set(sentence)
            weight = len(terms & tokens) / max(1, len(terms))
            candidates.append((weight, index, sentence))
    _, index, sentence = max(candidates, key=lambda value: value[0])
    return index, sentence


def make_subjective(paper_id, level, part, prompt, references):
    supplied = references.get(paper_id, {}).get(part, {})
    supplied_hash = supplied.get("sourcePromptSha256")
    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    if supplied_hash and supplied_hash != prompt_hash:
        # Translation author input excludes the common English Directions.
        chinese_prompt_hash = hashlib.sha256(prompt.split("\n\n", 1)[-1].encode("utf-8")).hexdigest()
        if part != "translation" or supplied_hash != chinese_prompt_hash:
            raise ValueError(f"reference is bound to a different source prompt: {paper_id} {part}")
    reference = supplied.get("referenceAnswer", "").strip()
    complete_reference = bool(reference)
    if not complete_reference:
        reference = ("写作框架（非完整范文）：先准确回应题目中的对象、文体与主题；主体用两个具体理由或例子展开；结尾回扣立场。按原卷词数要求自查。"
                     if part == "writing" else
                     "翻译自查要点（非完整参考译文）：逐句列出人物、时间、地点、数量、因果与目的；先写英文主谓宾，再补充修饰和连接词。译完逐句对照中文，检查遗漏与时态。")
    rubric = supplied.get("rubric") or (["符合原卷文体、主题和写作对象", "满足原卷词数要求", "观点与例证具体且相互支持", "语法、拼写与段落衔接准确"]
                                        if part == "writing" else ["逐句信息无遗漏、无增译", "专名、时间、数字和单位准确", "句子主干与时态准确", "因果、转折、目的和修饰关系一致"])
    return {"id": f"{paper_id}-{part}", "number": "I" if part == "writing" else "IV", "level": level,
            "type": "short_text_self_check", "skill": part, "section": part, "prompt": prompt,
            "options": [], "correctAnswer": reference, "referenceAnswer": reference,
            "hint": supplied.get("hint") or ("先圈出题目限定对象、文体、主题和词数，再列出每段要表达的重点。" if part == "writing" else "先分句，圈出时间、数字、专名与逻辑关系，再决定每句的主谓结构。"),
            "explanation": supplied.get("explanation") or "本题为真实卷面的主观题，自评不计入客观正确率。当前提供项目自查框架，不冒充完整范文或官方标准答案；可打开本卷来源页对照原题。",
            "rubric": rubric, "referenceType": "project_authored_reference" if complete_reference else "self_check_outline",
            "guidance": supplied.get("guidance") or ("项目原创参考范文/译文，不是官方唯一答案；允许准确自然的其他表达。" if complete_reference else "当前为自查框架，不是完整参考范文/译文；允许准确自然的其他表达。"),
            "authenticity": "past_exam", "sourceId": paper_id}


def import_paper(cache, level, date_set, references, reviewed_questions):
    source = paper_path(cache, level, date_set)
    page = soup(source)
    reading_map = reading_sources(page, level, date_set)
    reading_correction = READING_SOURCE_CORRECTIONS.get(f"{level}-{date_set}")
    if reading_correction:
        reading_map = {slug: reading_correction["sourceSet"] for slug in SLUGS}
    section_replacement = WORDCRAM_REPLACEMENT if (level, date_set) == ("cet6", "2021-12-3") else None
    paper_id = f"{level}-{date_set}-nonlistening"
    grade = level.upper()
    writing = plain(page.find(id="directions-part1"))
    translation = plain(page.find(id="directions-part-iv")) + "\n\n" + plain(page.find(id="stem-part-iv"))
    if not writing or len(plain(page.find(id="stem-part-iv"))) < 35:
        raise ValueError("writing or translation prompt incomplete")
    writing_question = make_subjective(paper_id, grade, "writing", writing, references)
    writing_images = page.select('#mod-part1 img[src]')
    if writing_images:
        writing_question["materialImages"] = [{"url": f"/english-assets/exams/{level}-{date_set}-writing-chart.jpg", "caption": node.get("alt", "原卷写作图表"), "width": int(node.get("width", 0)), "height": int(node.get("height", 0))} for node in writing_images]
        if paper_id in CHART_TEXT:
            writing_question["passage"] = CHART_TEXT[paper_id]
    elif re.search(r"\b(?:graph|chart|picture|cartoon)\s+below\b", writing, re.I):
        raise ValueError("writing refers to a missing chart/image")
    questions = [writing_question]
    answer_sources = []
    shared = {}
    corrections = []
    reused_references = set()
    for slug, numbers in zip(SLUGS, (range(26, 36), range(36, 46), range(46, 51), range(51, 56))):
        replaced_word_bank = bool(section_replacement and slug == section_replacement["section"])
        actual = reading_map[slug]
        original = soup(paper_path(cache, level, actual))
        actual_slug = module_slug(original, slug)
        module = original.find(id="mod-" + actual_slug) if actual_slug else None
        if not module:
            raise ValueError("shared source lacks requested module")
        part_path = cache / "lazy" / level / actual / (actual_slug + ".html")
        if replaced_word_bank:
            paras, replacement_options, answers, replacement_source = replacement_word_bank(cache)
            answer_sources.append(replacement_source)
        else:
            answers = answer_facts(part_path, numbers)
            answer_sources.append({"section": slug, "url": source_url(level, actual, actual_slug), "sha256": sha(part_path)})
            paras = paragraphs(module, actual_slug)
        if actual != date_set and not replaced_word_bank:
            shared[slug] = {"paper": f"{level}-{actual}", "url": source_url(level, actual)}
        passage = "\n\n".join(paras)
        if slug == "part3-section-b":
            first_paragraph = module.find(id=f"p-{actual_slug}-1")
            title = plain(first_paragraph.find_previous_sibling()) if first_paragraph else ""
            if title:
                passage = title + "\n\n" + passage
        if slug == "part3-section-a":
            bank = module.find(id="choices-" + slug)
            options = []
            for label in bank.select("span.select-none"):
                key = plain(label).rstrip(")")
                option = plain(label.parent).removeprefix(plain(label)).strip()
                options.append({"id": key, "text": option})
            options.sort(key=lambda value: value["id"])
            if replaced_word_bank:
                options = replacement_options
            if [option["id"] for option in options] != list("ABCDEFGHIJKLMNO"):
                raise ValueError("word-bank options are not A-O")
            for number in numbers:
                if f"[{number}]" not in passage:
                    raise ValueError(f"blank {number} absent")
        elif slug == "part3-section-b":
            letters = module.select('[id^="p-part3-section-b-"] [data-pdh-letter]')
            options = [{"id": node["data-pdh-letter"], "text": node["data-pdh-letter"] + " 段"} for node in letters]
            paragraph_by_letter = {node["data-pdh-letter"]: plain(node) for node in letters}
            # Some real papers (CET4 2022.12 set 2) have A-I paragraphs;
            # ten statements may legitimately refer to a paragraph twice.
            if len(options) < 9 or len(paragraph_by_letter) != len(options):
                raise ValueError("matching paragraphs missing or duplicated")
        for number in numbers:
            fact = answers[number]
            question = original.find(id=f"qp-{number}")
            if slug == "part3-section-a":
                prompt = f"选词填空：为第 {number} 空选择合适的单词。每个选项最多使用一次。"
                context = next(para for para in paras if f"[{number}]" in para)
                sentence = next((s for s in re.split(r"(?<=[.!?])\s+", context) if f"[{number}]" in s), context)
                label = next(option["text"] for option in options if option["id"] == fact["id"])
                if plain_text(fact["text"].split(")", 1)[1]) != plain_text(label):
                    raise ValueError(f"word-bank answer/option text differs: {number}")
                explanation = f"来源答案为 {fact['id']}（{label}）。本空所在句：{sentence}\n将本空替换为 {label} 后，检查它与前后主语、谓语、宾语或修饰成分的关系，并与整段论述方向核对。此讲解为自动上下文定位，不是逐题人工详解。"
                hint = f"先看第 {number} 空前后的句子成分，再结合所在段语境；词库中每个词最多使用一次。"
                section = "reading_word_bank"
            else:
                stem_node = question.select_one("[data-pdh-stem]") if question else None
                prompt = plain(stem_node)
                if not prompt or plain_text(prompt) != plain_text(fact["stem"]):
                    raise ValueError(f"question stem differs from answer source: {number}")
                if slug == "part3-section-b":
                    if fact["id"] not in paragraph_by_letter:
                        raise ValueError("matching answer paragraph absent")
                    sentence = paragraph_by_letter[fact["id"]]
                    explanation = f"来源答案对应 {fact['id']} 段。题干：{prompt}\n核对该段原文：{sentence}\n比较题干与段落中的人物、时间、对象和动作是否一致；关键词相似本身不能证明匹配。此讲解为自动段落定位，不是逐题人工详解。"
                    hint = "标出题干中的专名、时间和关键动作，再寻找表达同一事实的段落，注意同义改写。"
                    section = "reading_matching"
                else:
                    options = [{"id": node["data-pdh-letter"], "text": plain(node)} for node in question.select("[data-pdh-letter]")]
                    if [option["id"] for option in options] != list("ABCD"):
                        raise ValueError("close-reading options are not A-D")
                    label = next(option["text"] for option in options if option["id"] == fact["id"])
                    if plain_text(fact["text"].split(")", 1)[1]) != plain_text(label):
                        raise ValueError(f"accepted answer option text differs: {number}")
                    para_number, sentence = evidence_sentence(paras, prompt, label)
                    explanation = f"来源答案为 {fact['id']}：{label}\n关键词检索定位到第 {para_number} 段的候选相关句：{sentence}\n请结合该句前后文核对选项的主体、程度、范围、时间和因果关系；此句为自动检索候选，不能替代整段理解，也不是逐题人工详解。"
                    hint = "用题干中的对象和核心动作定位相关段落，再比较四个选项的范围与原文逻辑。"
                    section = "reading_comprehension"
            if fact["id"] not in {option["id"] for option in options}:
                raise ValueError(f"answer absent from options: {number}")
            current_question = {"id": f"{paper_id}-q{number}", "canonicalId": f"wordcram-{section_replacement['sourcePaper']}-q{number}" if replaced_word_bank else f"lazynote-{level}-{actual}-q{number}",
                              "number": number, "level": grade, "type": "single_choice", "skill": "reading",
                              "section": section, "prompt": prompt, "passage": passage, "options": options,
                              "correctAnswer": fact["id"], "hint": hint, "explanation": explanation,
                              "authenticity": "past_exam", "sourceId": paper_id}
            for reviewed in reviewed_questions:
                if reviewed["level"] != grade or reviewed["number"] != number or plain_text(reviewed["prompt"]) != plain_text(prompt):
                    continue
                if {plain_text(option["text"]) for option in reviewed["options"]} != {plain_text(option["text"]) for option in options}:
                    continue
                if plain_text(reviewed["passage"]) != plain_text(passage):
                    continue
                correct_text = next(option["text"] for option in reviewed["options"] if option["id"] == reviewed["correctAnswer"])
                correct_id = next(option["id"] for option in options if plain_text(option["text"]) == plain_text(correct_text))
                if correct_id != fact["id"]:
                    dispute = {"questionNumber": number, "publicSourceAnswer": fact["id"], "publishedAnswer": correct_id,
                               "reason": "Public reference and the existing institutional-PDF reference disagree for the same normalized prompt, passage and choices. The previously reviewed institutional key is retained with its explanation caveat; this is not a claim that the disagreement is resolved.",
                               "reviewedQuestionId": reviewed["id"], "verificationSource": reviewed["verificationSource"]}
                    corrections.append(dispute)
                    current_question["referenceDispute"] = dispute
                current_question["correctAnswer"] = correct_id
                current_question["hint"] = reviewed["hint"]
                current_question["explanation"] = reviewed["explanation"]
                if current_question.get("referenceDispute"):
                    current_question["explanation"] += f"\n答案来源存在分歧：网页参考为 {fact['id']}，本项目保留已核对的机构参考 {correct_id}；上述措辞范围疑点仍应结合原文理解。"
                current_question["canonicalId"] = reviewed["id"].replace("-reading-q", "-q")
                current_question["explanationType"] = "previous_project_authored_reviewed_explanation"
                reused_references.add(reviewed["sourceId"])
                break
            questions.append(current_question)
    questions.append(make_subjective(paper_id, grade, "translation", translation, references))
    independent_answer_check = INDEPENDENT_ANSWER_CHECKS.get(f"{level}-{date_set}")
    if independent_answer_check:
        actual_key = "".join(question["correctAnswer"] for question in questions if question["number"] in independent_answer_check["questionNumbers"])
        if actual_key != independent_answer_check["answerKey"]:
            raise ValueError("independent institutional answer key differs from the imported source")
    if len(questions) != 32 or Counter(question["section"] for question in questions) != {"writing": 1, "translation": 1, "reading_word_bank": 10, "reading_matching": 10, "reading_comprehension": 10}:
        raise ValueError("non-listening paper must contain writing + 30 reading + translation")
    year, month, set_number = map(int, date_set.split("-"))
    name = "四级" if grade == "CET4" else "六级"
    shared_confirmation = SHARED_READING_CONFIRMATIONS.get(f"{level}-{date_set}")
    full_non_listening = not shared or bool(shared_confirmation) or bool(reading_correction)
    note = "写作1题、阅读30题、翻译1题，不含听力。"
    if shared:
        if reading_correction:
            note += "阅读已按机构原题纠正网页错误关联，并记录实际材料来源。"
        elif shared_confirmation:
            note += "该考次原题阅读共用已通过机构来源确认。"
        else:
            note += "来源网页将阅读关联至其他套卷，尚未独立核对原卷编排；当前仅作真实主观题与关联阅读练习，不能称完整真题。"
        note += "共用题不重复计算排行榜首次得分。"
    if section_replacement:
        note += "网页漏失且错误关联的选词填空已按原卷完整阅读材料补齐，并记录来源及转录校正。"
    paper = {"id": paper_id, "level": grade, "year": year, "month": month, "set": set_number,
             "title": f"{year}年{month}月英语{name}第{set_number}套" + ("真题（不含听力）" if full_non_listening else "主观题与关联阅读练习（编排待核对）"),
             "authenticity": "past_exam", "questionIds": [question["id"] for question in questions],
             "durationSeconds": 6000, "description": note + "客观题答案与题面、选项完成结构一致性核对。",
             "sourceId": paper_id,
             "coverage": {"fullPaper": False, "fullNonListening": full_non_listening, "listeningExcluded": True,
                          "objectiveNumbers": list(range(26, 56)), "objectiveCount": 30, "subjectiveCount": 2,
                          "sections": ["writing", "reading_word_bank", "reading_matching", "reading_comprehension", "translation"],
                          "sharedSectionSource": shared, "note": note,
                          "independentlyConfirmedSharedSource": shared_confirmation or "",
                          "readingSourceCorrection": reading_correction,
                          "sectionSourceReplacement": section_replacement,
                          "referenceStatus": "project_authored" if all(question.get("referenceType") == "project_authored_reference" for question in questions if question["skill"] in ("writing", "translation")) else "self_check_outline"},
             "resources": [{"id": paper_id + "-source", "type": "web", "title": "原卷来源与题面核对", "url": source_url(level, date_set)}]}
    material_sources = [{"url": node["src"], "sha256": sha(source.parent / "writing-chart.jpg")} for node in writing_images]
    return {"schemaVersion": 1, "status": "verified_structured",
            "source": {"id": paper_id, "textCollection": SITE,
                       "textUrl": source_url(level, date_set), "textSha256": sha(source),
                       "answerSources": answer_sources, "rightsUrl": SITE,
                       "rights": "Source footer attributes original papers to the National College English Test Committee. Original materials retain their respective rights; no blanket source license is asserted. Commercial explanatory prose is not copied.",
                       "sourceRightsNotice": plain(page.find("footer")),
                       "sourceTermsUrl": SITE + "/terms/",
                       "reviewedAt": "2026-10-03", "answerStatus": "public_reference_structural_consistency_checked_with_disputes" if corrections else "public_reference_structural_consistency_verified",
                       "explanations": "Project-generated contextual evidence notes. Close-reading locations are keyword-search candidates, not manually verified detailed explanations.",
                       "referenceEssays": "Project-authored full reference examples bound to the original prompts; not official model answers." if paper["coverage"]["referenceStatus"] == "project_authored" else "Explicit self-check outlines where a project-authored full reference has not been supplied.",
                       "materialSources": material_sources,
                       "corrections": corrections,
                       "previousReviewedAnswerSources": sorted(reused_references),
                       "sourceEdition": "lazynote public original-paper arrangement; set numbering can differ from other collections.",
                       "independentlyConfirmedSharedSource": shared_confirmation or "",
                       "readingSourceCorrection": reading_correction,
                       "sectionSourceReplacement": section_replacement,
                       "independentAnswerChecks": [independent_answer_check] if independent_answer_check else [],
                       "sharedSectionSource": shared}, "papers": [paper], "questions": questions}


def plain_text(text):
    return "".join(char for char in unicodedata.normalize("NFKC", text).casefold() if char.isalnum())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "server/data/english/exams")
    parser.add_argument("--references", type=Path, nargs="*")
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    references = {}
    reference_paths = args.references if args.references is not None else [ROOT / "scripts" / ("cet-subjective-reference-" + level + ".json") for level in ("cet4", "cet6")]
    for path in reference_paths:
        if path.exists():
            references.update(json.loads(path.read_text(encoding="utf-8")))
    reviewed_questions = []
    for file in sorted((ROOT / "server/data/english/exams").glob("*.json")):
        if file.stem.endswith("-nonlistening"):
            continue
        bundle = json.loads(file.read_text(encoding="utf-8"))
        if bundle.get("source", {}).get("answerStatus") == "institution_reference_verified_against_options":
            for question in bundle.get("questions", []):
                if question.get("skill") == "reading":
                    reviewed_questions.append({**question, "verificationSource": bundle["source"].get("answerPdfUrl", "")})
    urls_file = args.cache / "lazy-whole-urls.json"
    if args.fetch and not urls_file.exists():
        sitemap = get(SITE + "/sitemap-papers.xml", args.cache / "sitemap-papers.xml")
        urls = [node.text for node in ET.fromstring(sitemap.read_bytes()).iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
                if re.search(r"/cet[46]/paper/20(?:19|2[0-6])-\d{2}-[123]/$", node.text)]
        urls_file.write_text(json.dumps(sorted(urls), indent=2), encoding="utf-8")
    urls = json.loads(urls_file.read_text(encoding="utf-8"))
    pairs = [re.search(r"/(cet[46])/paper/(\d{4}-\d{2}-[123])/", url).groups() for url in urls]
    pairs = [pair for pair in pairs if "2019-06" <= pair[1][:7] <= "2026-06"]
    if len(set(pairs)) != len(pairs):
        raise ValueError("source catalogue contains duplicate paper arrangements")
    if args.fetch:
        requests = []
        for level, date_set in pairs:
            get(source_url(level, date_set), paper_path(args.cache, level, date_set))
            source_page = soup(paper_path(args.cache, level, date_set))
            for node in source_page.select('#mod-part1 img[src]'):
                get(urllib.parse.urljoin(SITE, node["src"]), paper_path(args.cache, level, date_set).parent / "writing-chart.jpg")
            mapping = reading_sources(source_page, level, date_set)
            for slug, actual in mapping.items():
                actual_slug = module_slug(soup(paper_path(args.cache, level, actual)), slug)
                requests.append((source_url(level, actual, actual_slug), args.cache / "lazy" / level / actual / (actual_slug + ".html")))
        get(WORDCRAM_REPLACEMENT["url"], args.cache / "wordcram" / "cet6-2021-12-1.html")
        get(WORDCRAM_REPLACEMENT["answerImageUrl"], args.cache / "wordcram" / "cet6-2021-12-1-answers.png")
        requests = list(dict.fromkeys(requests))
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            for index, _ in enumerate(pool.map(lambda item: get(*item), requests), 1):
                if index % 20 == 0:
                    print(f"answer sources {index}/{len(requests)}", flush=True)
    args.output.mkdir(parents=True, exist_ok=True)
    inventory = []
    failures = []
    prepared_outputs = []
    unique_reading_questions = set()
    reused_reviewed_questions = 0
    for level, date_set in pairs:
        try:
            bundle = import_paper(args.cache, level, date_set, references, reviewed_questions)
            target = args.output / (bundle["source"]["id"] + ".json")
            data = json.dumps(bundle, ensure_ascii=False, indent=2) + "\n"
            if args.check:
                if not target.exists() or target.read_text(encoding="utf-8") != data:
                    raise ValueError("imported bundle differs from reproducible source")
            else:
                prepared_outputs.append((target, data))
            paper = bundle["papers"][0]
            unique_reading_questions.update(question["canonicalId"] for question in bundle["questions"] if question["skill"] == "reading")
            reused_reviewed_questions += sum(question.get("explanationType") == "previous_project_authored_reviewed_explanation" for question in bundle["questions"])
            inventory.append({"paperId": paper["id"], "level": paper["level"], "year": paper["year"],
                              "month": paper["month"], "set": paper["set"], "questionCount": 32,
                              "fullNonListening": paper["coverage"]["fullNonListening"],
                              "referenceStatus": paper["coverage"]["referenceStatus"],
                              "sharedSectionSource": paper["coverage"]["sharedSectionSource"],
                              "independentlyConfirmedSharedSource": paper["coverage"]["independentlyConfirmedSharedSource"],
                              "readingSourceCorrection": paper["coverage"]["readingSourceCorrection"],
                              "sectionSourceReplacement": paper["coverage"]["sectionSourceReplacement"],
                              "answerDisputeCount": len(bundle["source"]["corrections"]),
                              "sourceUrl": bundle["source"]["textUrl"], "sourceSha256": bundle["source"]["textSha256"]})
        except Exception as error:
            failures.append({"paper": f"{level}-{date_set}", "reason": str(error)})
    manifest = {"scope": "2019-06 through 2026-06, available public-source catalogue arrangements; not a claim of every nationwide exam version", "listeningExcluded": True,
                "sourceCatalogueCoverage": "52 available arrangements per level, including one available 2020-07 arrangement per level. Other nationwide subjective versions are not asserted complete.",
                "expectedSourceSets": len(pairs), "importedSets": len(inventory),
                "levelSets": dict(Counter(row["level"] for row in inventory)),
                "completeNonListeningSets": sum(row["fullNonListening"] for row in inventory),
                "unconfirmedArrangements": [row["paperId"] for row in inventory if not row["fullNonListening"]],
                "sharedReadingArrangements": sum(bool(row["sharedSectionSource"]) for row in inventory),
                "completeSubjectiveReferenceSets": sum(row["referenceStatus"] == "project_authored" for row in inventory),
                "answerDisputes": sum(row["answerDisputeCount"] for row in inventory),
                "uniqueReadingQuestions": len(unique_reading_questions),
                "reusedReviewedQuestionOccurrences": reused_reviewed_questions,
                "questions": len(inventory) * 32, "periods": dict(Counter(f"{row['year']}-{row['month']:02}" for row in inventory)),
                "papers": inventory, "failures": failures,
                "quality": "Answer facts checked against source numbered prompts and choice text; generated notes are not manual detailed explanations. Subjective references are explicitly labelled."}
    manifest_path = args.output.parent / "nonlistening-coverage.json"
    manifest_data = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    print(json.dumps({key: manifest[key] for key in ("expectedSourceSets", "importedSets", "questions", "periods", "failures")}, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)
    if args.check:
        if not manifest_path.exists() or manifest_path.read_text(encoding="utf-8") != manifest_data:
            raise SystemExit("coverage manifest differs from reproducible source")
    else:
        for target, data in prepared_outputs:
            target.write_text(data, encoding="utf-8")
        manifest_path.write_text(manifest_data, encoding="utf-8")


if __name__ == "__main__":
    main()
