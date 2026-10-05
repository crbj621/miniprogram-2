const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function createStudy(request) {
  const renders = [], events = [], feedbackEvents = [], errorListeners = new Set(), feedbackErrors = new Set(), feedbackEnds = new Set()
  let page, creations = 0
  function context(log, errors, ends) {
    let destroyed = false
    return { src: '',
      onError(callback) { errors.add(callback) }, offError(callback) { errors.delete(callback) },
      onEnded(callback) { ends.add(callback) }, offEnded(callback) { ends.delete(callback) },
      stop() { assert.equal(destroyed, false); log.push({ type: 'stop' }) },
      play() { assert.equal(destroyed, false); log.push({ type: 'play', src: this.src }) },
      destroy() { assert.equal(destroyed, false); destroyed = true; log.push({ type: 'destroy' }) }
    }
  }
  const audio = context(events, errorListeners, new Set()), feedbackAudio = context(feedbackEvents, feedbackErrors, feedbackEnds)
  const file = path.resolve(__dirname, '../miniprogram/packageEnglish/pages/study/study.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, Date, Math,
    wx: { createInnerAudioContext: () => { creations++; return creations === 1 ? audio : feedbackAudio }, pageScrollTo() {}, navigateBack() {} },
    require: ref => ref.endsWith('/page-share') ? { withSharing: value => value } : ref.endsWith('/english-api') ? {
      callEnglish: request, englishRequestId: () => 'request', englishResourceUrl: url => 'https://campus.test/campus-api/' + url.replace(/^\//, '')
    } : ref.endsWith('/format') ? { message: error => error.message } : { getSavedCampusTheme: () => ({ style: '' }) },
    Page: definition => { page = definition }
  })
  page.setData = (data, callback) => { Object.assign(page.data, data); if (callback) renders.push(callback) }
  return {
    page, audio, events, errorListeners, feedbackAudio, feedbackEvents, feedbackEnds,
    render() { while (renders.length) renders.shift()() },
    plays: () => events.filter(event => event.type === 'play'),
    feedbackPlays: () => feedbackEvents.filter(event => event.type === 'play'),
    creations: () => creations,
    failAudio() { for (const callback of [...errorListeners]) callback({ errCode: 10002, errMsg: 'network failed' }) },
    endFeedback() { for (const callback of [...feedbackEnds]) callback() },
    failFeedback() { for (const callback of [...feedbackErrors]) callback() }
  }
}

function session(id, mode = 'new', completed = 0) {
  return { sessionId: 'study-session', mode, total: 3, completed, question: { id, lemma: id, options: [], audioUrl: '/api/english/audio?word=' + id } }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

async function start(mode = 'new') {
  const study = createStudy(async () => session('book', mode))
  study.page.onLoad({ mode }); study.page.onShow()
  await settle(); study.render()
  return study
}

async function run() {
  for (const mode of ['new', 'review']) {
    const loading = deferred()
    const study = createStudy(() => loading.promise)
    study.page.onLoad({ mode }); study.page.onShow(); study.render()
    assert.equal(study.plays().length, 0, 'onShow before the request completes cannot play an empty question')
    loading.resolve(session('book', mode)); await settle()
    assert.equal(study.plays().length, 0, 'a fetched word waits for its card to render')
    study.render()
    assert.equal(study.plays().length, 1, mode + ' starts with one automatic pronunciation')
    assert.match(study.plays()[0].src, /^https:\/\/campus.test\/campus-api\/api\/english\/audio\?word=book$/)
    study.page.onShow(); study.render()
    assert.equal(study.plays().length, 1, 'a duplicate initial onShow cannot repeat pronunciation')
    assert.equal(study.creations(), 2, 'separate native pronunciation and short feedback contexts serve the page')
    study.page.onUnload()
  }

  const beforeShow = createStudy(async () => session('early'))
  beforeShow.page.onLoad({ mode: 'new' }); await settle(); beforeShow.render()
  assert.equal(beforeShow.plays().length, 0, 'a response before first onShow remains silent')
  beforeShow.page.onShow(); beforeShow.render()
  assert.equal(beforeShow.plays().length, 1, 'first onShow plays an already rendered word')
  beforeShow.page.onUnload()

  const study = await start()
  study.page.showSession(session('old')); study.page.showSession(session('new'))
  const afterStop = study.events[study.events.length - 1]
  assert.equal(afterStop.type, 'stop', 'changing the word cancels the old audio immediately')
  study.render()
  assert.deepEqual(study.plays().map(event => event.src.split('word=')[1]), ['book', 'new'], 'late render callbacks never play the superseded word')
  study.page.showSession(session('new', 'new', 1)); study.render()
  assert.equal(study.plays().length, 3, 'a repeated word in the next question is pronounced again')
  const canceledError = [...study.errorListeners][0]
  study.page.showSession(session('next')); study.render()
  canceledError({ errCode: 10002 })
  assert.equal(study.page.data.error, '', 'a delayed old audio error cannot overwrite the new word')
  study.failAudio()
  assert.match(study.page.data.error, /发音播放失败/, 'a current network audio failure gives a retry message')
  study.page.playAudio()
  assert.equal(study.plays().length, 5, 'the pronunciation button retries failed automatic playback')
  study.page.onHide()
  assert.equal(study.events[study.events.length - 1].type, 'stop', 'hiding cancels playing or buffering pronunciation')
  study.page.playAudio(); study.failAudio()
  assert.equal(study.plays().length, 5, 'hidden pages cannot play even from a late manual handler')
  study.page.onShow(); study.render()
  assert.equal(study.plays().length, 6, 'returning automatically pronounces the current word once')
  study.page.onUnload()
  const eventsAtUnload = study.events.length
  study.page.playAudio(); study.page.onShow(); study.render(); study.failAudio()
  assert.equal(study.events.length, eventsAtUnload, 'disposed pages never use the destroyed audio context')

  const hiddenLoad = deferred()
  const hidden = createStudy(() => hiddenLoad.promise)
  hidden.page.onLoad({ mode: 'review' }); hidden.page.onShow(); hidden.page.onHide()
  hiddenLoad.resolve(session('hidden', 'review')); await settle(); hidden.render()
  assert.equal(hidden.plays().length, 0, 'a late response while hidden cannot start pronunciation')
  hidden.page.onShow(); hidden.render()
  assert.equal(hidden.plays().length, 1, 'returning plays the word fetched in the background')
  hidden.page.onUnload()

  const unloading = deferred()
  const unloaded = createStudy(() => unloading.promise)
  unloaded.page.onLoad({ mode: 'new' }); unloaded.page.onShow(); unloaded.page.onUnload()
  unloading.resolve(session('disposed')); await settle(); unloaded.render()
  assert.equal(unloaded.plays().length, 0, 'a response after unloading cannot play')
  assert.equal(unloaded.page.data.question, null, 'a response after unloading cannot render a word')

  const hiddenRender = await start()
  hiddenRender.page.showSession(session('pending-render')); hiddenRender.page.onHide(); hiddenRender.render()
  assert.equal(hiddenRender.plays().length, 1, 'a render callback after hiding remains silent')
  hiddenRender.page.onShow(); hiddenRender.render()
  assert.equal(hiddenRender.plays().length, 2, 'returning plays the word rendered while hidden')
  hiddenRender.page.showSession({ status: 'completed', completed: 3, total: 3, question: null }); hiddenRender.render()
  assert.equal(hiddenRender.plays().length, 2, 'a completed session does not pronounce the last word again')
  hiddenRender.page.onUnload()

  for (const mode of ['new', 'spelling']) {
    const answer = deferred()
    const spelling = createStudy(action => action === 'startStudy' ? Promise.resolve(session('book', mode)) : answer.promise)
    spelling.page.onLoad({ mode }); spelling.page.onShow(); await settle(); spelling.render()
    assert.equal(spelling.plays().length, mode === 'spelling' ? 0 : 1, 'spelling cannot reveal an answer through automatic audio')
    if (mode === 'spelling') { spelling.page.playAudio(); assert.equal(spelling.plays().length, 0, 'spelling also blocks answer audio from a manual call before feedback') }
    const answering = spelling.page.answer('book')
    answer.resolve({ feedback: { lemma: 'book', correct: true, meanings: [], examples: [], audioUrl: '/api/english/audio?word=book' }, session: session('next', mode, 1) })
    await answering
    assert.equal(spelling.plays().length, mode === 'spelling' ? 0 : 1, 'feedback waits for its card to render before pronunciation')
    spelling.render()
    assert.equal(spelling.feedbackPlays().length, 1, 'answer plays one local feedback sound after rendering')
    assert.equal(spelling.plays().length, mode === 'spelling' ? 0 : 1, 'feedback sound never overlaps the spelling answer pronunciation')
    spelling.endFeedback()
    assert.equal(spelling.plays().length, 1, 'normal feedback does not repeat audio, spelling feedback pronounces its revealed word')
    spelling.page.continueStudy(); spelling.render()
    assert.equal(spelling.plays().length, mode === 'spelling' ? 1 : 2, 'next-word autoplay follows the selected study mode')
    spelling.page.onUnload()
  }

  for (const correct of [true, false]) {
    const pending = deferred(), calls = []
    const feedback = createStudy((action, data) => { calls.push({ action, data }); return action === 'startStudy' ? Promise.resolve(session('choice')) : pending.promise })
    feedback.page.onLoad({ mode: 'new', extraCount: '3' }); feedback.page.onShow(); await settle(); feedback.render()
    assert.equal(calls[0].data.extraCount, 3, 'selected extra quantity reaches the server')
    const answering = feedback.page.answer('A'); await feedback.page.answer('A')
    assert.equal(calls.filter(row => row.action === 'answerStudy').length, 1, 'rapid taps submit one answer')
    pending.resolve({ feedback: { correct, lemma: 'choice', meanings: [], examples: [] }, session: session('next', 'new', 1) })
    await answering; feedback.render()
    assert.equal(feedback.page.data.cardState, correct ? 'correct' : 'retry', 'answer has the corresponding visible feedback')
    assert.equal(feedback.feedbackPlays().length, 1)
    assert.match(feedback.feedbackPlays()[0].src, correct ? /correct\.wav$/ : /retry\.wav$/)
    assert.equal(feedback.feedbackAudio.obeyMuteSwitch, false)
    await feedback.page.answer('A'); feedback.render()
    assert.equal(feedback.feedbackPlays().length, 1, 'answered questions cannot replay their settlement sound')
    const stale = [...feedback.feedbackEnds][0]
    feedback.page.continueStudy(); feedback.render(); stale()
    assert.equal(feedback.page.data.cardState, 'enter', 'next card resets the previous feedback animation')
    assert.equal(feedback.page.data.question.id, 'next')
    assert.equal(feedback.plays().length, 2, 'next question pronounces once despite late feedback completion')
    feedback.page.onHide(); feedback.page.onUnload(); stale()
    assert.equal(feedback.feedbackEvents.filter(row => row.type === 'destroy').length, 1, 'feedback audio is destroyed on unload')
    assert.equal(feedback.events.filter(row => row.type === 'destroy').length, 1, 'pronunciation audio is destroyed on unload')
  }
  const fallback = createStudy(action => Promise.resolve(action === 'startStudy' ? session('book', 'spelling') : { feedback: { correct: true, lemma: 'book', meanings: [], examples: [], audioUrl: '/api/english/audio?word=book' }, session: session('next', 'spelling', 1) }))
  fallback.page.onLoad({ mode: 'spelling' }); fallback.page.onShow(); await settle(); fallback.render(); await fallback.page.answer('book'); fallback.render()
  fallback.failFeedback(); assert.equal(fallback.plays().length, 1, 'feedback audio failure still allows spelling pronunciation'); fallback.page.onUnload()
  for (const file of ['correct.wav', 'retry.wav']) {
    const bytes = fs.readFileSync(path.join(__dirname, '../miniprogram/packageEnglish/assets/audio', file))
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE')
    assert.equal(bytes.readUInt16LE(20), 1, 'feedback is standard PCM'); assert.ok(bytes.length < 16000)
    assert.ok(bytes.subarray(44).some(byte => byte !== 0), 'feedback contains a real non-silent waveform')
  }

  const missing = createStudy(async () => ({ ...session('missing'), question: { id: 'missing', options: [] } }))
  missing.page.onLoad({ mode: 'new' }); missing.page.onShow(); await settle(); missing.render()
  assert.equal(missing.plays().length, 0, 'missing audio never starts an empty or previous source')
  assert.match(missing.page.data.error, /暂未提供/, 'missing pronunciation retains its explicit resource error')
  missing.page.onUnload()
  console.log('英语自动读音回归通过：新词／复习首题、渲染时机、连续切词、旧回调取消、隐藏／返回／卸载、拼写答后读音、网络失败重试')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
