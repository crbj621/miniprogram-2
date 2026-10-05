'use strict'

// Default: isolated memory fixtures. --database: explicitly named disposable MariaDB only.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { AsyncLocalStorage } = require('node:async_hooks')
const { execFile } = require('node:child_process')
const { createService } = require('../services/english_learning')
const actualContent = require('../src/english-content')
const { reviewMemory } = require('../src/english-fsrs')
const databaseMode = process.argv.includes('--database') || process.argv.includes('--worker')
if (databaseMode && !/^campus_english_(test|review)_[A-Za-z0-9_]+$/.test(process.env.DB_NAME || '')) throw new Error('Database regression requires a disposable campus_english_test_* or campus_english_review_* database')
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const key = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex')
const prefix = 'english-test-' + crypto.randomBytes(5).toString('hex')
const owner = prefix + '-a', peer = prefix + '-b', zero = prefix + '-zero', admin = prefix + '-admin'
let checks = 0, failure = null
function check(value, message) { assert.ok(value, message); checks++ }
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++ }

function memoryCloud() {
  const context = new AsyncLocalStorage()
  let tables = new Map(), queue = Promise.resolve()
  const table = name => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name) }
  function collection(name, where = {}) {
    return {
      where: query => collection(name, query),
      get: async () => ({ data: [...table(name).entries()].map(([id, value]) => ({ ...clone(value), _id: id })).filter(row => Object.entries(where).every(([field, expected]) => expected && expected.__in ? expected.__in.includes(row[field]) : row[field] === expected)) }),
      add: async ({ data }) => { const id = crypto.randomUUID(); table(name).set(id, clone({ ...data, _id: id })); return { _id: id } },
      doc(id) {
        return {
          get: async () => ({ data: clone(table(name).get(id) || null) }),
          set: async ({ data }) => { table(name).set(id, clone({ ...data, _id: id })); return { _id: id } },
          create: async ({ data }) => { if (table(name).has(id)) throw new Error('Duplicate fixture document'); table(name).set(id, clone({ ...data, _id: id })); return { _id: id } },
          remove: async () => table(name).delete(id)
        }
      }
    }
  }
  const db = { command: { in: values => ({ __in: values }) }, collection,
    async runTransaction(callback) {
      let release
      const before = queue
      queue = new Promise(resolve => { release = resolve })
      await before
      const snapshot = clone([...tables.entries()].map(([name, values]) => [name, [...values.entries()]]))
      try { const result = await callback(); if (result && result.success === false) tables = new Map(snapshot.map(([name, values]) => [name, new Map(values)])); return result }
      catch (error) { tables = new Map(snapshot.map(([name, values]) => [name, new Map(values)])); throw error }
      finally { release() }
    }
  }
  return { database: () => db, getWXContext: () => ({ OPENID: context.getStore()?.openid || '' }), __runWithContext: (value, callback) => context.run(value, callback) }
}

const sdk = databaseMode ? require('campus-server-sdk') : memoryCloud()
const db = sdk.database()
const guardedDb = { ...db, collection(name) {
  const collection = db.collection(name)
  const doc = collection.doc.bind(collection)
  collection.doc = id => {
    const reference = doc(id)
    for (const method of ['set', 'create']) {
      const original = reference[method].bind(reference)
      reference[method] = async value => { if (failure && failure.name === name && failure.method === method) { failure = null; throw new Error('Injected transaction failure') } return original(value) }
    }
    return reference
  }
  return collection
} }
const guardedSdk = { ...sdk, database: () => guardedDb }
const words = ['CET4', 'CET6'].flatMap(level => Array.from({ length: 32 }, (_, index) => ({
  id: level + '-word-' + index, level, lemma: level.toLowerCase() + 'word' + index,
  ipa: '/test/', partOfSpeech: index < 24 ? 'n.' : 'v.', definitionZh: level + '释义' + index,
  meanings: [{ partOfSpeech: 'n.', definitionZh: level + '释义' + index }], exampleEn: 'A sample sentence.', exampleZh: '示例句子。', audioUrl: '/api/english/audio?word=sample'
})))
// A secondary sense overlaps the first word: it must never become a distractor.
words[1].meanings.push({ partOfSpeech: 'v.', definitionZh: '别的义项；CET4释义0' })
const questions = [
  { id: 'fixture-choice', level: 'CET4', type: 'single_choice', skill: 'reading', prompt: 'Choose one.', options: [{ id: 'A', text: 'Correct' }, { id: 'B', text: 'Wrong' }], correctAnswer: 'A', hint: 'Read the subject.', explanation: 'The subject determines the answer.', maxScore: 2 },
  { id: 'fixture-text', level: 'CET4', type: 'short_text_self_check', skill: 'writing', prompt: 'Write a paragraph.', options: [], hint: 'State your position.', referenceAnswer: 'This is an English reference paragraph.', correctAnswer: 'Reference only.', explanation: 'Compare your structure with the reference.', rubric: ['Clear position', 'Two reasons'], maxScore: 10 }
]
const fixtureContent = { version: prefix, words, questions, papers: [{ id: 'fixture-paper', level: 'CET4', title: 'Original test paper', questionIds: questions.map(question => question.id), durationSeconds: 1200, authenticity: 'original_mock' }] }
const fixtureShop = { assets: { boy: '/boy.png', girl: '/girl.png' }, items: [
  { id: 'fixture-boy', name: 'Boy outfit', category: 'outfit', character: 'boy', price: 10, heat: 80 },
  { id: 'fixture-all', name: 'Shared accessory', category: 'accessory', character: 'all', price: 5 },
  { id: 'fixture-theme', name: 'Theme', category: 'theme', character: 'all', price: 7, heat: 20 },
  { id: 'fixture-food', name: 'Food', category: 'food', character: 'all', price: 3 },
  { id: 'fixture-expensive', name: 'Costly shoes', category: 'shoes', character: 'all', price: 9999 }
] }
const fixtures = { content: () => fixtureContent, shop: () => fixtureShop, pastExams: () => [
  { id: 'fixture-external', level: 'CET4', year: 2020, month: 6, kind: 'pdf', paperUrl: 'https://example.org/paper.pdf', authenticity: 'past_exam_resource' },
  { id: 'fixture-source', level: 'CET4', year: 2026, month: 6, kind: 'source_link', sourceUrl: 'https://example.org/index', authenticity: 'past_exam_resource' }
] }
let now = new Date('2030-07-01T01:00:00Z')
const service = createService({ cloud: guardedSdk, source: fixtures, clock: () => new Date(now) })
const call = (openid, action, input = {}, target = service) => sdk.__runWithContext({ openid }, () => target.main({ action, ...input }))
async function good(openid, action, input, target) { const response = await call(openid, action, input, target); assert.equal(response.success, true, action + ': ' + response.msg); return response.data }
async function get(name, id) { return (await db.collection(name).doc(id).get()).data }
async function rows(name) { return (await db.collection(name).get()).data }
async function set(name, id, data) { return db.collection(name).doc(id).set({ data }) }
async function correctStudy(openid, session) {
  const stored = await get('english_sessions', session.sessionId)
  const word = words.find(word => word.id === stored.wordIds[stored.cursor])
  now = new Date(now.getTime() + 5000)
  return good(openid, 'answerStudy', { sessionId: session.sessionId, questionId: session.question.id, answer: session.mode === 'spelling' ? word.lemma : session.question.options.find(option => option.text === word.definitionZh).id, activeSeconds: 500 })
}
async function completeChallenge(openid, first, wrong = false) {
  let result = first
  while (result.question) {
    const definition = await get('english_challenges', result.challengeId)
    const question = definition.questions.find(question => question.id === result.question.id)
    result = await good(openid, 'answerChallenge', { attemptId: result.attemptId, questionId: question.id, answer: wrong ? question.options.find(option => option.id !== question.correctAnswer).id : question.correctAnswer })
  }
  return good(openid, 'finishChallenge', { attemptId: result.attemptId })
}
function worker(openid, action, input) {
  return new Promise((resolve, reject) => execFile(process.execPath, [__filename, '--worker', openid, action, JSON.stringify(input), now.toISOString()], { timeout: 30000 }, (error, stdout, stderr) => {
    if (error) return reject(new Error(stderr || error.message))
    try { resolve(JSON.parse(stdout.trim().split('\n').pop())) } catch (error) { reject(error) }
  }))
}

async function extraStudyRegression() {
  const previousNow = new Date(now), learner = prefix + '-extra', dailyId = () => key(learner, new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10))
  const finish = async session => { let result; while (session.question) { result = await correctStudy(learner, session); session = result.session }; return result }
  try {
    now = new Date('2030-08-01T01:00:00Z')
    await good(learner, 'savePlan', { level: 'CET4', newGoal: 4, reviewGoal: 0 })
    equal((await good(learner, 'home')).extraStudy.enabled, false, 'Extra study is unavailable before the daily targets are complete')
    check(!(await call(learner, 'startStudy', { mode: 'new', extraCount: 2 })).success, 'Extra study cannot bypass unfinished daily targets')
    await finish(await good(learner, 'startStudy', { mode: 'new' }))
    await good(learner, 'savePlan', { level: 'CET4', newGoal: 2, reviewGoal: 2 })
    now = new Date('2030-08-02T01:00:00Z')
    await finish(await good(learner, 'startStudy', { mode: 'new' }))
    check(!(await call(learner, 'startStudy', { mode: 'new', extraCount: 1 })).success, 'Finishing only new words cannot skip the review target')
    const completed = (await finish(await good(learner, 'startStudy', { mode: 'review' }))).home
    check(completed.extraStudy.enabled, 'Completing both daily targets enables extra study')
    equal([completed.extraStudy.newAvailable, completed.extraStudy.reviewAvailable], [26, 2], 'Extra availability excludes today learned and already reviewed words')
    const pending = await good(learner, 'savePlan', { level: 'CET6', newGoal: 1, reviewGoal: 0 })
    const frozenPlan = clone(pending.plan), checkedAt = pending.today.checkedAt, coinsBefore = pending.coins
    for (const extraCount of [0, -1, 1.5, 101, Infinity, true]) check(!(await call(learner, 'startStudy', { mode: 'new', extraCount })).success, 'Invalid extra count rejected: ' + extraCount)
    check(!(await call(learner, 'startStudy', { mode: 'spelling', extraCount: 1 })).success, 'Spelling cannot pretend to be counted extra study')
    check(!(await call(learner, 'startStudy', { mode: 'new', level: 'CET6', extraCount: 1 })).success, 'Extra study follows today frozen level, not tomorrow pending level')
    check(!(await call(learner, 'startStudy', { mode: 'new', extraCount: 27 })).success, 'Extra new count cannot exceed the actual remaining pool')
    check(!(await call(learner, 'startStudy', { mode: 'review', extraCount: 3 })).success, 'Extra review count cannot exceed eligible unreviewed old words')
    const starts = databaseMode
      ? await Promise.all([worker(learner, 'startStudy', { mode: 'new', extraCount: 2 }), worker(learner, 'startStudy', { mode: 'new', extraCount: 4 })]).then(results => { check(results.every(result => result.success), 'SQL processes can start or restore the same extra session'); return results.map(result => result.data) })
      : await Promise.all([good(learner, 'startStudy', { mode: 'new', extraCount: 2 }), good(learner, 'startStudy', { mode: 'new', extraCount: 4 })])
    equal(starts[0].sessionId, starts[1].sessionId, 'Concurrent extra requests restore one active queue rather than competing batches')
    let session = starts[0]
    check(session.extra && [2, 4].includes(session.requestedCount), 'Extra queue records its selected initial count')
    // SQL lock acquisition may choose either request; finish the same selected queue.
    const selected = session.requestedCount
    check(!JSON.stringify(session.question).includes('correctAnswer'), 'Extra questions keep the answer server-side')
    equal((await good(learner, 'startStudy', { mode: 'new' })).sessionId, session.sessionId, 'Ordinary entry also resumes an unfinished extra queue')
    const wrongAnswer = session.question.options.find(option => option.text !== words.find(word => word.id === session.question.wordId).definitionZh).id
    now = new Date(now.getTime() + 5000)
    const wrong = await good(learner, 'answerStudy', { sessionId: session.sessionId, questionId: session.question.id, answer: wrongAnswer, activeSeconds: 5 })
    equal(wrong.home.today.newCount, 2, 'An incorrect extra answer does not claim a learned word')
    check(wrong.retryScheduled && !wrong.correct, 'Incorrect extra word is scheduled again with explicit feedback')
    equal(wrong.coinsEarned, 0, 'Incorrect extra answer never rewards an already completed daily task')
    session = wrong.session
    const extraNew = (await finish(session)).home
    equal([extraNew.today.newCount, extraNew.today.extraNewCount], [2 + selected, selected], 'Extra new words increase actual personal totals beyond the fixed goal')
    equal(extraNew.plan, frozenPlan, 'Extra new study does not overwrite current or pending plans')
    equal(extraNew.today.checkedAt, checkedAt, 'Extra study keeps the original check-in timestamp')
    equal(extraNew.coins, coinsBefore, 'Finishing extra new words cannot award the daily reward again')
    const review = await good(learner, 'startStudy', { mode: 'review', extraCount: 2 })
    const reviewStored = await get('english_sessions', review.sessionId)
    const dayBeforeReview = await get('english_daily', dailyId())
    check(reviewStored.wordIds.every(id => !dayBeforeReview.reviewWordIds.includes(id) && !dayBeforeReview.newWordIds.includes(id)), 'Extra review never reuses today learned or correctly reviewed words')
    const extraReview = (await finish(review)).home
    equal([extraReview.today.reviewCount, extraReview.today.extraReviewCount], [4, 2], 'Extra review increases actual unique reviewed totals')
    equal(extraReview.plan, frozenPlan); equal(extraReview.today.checkedAt, checkedAt); equal(extraReview.coins, coinsBefore)
    equal(extraReview.extraStudy.reviewAvailable, 0, 'Review availability reaches zero when every eligible old word was reviewed')
    check(!(await call(learner, 'startStudy', { mode: 'review', extraCount: 1 })).success, 'No eligible old words cannot become a fake review session')
    session = await good(learner, 'startStudy', { mode: 'new', extraCount: 1 })
    const stored = await get('english_sessions', session.sessionId), word = words.find(word => word.id === stored.wordIds[stored.cursor])
    const payload = { sessionId: session.sessionId, questionId: session.question.id, answer: session.question.options.find(option => option.text === word.definitionZh).id, activeSeconds: 5 }
    const profileBefore = clone(await get('english_profiles', key(learner))), dayBefore = clone(await get('english_daily', dailyId()))
    failure = { name: 'english_daily', method: 'set' }
    check(!(await call(learner, 'answerStudy', payload)).success, 'Failure after session/card/profile updates aborts the extra answer')
    equal(await get('english_sessions', session.sessionId), stored, 'Failed extra answer restores its cursor and response map')
    equal(await get('english_profiles', key(learner)), profileBefore, 'Failed extra answer restores learned IDs and wallet')
    equal(await get('english_daily', dailyId()), dayBefore, 'Failed extra answer restores daily counts and check-in')
    equal(await get('english_cards', key('card', learner, word.id)), null, 'Failed extra answer cannot leave an FSRS card behind')
    now = new Date(now.getTime() + 5000)
    const duplicates = databaseMode
      ? await Promise.all(Array.from({ length: 3 }, () => worker(learner, 'answerStudy', payload))).then(results => { check(results.every(result => result.success), 'Independent SQL answer retries all return successfully'); return results.map(result => result.data) })
      : await Promise.all(Array.from({ length: 3 }, () => good(learner, 'answerStudy', payload)))
    equal(duplicates.map(result => result.session.completed), [1, 1, 1], 'Concurrent duplicate extra answers advance one question only')
    equal(duplicates.map(result => result.coinsEarned), [0, 0, 0], 'Concurrent extra answers cannot farm the daily reward')
    const actualHome = await good(learner, 'home')
    equal(actualHome.today.newCount, 3 + selected, 'Repeated extra answer adds exactly one unique word')
    equal((await good(learner, 'rank', { type: 'study', period: 'day', level: 'CET4' })).myScore, 7 + selected, 'Daily leaderboard includes actual extra new and review words')
    equal((await rows('english_coin_ledger')).filter(row => row.openid === learner && row.date === '2030-08-02' && row.kind === 'reward').length, 2, 'Exactly the original new/review reward rows exist after every extra batch')
    session = await good(learner, 'startStudy', { mode: 'new', extraCount: 1 })
    now = new Date('2030-08-03T01:00:00Z')
    check(!(await call(learner, 'answerStudy', { sessionId: session.sessionId, questionId: session.question.id, answer: 'A' })).success, 'An unfinished extra session cannot be settled into another date')
    const tomorrow = await good(learner, 'home', { level: 'CET6' })
    equal([tomorrow.plan.level, tomorrow.plan.newGoal, tomorrow.plan.reviewGoal, tomorrow.plan.pending], ['CET6', 1, 0, null], 'Tomorrow pending plan survives extra study and activates normally')
    equal([tomorrow.today.newCount, tomorrow.today.reviewCount, tomorrow.today.checkedIn, tomorrow.extraStudy.enabled], [0, 0, false, false], 'Extra count and enabled state do not leak into the next day')
    equal((await good(learner, 'rank', { type: 'study', period: 'day', level: 'CET4' })).myScore, 0, 'Today extra words belong only to their actual learning date')
  } finally { now = previousNow; failure = null }
}

async function exhaustedExtraResumeRegression() {
  const learner = prefix + '-extra-resume'
  await good(learner, 'savePlan', { level: 'CET4', newGoal: 31, reviewGoal: 0 })
  let session = await good(learner, 'startStudy', { mode: 'new' })
  while (session.question) session = (await correctStudy(learner, session)).session
  const completed = await good(learner, 'home')
  equal(completed.extraStudy.newAvailable, 1, 'Resume fixture has exactly one new word after its daily target')
  session = await good(learner, 'startStudy', { mode: 'new', extraCount: 1 })
  const word = words.find(word => word.id === session.question.wordId)
  const wrongAnswer = session.question.options.find(option => option.text !== word.definitionZh).id
  const wrong = await good(learner, 'answerStudy', { sessionId: session.sessionId, questionId: session.question.id, answer: wrongAnswer })
  equal(wrong.home.extraStudy.newAvailable, 0, 'A wrong final new word has a saved card while its retry remains active')
  check(wrong.session.question && wrong.retryScheduled, 'The exhausted new-word pool still has an unfinished retry')
  const refreshed = await good(learner, 'home')
  equal(refreshed.extraStudy.activeModes, ['new'], 'Home exposes the unfinished new batch even when no unused words remain')
  const resumed = await good(learner, 'startStudy', { mode: 'new' })
  equal([resumed.sessionId, resumed.question.id, resumed.total, resumed.completed], [wrong.session.sessionId, wrong.session.question.id, 2, 1], 'Ordinary resume preserves the original batch and its wrong-word retry')
  const finished = await correctStudy(learner, resumed)
  equal(finished.home.extraStudy.activeModes, [], 'Completed batches are no longer advertised as resumable')
  equal([finished.home.today.checkedAt, finished.home.coins], [completed.today.checkedAt, completed.coins], 'Resuming exhausted extra study keeps the original check-in and reward')
  equal(finished.home.today.extraNewCount, 1, 'A resumed wrong word contributes once after its correct retry')
}

async function run() {
  if (databaseMode) { await sdk.__ensureSchema(); equal((await rows('global_settings')).length, 0, 'Disposable database has no existing application settings') }
  await set('global_settings', prefix, { modules: { english: { enabled: true } } })
  await extraStudyRegression()
  await exhaustedExtraResumeRegression()
  for (const openid of [owner, peer, zero, admin]) await set('users', openid, { openid, nickName: openid })
  await set('global_admin', prefix + '-admin', { loginOpenid: admin, role: 'super', status: 'active' })
  check(!(await call('', 'home')).success, 'Unauthenticated callers rejected')
  check(!(await call(owner, 'savePlan', { newGoal: 0, reviewGoal: 0 })).success, 'Both goals zero rejected')
  const initial = await good(owner, 'home')
  equal(initial.stats.totalWords, 32, 'Word count scoped to level')
  await good(owner, 'savePlan', { newGoal: 3, reviewGoal: 0, level: 'CET4' })
  let session = await good(owner, 'startStudy', { mode: 'new', level: 'CET4' })
  equal((await good(owner, 'startStudy', { mode: 'new' })).sessionId, session.sessionId, 'Active session restored')
  check(!('correctAnswer' in session.question) && !('definitionZh' in session.question), 'No answer in public study question')
  check(session.question.options.every(option => /^[A-D]$/.test(option.id)), 'Choice IDs do not reveal the correct word ID')
  check(!session.question.options.some(option => option.text === words[1].definitionZh), 'Secondary meaning overlap excluded')
  check(session.question.options.every(option => words.find(word => word.definitionZh === option.text).partOfSpeech === 'n.'), 'Same part of speech preferred for distractors')
  const firstId = session.question.id, firstWord = session.question.wordId
  await good(owner, 'studyHint', { sessionId: session.sessionId, questionId: firstId })
  now = new Date(now.getTime() + 5000)
  const wrong = session.question.options.find(option => option.text !== words[0].definitionZh).id
  let response = await good(owner, 'answerStudy', { sessionId: session.sessionId, questionId: firstId, answer: wrong, activeSeconds: Infinity })
  check(!response.correct && response.retryScheduled && response.feedback.usedHint, 'Wrong answer schedules retry and keeps explicit hint flag')
  equal(response.home.today.newCount, 0, 'Wrong new answer cannot count toward target')
  equal(response.home.today.studySeconds, 0, 'Nonfinite client time cannot affect duration')
  check(response.feedback.meanings.length && response.feedback.exampleEn && response.feedback.exampleZh, 'Full meanings and examples returned after answer')
  const failedCard = await get('english_cards', key('card', owner, firstWord))
  equal(failedCard.schedulerVersion, 'ts-fsrs@5.4.2', 'FSRS real library used')
  session = response.session
  response = await correctStudy(owner, session); session = response.session
  response = await correctStudy(owner, session); session = response.session
  equal(session.question.wordId, firstWord, 'Wrong word reappears later in the same session')
  response = await correctStudy(owner, session)
  equal(response.home.today.newCount, 3, 'Only distinct correctly answered words count')
  check(response.home.today.checkedIn, 'Zero review goal permits checkin after new target met')
  equal(response.home.coins, 10, 'Daily new reward awarded exactly once')
  check(response.home.today.studySeconds <= 15, 'Recorded active time capped by server elapsed time')
  const retry = await good(owner, 'answerStudy', { sessionId: session.sessionId, questionId: firstId, answer: words[0].lemma, activeSeconds: 100 })
  equal(retry.home.today.newCount, 3, 'Repeated submission cannot farm target count')
  equal(retry.coinsEarned, 0, 'Repeated answer cannot claim reward twice')
  const spelling = await good(owner, 'startStudy', { mode: 'spelling' })
  check(!spelling.question.lemma && !spelling.question.ipa && !spelling.question.wordId.includes('word'), 'Spelling question does not expose answer through word ID')
  const memoryBefore = (await rows('english_cards')).filter(row => row.openid === owner)
  const spellAnswer = await correctStudy(owner, spelling)
  equal(spellAnswer.home.today.newCount, 3, 'Spelling does not count daily goals')
  equal(spellAnswer.coinsEarned, 0, 'Spelling does not award coins')
  equal((await rows('english_cards')).filter(row => row.openid === owner), memoryBefore, 'Spelling does not alter FSRS memory scheduling')
  const pending = await good(owner, 'savePlan', { newGoal: 1, reviewGoal: 1, level: 'CET4' })
  equal(pending.plan.newGoal, 3, 'First study freezes current daily goal')
  equal(pending.plan.pending.appliesOn, '2030-07-02', 'Changes begin next day')
  now = new Date('2030-07-02T01:00:00Z')
  equal((await good(owner, 'home')).plan.reviewGoal, 1, 'Pending goals activate next day')
  session = await good(owner, 'startStudy', { mode: 'new' })
  response = await correctStudy(owner, session)
  check(!response.home.today.checkedIn, 'Both nonzero goals required before checkin')
  session = await good(owner, 'startStudy', { mode: 'review' })
  response = await correctStudy(owner, session)
  check(response.home.today.checkedIn, 'New and old independent targets complete checkin')
  equal(response.home.today.reviewCount, 1, 'Review unique old word counted')
  equal(response.home.coins, 30, 'Separate new and review tasks each award once')
  check(!(await call(peer, 'answerStudy', { sessionId: session.sessionId, questionId: 'any', answer: 'A' })).success, 'Cannot answer another account session')
  const otherLevel = prefix + '-level'
  await good(otherLevel, 'savePlan', { level: 'CET4', newGoal: 1, reviewGoal: 0 })
  const sixStudy = await good(otherLevel, 'startStudy', { mode: 'new', level: 'CET6' })
  const sixAnswer = await correctStudy(otherLevel, sixStudy)
  equal([sixAnswer.home.plan.level, sixAnswer.home.today.newCount, sixAnswer.home.today.checkedIn], ['CET4', 0, false], 'Cross level practice cannot satisfy another level daily plan')
  equal((await good(otherLevel, 'rank', { type: 'study', period: 'day', level: 'CET6' })).myScore, 1, 'Cross level activity still credited to its actual level leaderboard')
  check(!(await call(otherLevel, 'savePlan', { level: 'CET4', newGoal: 1, reviewGoal: 500 })).success, 'Frozen pending plan validates available old words')
  check(!(await call(otherLevel, 'savePlan', { level: 'CET4', newGoal: 100, reviewGoal: 0 })).success, 'Frozen pending plan validates remaining new words')
  equal((await good(otherLevel, 'home')).plan.pending, null, 'Rejected impossible plan cannot overwrite next day settings')
  const fourStudy = await good(otherLevel, 'startStudy', { mode: 'new', level: 'CET4' })
  check((await correctStudy(otherLevel, fourStudy)).home.today.checkedIn, 'Original plan level still completes checkin normally')

  const a = await good(owner, 'startChallenge', { level: 'CET4' })
  const b = await good(peer, 'startChallenge', { level: 'CET4' })
  const attempts = [await get('english_challenge_attempts', a.attemptId), await get('english_challenge_attempts', b.attemptId)]
  equal(attempts[0].order.slice().sort(), attempts[1].order.slice().sort(), 'Daily formal challenge gives everyone the same question set')
  equal(a.remainingSeconds, b.remainingSeconds, 'Daily challenge duration identical')
  equal((await good(owner, 'startChallenge', { level: 'CET4' })).attemptId, a.attemptId, 'Formal attempt once per account date and level')
  check(!JSON.stringify(a.question).includes('correctAnswer'), 'Challenge does not return answers while active')
  const finished = await completeChallenge(owner, a)
  const peerFinished = await completeChallenge(peer, b)
  equal(finished.correctCount, 20, 'Server calculates challenge correct count')
  check(!finished.review && finished.answersAvailableAt, 'Default challenge answers delayed until next day')
  equal(peerFinished.myRank, 1, 'Same scores share first place')
  equal((await good(owner, 'finishChallenge', { attemptId: a.attemptId })).coinsEarned, 0, 'Challenge finish idempotent reward')
  equal((await good(owner, 'startChallenge', { level: 'CET4' })).status, 'submitted', 'Cannot restart completed daily formal attempt')
  const z = await good(zero, 'startChallenge', { level: 'CET4' })
  const zeroFinished = await completeChallenge(zero, z, true)
  equal(zeroFinished.correctCount, 0, 'Zero score is valid submitted challenge')
  check(zeroFinished.rank.items.some(item => item.openid === zero), 'Zero scores still appear in challenge rank')
  const six = await good(owner, 'startChallenge', { level: 'CET6' })
  now = new Date(Date.parse(six.deadlineAt) + 1)
  const late = await good(owner, 'answerChallenge', { attemptId: six.attemptId, questionId: six.question.id, answer: 'A' })
  check(!late.accepted && late.status === 'submitted', 'Server deadline rejects late answer')
  equal(late.correctCount, 0, 'Late answer cannot change score')
  equal((await good(owner, 'finishChallenge', { attemptId: six.attemptId })).coinsEarned, 0, 'Empty challenge not eligible for reward')

  const papers = await good(owner, 'papers', { level: 'CET4' })
  equal(papers.papers.find(paper => paper.id === 'fixture-paper').authenticity, 'original_mock', 'Original questions never called real past exam')
  const external = papers.papers.find(paper => paper.id === 'fixture-external')
  check(!external.available && external.resources[0].downloadUrl.includes('/api/english/resource'), 'External PDF has proxy route but no automatic examination claim')
  const link = papers.papers.find(paper => paper.id === 'fixture-source').resources[0]
  equal([link.type, link.downloadUrl], ['source', ''], 'Source index is a link, not downloadable PDF')
  check(!(await call(owner, 'startExam', { paperId: external.id })).success, 'Cannot fake automated exam for unstructured resources')
  let exam = await good(owner, 'startExam', { paperId: 'fixture-paper', mode: 'exam' })
  check(!JSON.stringify(exam.questions).includes('correctAnswer') && !JSON.stringify(exam.questions).includes('referenceAnswer'), 'Exam answer keys removed before submission')
  let saved = await good(owner, 'saveExamDraft', { attemptId: exam.attemptId, questionId: 'fixture-text', answer: 'My saved draft.' })
  equal(saved.attempt.drafts['fixture-text'], 'My saved draft.', 'Unsubmitted text draft actually persisted')
  equal(saved.feedback, null, 'Draft save reveals no answer')
  equal((await good(owner, 'startExam', { paperId: 'fixture-paper', mode: 'exam' })).drafts['fixture-text'], 'My saved draft.', 'Exam draft restored on reopening')
  saved = await good(owner, 'answerExam', { attemptId: exam.attemptId, questionId: 'fixture-choice', answer: 'A' })
  equal(saved.feedback, null, 'Formal exam does not reveal feedback before hand-in')
  equal((await good(owner, 'examHistory', { level: 'CET4' })).items.find(item => item.attemptId === exam.attemptId).correctCount, null, 'History cannot reveal active formal exam correctness')
  equal((await good(owner, 'wrongQuestions', { level: 'CET4' })).items.length, 0, 'Wrong question history cannot act as an active exam answer oracle')
  check(!(await call(peer, 'examDetail', { attemptId: exam.attemptId })).success, 'Exam details remain private to the owner')
  saved = await good(owner, 'answerExam', { attemptId: exam.attemptId, questionId: 'fixture-text', answer: 'My paragraph.' })
  equal([saved.attempt.index, saved.attempt.question], [2, null], 'All answered exam does not loop back to first question')
  const submitted = await good(owner, 'finishExam', { attemptId: exam.attemptId })
  equal((await good(owner, 'examDetail', { attemptId: exam.attemptId })).review, submitted.review, 'Submitted history restores complete feedback without new attempt')
  equal([submitted.objectiveScore, submitted.objectiveMaxScore], [2, 2], 'Only objective questions auto graded')
  equal(submitted.review[1].feedback.correct, null, 'Writing remains self assessed')
  equal(submitted.review[1].feedback.modelAnswer, questions[1].referenceAnswer, 'Actual English reference answer included after hand-in')
  const assessed = await good(owner, 'answerExam', { attemptId: exam.attemptId, questionId: 'fixture-text', selfAssessment: 'mastered' })
  equal(assessed.feedback.selfAssessment, 'mastered', 'Subjective self assessment can be saved after hand-in')
  await good(owner, 'finishExam', { attemptId: exam.attemptId })
  equal((await good(owner, 'home')).today.correctCount, 1, 'Repeated hand-in cannot farm correct question count')
  const practice = await good(owner, 'startExam', { mode: 'practice', level: 'CET4', questionIds: ['fixture-choice'] })
  saved = await good(owner, 'answerExam', { attemptId: practice.attemptId, questionId: 'fixture-choice', answer: 'B' })
  check(saved.feedback && !saved.feedback.correct && saved.feedback.explanation, 'Ordinary practice gives immediate detailed feedback')
  equal((await good(owner, 'wrongQuestions', { level: 'CET4' })).items.map(row => row.question.id), ['fixture-choice'], 'Checked practice mistakes appear in the wrong question list')
  const retryPractice = await good(owner, 'startExam', { mode: 'practice', level: 'CET4', questionIds: ['fixture-choice'] })
  check(retryPractice.attemptId !== practice.attemptId, 'Completed practice restarts with a fresh attempt rather than looping old checked answer')
  await good(owner, 'answerExam', { attemptId: retryPractice.attemptId, questionId: 'fixture-choice', answer: 'A' })
  equal((await good(owner, 'wrongQuestions', { level: 'CET4' })).items.length, 0, 'New correct answer removes older error even when clock timestamps tie')
  const orderedPractice = await good(owner, 'startExam', { mode: 'practice', level: 'CET4', questionIds: ['fixture-text', 'fixture-choice'] })
  equal(orderedPractice.questions.map(question => question.id), ['fixture-text', 'fixture-choice'], 'Chosen wrong question order preserved rather than source order')
  equal((await good(owner, 'home')).today.examCount, 1, 'Same question repeated in practice cannot farm leaderboard')
  await good(owner, 'examHint', { attemptId: practice.attemptId, questionId: 'fixture-choice' })
  check((await good(owner, 'finishExam', { attemptId: practice.attemptId })).review[0].hintUsed, 'Exam explicit hint usage persisted')

  const profileId = key(owner)
  const profile = await get('english_profiles', profileId)
  profile.coins = 100
  await set('english_profiles', profileId, profile)
  const bought = await Promise.all(Array.from({ length: 4 }, () => good(owner, 'buyItem', { itemId: 'fixture-boy' })))
  equal(bought.at(-1).coins, 90, 'Concurrent permanent purchase debits once')
  equal(bought.at(-1).owned.filter(id => id === 'fixture-boy').length, 1, 'Permanent ownership unique')
  equal((await good(owner, 'equipItem', { itemId: 'fixture-boy' })).heat, 80, 'Equipped heat is returned from the server catalog')
  equal((await good(owner, 'wardrobeRank', { heat: 999999 })).myHeat, 80, 'Leaderboard ignores client supplied heat')
  const girl = await good(owner, 'selectCharacter', { character: 'girl' })
  equal(girl.equipped.outfit, '', 'Switching appearance clears incompatible outfit')
  equal(girl.heat, 0, 'Appearance change updates current equipped heat')
  check(girl.owned.includes('fixture-boy'), 'Appearance switch keeps owned items')
  check(!(await call(owner, 'equipItem', { itemId: 'fixture-boy' })).success, 'Gender compatibility enforced server side')
  await good(owner, 'buyItem', { itemId: 'fixture-theme' })
  const theme = await good(owner, 'equipItem', { itemId: 'fixture-theme', module: 'english' })
  equal(theme.equipped.themes.english, 'fixture-theme', 'Theme equipped per module')
  equal((await get('global_settings', prefix)).modules.english.enabled, true, 'Themes cannot overwrite module switch')
  const food = await Promise.all(Array.from({ length: 4 }, () => good(owner, 'buyItem', { itemId: 'fixture-food', requestId: 'food-1' })))
  equal([food.at(-1).coins, food.at(-1).foodStock['fixture-food']], [80, 1], 'Consumable retry creates one inventory unit and debit')
  const fed = await Promise.all(Array.from({ length: 4 }, () => good(owner, 'feed', { itemId: 'fixture-food', requestId: 'feed-1' })))
  equal([fed.at(-1).foodStock['fixture-food'], fed.at(-1).expression], [0, 'yum'], 'Repeated feed consumes once and returns animation')
  check(!(await call(owner, 'feed', { itemId: 'fixture-food', requestId: 'feed-2' })).success, 'Empty food stock rejected')
  check(!(await call(owner, 'buyItem', { itemId: 'fixture-expensive' })).success, 'Insufficient coins rejected')
  const beforeFailure = await get('english_profiles', profileId)
  failure = { name: 'english_profiles', method: 'set' }
  check(!(await call(owner, 'buyItem', { itemId: 'fixture-food', requestId: 'rollback-food' })).success, 'Failure after ledger insert aborts purchase')
  equal(await get('english_profiles', profileId), beforeFailure, 'Transaction failure restores wallet and inventory')
  check(!await get('english_coin_ledger', key('purchase', owner, 'rollback-food')), 'Same connection rollback removes inserted ledger')
  if (databaseMode) {
    const independent = await Promise.all(Array.from({ length: 3 }, () => worker(owner, 'buyItem', { itemId: 'fixture-food', requestId: 'process-food' })))
    check(independent.every(response => response.success), 'Independent Node processes can retry same request')
    const state = await good(owner, 'wardrobe')
    equal([state.coins, state.foodStock['fixture-food']], [77, 1], 'MariaDB GET_LOCK serializes independent process purchases')
    const crossFeed = await Promise.all(Array.from({ length: 3 }, () => worker(owner, 'feed', { itemId: 'fixture-food', requestId: 'process-feed' })))
    check(crossFeed.every(response => response.success), 'Independent feed retries successful')
    equal((await good(owner, 'wardrobe')).foodStock['fixture-food'], 0, 'MariaDB process feed consumes once')
  }
  check(!(await call(owner, 'adminOverview')).success, 'Non administrator cannot read admin overview')
  equal((await good(admin, 'adminOverview')).admin.role, 'super', 'Admin role returned for safe edit UI')
  equal((await good(admin, 'saveGameSettings', { settings: { newReward: 12, reviewReward: 13, challengeReward: 6 } })).settings.newReward, 12, 'Super admin reward settings persist')
  check(!(await call(admin, 'saveGameSettings', { settings: { newReward: 1.5 } })).success, 'Reward configuration rejects fractional value')
  await set('global_admin', prefix + '-read-admin', { loginOpenid: peer, role: 'admin', status: 'active' })
  equal((await good(peer, 'adminOverview')).admin.role, 'admin', 'Ordinary admin can inspect overview')
  check(!(await call(peer, 'saveGameSettings', { settings: { newReward: 99 } })).success, 'Ordinary admin cannot alter reward economy')
  await set('global_settings', prefix, { modules: { english: { enabled: false } } })
  check(!(await call(owner, 'home')).success, 'Live disabled module blocks learning')
  check((await call(owner, 'wardrobe')).success, 'Home companion still available while English module disabled')
  check((await call(owner, 'wardrobeRank')).success, 'Companion leaderboard follows independent wardrobe availability')
  await set('global_settings', prefix, { modules: {} })
  check((await call(owner, 'home')).success, 'Legacy settings missing new English key follow shared enabled default')
  await set('global_settings', prefix, { modules: { running: true, food: false, canteen: true, forum: false, rider: true } })
  check((await call(owner, 'home')).success, 'Five-module upgraded settings can load real English learning')
  await set('global_settings', prefix, { modules: { english: { enabled: true } } })
  // Calendar week uses Monday in Beijing, including Sunday evening UTC rollover.
  now = new Date('2030-07-07T10:00:00Z')
  equal((await good(owner, 'rank', { type: 'study', period: 'week', level: 'CET4' })).myScore, 5, 'Sunday weekly rank still includes Monday and Tuesday')
  now = new Date('2030-07-08T01:00:00Z')
  equal((await good(owner, 'rank', { type: 'study', period: 'week', level: 'CET4' })).myScore, 0, 'New Monday starts fresh week')
  const finalPending = prefix + '-pending-final'
  await good(finalPending, 'savePlan', { level: 'CET4', newGoal: 3, reviewGoal: 0 })
  session = await good(finalPending, 'startStudy', { mode: 'new' })
  response = await correctStudy(finalPending, session)
  await good(finalPending, 'savePlan', { level: 'CET4', newGoal: 31, reviewGoal: 0 })
  response = await correctStudy(finalPending, response.session)
  await correctStudy(finalPending, response.session)
  now = new Date('2030-07-09T01:00:00Z')
  const exhaustedPending = await good(finalPending, 'home')
  equal([exhaustedPending.plan.newGoal, exhaustedPending.plan.newAvailable], [31, 29], 'Pending goal rechecked against words consumed later on original day')
  check(exhaustedPending.plan.needsUpdate && exhaustedPending.plan.availabilityNote, 'Unavailable pending goal explains required update without failing home')
  check(!(await call(finalPending, 'startStudy', { mode: 'new' })).success, 'Unavailable goal cannot start and freeze day')
  check(!(await good(finalPending, 'home')).plan.frozen, 'Rejected start leaves impossible goal editable')
  await good(finalPending, 'savePlan', { level: 'CET4', newGoal: 29, reviewGoal: 0 })
  check((await good(finalPending, 'startStudy', { mode: 'new' })).question, 'Reachable correction permits study')
  const finalFixed = prefix + '-fixed-final'
  const previousMemory = reviewMemory(null, 'good', new Date('2030-07-08T01:00:00Z'))
  const template = clone(await get('english_profiles', key(owner)))
  await set('english_profiles', key(finalFixed), { ...template, openid: finalFixed, coins: 0, plan: { newGoal: 4, reviewGoal: 0 }, pendingPlan: null, learnedWordIds: words.filter(word => word.level === 'CET4').slice(0, 30).map(word => word.id), activeSessions: {}, activeExams: {}, createdAt: now.toISOString() })
  for (const word of words.filter(word => word.level === 'CET4').slice(0, 30)) await set('english_cards', key('card', finalFixed, word.id), { openid: finalFixed, level: word.level, wordId: word.id, learnedAt: '2030-07-08T01:00:00Z', ...previousMemory })
  const exhaustedFixed = await good(finalFixed, 'home')
  equal([exhaustedFixed.plan.newAvailable, exhaustedFixed.plan.needsUpdate], [2, true], 'Fixed recurring target rechecked on final vocabulary day')
  check(!(await call(finalFixed, 'startStudy', { mode: 'new' })).success, 'Cannot freeze fixed target above remaining vocabulary')
  await good(finalFixed, 'savePlan', { level: 'CET4', newGoal: 2, reviewGoal: 0 })
  check((await good(finalFixed, 'startStudy', { mode: 'new' })).question, 'Final day can be corrected without automatic goal changes')
  const historic = prefix + '-history'
  now = new Date('2030-08-15T01:00:00Z')
  const dateAt = offset => new Date(now.getTime() + 8 * 3600000 - offset * 86400000).toISOString().slice(0, 10)
  for (let i = 1; i <= 40; i++) {
    const date = dateAt(i)
    await set('english_daily', key(historic, date), { openid: historic, date, level: 'CET4', plan: { newGoal: 1, reviewGoal: 0 }, checkedAt: date + 'T01:00:00Z', frozenAt: date + 'T01:00:00Z', byLevel: { CET4: { newWordIds: [date], reviewWordIds: [], examQuestionIds: [], correctQuestionIds: [], studySeconds: 5 } }, newWordIds: [date], reviewWordIds: [], examQuestionIds: [], correctQuestionIds: [], studySeconds: 5 })
  }
  const historyHome = await good(historic, 'home')
  equal([historyHome.stats.streak, historyHome.stats.totalCheckins], [40, 40], 'Full history streak crosses 31 days and continues yesterday before today checked')
  check(historyHome.checkins.length <= 31, 'Short display list does not truncate full historical statistics')
  const todayId = key(historic, dateAt(0)), today = await get('english_daily', todayId)
  await set('english_daily', todayId, { ...today, checkedAt: now.toISOString(), byLevel: { CET4: { newWordIds: [dateAt(0)], reviewWordIds: [], examQuestionIds: [], correctQuestionIds: [], studySeconds: 5 } } })
  const historyRank = await good(historic, 'rank', { type: 'study', period: 'week', level: 'CET4' })
  const historicRow = historyRank.items.find(row => row.openid === historic)
  equal([historicRow.streak, historicRow.totalCheckins], [41, 41], 'Weekly rank includes uninterrupted full history streak and total')
  check(historicRow.score < historicRow.streak && historicRow.score > 0, 'Weekly activity score alone is restricted to this week')
  const gapId = key(historic, dateAt(2)), gap = await get('english_daily', gapId)
  await set('english_daily', gapId, { ...gap, checkedAt: null })
  equal((await good(historic, 'home')).stats.streak, 2, 'Missing checkin actually breaks streak')
  const fsrsAgain = reviewMemory(null, 'again', now), fsrsEasy = reviewMemory(null, 'easy', now)
  check(Date.parse(fsrsAgain.memory.due) < Date.parse(fsrsEasy.memory.due), 'FSRS failure scheduled sooner than easy answer')
  const actual = actualContent.content()
  check(actual.words.length > 8000 && actual.questions.length >= 146 && actual.papers.length >= 4, 'Imported content includes vocabulary, original practice and structured real exams')
  check(actual === actualContent.content(), 'Normalized content reused until source mtime changes')
  check(actual.wordById.get(actual.words[0].id) === actual.words[0], 'Word lookup indexed instead of repeatedly scanning full vocabulary')
  equal(actual.papers.filter(paper => paper.authenticity === 'original_mock').length, 2, 'Original papers remain distinct from real exams')
  equal(actual.papers.filter(paper => paper.authenticity === 'past_exam' && paper.coverage.fullPaper).length, 2, 'Two real full exams contain verified scope')
  check(actual.questions.every(question => question.hint && question.explanation), 'All imported question hints and explanations present')
  check(actual.questions.filter(question => question.type === 'short_text_self_check').every(question => question.referenceAnswer && question.rubric.length), 'Subjective content has reference and self check rubric')
  const realSources = { ...actualContent, content: () => actual }
  const actualService = createService({ cloud: guardedSdk, source: realSources, clock: () => new Date(now) })
  const realHome = await good(prefix + '-actual', 'home', { level: 'CET6' }, actualService)
  equal(realHome.stats.totalWords, actual.words.filter(word => word.level === 'CET6').length, 'Real vocabulary loads into live service')
  const actualSession = await good(prefix + '-actual', 'startStudy', { mode: 'new', level: 'CET6' }, actualService)
  check(actualSession.question.audioUrl.startsWith('/api/english/audio?word='), 'Actual study provides usable same origin pronunciation URL')
  console.log('English learning ' + (databaseMode ? 'real MariaDB' : 'memory') + ' regression passed: ' + checks + ' checks')
}

async function cleanup() {
  const collections = ['global_settings', 'global_admin', 'users', 'english_profiles', 'english_daily', 'english_sessions', 'english_cards', 'english_challenges', 'english_challenge_attempts', 'english_exam_attempts', 'english_coin_ledger', 'english_feed_events', 'global_admin_log', 'english_settings']
  for (const collection of collections) for (const row of await rows(collection)) {
    if (String(row.openid || row._openid || row.loginOpenid || row._id).startsWith(prefix) || collection === 'english_settings' && row.updatedBy === admin || collection === 'english_challenges' && row.contentVersion === prefix) await db.collection(collection).doc(row._id).remove()
  }
}

if (process.argv.includes('--worker')) {
  const index = process.argv.indexOf('--worker')
  if (process.argv[index + 4]) now = new Date(process.argv[index + 4])
  call(process.argv[index + 1], process.argv[index + 2], JSON.parse(process.argv[index + 3])).then(response => console.log(JSON.stringify(response))).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => sdk.__getPool().end())
} else {
  run().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await cleanup(); if (databaseMode) await sdk.__getPool().end() })
}
