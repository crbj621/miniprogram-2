const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadPage(name, request, packageName = 'packageEnglish') {
  const storage = new Map([['openid', 'learner']])
  const navigation = []
  const scrolls = []
  const timerHandles = new Set()
  const wx = { getStorageSync: key => storage.get(key) || '', setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), navigateTo: options => navigation.push(options.url), redirectTo: options => navigation.push(options.url), pageScrollTo: options => scrolls.push(options), showToast() {} }
  let serial = 0
  function load(file) {
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, wx, Date, Math, console, setInterval: () => { const handle = {}; timerHandles.add(handle); return handle }, clearInterval: handle => timerHandles.delete(handle),
      require: ref => ref.endsWith('/english-api') ? { callEnglish: request, englishRequestId: () => 'request-' + ++serial, englishResourceUrl: value => value } : load(path.resolve(path.dirname(file), ref + '.ts')),
      Page: value => { module.exports = value } })
    return module.exports
  }
  const page = load(path.resolve(__dirname, '../miniprogram/' + packageName + '/pages/' + name + '/' + name + '.ts'))
  page.setData = (data, complete) => { Object.assign(page.data, data); if (complete) complete() }
  page.navigation = navigation
  page.scrolls = scrolls
  page.timerHandles = timerHandles
  page.storage = storage
  return page
}

function checkNavigation() {
  let definition
  const redirects = [], toasts = []
  const file = path.resolve(__dirname, '../miniprogram/packageEnglish/components/english-nav/english-nav.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText
  vm.runInNewContext(code, { Component: value => { definition = value }, wx: { redirectTo: options => redirects.push(options), showToast: value => toasts.push(value) } })
  const navigation = Object.assign({ data: definition.data, properties: { current: 'words', level: 'CET6' } }, definition.methods)
  const click = id => navigation.switchSection({ currentTarget: { dataset: { id } } })
  click('words'); click('unknown')
  assert.equal(redirects.length, 0, 'current or unknown sections cannot navigate')
  click('papers'); click('challenge')
  assert.equal(redirects.length, 1, 'repeated navigation taps are blocked until completion')
  assert.match(redirects[0].url, /pages\/papers\/papers\?level=CET6$/, 'navigation preserves selected level')
  redirects[0].fail(); redirects[0].complete()
  assert.equal(toasts.length, 1, 'navigation failure offers retry instead of silent inactivity')
  for (const id of ['papers', 'challenge', 'rank']) {
    click(id)
    const redirect = redirects[redirects.length - 1]
    assert.match(redirect.url, new RegExp('pages/' + id + '/' + id + '\\?level=CET6$'))
    redirect.complete()
  }
  navigation.properties.current = 'rank'
  navigation.properties.level = 'invalid'
  click('words')
  assert.match(redirects[redirects.length - 1].url, /pages\/index\/index\?level=CET4$/, 'word section resolves to its actual page and valid level')
}

async function run() {
  checkNavigation()
  const home = loadPage('index', async () => {})
  home.applyHome({ level: 'CET4', plan: { newGoal: 10, reviewGoal: 10 }, today: { newCount: 20, reviewCount: 0, checkedIn: false, checkedAt: null } })
  assert.equal(home.data.progress, 50, 'extra new words cannot replace review targets')
  assert.equal(home.data.home.today.checkedIn, false, 'UI cannot grant check-in')
  home.data.home.plan.needsUpdate = true
  home.openStudy({ currentTarget: { dataset: { mode: 'new' } } })
  assert.equal(home.navigation.length, 0, 'unreachable daily targets cannot begin counted learning')
  home.openStudy({ currentTarget: { dataset: { mode: 'spelling' } } })
  assert.match(home.navigation[0], /mode=spelling/, 'independent spelling remains available')
  home.data.home = null
  home.openPage({ currentTarget: { dataset: { page: 'history' } } })
  assert.match(home.navigation[1], /papers\?level=CET4&view=history/, 'history remains reachable when home request fails')
  home.data.home = { plan: { needsUpdate: false }, extraStudy: { enabled: true, maxCount: 100, newAvailable: 20, reviewAvailable: 2 } }
  home.inputExtraCount({ detail: { value: '3' } }); home.openStudy({ currentTarget: { dataset: { mode: 'new' } } })
  assert.match(home.navigation[2], /mode=new&extraCount=3$/, 'completed daily tasks open the chosen extra batch')
  const navigations = home.navigation.length
  home.openStudy({ currentTarget: { dataset: { mode: 'review' } } })
  assert.equal(home.navigation.length, navigations, 'extra batch cannot exceed actual eligible old words')
  assert.match(home.data.error, /剩余2/)
  for (const value of ['0', '101', '1.5', '-1', 'abc']) { home.inputExtraCount({ detail: { value } }); home.openStudy({ currentTarget: { dataset: { mode: 'new' } } }); assert.equal(home.navigation.length, navigations) }
  home.inputExtraCount({ detail: { value: '2' } }); home.openStudy({ currentTarget: { dataset: { mode: 'review' } } })
  assert.match(home.navigation.at(-1), /mode=review&extraCount=2$/)

  home.data.home.extraStudy = { enabled: true, maxCount: 100, newAvailable: 0, reviewAvailable: 0, activeModes: ['new', 'review'] }
  home.inputExtraCount({ detail: { value: '10' } })
  for (const mode of ['new', 'review']) {
    const beforeResume = home.navigation.length
    home.openStudy({ currentTarget: { dataset: { mode } } })
    assert.equal(home.navigation.length, beforeResume + 1)
    assert.match(home.navigation.at(-1), new RegExp('mode=' + mode + '$'), 'an unfinished batch resumes before validating a new quantity or remaining pool')
  }
  home.inputExtraCount({ detail: { value: 'invalid' } })
  const beforeInvalidResume = home.navigation.length
  home.openStudy({ currentTarget: { dataset: { mode: 'new' } } })
  assert.equal(home.navigation.length, beforeInvalidResume + 1)
  assert.match(home.navigation.at(-1), /mode=new$/, 'a resume does not require a valid new-batch quantity')
  home.data.home.extraStudy.activeModes = []
  home.inputExtraCount({ detail: { value: '1' } })
  const afterResume = home.navigation.length
  home.openStudy({ currentTarget: { dataset: { mode: 'new' } } })
  assert.equal(home.navigation.length, afterResume, 'a completed batch cannot bypass the empty new-word pool')
  assert.match(home.data.error, /新词已学完/)

  const calls = []
  let retry = true
  const study = loadPage('study', async (action, data) => {
    calls.push({ action, data })
    if (action === 'studyHint') return { hint: 'look at the example' }
    if (retry) { retry = false; throw new Error('network lost') }
    return { feedback: { correct: false, lemma: 'book', definitionZh: '书', meanings: [{ partOfSpeech: 'n.', definitionZh: '书' }, { partOfSpeech: 'v.', definitionZh: '预订' }] }, session: { sessionId: 'session', total: 2, completed: 1, question: { id: 'repeated', options: [] } } }
  })
  study.showSession({ sessionId: 'session', total: 1, completed: 0, question: { id: 'first', hasHint: true, options: [] } })
  assert.equal(study.scrolls[0].scrollTop, 0, 'first word begins at the top after rendering')
  assert.equal(calls.length, 0, 'hints are never requested automatically')
  await study.showHint()
  assert.equal(study.data.hint, 'look at the example')
  await study.answer('wrong')
  await study.answer('wrong')
  assert.equal(calls[1].data.requestId, calls[2].data.requestId, 'network retry keeps idempotency key')
  assert.equal(study.data.question.id, 'first', 'answer feedback keeps original question visible')
  assert.match(study.data.feedback.meaningText, /预订/, 'all meanings must be revealed')
  assert.equal(study.data.total, 2, 'wrong-word recurrence uses the expanded server queue total')
  assert.equal(study.data.completed, 1)
  assert.equal(study.scrolls.length, 1, 'answer feedback does not automatically skip or scroll away from translations')
  study.continueStudy()
  assert.equal(study.data.question.id, 'repeated', 'continue reveals server-selected repeated word')
  assert.equal(study.data.feedback, null, 'next word removes the previous long feedback')
  assert.equal(study.scrolls[1].scrollTop, 0, 'next word returns to the top after the new card renders')
  study.continueStudy()
  assert.equal(study.scrolls.length, 2, 'double tapping next cannot skip a second word')
  study.showSession({ sessionId: 'session', status: 'completed', total: 2, completed: 2, question: null })
  assert.equal(study.data.question, null, 'last next opens the completed state within the same page')
  assert.equal(study.data.progress, 100)
  let rejectHint
  const lateHint = loadPage('study', () => new Promise((resolve, reject) => { rejectHint = reject }))
  lateHint.showSession({ sessionId: 'hint-session', question: { id: 'old' } })
  const hintRequest = lateHint.showHint()
  lateHint.showSession({ sessionId: 'hint-session', question: { id: 'new' } })
  rejectHint(new Error('old request failed')); await hintRequest
  assert.equal(lateHint.data.error, '', 'late hint failure cannot overwrite the next question')
  assert.equal(lateHint.data.hintLoading, false, 'next question has its own hint state')

  let releaseDraft
  const examCalls = []
  const questions = [{ id: 'q1', prompt: 'Write', options: [] }, { id: 'q2', prompt: 'Choose', options: [{ id: 'A', text: 'A' }] }]
  const attempt = { attemptId: 'attempt', status: 'active', index: 0, completed: 0, questions, answers: [], drafts: { q1: 'server draft' }, question: questions[0], paper: { title: 'Original' } }
  const exam = loadPage('attempt', async (action, data) => {
    examCalls.push({ action, data })
    if (action === 'saveExamDraft') return new Promise(resolve => { releaseDraft = () => resolve({ attempt }) })
    return { feedback: null, attempt: { ...attempt, completed: 1, question: questions[1], answers: [{ questionId: 'q1', checked: true, answer: data.answer }] } }
  })
  exam.data.mode = 'exam'; exam.showAttempt(attempt)
  assert.equal(exam.data.answer, 'server draft', 'server draft restores when local draft is absent')
  const saving = exam.saveDraft()
  exam.inputAnswer({ detail: { value: 'new writing' } })
  releaseDraft(); await saving
  assert.equal(exam.data.answer, 'new writing', 'late draft response preserves newer text')
  assert.equal(exam.data.savedNote, '', 'late save does not claim newer draft was saved')
  await exam.submitAnswer()
  assert.equal(exam.data.feedback, null, 'exam cannot reveal answer before submission')
  assert.equal(exam.data.question.id, 'q2')
  exam.chooseQuestion({ currentTarget: { dataset: { id: 'q1' } } })
  assert.equal(exam.data.answer, 'new writing', 'question navigation restores saved answer')

  const handInCalls = []
  const handIn = loadPage('attempt', async (action, data) => {
    handInCalls.push({ action, data })
    if (action === 'saveExamDraft') return { attempt }
    return { status: 'submitted', review: [{ question: questions[1], questionId: 'q2', answer: 'A', feedback: { correct: true, correctAnswer: 'A', explanation: 'Evidence', listeningTranscript: 'Full audio transcript' } }] }
  })
  handIn.data.mode = 'exam'; handIn.showAttempt(attempt)
  handIn.inputAnswer({ detail: { value: 'unfinished writing' } })
  handIn.chooseQuestion({ currentTarget: { dataset: { id: 'q2' } } })
  handIn.chooseAnswer({ currentTarget: { dataset: { id: 'A' } } })
  await handIn.finishAttempt()
  assert.equal(handInCalls[0].data.answer, 'unfinished writing', 'hand-in uploads earlier question local draft')
  assert.equal(handInCalls[1].data.answer, 'A', 'hand-in uploads current answer without separate save')
  assert.equal(handInCalls[2].action, 'finishExam', 'all local drafts save before grading')
  assert.equal(handIn.data.review[0].answerText, 'A. A', 'review includes selected option text')
  assert.equal(handIn.data.review[0].feedback.listeningTranscript, 'Full audio transcript', 'review preserves server listening transcript')

  const preservedCalls = []
  const preserved = loadPage('attempt', async (action, data) => { preservedCalls.push({ action, data }); return action === 'finishExam' ? { status: 'submitted', review: [] } : { attempt } })
  preserved.data.mode = 'exam'; preserved.showAttempt({ ...attempt, answers: [{ questionId: 'q2', answer: 'A', checked: true }] })
  preserved.inputAnswer({ detail: { value: 'current draft' } })
  await preserved.finishAttempt()
  assert.equal(preservedCalls.filter(call => call.action === 'saveExamDraft').length, 1, 'missing local storage must not clear an already saved server answer')
  assert.equal(preservedCalls[0].data.questionId, 'q1')

  let gradingRequested = false
  const failedHandIn = loadPage('attempt', async action => { if (action === 'finishExam') gradingRequested = true; throw new Error('network lost') })
  failedHandIn.data.mode = 'exam'; failedHandIn.showAttempt(attempt)
  failedHandIn.inputAnswer({ detail: { value: 'must not disappear' } })
  await failedHandIn.finishAttempt()
  assert.equal(gradingRequested, false, 'failed draft save cannot grade an older answer')
  assert.equal(failedHandIn.storage.get(failedHandIn.draftKey()).answer, 'must not disappear', 'failed hand-in keeps local draft for retry')

  const materialQuestions = [{ ...questions[0], passage: 'A shared reading', number: 46, section: 'Reading' }, { ...questions[1], passage: 'A shared reading', number: 47, section: 'Reading' }]
  const materialExam = loadPage('attempt', async () => {})
  materialExam.showAttempt({ ...attempt, questions: materialQuestions, question: materialQuestions[0] })
  materialExam.toggleMaterial()
  materialExam.chooseQuestion({ currentTarget: { dataset: { id: 'q2' } } })
  assert.equal(materialExam.data.materialExpanded, false, 'shared passage collapse survives next question')
  assert.equal(materialExam.data.question.number, 47, 'original exam question numbering is preserved')

  const paperPage = loadPage('papers', async action => action === 'wrongQuestions' ? { items: [{ question: questions[1] }] } : { papers: [
    { id: 'resource', available: false, year: 2025, authenticity: 'past_exam_resource' },
    { id: 'partial', available: true, year: 2025, authenticity: 'past_exam', coverage: { fullPaper: false, note: 'Reading only' } },
    { id: 'full', available: true, year: 2025, authenticity: 'past_exam', coverage: { fullNonListening: true } },
    { id: 'mock', available: true, year: 2025, authenticity: 'original_mock', questionCount: 16 }
  ] })
  await paperPage.loadPapers()
  assert.equal(paperPage.data.papers[1].isFullPaper, false, 'reading-only paper never claims a whole exam')
  assert.equal(paperPage.data.papers[2].isFullPaper, true, 'whole exam requires verified source and server coverage confirmation')
  assert.equal(paperPage.data.visiblePapers.length, 1, 'default online list only contains a complete real paper')
  assert.equal(paperPage.data.visiblePapers[0].id, 'full')
  paperPage.openAttempt({ currentTarget: { dataset: { id: 'partial', mode: 'exam' } } })
  assert.equal(paperPage.navigation.length, 0, 'partial source cannot open the whole-paper exam entry')
  paperPage.openAttempt({ currentTarget: { dataset: { id: 'full', mode: 'exam' } } })
  assert.match(paperPage.navigation[0], /paperId=full&mode=exam/, 'whole entry selects one full paper without a question subset')
  assert.ok(!paperPage.navigation[0].includes('questionIds='))
  paperPage.data.kind = 'resource'; paperPage.filterPapers()
  assert.equal(paperPage.data.visiblePapers.length, 2, 'partial papers remain labeled sources and short original exercises are not whole-paper resources')
  paperPage.data.view = 'wrong'; await paperPage.loadPapers()
  paperPage.practiceWrong({ currentTarget: { dataset: {} } })
  assert.match(decodeURIComponent(paperPage.navigation[1]), /questionIds=\["q2"\]/, 'wrong practice sends actual selected question IDs')

  const taskCalls = []
  const campusTasks = loadPage('tasks', async (action, data) => { taskCalls.push({ action, data }); return { coins: 15, runGoalKm: 3, pendingRunGoal: { goalKm: data.goalKm, appliesOn: '2026-10-04' }, tasks: [] } }, 'packageProfile')
  campusTasks.data.goalKm = '0.1'; await campusTasks.saveGoal()
  assert.equal(taskCalls.length, 0, 'invalid running goal cannot be saved')
  campusTasks.data.goalKm = '5'; await campusTasks.saveGoal()
  assert.match(campusTasks.data.savedNote, /2026-10-04/, 'frozen running goal shows actual effective date')
  campusTasks.data.tasks = [{ id: 'closed', available: false, path: '/pages/index/index' }]
  campusTasks.openTask({ currentTarget: { dataset: { id: 'closed' } } })
  assert.equal(campusTasks.navigation.length, 0, 'closed reward task cannot navigate through module guard')

  const adminCalls = []
  const settings = { newReward: 10, reviewReward: 10, challengeReward: 5, runningReward: 10, commentReward: 3, photoReward: 2, likeReward: 1, likeDailyCap: 5 }
  const overview = { admin: { role: 'super' }, settings, counts: { realPapers: 2, fullRealPapers: 1 } }
  const englishAdmin = loadPage('admin', async (action, data) => { adminCalls.push({ action, data }); return overview })
  englishAdmin._active = true; englishAdmin.applyOverview(overview)
  englishAdmin.data.form.likeDailyCap = '21'; await englishAdmin.saveRewards()
  assert.equal(adminCalls.length, 0, 'admin cannot save an excessive like reward cap')
  englishAdmin.data.form.likeDailyCap = '20'; await englishAdmin.saveRewards()
  assert.equal(adminCalls[0].data.settings.likeDailyCap, 20, 'admin saves like cap separately from coin amounts')
  assert.equal(adminCalls[0].data.settings.runningReward, 10, 'admin saves shared running reward configuration')

  const challengeCalls = []
  const challenge = loadPage('challenge', async (action, data) => {
    challengeCalls.push({ action, data })
    if (action === 'answerChallenge') return { attemptId: 'challenge-attempt', remainingSeconds: 80, total: 2, completed: 1, index: 1, question: { id: 'c2', options: [] } }
    return { correctCount: 1, total: 2, answeredCount: 1, rank: { myRank: 7 } }
  })
  challenge.showChallenge({ attemptId: 'challenge-attempt', remainingSeconds: 90, total: 2, completed: 0, question: { id: 'c1', options: [] } })
  await challenge.chooseAnswer({ currentTarget: { dataset: { id: 'A' } } })
  assert.equal(challenge.data.result, null, 'live challenge cannot reveal correctness or local score')
  await challenge.finishChallenge()
  assert.equal(challenge.data.result.myRank, 7, 'final rank comes from server')
  assert.equal(challengeCalls.filter(call => call.action === 'finishChallenge').length, 1)

  const deadlineAt = new Date(Date.now() + 90000).toISOString()
  const resumedChallenge = { status: 'active', attemptId: 'late-challenge', deadlineAt, remainingSeconds: 80, total: 2, completed: 1, question: { id: 'c2', options: [] } }
  let releaseChallengeAnswer
  const backgroundChallenge = loadPage('challenge', action => action === 'answerChallenge' ? new Promise(resolve => { releaseChallengeAnswer = resolve }) : Promise.resolve(resumedChallenge))
  backgroundChallenge.showChallenge({ ...resumedChallenge, completed: 0, question: { id: 'c1', options: [] } })
  const backgroundAnswer = backgroundChallenge.chooseAnswer({ currentTarget: { dataset: { id: 'A' } } })
  backgroundChallenge.onHide()
  releaseChallengeAnswer(resumedChallenge); await backgroundAnswer
  assert.equal(backgroundChallenge.timerHandles.size, 0, 'late answer cannot restart a timer after leaving the challenge section')
  assert.equal(backgroundChallenge.deadline, Date.parse(deadlineAt), 'remaining-time updates cannot extend the server challenge deadline')
  backgroundChallenge.onShow()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(backgroundChallenge.timerHandles.size, 1, 'returning resumes exactly one timer from the server attempt')
  backgroundChallenge.onUnload()
  assert.equal(backgroundChallenge.timerHandles.size, 0, 'unloading the redirected section clears its timer')
  console.log('英语学习页面行为回归通过：分区导航、计划、提示、释义、连续切词复位、重试、交卷草稿、完整复盘、真题整卷入口、错题、校园任务、挑战成绩')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
