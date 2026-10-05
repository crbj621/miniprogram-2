"""Rebuild CET content from a pinned vocabulary snapshot and the supplied site.

Usage: python scripts/import-english-content.py --source-project PATH --cache-dir PATH
The source SQLite is opened read-only; user progress is never imported.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'server/data/english'
COMMIT = 'c4c6c80879ff17d7025c28fb853a4991c8e6be6a'
UPSTREAM = 'https://raw.githubusercontent.com/KyleBing/english-vocabulary/' + COMMIT + '/'


def read_snapshot(name, cache):
    cached = cache / ('campus-cet-' + name.rsplit('/', 1)[-1])
    if cached.exists():
        return cached.read_bytes()
    req = urllib.request.Request(UPSTREAM + urllib.parse.quote(name), headers={'User-Agent': 'campus-cet-import'})
    return urllib.request.urlopen(req, timeout=45).read()


def write_json(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def build(source, cache):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'licenses').mkdir(exist_ok=True)
    (OUT / 'licenses/KyleBing-BSD-3-Clause.txt').write_bytes(read_snapshot('LICENSE', cache))
    connection = sqlite3.connect((source / 'data/cet-study.sqlite').as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    words = []
    seen = set()
    for row in connection.execute("SELECT * FROM lexemes WHERE status='published'"):
        seen.add((row['level'], row['lemma'].lower()))
        words.append({'id': row['id'], 'level': row['level'], 'lemma': row['lemma'],
                      'ipa': row['ipa'], 'partOfSpeech': row['part_of_speech'],
                      'definitionZh': row['definition_zh'],
                      'meanings': [{'partOfSpeech': row['part_of_speech'], 'definitionZh': row['definition_zh']}],
                      'exampleEn': row['example_en'], 'exampleZh': row['example_zh'],
                      'sourceId': row['source_id']})
    by_lemma = {(word['level'], word['lemma'].lower()): word for word in words}
    report = {}
    for level, filename in [('CET4', '四级.jsonl'), ('CET6', '六级.jsonl')]:
        raw = read_snapshot('full_line_jsonl/sentence/正序/' + filename, cache)
        stats = {'sourceRecords': 0, 'imported': 0, 'missingExampleOrMeaning': 0, 'duplicates': 0,
                 'sha256': hashlib.sha256(raw).hexdigest()}
        for line in raw.decode('utf-8-sig').splitlines():
            if not line.strip():
                continue
            stats['sourceRecords'] += 1
            item = json.loads(line)
            lemma = item['word'].strip()
            key = (level, lemma.lower())
            meanings = [{'partOfSpeech': value.get('type', ''), 'definitionZh': value['translation'].strip()}
                        for value in item.get('translations', []) if value.get('translation', '').strip()]
            examples = [value for value in item.get('sentences', [])
                        if value.get('sentence', '').strip() and value.get('translation', '').strip()]
            if key in seen:
                stats['duplicates'] += 1
                existing = by_lemma[key]
                for meaning in meanings:
                    if meaning not in existing['meanings']:
                        existing['meanings'].append(meaning)
                pairs = existing.setdefault('examples', [{'exampleEn': existing['exampleEn'], 'exampleZh': existing['exampleZh']}])
                for example in examples:
                    pair = {'exampleEn': example['sentence'], 'exampleZh': example['translation']}
                    if pair not in pairs:
                        pairs.append(pair)
                continue
            if not meanings or not examples or not re.fullmatch(r"[A-Za-z][A-Za-z '\-]{0,59}", lemma):
                stats['missingExampleOrMeaning'] += 1
                continue
            seen.add(key)
            phonetic = item.get('uk') or item.get('us') or ''
            words.append({'id': level.lower() + '-' + hashlib.sha256(lemma.lower().encode()).hexdigest()[:16],
                          'level': level, 'lemma': lemma, 'ipa': '/' + phonetic.strip('/') + '/' if phonetic else '',
                          'partOfSpeech': meanings[0]['partOfSpeech'], 'definitionZh': meanings[0]['definitionZh'],
                          'meanings': meanings, 'exampleEn': examples[0]['sentence'],
                          'exampleZh': examples[0]['translation'], 'sourceId': 'kylebing-vocabulary',
                          'examples': [{'exampleEn': value['sentence'], 'exampleZh': value['translation']} for value in examples]})
            by_lemma[key] = words[-1]
            stats['imported'] += 1
        report[level] = stats

    materials = {r['id']: r['body'] for r in connection.execute('SELECT * FROM materials')}
    questions = []
    for row in connection.execute('SELECT q.*, a.* FROM questions q JOIN question_answer_keys a ON q.id=a.question_id WHERE q.status="published"'):
        questions.append({'id': row['id'], 'level': row['level'], 'type': row['type'], 'skill': row['skill'],
                          'prompt': row['prompt'], 'options': json.loads(row['options_json']),
                          'correctAnswer': row['correct_answer'], 'explanation': row['explanation'],
                          'hint': row['guidance'], 'guidance': row['guidance'],
                          'referenceAnswer': row['reference_answer'] or '', 'rubric': json.loads(row['rubric_json']),
                          'materialBody': materials.get(row['material_id'], ''), 'sourceId': row['source_id'],
                          'authenticity': 'original_mock'})
    overrides = json.loads((OUT / 'practice-explanations.json').read_text(encoding='utf-8'))
    for number, question in enumerate(questions):
        question.update(overrides.get(question['id'], {}))
        assert question['hint'] and question['explanation'], question['id']
        # The site's demo keys were all A. Preserve the answer while distributing
        # its label across the four positions so position alone gives no clue.
        options = question['options']
        if options:
            shift = number % len(options)
            ordered = options[-shift:] + options[:-shift] if shift else options
            correct = question['correctAnswer']
            question['options'] = []
            for position, option in enumerate(ordered):
                label = chr(ord('A') + position)
                if option['id'] == correct:
                    question['correctAnswer'] = label
                question['options'].append({'id': label, 'text': option['text']})
    papers = []
    for row in connection.execute("SELECT * FROM papers WHERE status='published'"):
        ids = [q['id'] for q in questions if q['level'] == row['level']]
        papers.append({'id': row['id'], 'level': row['level'], 'title': row['title'],
                       'description': '原创专项练习，含词汇、语法、阅读及主观自评；不是历年真题。',
                       'questionIds': ids, 'durationSeconds': row['duration_seconds'],
                       'authenticity': 'original_mock', 'sourceId': row['source_id']})
    original_sources = [dict(row) for row in connection.execute('SELECT * FROM content_sources')]
    connection.close()
    write_json('content.json', {'version': 1, 'words': words, 'questions': questions, 'papers': papers})
    pdfs = json.loads((source / 'apps/web/src/data/past-exam-pdfs.json').read_text(encoding='utf-8'))
    pdfs = [dict(p, authenticity='past_exam_resource', availabilityNote='资料卷：可阅读原卷/答案，不提供未经核对的在线判分。')
            for p in pdfs if p['year'] >= 2019]
    # Newer published source directories are links, never disguised as PDF/graded papers.
    for level in ('CET4', 'CET6'):
        for year, month in ((2024, 6), (2024, 12), (2025, 6), (2025, 12), (2026, 6)):
            pdfs.append({'id': f'{level.lower()}-{year}-{month:02}-sources', 'level': level,
                         'year': year, 'month': month, 'set': 0, 'kind': 'source_link',
                         'title': f'{year}年{month}月资料索引',
                         'sourceUrl': f'https://english-exam.lazynote.cn/{level.lower()}/',
                         'authenticity': 'past_exam_resource', 'hasListening': False,
                         'availabilityNote': '来源网站有该期目录；本项目尚未核对逐题答案/解析，暂不在线判分。'})
    write_json('past-exams.json', {'papers': pdfs})
    # Preserve rights metadata without importing accounts or attempts.
    write_json('provenance.json', {'vocabulary': {'repository': 'https://github.com/KyleBing/english-vocabulary',
               'commit': COMMIT, 'license': 'BSD-3-Clause', 'origin': 'Repository attributes vocabulary to kajweb/dict; dictionary data is not an official CET syllabus.'},
               'counts': {level: sum(w['level'] == level for w in words) for level in ('CET4', 'CET6')},
               'import': report, 'practiceSource': 'User supplied CET site, PROJECT-NONCOMMERCIAL-1.0',
               'practiceQuestionCount': len(questions), 'practiceSources': original_sources, 'latestCompletedExam': '2026-06',
               'resourceCount': len(pdfs), 'note': 'Audio is fetched on demand; historical paper resources are not a complete structured question bank.'})
    print(json.dumps({'words': len(words), 'questions': len(questions), 'papers': len(papers), 'resources': len(pdfs), 'report': report}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-project', type=Path, required=True)
    parser.add_argument('--cache-dir', type=Path, default=Path.home() / 'Downloads')
    args = parser.parse_args()
    build(args.source_project.resolve(), args.cache_dir.resolve())
