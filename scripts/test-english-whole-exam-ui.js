const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const crypto = require('node:crypto')
const { createService } = require('../server/services/english_learning')
const source = require('../server/src/english-content')

// Exercise the real service using isolated memory; no HTTP or production writes.
function memoryCloud(openid) {
  const tables = new Map()
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))
  function collection(name, query = {}) {
    if (!tables.has(name)) tables.set(name, new Map())
    const rows = tables.get(name)
    return {
      where: value => collection(name, value),
      get: async () => ({ data: [...rows.values()].filter(row => Object.entries(query).every(([key, value]) => value && value.__in ? value.__in.includes(row[key]) : row[key] === value)).map(clone) }),
      doc: id => ({ get: async () => ({ data: clone(rows.get(id) || null) }), set: async ({ data }) => rows.set(id, clone({ ...data, _id: id })) })
    }
  }
  const db = { collection, command: { in: values => ({ __in: values }) }, runTransaction: callback => callback() }
  db.collection('global_settings').doc('fixture').set({ data: { modules: { english: { enabled: true } } } })
  return { database: () => db, getWXContext: () => ({ OPENID: openid }) }
}

function loadAttempt(request, openid) {
  const storage = new Map([['openid', openid]])
  const scrolls = []
  let renderingComplete = false
  const wx = { getStorageSync: key => storage.get(key) || '', setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), pageScrollTo: options => {
    assert.equal(renderingComplete, true, 'scroll runs after the final setData render callback')
    if (!page.data.result) assert.equal(page.data.navigationExpanded, false, 'question navigation folds before scroll reset')
    scrolls.push(options)
  }, navigateBack() {} }
  let serial = 0
  function load(file) {
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, wx, Date, Math, console, setInterval: () => 1, clearInterval() {},
      require: ref => ref.endsWith('/english-api') ? { callEnglish: request, englishRequestId: () => 'whole-exam-' + ++serial, englishResourceUrl: value => value } : load(path.resolve(path.dirname(file), ref + '.ts')),
      Page: value => { module.exports = value } })
    return module.exports
  }
  const page = load(path.resolve(__dirname, '../miniprogram/packageEnglish/pages/attempt/attempt.ts'))
  page.setData = (values, callback) => { Object.assign(page.data, values); if (callback) { renderingComplete = true; try { callback() } finally { renderingComplete = false } } }
  page.scrolls = scrolls
  return page
}

async function run() {
  const content = source.content()
  const complete = content.papers.filter(paper => paper.coverage && (paper.coverage.fullPaper || paper.coverage.fullNonListening))
  const papers = ['CET4', 'CET6'].flatMap(level => [
    complete.find(paper => paper.level === level && paper.coverage.fullPaper),
    complete.find(paper => paper.level === level && paper.year === 2019 && paper.coverage.fullNonListening),
    complete.find(paper => paper.level === level && paper.year === 2026 && paper.coverage.fullNonListening)
  ].filter(Boolean))
  assert.ok(papers.every(Boolean), 'both CET levels have verified whole papers')
  for (const paper of papers) {
    const openid = 'whole-exam-ui-' + paper.id
    const cloud = memoryCloud(openid), db = cloud.database()
    const service = createService({ cloud, source, clock: () => new Date('2030-10-03T01:00:00Z') })
    const catalog = (await service.main({ action: 'papers', level: paper.level })).data
    for (const full of catalog.papers.filter(row => row.coverage && row.coverage.fullNonListening)) {
      assert.equal(full.questionCount, 32)
      assert.ok(full.questionIds.every(id => content.questionById.get(id).skill !== 'listening'))
      assert.ok(full.resources.every(resource => resource.type !== 'audio'))
    }
    assert.equal(catalog.coverage.completePapers, catalog.papers.filter(row => row.coverage && row.coverage.fullNonListening).length)
    if (paper.coverage.fullPaper) {
      await service.main({ action: 'home', level: paper.level })
      const profileId = crypto.createHash('sha256').update(openid).digest('hex')
      const profile = (await db.collection('english_profiles').doc(profileId).get()).data
      const legacyId = 'legacy-' + paper.id
      profile.activeExams['exam:' + paper.id + ':'] = legacyId
      await db.collection('english_profiles').doc(profileId).set({ data: profile })
      await db.collection('english_exam_attempts').doc(legacyId).set({ data: { id: legacyId, openid, level: paper.level, mode: 'exam', paper, questions: paper.questionIds.map(id => content.questionById.get(id)), answers: {}, hints: {}, status: 'active', startedAt: '2030-10-03T00:00:00Z', deadlineAt: '2030-10-03T03:00:00Z' } })
      const legacy = await service.main({ action: 'examDetail', attemptId: legacyId })
      assert.equal(legacy.data.total, 57, 'earlier full-paper attempt keeps its historical snapshot')
    }
    const calls = []
    const request = async (action, data) => {
      calls.push({ action, data })
      const response = await service.main({ action, ...data })
      assert.equal(response.success, true, action + ': ' + response.msg)
      return response.data
    }
    const page = loadAttempt(request, openid)
    page.setData({ paperId: paper.id, level: paper.level, mode: 'exam' })
    await page.loadAttempt()
    assert.equal(page.data.error, '')
    assert.equal(page.data.attempt.total, 32, 'one attempt contains all non-listening parts')
    assert.ok(!page.data.attempt.attemptId.startsWith('legacy-'), 'new non-listening entry never resumes the old 57-question scope')
    assert.equal(calls[0].data.paperId, paper.id)
    assert.equal(calls[0].data.questionIds, undefined, 'whole paper start does not slice question IDs')
    assert.equal(calls[0].data.skill, undefined, 'whole paper start does not slice sections')
    assert.deepEqual(Array.from(page.data.navigation, row => row.id), paper.questionIds.filter(id => content.questionById.get(id).skill !== 'listening'))
    assert.equal(page.data.navigationGroups.reduce((total, group) => total + group.questions.length, 0), 32, 'one navigator retains all non-listening sections')
    const questions = page.data.attempt.questions
    assert.equal(questions.filter(question => question.skill === 'writing').length, 1)
    assert.equal(questions.filter(question => question.skill === 'listening').length, 0)
    assert.equal(questions.filter(question => question.skill === 'reading').length, 30)
    assert.equal(questions.filter(question => question.skill === 'translation').length, 1)
    assert.ok(questions.every(question => !('correctAnswer' in question) && !('explanation' in question) && !('listeningTranscript' in question)), 'formal exam questions contain no answer material')
    assert.equal(calls.filter(call => call.action === 'examHint').length, 0, 'hint request is explicit')
    await page.showHint()
    assert.ok(page.data.hint)
    const attemptId = page.data.attempt.attemptId
    while (page.data.question) {
      const question = content.questionById.get(page.data.question.id)
      if (question.type === 'single_choice') page.chooseAnswer({ currentTarget: { dataset: { id: question.correctAnswer } } })
      else page.inputAnswer({ detail: { value: 'My ' + question.skill + ' answer.' } })
      await page.submitAnswer()
      assert.equal(page.data.error, '')
      assert.equal(page.data.feedback, null, 'formal feedback remains hidden through all sections')
      assert.equal(page.data.attempt.attemptId, attemptId, 'sections progress inside the same attempt')
      assert.equal(page.scrolls.at(-1).scrollTop, 0, 'next question starts at the top')
    }
    assert.equal(page.data.attempt.completed, 32)
    assert.equal(calls.filter(call => call.action === 'startExam').length, 1)
    assert.equal(calls.filter(call => call.action === 'finishExam').length, 0, 'finishing a section never submits the paper')
    await page.finishAttempt()
    assert.equal(page.data.result.total, 32)
    assert.equal(page.data.result.correctCount, 30)
    assert.equal(page.data.result.selfCheckPendingCount, 2)
    assert.equal(page.data.review.length, 32, 'one hand-in returns the full non-listening review')
    assert.equal(calls.filter(call => call.action === 'finishExam').length, 1)
    assert.equal(page.data.attempt.paper.coverage.listeningExcluded, true)
    assert.equal(page.data.attempt.paper.durationSeconds, 6000, 'non-listening exam lasts 100 minutes')
    const writing = page.data.review.find(row => row.question.skill === 'writing')
    assert.ok(writing.feedback.modelAnswer && writing.feedback.rubricText)
    const reviewScrolls = page.scrolls.length
    await page.markSelf({ currentTarget: { dataset: { id: writing.questionId, value: 'mastered' } } })
    assert.equal(page.data.result.selfCheckPendingCount, 1, 'whole-paper review retains subjective self assessment')
    assert.equal(page.scrolls.length, reviewScrolls, 'updating self assessment preserves the review scroll position')

    const draftPage = loadAttempt(request, openid)
    draftPage.setData({ paperId: paper.id, level: paper.level, mode: 'exam' })
    await draftPage.loadAttempt()
    const secondId = draftPage.data.attempt.attemptId
    assert.notEqual(secondId, attemptId)
    const draftAnswers = new Map()
    for (const skill of ['writing', 'reading', 'translation']) {
      const question = questions.find(row => row.skill === skill)
      draftPage.toggleNavigation()
      draftPage.chooseQuestion({ currentTarget: { dataset: { id: question.id } } })
      const answer = question.options.length ? question.options[0].id : 'Unsubmitted ' + skill + ' draft.'
      draftPage.inputAnswer({ detail: { value: answer } })
      draftAnswers.set(question.id, answer)
    }
    draftPage.toggleNavigation()
    draftPage.chooseQuestion({ currentTarget: { dataset: { id: writing.questionId } } })
    assert.equal(draftPage.data.answer, draftAnswers.get(writing.questionId), 'jumping back restores the local draft before rendering completes')
    const beforeFinish = calls.length
    await draftPage.finishAttempt()
    const handIn = calls.slice(beforeFinish)
    assert.equal(handIn.filter(call => call.action === 'saveExamDraft').length, 3, 'unified hand-in saves local drafts from all three parts')
    assert.equal(handIn.at(-1).action, 'finishExam')
    assert.ok(handIn.every(call => call.data.attemptId === secondId))
    for (const [id, answer] of draftAnswers) assert.equal(draftPage.data.review.find(row => row.questionId === id).answer, answer)
    assert.equal(draftPage.data.review.length, 32, 'unanswered questions remain in whole-paper review')
    console.log(paper.level + ' whole-paper UI: 32 questions without listening, one hand-in, drafts and self assessment passed')
  }
}

run().catch(error => { console.error(error); process.exitCode = 1 })
