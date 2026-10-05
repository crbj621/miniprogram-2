'use strict'

// Read-only corpus checks; no server or database is needed.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const examDir = path.join(root, 'server/data/english/exams')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const hash = text => crypto.createHash('sha256').update(text).digest('hex')
const canonical = question => question.canonicalId || question.id.replace(/-(?:reading|nonlistening)-q(?=\d+$)/, '-q')
const signature = question => JSON.stringify([question.level, question.number, question.section, normalize(question.prompt), normalize(question.passage), question.options.map(option => normalize(option.text)).sort()])
const words = text => (text.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g) || []).length
const periods = ['2019-06', '2019-12', '2020-07', '2020-09', '2020-12', '2021-06', '2021-12', '2022-06', '2022-09', '2022-12', '2023-03', '2023-06', '2023-12', '2024-06', '2024-12', '2025-06', '2025-12', '2026-06']
const expected = ['cet4', 'cet6'].flatMap(level => periods.flatMap(period => (period === '2020-07' ? [1] : [1, 2, 3]).map(set => `${level}-${period}-${set}-nonlistening`))).sort()
const filenames = fs.readdirSync(examDir).filter(file => file.endsWith('-nonlistening.json')).sort()
assert.deepEqual(filenames.map(file => file.slice(0, -5)), expected, 'Available source catalogue must cover 52 arrangements per level; this is not a nationwide exhaustive catalogue claim')

const references = Object.assign({}, ...['cet4', 'cet6'].map(level => read(path.join(root, `scripts/cet-subjective-reference-${level}.json`))))
assert.deepEqual(Object.keys(references).sort(), expected, 'All 104 original prompts need full project-authored references')
const bundles = filenames.map(file => read(path.join(examDir, file)))
for (const level of ['cet4', 'cet6']) for (const period of ['2020-09', '2022-06']) {
  const corrected = bundles.find(bundle => bundle.source.id === `${level}-${period}-3-nonlistening`)
  assert.equal(corrected.papers[0].coverage.readingSourceCorrection.sourceSet, `${period}-2`, 'Original third-set evidence must correct the public webpage association to set 2')
}
const restored = bundles.find(bundle => bundle.source.id === 'cet6-2021-12-3-nonlistening')
const restoredBank = restored.questions.filter(question => question.section === 'reading_word_bank')
assert.match(restoredBank[0].passage, /According to psychologist Sharon Draper/)
assert.equal(restoredBank.map(question => question.correctAnswer).join(''), 'BDOAIEGJMF', 'Original reference-image key for the previously missing bank')
assert.ok(restoredBank.every(question => question.canonicalId.startsWith('wordcram-')))
assert.equal(Object.keys(restored.papers[0].coverage.sharedSectionSource).length, 0, 'The repaired word bank is not the optimism/longevity bank from collection set 1')
const older = fs.readdirSync(examDir).filter(file => file.endsWith('.json') && !file.endsWith('-nonlistening.json')).flatMap(file => read(path.join(examDir, file)).questions || []).filter(question => question.skill === 'reading')
const olderIds = new Map(older.map(question => [canonical(question), question]))
const canonicalGroups = new Map()
const recordCanonical = question => {
  const id = canonical(question)
  const answer = normalize(question.options.find(option => option.id === question.correctAnswer).text)
  if (canonicalGroups.has(id)) {
    const existing = canonicalGroups.get(id)
    assert.equal(signature(question), existing.signature, `Canonical id ${id} merged different question texts: ${existing.id} and ${question.id}`)
    assert.equal(answer, existing.answer, `Canonical id ${id} has conflicting published answer text`)
    existing.occurrences += 1
  } else canonicalGroups.set(id, { id: question.id, signature: signature(question), answer, occurrences: 1 })
}
older.forEach(recordCanonical)

let objectiveCount = 0
let subjectiveCount = 0
let sharedArrangements = 0
let unconfirmedArrangements = 0
let disputes = 0
let reusedReviewedQuestions = 0
const paperIds = new Set()
for (const bundle of bundles) {
  assert.equal(bundle.status, 'verified_structured')
  assert.equal(bundle.papers.length, 1)
  const paper = bundle.papers[0]
  const { coverage } = paper
  assert.equal(bundle.source.id, paper.id)
  assert.equal(paper.authenticity, 'past_exam')
  assert.equal(coverage.fullPaper, false, `${paper.id} excludes listening and cannot be marked fullPaper`)
  assert.equal(coverage.listeningExcluded, true)
  assert.equal(coverage.referenceStatus, 'project_authored')
  assert.equal(paper.questionIds.length, 32)
  assert.equal(bundle.questions.length, 32)
  assert.deepEqual(paper.questionIds, bundle.questions.map(question => question.id))
  assert.equal(new Set(paper.questionIds).size, 32)
  assert.equal(paperIds.has(paper.id), false)
  paperIds.add(paper.id)
  assert.deepEqual(bundle.questions.map(question => question.number), ['I', ...Array.from({ length: 30 }, (_, index) => 26 + index), 'IV'])
  const sections = bundle.questions.reduce((counts, question) => ({ ...counts, [question.section]: (counts[question.section] || 0) + 1 }), {})
  assert.deepEqual(sections, { writing: 1, reading_word_bank: 10, reading_matching: 10, reading_comprehension: 10, translation: 1 })
  assert.deepEqual(coverage.objectiveNumbers, Array.from({ length: 30 }, (_, index) => 26 + index))
  assert.equal(coverage.objectiveCount, 30)
  assert.equal(coverage.subjectiveCount, 2)
  assert.match(bundle.source.textUrl, /^https:\/\/english-exam\.lazynote\.cn\/cet[46]\/paper\//)
  assert.match(bundle.source.textSha256, /^[a-f0-9]{64}$/)
  assert.ok(bundle.source.sourceRightsNotice.includes('版权'))
  assert.equal(bundle.source.answerSources.length, 4)
  for (const source of bundle.source.answerSources) assert.match(source.sha256, /^[a-f0-9]{64}$/)
  const shared = Object.keys(coverage.sharedSectionSource).length > 0
  if (shared) sharedArrangements += 1
  if (!coverage.fullNonListening) {
    unconfirmedArrangements += 1
    assert.ok(shared)
    assert.ok(!coverage.independentlyConfirmedSharedSource && !coverage.readingSourceCorrection)
    assert.match(paper.title, /编排待核对/)
    assert.match(paper.description, /不能称完整真题/)
  } else if (shared) assert.ok(coverage.independentlyConfirmedSharedSource || coverage.readingSourceCorrection, `${paper.id} shared reading requires independent original-paper evidence`)
  for (const question of bundle.questions) {
    assert.equal(question.level, paper.level)
    assert.equal(question.sourceId, paper.id)
    assert.equal(question.authenticity, 'past_exam')
    assert.ok(question.prompt && question.hint && question.explanation)
    if (question.skill === 'reading') {
      objectiveCount += 1
      assert.equal(question.type, 'single_choice')
      assert.ok(question.passage.length > 100)
      assert.ok(question.options.every(option => option.id && option.text))
      assert.equal(new Set(question.options.map(option => option.id)).size, question.options.length)
      assert.ok(question.options.some(option => option.id === question.correctAnswer), `${question.id} answer is absent from choices`)
      if (question.section === 'reading_word_bank') {
        assert.deepEqual(question.options.map(option => option.id), Array.from('ABCDEFGHIJKLMNO'))
        assert.ok(question.passage.includes(`[${question.number}]`))
      } else if (question.section === 'reading_comprehension') assert.deepEqual(question.options.map(option => option.id), Array.from('ABCD'))
      else {
        assert.ok(question.options.length >= 9)
        for (const option of question.options) assert.match(question.passage, new RegExp(`(?:^|\\n)${option.id}\\)`))
      }
      assert.ok(question.canonicalId)
      if (question.canonicalId.startsWith('wordcram-')) {
        assert.equal(question.section, 'reading_word_bank')
        assert.ok(coverage.sectionSourceReplacement)
        assert.match(question.canonicalId, /^wordcram-cet6-2021-12-1-q\d+$/)
      } else if (!question.canonicalId.startsWith('lazynote-')) {
        const reviewed = olderIds.get(question.canonicalId)
        assert.ok(reviewed, `${question.id} unqualified canonical id must come from an existing reviewed question`)
        assert.equal(signature(question), signature(reviewed))
        reusedReviewedQuestions += 1
      }
      if (question.referenceDispute) {
        disputes += 1
        assert.ok(bundle.source.corrections.some(correction => correction.questionNumber === question.number))
        assert.equal(question.referenceDispute.publishedAnswer, question.correctAnswer)
        assert.notEqual(question.referenceDispute.publicSourceAnswer, question.correctAnswer)
        assert.match(question.explanation, /分歧/)
        assert.match(bundle.source.answerStatus, /disputes/)
      }
      recordCanonical(question)
    } else {
      subjectiveCount += 1
      const supplied = references[paper.id][question.skill]
      assert.equal(question.type, 'short_text_self_check')
      assert.equal(question.referenceType, 'project_authored_reference')
      assert.equal(question.referenceAnswer, supplied.referenceAnswer.trim())
      assert.equal(question.correctAnswer, question.referenceAnswer)
      assert.ok(question.rubric.length >= 3)
      assert.doesNotMatch(question.referenceAnswer + question.guidance + question.explanation, /当前为自查框架|非完整范文|非完整参考译文|待补|TODO|PLACEHOLDER/i)
      const promptHashes = [hash(question.prompt)]
      if (question.skill === 'translation') promptHashes.push(hash(question.prompt.split('\n\n').slice(1).join('\n\n')))
      assert.ok(promptHashes.includes(supplied.sourcePromptSha256), `${question.id} reference must be bound to this exact original prompt`)
      if (question.skill === 'writing') {
        const minimum = Number((question.prompt.match(/at least\s+(\d+)\s+words/i) || [0, paper.level === 'CET4' ? 120 : 150])[1])
        const maximum = Number((question.prompt.match(/no more than\s+(\d+)\s+words/i) || [0, paper.level === 'CET4' ? 180 : 200])[1])
        let answerWords = words(question.referenceAnswer)
        if (/not including the sentence given/i.test(question.prompt)) answerWords -= words(question.referenceAnswer.split(/[.!?](?:\s|$)/)[0])
        assert.ok(answerWords >= minimum && answerWords <= maximum, `${question.id} reference word count ${answerWords} must be ${minimum}-${maximum}`)
        if (/\b(?:graph|chart|picture|cartoon)\s+below\b/i.test(question.prompt)) assert.ok(question.materialImages?.length && question.passage, `${question.id} requires the original image and accessible data`)
      } else assert.ok(words(question.referenceAnswer) >= 45, `${question.id} needs a complete translation, not a placeholder`)
    }
  }
}
assert.equal(objectiveCount, 3120)
assert.equal(subjectiveCount, 208)
const manifest = read(path.join(root, 'server/data/english/nonlistening-coverage.json'))
assert.equal(manifest.expectedSourceSets, 104)
assert.equal(manifest.importedSets, 104)
assert.equal(manifest.questions, 3328)
assert.deepEqual(manifest.levelSets, { CET4: 52, CET6: 52 })
assert.equal(manifest.completeNonListeningSets, 104 - unconfirmedArrangements)
assert.equal(manifest.completeSubjectiveReferenceSets, 104)
assert.equal(manifest.sharedReadingArrangements, sharedArrangements)
assert.equal(manifest.answerDisputes, disputes)
assert.equal(manifest.uniqueReadingQuestions, new Set(bundles.flatMap(bundle => bundle.questions.filter(question => question.skill === 'reading').map(question => question.canonicalId))).size)
assert.equal(manifest.reusedReviewedQuestionOccurrences, reusedReviewedQuestions)
assert.deepEqual(manifest.papers.map(paper => paper.paperId).sort(), expected)
assert.deepEqual(manifest.unconfirmedArrangements.sort(), bundles.filter(bundle => !bundle.papers[0].coverage.fullNonListening).map(bundle => bundle.papers[0].id).sort())
assert.deepEqual(manifest.failures, [])
if (process.argv.includes('--require-full-coverage')) assert.equal(unconfirmedArrangements, 0, 'Original-paper arrangements need independent evidence before all 104 can be claimed as full non-listening papers')
console.log(JSON.stringify({ sourceCatalogueArrangements: 104, objectiveOccurrences: objectiveCount, completeSubjectiveReferences: subjectiveCount, sharedArrangements, unconfirmedArrangements, answerDisputes: disputes, reusedReviewedQuestions, canonicalReadingQuestionsIncludingOlderPapers: canonicalGroups.size }, null, 2))
