'use strict'

const crypto = require('node:crypto')
const cloud = require('campus-server-sdk')
const source = require('../../src/english-content')
const { reviewMemory } = require('../../src/english-fsrs')
const { normalizeModules } = require('../../src/module-policy')
const { campusSnapshot, settleCampusRewards, campusTasks } = require('../../src/campus-rewards')
const { wardrobeHeat, buildWardrobeRanking } = require('./companion-ranking')
const { walletLock, loadWalletProfile } = require('../../src/campus-wallet')

const MODULES = ['portal', 'english', 'running', 'canteen', 'forum', 'profile']
const DEFAULT_SETTINGS = { newReward: 10, reviewReward: 10, challengeReward: 5, challengeDurationSeconds: 180, challengeQuestionCount: 20, revealChallengeAnswersNextDay: true, runningReward: 10, commentReward: 3, photoReward: 2, likeReward: 1, likeDailyCap: 5 }
const key = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex')
const dateOf = date => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10)
const nextDate = date => new Date(Date.parse(date + 'T00:00:00+08:00') + 86400000 + 8 * 3600000).toISOString().slice(0, 10)
const previousDate = date => dateOf(new Date(Date.parse(date + 'T00:00:00+08:00') - 86400000))
const ok = data => ({ success: true, data })
function fail(message) { throw new Error(message) }
function levelOf(value) { if (!['CET4', 'CET6'].includes(value)) fail('请选择四级或六级'); return value }
function integer(value, min, max, label) { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) fail(label + '不正确'); return number }
function shuffle(values) { const result = values.slice(); for (let i = result.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]] } return result }
function requestKey(input) { const value = String(input.requestId || input.eventId || ''); if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(value)) fail('请提供有效请求编号'); return value }
function cleanText(value, max = 10000) { const text = String(value || '').trim(); if (text.length > max) fail('答案内容过长'); return text }
function meaningsOf(word) {
  return new Set([word.definitionZh, ...(word.meanings || []).map(meaning => typeof meaning === 'string' ? meaning : meaning.definitionZh || '')]
    .flatMap(value => String(value).split(/[；;，,、/]/)).map(value => value.replace(/\([^)]*\)|（[^）]*）/g, '').replace(/\s+/g, '').trim()).filter(Boolean))
}
function positionsOf(value) {
  return new Set(String(value || '').toLowerCase().replace(/\./g, '').split(/[&/、,;\s]+/).filter(Boolean).map(pos => ['vt', 'vi', 'aux'].includes(pos) ? 'v' : pos === 'a' ? 'adj' : pos === 'interjection' ? 'int' : pos))
}
function publicQuestion(question) {
  return { id: question.id, type: question.type, level: question.level, skill: question.skill, sourceId: question.sourceId || '', authenticity: question.authenticity || 'original_practice', number: question.number || '', section: question.section || '', prompt: question.prompt, passage: question.passage || question.materialBody || '', materialTitle: question.materialTitle || '', materialImages: question.materialImages || [], options: question.options || [], guidance: '', hasHint: Boolean(question.hint || question.guidance), audioUrl: question.audioUrl || '' }
}
function grade(question, answer, selfAssessment) {
  const subjective = question.type === 'short_text_self_check'
  const correct = subjective ? null : answer === String(question.correctAnswer)
  return { correct, answer: subjective ? question.referenceAnswer || question.correctAnswer || '' : question.correctAnswer, correctAnswer: subjective ? null : question.correctAnswer, explanation: question.explanation || '', listeningTranscript: question.listeningTranscript || '', modelAnswer: question.referenceAnswer || '', referenceAnswer: question.referenceAnswer || '', rubric: question.rubric || [], selfAssessment: selfAssessment || null, score: subjective ? 0 : correct ? Number(question.maxScore || 1) : 0, maxScore: subjective ? 0 : Number(question.maxScore || 1) }
}

function createService(dependencies = {}) {
  const sdk = dependencies.cloud || cloud
  const db = sdk.database()
  const sources = dependencies.source || source
  const clock = dependencies.clock || (() => new Date())
  const get = async (collection, id) => (await db.collection(collection).doc(id).get()).data
  const put = (collection, id, value) => db.collection(collection).doc(id).set({ data: value })
  const all = async (collection, where) => (await (where ? db.collection(collection).where(where) : db.collection(collection)).get()).data
  const settings = async () => ({ ...DEFAULT_SETTINGS, ...await get('english_settings', 'game') })
  const data = () => sources.content()
  const wordsFor = level => data().wordsByLevel ? data().wordsByLevel.get(level) || [] : data().words.filter(word => word.level === level && word.definitionZh && word.lemma)
  const wordFor = id => data().wordById ? data().wordById.get(id) : data().words.find(word => word.id === id)
  const cardsFor = async profile => {
    const ids = profile.learnedWordIds.map(id => key('card', profile.openid, id))
    return ids.length ? all('english_cards', { _id: db.command.in(ids) }) : []
  }

  async function requireEnabled() {
    const rows = await all('global_settings')
    if (!normalizeModules(rows[0] && rows[0].modules).english.enabled) fail('英语学习模块暂未开放')
  }

  async function profileFor(openid) {
    const profile = await loadWalletProfile(db, openid, clock().toISOString())
    if (profile.pendingPlan && profile.pendingPlan.appliesOn <= dateOf(clock())) {
      profile.plan = { newGoal: profile.pendingPlan.newGoal, reviewGoal: profile.pendingPlan.reviewGoal }
      profile.level = profile.pendingPlan.level
      profile.pendingPlan = null
    }
    profile.campusRunPlan = profile.campusRunPlan || { goalKm: 3, pending: null }
    if (profile.campusRunPlan.pending && profile.campusRunPlan.pending.appliesOn <= dateOf(clock())) {
      profile.campusRunPlan.goalKm = profile.campusRunPlan.pending.goalKm
      profile.campusRunPlan.pending = null
    }
    return profile
  }

  async function dayFor(profile) {
    const date = dateOf(clock())
    const existing = await get('english_daily', key(profile.openid, date))
    if (existing) { existing.rewards = { ...DEFAULT_SETTINGS, ...existing.rewards }; if (!existing.availability) existing.availability = await planAvailability(profile, existing.level, existing.date); return existing }
    const day = { openid: profile.openid, date, plan: { ...profile.plan }, level: profile.level, newWordIds: [], reviewWordIds: [], examQuestionIds: [], correctQuestionIds: [], studySeconds: 0, byLevel: {}, frozenAt: null, checkedAt: null, rewarded: [], rewards: { ...await settings() } }
    day.availability = await planAvailability(profile, day.level, day.date)
    return day
  }

  async function planAvailability(profile, level, date, tomorrow = false) {
    const words = wordsFor(level), ids = new Set(words.map(word => word.id))
    const cards = (await cardsFor(profile)).filter(card => ids.has(card.wordId))
    const reviewAvailable = cards.filter(card => tomorrow || dateOf(new Date(card.learnedAt)) < date).length
    return { newAvailable: words.length - reviewAvailable, reviewAvailable }
  }

  function planNotice(day) {
    const available = day.availability || {}
    const needsUpdate = day.plan.newGoal > available.newAvailable || day.plan.reviewGoal > available.reviewAvailable
    return { ...available, needsUpdate, availabilityNote: needsUpdate ? '今日目标超过当前可用词数，请重新保存新词与旧词目标后开始计划学习。' : '' }
  }

  function historySummary(records) {
    const dates = new Set(records.filter(row => row.checkedAt && row.date <= dateOf(clock())).map(row => row.date))
    let date = dates.has(dateOf(clock())) ? dateOf(clock()) : previousDate(dateOf(clock())), streak = 0
    while (dates.has(date)) { streak++; date = previousDate(date) }
    return { streak, totalCheckins: dates.size }
  }

  async function attachHistory(openid, result) {
    const history = await all('english_daily', { openid })
    result.stats = { ...result.stats, ...historySummary(history) }
  }

  function levelDay(day, level) {
    day.byLevel = day.byLevel || {}
    if (!day.byLevel[level]) day.byLevel[level] = { newWordIds: [], reviewWordIds: [], examQuestionIds: [], correctQuestionIds: [], studySeconds: 0 }
    return day.byLevel[level]
  }

  async function award(profile, day, task) {
    const rewardId = key('reward', profile.openid, day.date, task)
    if (await get('english_coin_ledger', rewardId)) return 0
    const amount = day.rewards[task + 'Reward'] || 0
    await db.collection('english_coin_ledger').doc(rewardId).create({ data: { openid: profile.openid, date: day.date, kind: 'reward', task, amount, createdAt: clock().toISOString() } })
    profile.coins += amount
    if (!day.rewarded.includes(task)) day.rewarded.push(task)
    return amount
  }

  async function settleDay(profile, day) {
    let earned = 0
    if (day.plan.newGoal > 0 && day.newWordIds.length >= day.plan.newGoal) earned += await award(profile, day, 'new')
    if (day.plan.reviewGoal > 0 && day.reviewWordIds.length >= day.plan.reviewGoal) earned += await award(profile, day, 'review')
    if (!day.checkedAt && day.frozenAt && day.newWordIds.length >= day.plan.newGoal && day.reviewWordIds.length >= day.plan.reviewGoal) day.checkedAt = clock().toISOString()
    return earned
  }

  function publicDay(day) {
    return { date: day.date, newCount: day.newWordIds.length, reviewCount: day.reviewWordIds.length, extraNewCount: Math.max(0, day.newWordIds.length - day.plan.newGoal), extraReviewCount: Math.max(0, day.reviewWordIds.length - day.plan.reviewGoal), examCount: day.examQuestionIds.length, correctCount: day.correctQuestionIds.length, studySeconds: day.studySeconds, checkedIn: Boolean(day.checkedAt), checkedAt: day.checkedAt, newGoal: day.plan.newGoal, reviewGoal: day.plan.reviewGoal }
  }

  async function home(profile, day, requestedLevel) {
    const level = levelOf(requestedLevel || profile.level)
    const words = wordsFor(level)
    const cards = (await cardsFor(profile)).filter(card => card.level === level)
    const learned = new Set(cards.map(card => card.wordId))
    const remaining = words.filter(word => !learned.has(word.id)).length
    const learnedIds = new Set(profile.learnedWordIds)
    const reviewed = new Set((day.byLevel && day.byLevel[level] || day).reviewWordIds || [])
    const activeIds = ['new', 'review'].map(mode => profile.activeSessions[day.date + ':' + level + ':' + mode]).filter(Boolean)
    const activeSessions = activeIds.length ? await all('english_sessions', { _id: db.command.in(activeIds) }) : []
    const activeModes = activeSessions.filter(session => session.openid === profile.openid && session.date === day.date && session.level === level && session.cursor < session.wordIds.length).map(session => session.mode)
    const days = Array.from({ length: 31 }, (_, i) => dateOf(new Date(clock().getTime() - i * 86400000)))
    const rows = await all('english_daily', { _id: db.command.in(days.map(date => key(profile.openid, date))) })
    return {
      level, plan: { ...day.plan, level: day.level, ...planNotice(day), frozen: Boolean(day.frozenAt), frozenAt: day.frozenAt, pending: profile.pendingPlan }, today: publicDay(day),
      stats: { totalWords: words.length, learnedWords: learned.size, dueWords: cards.filter(card => Date.parse(card.memory.due) <= clock().getTime()).length, newRemaining: remaining, estimatedDays: day.plan.newGoal ? Math.ceil(remaining / day.plan.newGoal) : null },
      extraStudy: { enabled: Boolean(day.checkedAt) && level === day.level, activeModes, maxCount: 100, newAvailable: words.filter(word => !learnedIds.has(word.id)).length, reviewAvailable: cards.filter(card => dateOf(new Date(card.learnedAt)) < day.date && !reviewed.has(card.wordId)).length },
      coins: profile.coins, character: profile.character,
      tasks: ['new', 'review', 'challenge'].map(task => ({ id: task, label: task === 'new' ? '完成新词目标' : task === 'review' ? '完成旧词目标' : '完成每日挑战', target: task === 'new' ? day.plan.newGoal : task === 'review' ? day.plan.reviewGoal : 1, progress: task === 'new' ? day.newWordIds.length : task === 'review' ? day.reviewWordIds.length : day.rewarded.includes(task) ? 1 : 0, reward: day.rewards[task + 'Reward'], rewarded: day.rewarded.includes(task) })),
      checkins: rows.filter(row => row.checkedAt).sort((a, b) => b.date.localeCompare(a.date)).map(publicDay), settings: await settings()
    }
  }

  async function savePlan(profile, day, input) {
    const level = levelOf(input.level || profile.level)
    const newGoal = integer(input.newGoal, 0, 100, '新词目标')
    const reviewGoal = integer(input.reviewGoal, 0, 500, '旧词目标')
    if (!newGoal && !reviewGoal) fail('新词和旧词目标不能同时为零')
    const available = await planAvailability(profile, level, day.date, Boolean(day.frozenAt))
    if (newGoal > available.newAvailable) fail('剩余新词不足，请降低新词目标')
    if (reviewGoal > available.reviewAvailable) fail('已学旧词不足，请降低旧词目标')
    if (!day.frozenAt) {
      profile.level = level
      profile.plan = { newGoal, reviewGoal }
      day.level = level
      day.plan = { newGoal, reviewGoal }
      day.availability = available
      day.newWordIds = [...((day.byLevel[level] || {}).newWordIds || [])]
      day.reviewWordIds = [...((day.byLevel[level] || {}).reviewWordIds || [])]
      profile.pendingPlan = null
    } else profile.pendingPlan = { level, newGoal, reviewGoal, appliesOn: nextDate(day.date) }
    return { ...await home(profile, day, level), appliesOn: day.frozenAt ? nextDate(day.date) : day.date }
  }

  function wordQuestion(word, mode, questionId) {
    if (mode === 'spelling') return { id: questionId, wordId: word.id, type: 'spelling', level: word.level, prompt: '根据中文释义拼写单词', definitionZh: word.definitionZh, exampleZh: word.exampleZh, options: [], choices: [], hasHint: true }
    const pool = wordsFor(word.level)
    const seen = meaningsOf(word)
    const positions = positionsOf(word.partOfSpeech)
    const samePosition = item => [...positionsOf(item.partOfSpeech)].some(pos => positions.has(pos))
    const candidates = shuffle(pool.filter(item => item.id !== word.id && samePosition(item))).concat(shuffle(pool.filter(item => item.id !== word.id && !samePosition(item))))
    const wrong = []
    for (const candidate of candidates) {
      const senses = meaningsOf(candidate)
      if ([...senses].some(sense => seen.has(sense))) continue
      wrong.push(candidate)
      for (const sense of senses) seen.add(sense)
      if (wrong.length === 3) break
    }
    if (wrong.length < 3) fail('词库至少需要四种不同释义')
    const choices = shuffle([word, ...wrong])
    const options = choices.map((item, i) => ({ id: 'ABCD'[i], text: item.definitionZh }))
    return { id: questionId, wordId: word.id, type: 'single_choice', level: word.level, prompt: '选择这个单词最贴切的中文释义', lemma: word.lemma, ipa: word.ipa, partOfSpeech: word.partOfSpeech, exampleEn: word.exampleEn, audioUrl: word.audioUrl, passage: '', options, choices: options, correctAnswer: options[choices.findIndex(item => item.id === word.id)].id, hasHint: true }
  }

  async function publicStudy(session) {
    let question = null
    if (session.cursor < session.wordIds.length) {
      const word = wordFor(session.wordIds[session.cursor])
      if (!word) fail('学习词条已更新，请重新开始')
      const stored = session.currentQuestion || wordQuestion(word, session.mode, session.id + ':' + session.cursor)
      session.currentQuestion = stored
      const { correctAnswer, ...publicFields } = stored
      question = session.mode === 'spelling' ? { ...publicFields, wordId: key('public-word', word.id) } : publicFields
      if (!session.questionStartedAt) session.questionStartedAt = clock().toISOString()
    }
    return { sessionId: session.id, mode: session.mode, level: session.level, extra: Boolean(session.extra), requestedCount: session.requestedCount || session.wordIds.length, status: question ? 'active' : 'completed', total: session.wordIds.length, completed: session.cursor, index: session.cursor, question }
  }

  async function ownedSession(profile, id, collection) {
    const session = await get(collection, String(id || ''))
    if (!session || session.openid !== profile.openid) fail('学习记录不存在或无权访问')
    return session
  }

  async function startStudy(profile, day, input) {
    const level = levelOf(input.level || profile.level)
    const mode = input.mode || 'new'
    if (!['new', 'review', 'spelling'].includes(mode)) fail('学习模式不正确')
    const extra = input.extraCount !== undefined
    const extraCount = extra ? integer(input.extraCount, 1, 100, '今日加练数量') : 0
    if (extra && (typeof input.extraCount === 'boolean' || mode === 'spelling')) fail('请为新词或旧词选择有效的加练数量')
    if (extra && (!day.checkedAt || level !== day.level)) fail('请先完成今日计划等级的新词与复习目标，再开始加练')
    if (mode !== 'spelling' && level === day.level && !day.frozenAt) {
      day.availability = await planAvailability(profile, level, day.date)
      if (planNotice(day).needsUpdate) fail('今日目标超过可用词数，请先重新保存学习目标')
    }
    const activeKey = day.date + ':' + level + ':' + mode
    const existing = profile.activeSessions[activeKey] && await get('english_sessions', profile.activeSessions[activeKey])
    if (existing && existing.cursor < existing.wordIds.length) return publicStudy(existing)
    const cards = (await cardsFor(profile)).filter(card => card.level === level).sort((a, b) => Date.parse(a.memory.due) - Date.parse(b.memory.due))
    const oldIds = new Set(profile.learnedWordIds)
    let ids
    if (mode === 'new') {
      const count = extra ? extraCount : level === day.level ? Math.max(0, day.plan.newGoal - day.newWordIds.length) : 20
      if (!count) fail('今日新词目标已完成')
      const eligible = wordsFor(level).filter(word => !oldIds.has(word.id))
      if (extra && count > eligible.length) fail('剩余新词不足，请减少今日加练数量')
      ids = eligible.slice(0, count).map(word => word.id)
    } else {
      const eligible = cards.filter(card => mode === 'spelling' || (dateOf(new Date(card.learnedAt)) < day.date && !day.reviewWordIds.includes(card.wordId)))
      const count = extra ? extraCount : mode === 'spelling' || level !== day.level ? 20 : Math.max(0, day.plan.reviewGoal - day.reviewWordIds.length)
      if (!count) fail('今日旧词目标已完成')
      if (extra && count > eligible.length) fail('今日剩余未复习旧词不足，请减少加练数量')
      ids = (mode === 'spelling' ? shuffle(eligible) : eligible).slice(0, count).map(card => card.wordId)
    }
    if (!ids.length) fail(mode === 'new' ? '没有可学习的新词' : '没有可复习的旧词，请先学习新词')
    if (mode !== 'spelling' && level === day.level && !day.frozenAt && !planNotice(day).needsUpdate) day.frozenAt = clock().toISOString()
    const session = { id: crypto.randomUUID(), openid: profile.openid, date: day.date, level, mode, extra, requestedCount: ids.length, wordIds: ids, cursor: 0, responses: {}, hints: {}, currentQuestion: null, questionStartedAt: null, startedAt: clock().toISOString() }
    const result = await publicStudy(session)
    profile.activeSessions[activeKey] = session.id
    await put('english_sessions', session.id, session)
    return result
  }

  async function answerStudy(profile, day, input) {
    const session = await ownedSession(profile, input.sessionId, 'english_sessions')
    const questionId = String(input.questionId || '')
    if (session.responses[questionId]) return { ...session.responses[questionId], session: await publicStudy(session), home: await home(profile, day, session.level), coinsEarned: 0 }
    if (session.date !== day.date) fail('这轮学习属于之前的日期，请开始今天的学习')
    const current = (await publicStudy(session)).question
    if (!current || current.id !== questionId) fail('当前题目已变化，请重新读取学习记录')
    const word = wordFor(session.wordIds[session.cursor])
    const answer = cleanText(input.answer, 200)
    if (session.mode !== 'spelling' && !current.options.some(option => option.id === answer)) fail('请选择有效选项')
    if (!answer) fail('请先作答')
    const correct = session.mode === 'spelling' ? answer.toLowerCase() === word.lemma.trim().toLowerCase() : answer === session.currentQuestion.correctAnswer
    const levelStats = levelDay(day, word.level)
    let intervalLabel = ''
    if (session.mode !== 'spelling') {
      const cardId = key('card', profile.openid, word.id)
      const previous = await get('english_cards', cardId)
      const rating = !correct ? 'again' : ['hard', 'good', 'easy'].includes(input.rating) ? input.rating : 'good'
      const scheduled = reviewMemory(previous && previous.memory, rating, clock())
      intervalLabel = scheduled.intervalLabel
      const card = { openid: profile.openid, level: word.level, wordId: word.id, learnedAt: previous ? previous.learnedAt : clock().toISOString(), ...scheduled }
      await put('english_cards', cardId, card)
      if (!profile.learnedWordIds.includes(word.id)) profile.learnedWordIds.push(word.id)
      if (correct) {
        const isNew = !previous || dateOf(new Date(previous.learnedAt)) === day.date
        const target = isNew ? day.newWordIds : day.reviewWordIds
        if (word.level === day.level && !target.includes(word.id)) target.push(word.id)
        const levelTarget = isNew ? levelStats.newWordIds : levelStats.reviewWordIds
        if (!levelTarget.includes(word.id)) levelTarget.push(word.id)
      }
    }
    const elapsed = Math.max(0, Math.floor((clock().getTime() - Date.parse(session.questionStartedAt)) / 1000))
    const duration = Number(input.activeSeconds || 0)
    const seconds = Math.min(elapsed, Number.isFinite(duration) ? Math.max(0, Math.floor(duration)) : 0, 600)
    day.studySeconds += seconds
    levelStats.studySeconds += seconds
    const feedback = { correct, answer: session.mode === 'spelling' ? word.lemma : word.definitionZh, correctAnswer: session.mode === 'spelling' ? word.lemma : session.currentQuestion.correctAnswer, lemma: word.lemma, ipa: word.ipa, partOfSpeech: word.partOfSpeech, definitionZh: word.definitionZh, meanings: word.meanings || [], exampleEn: word.exampleEn, exampleZh: word.exampleZh, examples: word.examples || [{ exampleEn: word.exampleEn, exampleZh: word.exampleZh }], audioUrl: word.audioUrl, explanation: word.explanation || word.definitionZh + (word.exampleZh ? '。例句：' + word.exampleZh : ''), modelAnswer: '', selfAssessment: null, usedHint: Boolean(session.hints[questionId]) }
    session.responses[questionId] = { correct, feedback, intervalLabel, retryScheduled: !correct }
    if (!correct) session.wordIds.splice(Math.min(session.cursor + 3, session.wordIds.length), 0, word.id)
    session.cursor++
    session.currentQuestion = null
    session.questionStartedAt = null
    const result = await publicStudy(session)
    await put('english_sessions', session.id, session)
    const coinsEarned = session.mode === 'spelling' ? 0 : await settleDay(profile, day)
    return { ...session.responses[questionId], session: result, home: await home(profile, day, session.level), coinsEarned }
  }

  async function studyHint(profile, input) {
    const session = await ownedSession(profile, input.sessionId, 'english_sessions')
    const question = (await publicStudy(session)).question
    if (!question || question.id !== input.questionId) fail('当前题目已变化')
    const word = wordFor(session.wordIds[session.cursor])
    session.hints[question.id] = session.hints[question.id] || clock().toISOString()
    await put('english_sessions', session.id, session)
    const hint = session.mode === 'spelling' ? '首字母 ' + word.lemma.slice(0, 1) + '，共 ' + word.lemma.length + ' 个字符' : word.hint || word.mnemonic || '结合例句语境和词性 ' + (word.partOfSpeech || '判断') + '，先排除不符合语境的释义。'
    return { hint, usedHint: true }
  }

  async function challengeDefinition(level) {
    const date = dateOf(clock())
    const id = key('challenge', date, level)
    return db.runTransaction(async () => {
      const existing = await get('english_challenges', id)
      if (existing) return existing
      const config = await settings()
      const pool = shuffle(wordsFor(level)).slice(0, config.challengeQuestionCount)
      if (pool.length < 4) fail('该等级挑战词库尚未准备好')
      const questions = pool.map(word => {
        const question = wordQuestion(word, 'new', word.id)
        return { ...question, prompt: word.lemma + ' 的正确中文释义是？', explanation: word.definitionZh + '。' + word.exampleZh }
      })
      const definition = { id, date, level, durationSeconds: config.challengeDurationSeconds, questions, answersAvailableAt: config.revealChallengeAnswersNextDay ? nextDate(date) + 'T00:00:00+08:00' : clock().toISOString(), contentVersion: data().version || '', createdAt: clock().toISOString() }
      await db.collection('english_challenges').doc(id).create({ data: definition })
      return definition
    }, { lock: 'eng-challenge:' + date + ':' + level, readCommitted: true })
  }

  async function publicChallenge(attempt) {
    const definition = await get('english_challenges', attempt.challengeId)
    const question = attempt.status === 'active' && definition.questions.find(item => item.id === attempt.order[attempt.cursor])
    const result = { challengeId: attempt.challengeId, attemptId: attempt.id, level: attempt.level, date: attempt.date, status: attempt.status, total: attempt.order.length, completed: attempt.cursor, answeredCount: Object.keys(attempt.answers).length, index: attempt.cursor, deadlineAt: attempt.deadlineAt, remainingSeconds: Math.max(0, Math.ceil((Date.parse(attempt.deadlineAt) - clock().getTime()) / 1000)), question: question ? { ...publicQuestion(question), options: attempt.options[question.id] } : null }
    if (attempt.status !== 'active') {
      result.correctCount = attempt.correctCount
      result.answersAvailableAt = definition.answersAvailableAt
      if (clock().getTime() >= Date.parse(definition.answersAvailableAt)) result.review = definition.questions.map(item => ({ question: publicQuestion(item), answer: attempt.answers[item.id] || '', feedback: grade(item, attempt.answers[item.id] || '') }))
    }
    return result
  }

  async function settleChallenge(profile, day, attempt) {
    if (attempt.status === 'active') { attempt.status = 'submitted'; attempt.submittedAt = clock().toISOString() }
    let coinsEarned = 0
    if (attempt.date === day.date && Object.keys(attempt.answers).length >= Math.min(5, attempt.order.length)) coinsEarned = await award(profile, day, 'challenge')
    await put('english_challenge_attempts', attempt.id, attempt)
    return coinsEarned
  }

  async function startChallenge(profile, day, input, definition) {
    const id = key('challenge-attempt', profile.openid, day.date, definition.level)
    let attempt = await get('english_challenge_attempts', id)
    if (!attempt) {
      const dayEnd = Date.parse(nextDate(day.date) + 'T00:00:00+08:00')
      if (clock().getTime() + definition.durationSeconds * 1000 > dayEnd) fail('今天已不足完整挑战时长，请明天再参加')
      attempt = { id, openid: profile.openid, date: day.date, level: definition.level, challengeId: definition.id, order: shuffle(definition.questions.map(item => item.id)), options: Object.fromEntries(definition.questions.map(item => [item.id, shuffle(item.options)])), cursor: 0, answers: {}, correctCount: 0, status: 'active', startedAt: clock().toISOString(), deadlineAt: new Date(clock().getTime() + definition.durationSeconds * 1000).toISOString() }
      await db.collection('english_challenge_attempts').doc(id).create({ data: attempt })
    } else if (attempt.status === 'active' && Date.parse(attempt.deadlineAt) <= clock().getTime()) await settleChallenge(profile, day, attempt)
    return publicChallenge(attempt)
  }

  async function answerChallenge(profile, day, input) {
    const attempt = await ownedSession(profile, input.attemptId, 'english_challenge_attempts')
    if (attempt.status !== 'active' || Date.parse(attempt.deadlineAt) <= clock().getTime()) {
      await settleChallenge(profile, day, attempt)
      return { ...await publicChallenge(attempt), accepted: false }
    }
    if (Object.hasOwn(attempt.answers, input.questionId)) return { ...await publicChallenge(attempt), accepted: true }
    const definition = await get('english_challenges', attempt.challengeId)
    const question = definition.questions.find(item => item.id === attempt.order[attempt.cursor])
    if (!question || question.id !== input.questionId) fail('当前挑战题已变化')
    const answer = cleanText(input.answer, 100)
    if (!question.options.some(option => option.id === answer)) fail('请选择有效选项')
    attempt.answers[question.id] = answer
    if (answer === question.correctAnswer) attempt.correctCount++
    attempt.cursor++
    if (attempt.cursor === attempt.order.length) await settleChallenge(profile, day, attempt)
    else await put('english_challenge_attempts', attempt.id, attempt)
    return { ...await publicChallenge(attempt), accepted: true }
  }

  async function finishChallenge(profile, day, input) {
    const attempt = await ownedSession(profile, input.attemptId, 'english_challenge_attempts')
    const coinsEarned = await settleChallenge(profile, day, attempt)
    return { ...await publicChallenge(attempt), coinsEarned }
  }

  function paperList(level, includeSuperseded = false) {
    const content = data(), byId = content.questionById || new Map(content.questions.map(question => [question.id, question]))
    const original = content.papers.map(paper => {
      const complete = paper.authenticity === 'past_exam' && paper.coverage && (paper.coverage.fullPaper || paper.coverage.fullNonListening)
      const questionIds = complete ? paper.questionIds.filter(id => byId.get(id).skill !== 'listening') : paper.questionIds || []
      return { ...paper, kind: 'structured', authenticity: paper.authenticity || paper.paperKind || 'original_mock', questionIds, available: Boolean(questionIds.length), questionCount: questionIds.length,
        title: paper.title + (complete && !paper.title.includes('不含听力') ? '（不含听力）' : ''), durationSeconds: complete ? 6000 : Number(paper.durationSeconds || 1200), resources: (paper.resources || []).filter(resource => resource.type !== 'audio'),
        ...(complete ? { description: '作文、阅读与翻译在同一套卷内完成；作文和翻译对照参考范文自评。', coverage: { ...paper.coverage, fullPaper: false, isFullExam: false, fullNonListening: true, listeningExcluded: true, objectiveCount: 30, subjectiveCount: 2, label: '整卷 · 不含听力', note: '作文1题＋阅读30题＋翻译1题；不含听力。' + (paper.coverage.fullNonListening && paper.coverage.note ? ' ' + paper.coverage.note : '') } } : {}) }
    })
    const external = sources.pastExams().map(paper => ({ ...paper, title: paper.title || paper.year + ' 年 ' + String(paper.month || '').padStart(2, '0') + ' 月 ' + (paper.level === 'CET4' ? '四级' : '六级') + '真题 · 第 ' + (paper.set || 1) + '套', authenticity: paper.authenticity || 'community_past_exam', available: false, questionCount: 0, durationSeconds: paper.level === 'CET4' ? 7500 : 7800, availabilityNote: paper.availabilityNote || '原始真题资料可阅读和下载；当前尚无校验完整的结构化逐题答案与详解，不提供自动判分考试。', resources: ['paper', 'answer', 'audio'].filter(type => paper[type + 'Url']).map(type => ({ id: paper.id + ':' + type, title: type === 'paper' ? '试卷' : type === 'answer' ? '答案与解析资料' : '听力音频', type, url: paper[type + 'Url'], downloadUrl: '/api/english/resource?paperId=' + encodeURIComponent(paper.id) + '&type=' + type })).concat(paper.kind === 'source_link' && paper.sourceUrl ? [{ id: paper.id + ':source', title: '真题资料来源', type: 'source', url: paper.sourceUrl, downloadUrl: '' }] : []) }))
    const identity = paper => [paper.level, paper.year, paper.month, paper.set || 1].join(':')
    const preferred = new Map()
    for (const paper of original.filter(paper => paper.year)) {
      const score = content.papers.find(item => item.id === paper.id).coverage || {}
      const priority = score.fullNonListening ? 2 : score.fullPaper ? 1 : 0
      const previous = preferred.get(identity(paper))
      if (!previous || priority > previous.priority) preferred.set(identity(paper), { paper, priority })
    }
    const listed = includeSuperseded ? original : original.filter(paper => !paper.year || preferred.get(identity(paper)).paper === paper)
    const structured = new Map(listed.filter(paper => paper.year).map(paper => [identity(paper), paper]))
    const resources = external.filter(paper => {
      const target = structured.get(identity(paper))
      if (!target || paper.kind === 'source_link') return true
      target.resources = [...target.resources, ...paper.resources.filter(resource => !target.resources.some(existing => existing.type === resource.type))]
      return false
    })
    return [...listed, ...resources].filter(paper => !level || paper.level === level).filter(paper => !paper.year || paper.year >= 2019).map(paper => ({ ...paper, resources: paper.resources.filter(resource => resource.type !== 'audio') }))
  }

  function paperCoverage(papers) {
    const complete = papers.filter(paper => paper.available && paper.coverage && paper.coverage.fullNonListening)
    const years = [...new Set(complete.map(paper => paper.year))].sort((a, b) => a - b)
    const periods = [...new Set(complete.map(paper => paper.year + '年' + paper.month + '月'))]
    return { fromYear: years[0] || null, toYear: years.at(-1) || null, years, periods, completePapers: complete.length, questions: complete.reduce((total, paper) => total + paper.questionCount, 0), listeningExcluded: true,
      text: complete.length ? '在线真题：' + years.join('、') + '年 · ' + complete.length + '套 · 每套32题（不含听力）' : '暂无已核验的不含听力整卷', requestedFromYear: 2019, requestedLatest: '2026年6月' }
  }

  async function publicExam(attempt) {
    const questions = attempt.questions.map(publicQuestion)
    const answers = attempt.questions.map(question => { const stored = attempt.answers[question.id] || {}; return { questionId: question.id, answer: stored.answer || '', checked: Boolean(stored.checked), draft: Boolean(stored.answer && !stored.checked), selfAssessment: stored.selfAssessment || null, hintUsed: Boolean(attempt.hints[question.id]), feedback: (attempt.mode === 'practice' && stored.checked) || attempt.status === 'submitted' ? grade(question, stored.answer || '', stored.selfAssessment) : null } })
    const firstUnanswered = answers.findIndex(answer => !answer.checked)
    const index = firstUnanswered === -1 ? questions.length : firstUnanswered
    return { attemptId: attempt.id, mode: attempt.mode, paper: attempt.paper, status: attempt.status, total: questions.length, completed: answers.filter(answer => answer.checked).length, index, deadlineAt: attempt.deadlineAt, question: attempt.status === 'active' ? questions[index] || null : null, questions, answers, drafts: Object.fromEntries(answers.filter(answer => answer.draft).map(answer => [answer.questionId, answer.answer])) }
  }

  async function startExam(profile, day, input) {
    const mode = input.mode === 'practice' ? 'practice' : 'exam'
    const level = levelOf(input.level || profile.level)
    let paper, questions
    if (input.paperId) {
      paper = paperList(undefined, true).find(item => item.id === input.paperId)
      if (!paper || !paper.available) fail('这份资料还没有校验完整的结构化题目，暂不支持站内自动判分')
      const content = data(), byId = content.questionById || new Map(content.questions.map(question => [question.id, question]))
      questions = paper.questionIds.map(id => byId.get(id))
    } else {
      if (mode !== 'practice') fail('请选择试卷')
      const candidates = data().questions.filter(question => question.level === level && (!input.skill || question.skill === input.skill))
      if (input.questionIds !== undefined) {
        if (!Array.isArray(input.questionIds) || !input.questionIds.length || input.questionIds.length > 100 || new Set(input.questionIds).size !== input.questionIds.length) fail('专项题目选择不正确')
        const byId = new Map(candidates.map(question => [question.id, question]))
        questions = input.questionIds.map(id => byId.get(id))
      } else questions = candidates.slice(0, 20)
      paper = { id: 'practice-' + level + '-' + (input.skill || 'all'), title: '专项练习', level, authenticity: 'practice', durationSeconds: 0 }
    }
    if (!questions.length || questions.some(question => !question)) fail('题目资料不完整')
    const activeKey = mode + ':' + paper.id + ':' + (input.questionIds ? key(...input.questionIds) : '') + (paper.coverage && paper.coverage.listeningExcluded ? ':non-listening-v1' : '')
    const existing = profile.activeExams[activeKey] && await get('english_exam_attempts', profile.activeExams[activeKey])
    if (existing && existing.status === 'active') {
      if (existing.mode !== 'practice' || existing.questions.some(question => !existing.answers[question.id] || !existing.answers[question.id].checked)) return publicExam(existing)
      await finishExam(profile, day, { attemptId: existing.id })
    }
    const attempt = { id: crypto.randomUUID(), openid: profile.openid, date: day.date, mode, level: paper.level, paper, questions, answers: {}, hints: {}, status: 'active', startedAt: clock().toISOString(), deadlineAt: mode === 'exam' ? new Date(clock().getTime() + paper.durationSeconds * 1000).toISOString() : null }
    profile.activeExams[activeKey] = attempt.id
    await put('english_exam_attempts', attempt.id, attempt)
    return publicExam(attempt)
  }

  function assessmentOf(input) { if (input.selfAssessment !== undefined && !['mastered', 'review', null].includes(input.selfAssessment)) fail('自评选项不正确'); return input.selfAssessment }

  function creditExam(day, question, answer) {
    const canonicalId = question.canonicalId || question.id
    if (question.type === 'short_text_self_check' || day.examQuestionIds.some(id => id.replace(/-(?:reading|nonlistening)-q(?=\d+$)/, '-q') === canonicalId)) return
    day.examQuestionIds.push(canonicalId)
    if (answer === question.correctAnswer) day.correctQuestionIds.push(canonicalId)
    const levelStats = levelDay(day, question.level)
    levelStats.examQuestionIds.push(canonicalId)
    if (answer === question.correctAnswer) levelStats.correctQuestionIds.push(canonicalId)
  }

  async function answerExam(profile, day, input, draftOnly) {
    const attempt = await ownedSession(profile, input.attemptId, 'english_exam_attempts')
    const question = attempt.questions.find(item => item.id === input.questionId)
    if (!question) fail('题目不存在')
    const previous = attempt.answers[question.id] || {}
    const selfAssessment = assessmentOf(input)
    if (input.answer === undefined && selfAssessment !== undefined && question.type === 'short_text_self_check') {
      if (!previous.checked && attempt.status !== 'submitted') fail('请先提交答案再自评')
      attempt.answers[question.id] = { ...previous, selfAssessment }
    } else {
      if (attempt.status !== 'active') return { feedback: grade(question, previous.answer || '', previous.selfAssessment), attempt: await publicExam(attempt) }
      if (attempt.deadlineAt && clock().getTime() >= Date.parse(attempt.deadlineAt)) return { feedback: null, attempt: await finishExam(profile, day, { attemptId: attempt.id }) }
      if (previous.checked && attempt.mode === 'practice') return { feedback: grade(question, previous.answer || '', previous.selfAssessment), attempt: await publicExam(attempt) }
      const answer = cleanText(input.answer)
      if (question.type === 'single_choice' && answer && !question.options.some(option => option.id === answer)) fail('请选择有效选项')
      if (!draftOnly && !answer) fail('请先作答')
      profile.examAnswerSequence = (profile.examAnswerSequence || 0) + 1
      attempt.answers[question.id] = { ...previous, answer, checked: !draftOnly, selfAssessment: selfAssessment === undefined ? previous.selfAssessment || null : selfAssessment, savedAt: clock().toISOString(), sequence: profile.examAnswerSequence }
      if (!draftOnly && attempt.mode === 'practice') creditExam(day, question, answer)
    }
    await put('english_exam_attempts', attempt.id, attempt)
    return { feedback: !draftOnly && (attempt.mode === 'practice' || attempt.status === 'submitted') ? grade(question, attempt.answers[question.id].answer || '', attempt.answers[question.id].selfAssessment) : null, attempt: await publicExam(attempt) }
  }

  async function examHint(profile, input) {
    const attempt = await ownedSession(profile, input.attemptId, 'english_exam_attempts')
    const question = attempt.questions.find(item => item.id === input.questionId)
    if (!question) fail('题目不存在')
    attempt.hints[question.id] = attempt.hints[question.id] || clock().toISOString()
    await put('english_exam_attempts', attempt.id, attempt)
    return { hint: question.hint || question.guidance || '先确定题干中的关键词，再结合上下文判断。', usedHint: true }
  }

  async function finishExam(profile, day, input) {
    const attempt = await ownedSession(profile, input.attemptId, 'english_exam_attempts')
    if (attempt.status === 'active') {
      attempt.status = 'submitted'
      attempt.submittedAt = clock().toISOString()
      for (const question of attempt.questions) {
        const answer = attempt.answers[question.id] || { answer: '', selfAssessment: null }
        attempt.answers[question.id] = { ...answer, checked: true }
        if (answer.answer) creditExam(day, question, answer.answer)
      }
      await put('english_exam_attempts', attempt.id, attempt)
    }
    return examResult(attempt)
  }

  async function examResult(attempt) {
    const result = await publicExam(attempt)
    const objective = result.answers.filter(answer => answer.feedback.correct !== null)
    return { ...result, correctCount: objective.filter(answer => answer.feedback.correct).length, objectiveCount: objective.length, objectiveScore: objective.reduce((sum, answer) => sum + answer.feedback.score, 0), objectiveMaxScore: objective.reduce((sum, answer) => sum + answer.feedback.maxScore, 0), selfCheckPendingCount: result.answers.filter(answer => answer.feedback.correct === null && !answer.selfAssessment).length, review: result.questions.map(question => ({ question, ...result.answers.find(answer => answer.questionId === question.id) })), authenticity: attempt.paper.authenticity }
  }

  async function examHistory(openid, input) {
    const level = levelOf(input.level || 'CET4')
    const attempts = (await all('english_exam_attempts', { openid })).filter(attempt => attempt.level === level).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    return { items: attempts.slice(0, 100).map(attempt => {
      const answered = Object.values(attempt.answers)
      const objective = attempt.questions.filter(question => question.type === 'single_choice')
      return { attemptId: attempt.id, paper: attempt.paper, mode: attempt.mode, status: attempt.status, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt || null, completed: answered.filter(answer => answer.answer).length, total: attempt.questions.length, correctCount: attempt.mode === 'exam' && attempt.status === 'active' ? null : objective.filter(question => attempt.answers[question.id] && attempt.answers[question.id].checked && attempt.answers[question.id].answer === question.correctAnswer).length, objectiveCount: objective.length, selfCheckPendingCount: attempt.questions.filter(question => question.type === 'short_text_self_check' && attempt.answers[question.id] && attempt.answers[question.id].checked && !attempt.answers[question.id].selfAssessment).length }
    }) }
  }

  async function wrongQuestions(openid, input) {
    const level = levelOf(input.level || 'CET4'), latest = new Map()
    for (const attempt of await all('english_exam_attempts', { openid })) {
      if (attempt.mode === 'exam' && attempt.status !== 'submitted') continue
      for (const question of attempt.questions) {
        const answer = attempt.answers[question.id]
        if (question.level !== level || question.type !== 'single_choice' || !answer || !answer.checked) continue
        const lastAnsweredAt = answer.savedAt || attempt.submittedAt || attempt.startedAt
        const previous = latest.get(question.id)
        const isLater = !previous || (answer.sequence && previous.answer.sequence ? answer.sequence > previous.answer.sequence : lastAnsweredAt >= previous.lastAnsweredAt)
        if (isLater) latest.set(question.id, { question, answer, lastAnsweredAt })
      }
    }
    return { items: [...latest.values()].filter(row => row.answer.answer !== row.question.correctAnswer).sort((a, b) => b.lastAnsweredAt.localeCompare(a.lastAnsweredAt)).slice(0, 100).map(row => ({ question: publicQuestion(row.question), lastAnsweredAt: row.lastAnsweredAt })) }
  }

  async function wardrobe(profile) {
    const catalog = sources.shop()
    return { character: profile.character, coins: profile.coins, catalog: catalog.items, owned: profile.owned, equipped: profile.equipped, theme: profile.equipped.themes.portal || 'default', foodStock: profile.foodStock, assets: catalog.assets, gameSettings: await settings(), ...wardrobeHeat(profile, catalog) }
  }

  function shopItem(id) { const item = sources.shop().items.find(item => item.id === id); if (!item || item.enabled === false) fail('商品不存在或暂不可购买'); return item }
  function compatible(item, character) { return item.character === 'all' || item.character === character || (item.compatibleCharacters || []).includes(character) }

  async function buyItem(profile, input) {
    const item = shopItem(input.itemId)
    const price = integer(item.price, 0, 100000, '商品价格')
    if (item.category !== 'food' && profile.owned.includes(item.id)) return wardrobe(profile)
    const requestId = item.category === 'food' ? requestKey(input) : String(input.requestId || item.id)
    const ledgerId = key('purchase', profile.openid, requestId)
    const previous = await get('english_coin_ledger', ledgerId)
    if (previous) { if (previous.itemId !== item.id) fail('请求编号已用于其他商品'); return wardrobe(profile) }
    if (profile.coins < price) fail('金币不足')
    if (!['food', 'outfit', 'accessory', 'shoes', 'theme'].includes(item.category)) fail('商品类型不正确')
    profile.coins -= price
    if (item.category === 'food') profile.foodStock[item.id] = (profile.foodStock[item.id] || 0) + 1
    else profile.owned.push(item.id)
    await db.collection('english_coin_ledger').doc(ledgerId).create({ data: { openid: profile.openid, date: dateOf(clock()), kind: 'purchase', itemId: item.id, amount: -price, requestId, createdAt: clock().toISOString() } })
    return wardrobe(profile)
  }

  async function equipItem(profile, input) {
    if (!input.itemId) {
      if (input.slot === 'theme') { if (!MODULES.includes(input.module)) fail('主题模块不正确'); delete profile.equipped.themes[input.module] }
      else if (['outfit', 'accessory', 'shoes'].includes(input.slot)) profile.equipped[input.slot] = ''
      else fail('装备位置不正确')
      return wardrobe(profile)
    }
    const item = shopItem(input.itemId)
    if (!profile.owned.includes(item.id)) fail('请先购买这件装扮')
    if (item.category === 'theme') {
      const module = input.module || item.module || 'portal'
      if (!MODULES.includes(module) || (Array.isArray(item.modules) && !item.modules.includes(module))) fail('主题不适用于该模块')
      profile.equipped.themes[module] = item.id
    } else {
      if (!['outfit', 'accessory', 'shoes'].includes(item.category) || !compatible(item, profile.character)) fail('装扮不适用于当前人物外观')
      profile.equipped[item.category] = item.id
    }
    return wardrobe(profile)
  }

  async function selectCharacter(profile, input) {
    if (!['boy', 'girl'].includes(input.character)) fail('请选择人物外观')
    profile.character = input.character
    for (const slot of ['outfit', 'accessory', 'shoes']) {
      const item = sources.shop().items.find(item => item.id === profile.equipped[slot])
      if (item && !compatible(item, profile.character)) profile.equipped[slot] = ''
    }
    return wardrobe(profile)
  }

  async function feed(profile, input) {
    const item = shopItem(input.itemId)
    if (item.category !== 'food') fail('请选择食物')
    const requestId = requestKey(input)
    const feedId = key('feed', profile.openid, requestId)
    const previous = await get('english_feed_events', feedId)
    if (previous) { if (previous.itemId !== item.id) fail('请求编号已用于其他食物'); return { ...await wardrobe(profile), expression: 'yum', animationId: requestId } }
    if (!(profile.foodStock[item.id] > 0)) fail('这份食物已经用完')
    profile.foodStock[item.id]--
    await db.collection('english_feed_events').doc(feedId).create({ data: { openid: profile.openid, itemId: item.id, date: dateOf(clock()), requestId, createdAt: clock().toISOString() } })
    return { ...await wardrobe(profile), expression: 'yum', animationId: requestId }
  }

  async function rank(openid, input) {
    const type = input.type || 'study', period = input.period || 'day', level = levelOf(input.level || 'CET4')
    if (!['study', 'challenge', 'exam'].includes(type) || !['day', 'week', 'all'].includes(period)) fail('排行榜类型不正确')
    const today = dateOf(clock())
    const weekday = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7
    const start = period === 'day' ? today : period === 'week' ? dateOf(new Date(Date.parse(today + 'T00:00:00+08:00') - weekday * 86400000)) : '0000-00-00'
    const history = await all('english_daily')
    const groupedHistory = new Map()
    for (const day of history) { if (!groupedHistory.has(day.openid)) groupedHistory.set(day.openid, []); groupedHistory.get(day.openid).push(day) }
    const rows = (type === 'challenge' ? await all('english_challenge_attempts') : history).filter(row => row.date >= start && row.date <= today && (type === 'challenge' ? row.level === level && row.status === 'submitted' && Object.keys(row.answers).length : Boolean(row.byLevel && row.byLevel[level]) || row.level === level))
    const users = new Map()
    for (const row of rows) {
      const stats = type === 'challenge' ? row : row.byLevel && row.byLevel[level] || row
      const value = users.get(row.openid) || { openid: row.openid, score: 0, newCount: 0, reviewCount: 0, correctCount: 0, studySeconds: 0, checkedAt: null, lastCheckedAt: null }
      value.newCount += (stats.newWordIds || []).length
      value.reviewCount += (stats.reviewWordIds || []).length
      value.correctCount += type === 'challenge' ? row.correctCount : (stats.correctQuestionIds || []).length
      value.score += type === 'study' ? (stats.newWordIds || []).length + (stats.reviewWordIds || []).length : type === 'challenge' ? row.correctCount : (stats.correctQuestionIds || []).length
      value.studySeconds += stats.studySeconds || 0
      if (row.checkedAt && (!value.lastCheckedAt || row.checkedAt > value.lastCheckedAt)) value.lastCheckedAt = row.checkedAt
      if (period === 'day') value.checkedAt = row.checkedAt || null
      users.set(row.openid, value)
    }
    const profiles = users.size ? await all('users', { openid: db.command.in([...users.keys()]) }) : []
    const names = new Map(profiles.map(user => [user.openid, user]))
    const list = [...users.values()].filter(user => type === 'challenge' || user.score > 0).sort((a, b) => b.score - a.score || a.openid.localeCompare(b.openid))
    let lastScore = null, lastRank = 0
    const items = list.map((user, i) => { if (user.score !== lastScore) { lastRank = i + 1; lastScore = user.score } const profile = names.get(user.openid) || {}; return { ...user, ...historySummary(groupedHistory.get(user.openid) || []), rank: lastRank, nickName: profile.nickName || '学习者', avatarUrl: profile.avatarUrl || '' } })
    const mine = items.find(user => user.openid === openid)
    return { type, period, level, items: items.slice(0, 100), myRank: mine ? mine.rank : null, myScore: mine ? mine.score : 0 }
  }

  async function admin(openid, input) {
    const users = await all('global_admin', { loginOpenid: openid })
    const current = users.find(user => user.status !== 'disabled')
    if (!current) fail('需要管理员权限')
    if (input.action === 'saveGameSettings') {
      if (current.role !== 'super') fail('需要超级管理员权限')
      const value = input.settings || input.data || input
      await db.runTransaction(async () => {
        const verified = await get('global_admin', current._id)
        if (!verified || verified.loginOpenid !== openid || verified.status === 'disabled' || verified.role !== 'super') fail('需要超级管理员权限')
        const currentSettings = await settings()
        for (const [name, min, max] of [['newReward', 0, 100], ['reviewReward', 0, 100], ['challengeReward', 0, 100], ['runningReward', 0, 100], ['commentReward', 0, 100], ['photoReward', 0, 100], ['likeReward', 0, 100], ['likeDailyCap', 0, 20], ['challengeDurationSeconds', 30, 900], ['challengeQuestionCount', 5, 100]]) if (Object.hasOwn(value, name)) currentSettings[name] = integer(value[name], min, max, name)
        if (Object.hasOwn(value, 'revealChallengeAnswersNextDay')) { if (typeof value.revealChallengeAnswersNextDay !== 'boolean') fail('答案开放配置不正确'); currentSettings.revealChallengeAnswersNextDay = value.revealChallengeAnswersNextDay }
        await put('english_settings', 'game', { ...currentSettings, updatedBy: openid, updatedAt: clock().toISOString() })
        await db.collection('global_admin_log').add({ data: { _openid: openid, module: 'english', action: 'saveGameSettings', detail: currentSettings, createTime: clock().toISOString() } })
      }, { lock: 'english-settings', readCommitted: true })
    }
    const content = data(), paperItems = paperList()
    return { admin: { role: current.role, name: current.username || current.name || '' }, settings: await settings(), counts: { words: content.words.length, questions: content.questions.length, originalPapers: paperItems.filter(paper => paper.available && paper.authenticity === 'original_mock').length, realPapers: paperItems.filter(paper => paper.available && paper.authenticity === 'past_exam').length, fullRealPapers: paperItems.filter(paper => paper.available && paper.authenticity === 'past_exam' && paper.coverage && paper.coverage.fullNonListening).length, pastExamResources: paperItems.filter(paper => !paper.available).length, learners: (await all('english_profiles')).length }, coverage: paperCoverage(paperItems), limitations: '在线整卷不含听力；真题范围以各卷标注为准，资料目录不等于完整题库。' }
  }

  async function main(event = {}) {
    const input = { ...event, ...(event.data || {}), action: event.action }
    const openid = sdk.getWXContext().OPENID
    if (!openid) return { success: false, msg: '请先登录' }
    try {
      if (['adminOverview', 'saveGameSettings'].includes(input.action)) return ok(await admin(openid, input))
      if (!['wardrobe', 'wardrobeRank', 'buyItem', 'equipItem', 'selectCharacter', 'feed', 'campusRewards', 'claimCampusRewards', 'setCampusRunGoal'].includes(input.action)) await requireEnabled()
      if (input.action === 'wardrobeRank') return ok(buildWardrobeRanking(await all('english_profiles'), sources.shop(), await all('users'), openid))
      if (input.action === 'rank') return ok(await rank(openid, input))
      if (input.action === 'papers') { const papers = paperList(input.level ? levelOf(input.level) : undefined); return ok({ papers, coverage: paperCoverage(papers), counts: { total: papers.length, available: papers.filter(paper => paper.available).length } }) }
      if (input.action === 'examHistory') return ok(await examHistory(openid, input))
      if (input.action === 'wrongQuestions') return ok(await wrongQuestions(openid, input))
      if (input.action === 'examDetail') { const attempt = await ownedSession({ openid }, input.attemptId, 'english_exam_attempts'); return ok(await (attempt.status === 'submitted' ? examResult(attempt) : publicExam(attempt))) }
      if (input.action === 'challengeHistory') return ok({ items: (await all('english_challenge_attempts', { openid })).filter(attempt => attempt.level === levelOf(input.level || 'CET4')).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100).map(attempt => ({ attemptId: attempt.id, date: attempt.date, status: attempt.status, correctCount: attempt.status === 'submitted' ? attempt.correctCount : null, total: attempt.order.length })) })
      if (input.action === 'challengeDetail') return ok(await publicChallenge(await ownedSession({ openid }, input.attemptId, 'english_challenge_attempts')))
      const definition = input.action === 'startChallenge' ? await challengeDefinition(levelOf(input.level || 'CET4')) : null
      const rewardsDate = dateOf(clock())
      const snapshot = ['home', 'wardrobe', 'campusRewards', 'claimCampusRewards', 'setCampusRunGoal'].includes(input.action) ? await campusSnapshot(db, openid, rewardsDate) : null
      const response = await db.runTransaction(async () => {
        const profile = await profileFor(openid), day = await dayFor(profile)
        if (snapshot && day.date !== rewardsDate) fail('日期已更新，请刷新后重试')
        const rewards = snapshot ? await settleCampusRewards({ db, get, profile, day, snapshot, now: clock().toISOString() }) : null
        let result
        switch (input.action) {
          case 'setCampusRunGoal': {
            const goalKm = Number(input.goalKm)
            if (!Number.isFinite(goalKm) || goalKm < 0.5 || goalKm > 20 || Math.abs(goalKm * 10 - Math.round(goalKm * 10)) > 0.000001) fail('每日目标需为0.5至20公里，保留一位小数')
            if (day.campusRunFrozen) profile.campusRunPlan.pending = { goalKm, appliesOn: nextDate(day.date) }
            else { profile.campusRunPlan.goalKm = goalKm; profile.campusRunPlan.pending = null; day.campusRunGoalKm = goalKm; await settleCampusRewards({ db, get, profile, day, snapshot, now: clock().toISOString() }) }
            result = campusTasks(profile, day, snapshot, (await all('english_coin_ledger', { openid, date: day.date })).filter(row => row.kind === 'campus_reward')); break
          }
          case 'campusRewards':
          case 'claimCampusRewards': result = { ...campusTasks(profile, day, snapshot, rewards.issued), coinsEarned: rewards.coinsEarned }; break
          case 'home': result = await home(profile, day, input.level); break
          case 'savePlan': result = await savePlan(profile, day, input); break
          case 'startStudy': result = await startStudy(profile, day, input); break
          case 'answerStudy': result = await answerStudy(profile, day, input); break
          case 'studyHint': result = await studyHint(profile, input); break
          case 'startChallenge': result = await startChallenge(profile, day, input, definition); break
          case 'answerChallenge': result = await answerChallenge(profile, day, input); break
          case 'finishChallenge': result = await finishChallenge(profile, day, input); break
          case 'startExam': result = await startExam(profile, day, input); break
          case 'answerExam': result = await answerExam(profile, day, input, false); break
          case 'saveExamDraft': result = await answerExam(profile, day, input, true); break
          case 'examHint': result = await examHint(profile, input); break
          case 'finishExam': result = await finishExam(profile, day, input); break
          case 'wardrobe': result = await wardrobe(profile); break
          case 'buyItem': result = await buyItem(profile, input); break
          case 'equipItem': result = await equipItem(profile, input); break
          case 'selectCharacter': result = await selectCharacter(profile, input); break
          case 'feed': result = await feed(profile, input); break
          default: fail('不支持的英语学习操作')
        }
        await put('english_profiles', key(openid), profile)
        await put('english_daily', key(openid, day.date), day)
        return ok(result)
      }, { lock: walletLock(openid), readCommitted: true })
      if (response.success && ['home', 'savePlan'].includes(input.action)) await attachHistory(openid, response.data)
      if (response.success && response.data.home) await attachHistory(openid, response.data.home)
      if (input.action === 'finishChallenge' && response.success) {
        response.data.rank = await rank(openid, { type: 'challenge', period: 'day', level: response.data.level })
        response.data.myRank = response.data.rank.myRank
      }
      return response
    } catch (error) { return { success: false, msg: error.message || '英语学习服务暂时不可用' } }
  }

  return { main }
}

const service = createService()
module.exports = { main: service.main, createService }
