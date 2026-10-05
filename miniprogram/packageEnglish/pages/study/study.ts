import { withSharing } from '../../../utils/page-share'
import { callEnglish, englishRequestId, englishResourceUrl } from '../../../utils/english-api'
import { message } from '../../utils/format'
import { getSavedCampusTheme } from '../../../utils/campus-theme'

Page(withSharing({
  data: { theme: getSavedCampusTheme('english'), level: 'CET4', mode: 'new', loading: false, busy: false, error: '', session: null as any,
    question: null as any, feedback: null as any, hint: '', hintLoading: false, spelling: '', chosen: '', coinsEarned: 0, intervalLabel: '', progress: 0, completed: 0, total: 0, nextCompleted: false, cardState: 'enter' },
  onLoad(options: any) {
    const mode = ['new', 'review', 'spelling'].includes(options.mode) ? options.mode : 'new'
    this.visible = false
    this.setData({ level: options.level === 'CET6' ? 'CET6' : 'CET4', mode })
    this.audio = wx.createInnerAudioContext()
    this.audio.autoplay = false
    this.feedbackAudio = wx.createInnerAudioContext()
    this.feedbackAudio.autoplay = false
    this.feedbackAudio.obeyMuteSwitch = false
    this.feedbackAudio.volume = .55
    this.extraCount = options.extraCount === undefined ? undefined : Number(options.extraCount)
    this.loadSession()
  },
  onShow() {
    if (this.disposed) return
    this.visible = true
    this.setData({ theme: getSavedCampusTheme('english') }); this.activeStarted = Date.now()
    this.autoPlayAudio()
  },
  onHide() { this.visible = false; this.autoAudioPlayed = false; this.captureActiveTime(); this.stopAudio(); this.stopFeedback() },
  onUnload() { this.disposed = true; this.visible = false; this.stopAudio(); this.stopFeedback(); if (this.audio) { this.audio.destroy(); this.audio = null }; if (this.feedbackAudio) { this.feedbackAudio.destroy(); this.feedbackAudio = null } },
  captureActiveTime() {
    if (this.activeStarted) this.activeMilliseconds = (this.activeMilliseconds || 0) + Math.max(0, Date.now() - this.activeStarted)
    this.activeStarted = 0
  },
  async loadSession() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try { const session = await callEnglish('startStudy', { level: this.data.level, mode: this.data.mode, ...(this.extraCount === undefined ? {} : { extraCount: this.extraCount }) }); if (!this.disposed) this.showSession(session) }
    catch (error) { if (!this.disposed) this.setData({ error: message(error) }) }
    finally { if (!this.disposed) this.setData({ loading: false }) }
  },
  showSession(session: any) {
    this.stopAudio(); this.stopFeedback()
    const audioVersion = this.audioVersion = (this.audioVersion || 0) + 1
    this.audioRendered = false; this.autoAudioPlayed = false
    const question = session.question && { ...session.question, options: session.question.options || session.question.choices || [] }
    this.activeMilliseconds = 0; this.activeStarted = Date.now(); this.answerRequest = null; this.nextSession = null
    this.setData({ session, question, loading: false, feedback: null, hint: '', hintLoading: false, spelling: '', chosen: '', coinsEarned: 0, intervalLabel: '', error: '', nextCompleted: false, completed: session.completed || 0, total: session.total || 0,
      progress: session.total ? Math.min(100, Math.round(session.completed * 100 / session.total)) : 0, cardState: 'enter' },
      () => {
        if (this.disposed || this.audioVersion !== audioVersion) return
        this.audioRendered = true
        wx.pageScrollTo({ scrollTop: 0, duration: 0 }); this.autoPlayAudio()
      })
  },
  inputSpelling(event: any) { this.setData({ spelling: event.detail.value }) },
  chooseAnswer(event: any) { this.answer(event.currentTarget.dataset.id) },
  submitSpelling() { const answer = this.data.spelling.trim(); if (answer) this.answer(answer) },
  async answer(answer: string) {
    if (this.data.busy || this.data.feedback || !this.data.question) return
    const questionId = this.data.question.id, sessionId = this.data.session.sessionId, audioVersion = this.audioVersion
    if (!this.answerRequest || this.answerRequest.answer !== answer) this.answerRequest = { answer, requestId: englishRequestId() }
    this.captureActiveTime()
    this.setData({ busy: true, error: '', chosen: answer })
    try {
      const result = await callEnglish('answerStudy', { sessionId, questionId, answer, requestId: this.answerRequest.requestId,
        activeSeconds: Math.floor((this.activeMilliseconds || 0) / 1000) })
      if (this.disposed) return
      this.nextSession = result.session
      const meaningText = (result.feedback.meanings || []).map((meaning: any) => typeof meaning === 'string' ? meaning :
        [meaning.partOfSpeech || meaning.pos || '', meaning.definitionZh || meaning.translation || (meaning.definitions || []).join('；')].filter(Boolean).join(' ')).join('\n')
      const examples = Array.isArray(result.feedback.examples) && result.feedback.examples.length ? result.feedback.examples :
        [{ exampleEn: result.feedback.exampleEn, exampleZh: result.feedback.exampleZh }]
      if (this.data.mode === 'spelling') this.audioRendered = false
      this.setData({ feedback: { ...result.feedback, meaningText, examples: examples.map((example: any, index: number) => ({ ...example, index })) }, coinsEarned: result.coinsEarned || 0, intervalLabel: result.intervalLabel || '', hintLoading: false, nextCompleted: result.session.status === 'completed', cardState: result.feedback.correct ? 'correct' : 'retry',
        completed: result.session.completed || 0, total: result.session.total || 0, progress: result.session.total ? Math.min(100, Math.round(result.session.completed * 100 / result.session.total)) : 0 }, () => {
        if (this.disposed || this.audioVersion !== audioVersion) return
        if (this.data.mode === 'spelling') this.audioRendered = true
        if (!this.playFeedback(result.feedback.correct) && this.data.mode === 'spelling') this.autoPlayAudio()
      })
    } catch (error) { if (!this.disposed) { this.activeStarted = Date.now(); this.setData({ error: message(error) }) } }
    finally { if (!this.disposed) this.setData({ busy: false }) }
  },
  continueStudy() {
    if (!this.data.feedback || !this.nextSession || this.data.busy) return
    const session = this.nextSession
    this.nextSession = null
    this.showSession(session)
  },
  async showHint() {
    if (this.data.hintLoading || this.data.busy || this.data.feedback || !this.data.question) return
    const questionId = this.data.question.id
    this.setData({ hintLoading: true, error: '' })
    try {
      const result = await callEnglish('studyHint', { sessionId: this.data.session.sessionId, questionId })
      if (!this.disposed && this.data.question && this.data.question.id === questionId && !this.data.feedback) this.setData({ hint: result.hint })
    } catch (error) { if (!this.disposed && this.data.question && this.data.question.id === questionId && !this.data.feedback) this.setData({ error: message(error) }) }
    finally { if (!this.disposed && this.data.question && this.data.question.id === questionId) this.setData({ hintLoading: false }) }
  },
  stopAudio() {
    this.audioPlayback = (this.audioPlayback || 0) + 1
    if (!this.audio) return
    if (this.audioError) { this.audio.offError(this.audioError); this.audioError = null }
    this.audio.stop()
  },
  stopFeedback() {
    this.feedbackPlayback = (this.feedbackPlayback || 0) + 1
    if (!this.feedbackAudio) return
    if (this.feedbackEnded) { this.feedbackAudio.offEnded(this.feedbackEnded); this.feedbackEnded = null }
    if (this.feedbackFailed) { this.feedbackAudio.offError(this.feedbackFailed); this.feedbackFailed = null }
    this.feedbackPlaying = false; this.feedbackAudio.stop()
  },
  playFeedback(correct: boolean) {
    if (!this.visible || this.disposed || !this.feedbackAudio) return false
    this.stopAudio(); this.stopFeedback()
    const playback = this.feedbackPlayback, version = this.audioVersion
    this.feedbackPlaying = true
    const finish = () => {
      if (this.disposed || !this.visible || this.feedbackPlayback !== playback || this.audioVersion !== version) return
      this.stopFeedback()
      if (this.data.mode === 'spelling') this.autoPlayAudio()
    }
    this.feedbackEnded = finish; this.feedbackFailed = finish
    this.feedbackAudio.onEnded(finish); this.feedbackAudio.onError(finish)
    this.feedbackAudio.src = '/packageEnglish/assets/audio/' + (correct ? 'correct.wav' : 'retry.wav')
    this.feedbackAudio.play()
    return true
  },
  autoPlayAudio() {
    if (!this.visible || this.disposed || !this.audioRendered || this.autoAudioPlayed || !this.data.question || this.data.mode === 'spelling' && !this.data.feedback) return
    this.autoAudioPlayed = true
    this.playAudio()
  },
  playAudio() {
    if (!this.visible || this.disposed || !this.audio || this.data.mode === 'spelling' && !this.data.feedback) return
    const question = this.data.feedback || this.data.question
    if (!question) return
    if (!question.audioUrl) { this.setData({ error: '当前词条暂未提供可播放的发音资源' }); return }
    this.stopFeedback(); this.stopAudio()
    const playback = this.audioPlayback
    this.audioError = () => { if (!this.disposed && this.visible && this.audioPlayback === playback) this.setData({ error: '发音播放失败，请检查网络后重试' }) }
    this.audio.onError(this.audioError)
    if (this.data.error === '发音播放失败，请检查网络后重试') this.setData({ error: '' })
    this.audio.src = englishResourceUrl(question.audioUrl); this.audio.play()
  },
  goHome() { wx.navigateBack() }
}))
