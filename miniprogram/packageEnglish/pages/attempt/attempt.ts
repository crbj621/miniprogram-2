import { withSharing } from '../../../utils/page-share'
import { callEnglish, englishRequestId, englishResourceUrl } from '../../../utils/english-api'
import { message, clockText } from '../../utils/format'
import { getSavedCampusTheme } from '../../../utils/campus-theme'
import { questionView, feedbackView, reviewView } from '../../utils/exam-view'

Page(withSharing({
  data: { theme: getSavedCampusTheme('english'), level: 'CET4', mode: 'practice', paperId: '', attemptId: '', questionIds: [] as string[], loading: false, busy: false, draftSaving: false, error: '',
    attempt: null as any, question: null as any, answer: '', feedback: null as any, hint: '', hintLoading: false,
    savedNote: '', result: null as any, review: [] as any[], navigation: [] as any[], navigationGroups: [] as any[], questionIndex: 0, remainingText: '', expired: false, selfAssessment: '', materialExpanded: true, navigationExpanded: false },
  onLoad(options: any) {
    let questionIds: string[] = []
    try { if (options.questionIds) questionIds = JSON.parse(decodeURIComponent(options.questionIds)) } catch (_) { this.setData({ error: '错题列表无效，请返回题库重新选择' }); return }
    this.setData({ level: options.level === 'CET6' ? 'CET6' : 'CET4', mode: options.mode === 'exam' ? 'exam' : 'practice', paperId: options.paperId || '', attemptId: options.attemptId || '', questionIds })
    this.audio = wx.createInnerAudioContext()
    this.audio.onError(() => this.setData({ error: '题目音频播放失败，请检查网络后重试' }))
    this.loadAttempt()
  },
  onShow() { this.setData({ theme: getSavedCampusTheme('english') }); if (this.data.attempt) this.startTimer() },
  onHide() { this.stopTimer(); this.keepLocalDraft(); if (this.audio) this.audio.stop() },
  onUnload() { this.disposed = true; this.stopTimer(); this.keepLocalDraft(); if (this.audio) this.audio.destroy() },
  async loadAttempt() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const attempt = this.data.attemptId ? await callEnglish('examDetail', { attemptId: this.data.attemptId }) : await callEnglish('startExam', { paperId: this.data.paperId, level: this.data.level, mode: this.data.mode, ...(this.data.questionIds.length ? { questionIds: this.data.questionIds } : {}) })
      if (this.disposed) return
      this.setData({ mode: attempt.mode || this.data.mode, level: attempt.paper && attempt.paper.level || this.data.level })
      if (!this.disposed) { this.showAttempt(attempt); this.startTimer() }
    } catch (error) { if (!this.disposed) this.setData({ error: message(error) }) }
    finally { if (!this.disposed) this.setData({ loading: false }) }
  },
  draftKey() {
    return this.data.attempt && this.data.question ? this.questionDraftKey(this.data.question.id) : ''
  },
  questionDraftKey(id: string) { return 'english_exam_draft_' + wx.getStorageSync('openid') + '_' + this.data.attempt.attemptId + '_' + id },
  keepLocalDraft() {
    const key = this.draftKey()
    if (key && !this.data.feedback && !this.data.result) wx.setStorageSync(key, { answer: this.data.answer })
  },
  showAttempt(attempt: any) {
    if (attempt.status === 'submitted') { this.setData({ attempt }); this.showResult(attempt); return }
    const navigation = (attempt.questions || []).map((question: any, index: number) => ({ id: question.id, index, number: question.number || index + 1, section: questionView(question, index).section || '题目',
      checked: (attempt.answers || []).some((answer: any) => answer.questionId === question.id && answer.checked) }))
    const navigationGroups: any[] = []
    for (const question of navigation) {
      let group = navigationGroups.find(item => item.section === question.section)
      if (!group) { group = { section: question.section, questions: [] }; navigationGroups.push(group) }
      group.questions.push(question)
    }
    this.setData({ attempt, navigation, navigationGroups, savedNote: '', error: '' })
    this.showQuestion(attempt.question)
  },
  showQuestion(source: any) {
    const previousId = this.data.question ? this.data.question.id : null
    if (this.audio && (!source || !this.data.question || source.audioUrl !== this.data.question.audioUrl)) this.audio.stop()
    const index = source ? (this.data.attempt.questions || []).findIndex((item: any) => item.id === source.id) : 0
    const question = source && questionView(source, index)
    const attempt = this.data.attempt
    const saved = question && (attempt.answers || []).find((item: any) => item.questionId === question.id)
    const draft = question && attempt.drafts && attempt.drafts[question.id]
    this.answerRequest = null
    const material = question && question.passage || ''
    if (!this.materialState) this.materialState = {}
    let answer = saved && saved.checked ? String(saved.answer || '') : String(draft || saved && saved.answer || '')
    const key = question && this.questionDraftKey(question.id)
    if (key && !(this.data.mode === 'practice' && saved && saved.checked)) { const local = wx.getStorageSync(key); if (local && typeof local.answer === 'string') answer = local.answer; else if (typeof local === 'string' && local) answer = local }
    this.setData({ question, questionIndex: index,
      materialExpanded: this.materialState[material] !== false,
      feedback: this.data.mode === 'practice' && saved && saved.checked ? feedbackView(saved.feedback, question) : null,
      answer, navigationExpanded: false,
      hint: '', hintLoading: false, selfAssessment: saved && saved.selfAssessment || '', error: '' }, () => {
      if ((question ? question.id : null) !== previousId) wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    })
  },
  chooseQuestion(event: any) {
    if (this.data.busy || this.data.draftSaving) return
    this.keepLocalDraft()
    const question = (this.data.attempt.questions || []).find((item: any) => item.id === event.currentTarget.dataset.id)
    if (question) { this.setData({ savedNote: '' }); this.showQuestion(question) }
  },
  previewMaterial(event: any) { const url = event.currentTarget.dataset.url; if (url) wx.previewImage({ current: url, urls: [url] }) },
  inputAnswer(event: any) { this.setData({ answer: event.detail.value, savedNote: '' }); this.keepLocalDraft() },
  chooseAnswer(event: any) { if (!this.data.busy && !this.data.feedback) { this.setData({ answer: event.currentTarget.dataset.id, savedNote: '' }); this.keepLocalDraft() } },
  async saveDraft() {
    if (!this.data.question || this.data.draftSaving || this.data.busy || this.data.feedback) return
    const answer = this.data.answer, questionId = this.data.question.id
    this.keepLocalDraft(); this.setData({ draftSaving: true, error: '' })
    try {
      const response = await callEnglish('saveExamDraft', { attemptId: this.data.attempt.attemptId, questionId, answer })
      if (this.disposed) return
      if (response.attempt.status === 'submitted') { this.showResult(await callEnglish('finishExam', { attemptId: this.data.attempt.attemptId })); return }
      this.setData({ attempt: response.attempt })
      if (this.data.question && this.data.question.id === questionId && this.data.answer === answer) { wx.removeStorageSync(this.questionDraftKey(questionId)); this.setData({ savedNote: '草稿已保存到服务器，可以稍后继续。' }) }
    } catch (error) { if (!this.disposed) this.setData({ error: message(error) }) }
    finally { if (!this.disposed) this.setData({ draftSaving: false }) }
  },
  async submitAnswer() {
    if (!this.data.question || this.data.busy || this.data.draftSaving || this.data.feedback || !this.data.answer.trim()) return
    const answer = this.data.answer, questionId = this.data.question.id
    if (!this.answerRequest || this.answerRequest.answer !== answer) this.answerRequest = { answer, requestId: englishRequestId() }
    this.setData({ busy: true, error: '' })
    try {
      const response = await callEnglish('answerExam', { attemptId: this.data.attempt.attemptId, questionId, answer, requestId: this.answerRequest.requestId })
      if (this.disposed) return
      const key = this.draftKey(); if (key) wx.removeStorageSync(key)
      this.nextAttempt = response.attempt
      if (response.attempt.status === 'submitted') this.showResult(await callEnglish('finishExam', { attemptId: this.data.attempt.attemptId }))
      else if (this.data.mode === 'practice' && response.feedback) this.setData({ feedback: feedbackView(response.feedback, this.data.question), savedNote: '', attempt: response.attempt })
      else { this.showAttempt(response.attempt); this.setData({ savedNote: '答案已保存，交卷后查看解析。' }) }
    } catch (error) { if (!this.disposed) this.setData({ error: message(error) }) }
    finally { if (!this.disposed) this.setData({ busy: false }) }
  },
  continueAttempt() { const next = this.nextAttempt || this.data.attempt; if (next && !this.data.busy) { this.showAttempt(next); this.nextAttempt = null } },
  async showHint() {
    if (!this.data.question || this.data.hintLoading || this.data.busy || this.data.feedback) return
    const questionId = this.data.question.id
    this.setData({ hintLoading: true, error: '' })
    try {
      const response = await callEnglish('examHint', { attemptId: this.data.attempt.attemptId, questionId })
      if (!this.disposed && this.data.question && this.data.question.id === questionId && !this.data.feedback) this.setData({ hint: response.hint })
    } catch (error) { if (!this.disposed && this.data.question && this.data.question.id === questionId && !this.data.feedback) this.setData({ error: message(error) }) }
    finally { if (!this.disposed && this.data.question && this.data.question.id === questionId) this.setData({ hintLoading: false }) }
  },
  async finishAttempt() {
    if (!this.data.attempt || this.data.busy || this.data.draftSaving) return
    this.keepLocalDraft()
    this.setData({ busy: true, error: '', savedNote: '正在保存所有本机草稿并交卷…' })
    try {
      for (const question of this.data.attempt.questions || []) {
        const key = this.questionDraftKey(question.id), local = wx.getStorageSync(key)
        const answer = local && typeof local.answer === 'string' ? local.answer : typeof local === 'string' && local ? local : null
        if (answer === null) continue
        const saved = (this.data.attempt.answers || []).find((item: any) => item.questionId === question.id)
        if (saved && saved.checked && this.data.mode === 'practice') { wx.removeStorageSync(key); continue }
        if (saved && String(saved.answer || '') === answer) { wx.removeStorageSync(key); continue }
        const response = await callEnglish('saveExamDraft', { attemptId: this.data.attempt.attemptId, questionId: question.id, answer })
        if (this.disposed) return
        this.setData({ attempt: response.attempt })
        if (response.attempt.status === 'submitted') break
        wx.removeStorageSync(key)
      }
      const result = await callEnglish('finishExam', { attemptId: this.data.attempt.attemptId })
      if (this.disposed) return
      this.stopTimer()
      this.showResult(result)
    } catch (error) { if (!this.disposed) this.setData({ error: message(error), savedNote: '' }) }
    finally { if (!this.disposed) this.setData({ busy: false }) }
  },
  showResult(result: any) {
    const firstResult = !this.data.result
    const review = reviewView(result.review || (result.questions || []).map((question: any) => ({ question, ...(result.answers || []).find((item: any) => item.questionId === question.id) })))
    for (const question of this.data.attempt.questions || []) wx.removeStorageSync(this.questionDraftKey(question.id))
    this.setData({ result, review, question: null, feedback: null, savedNote: '' }, () => {
      if (firstResult) wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    })
  },
  toggleMaterial() { const expanded = !this.data.materialExpanded; this.materialState[this.data.question.passage] = expanded; this.setData({ materialExpanded: expanded }) },
  toggleNavigation() { this.setData({ navigationExpanded: !this.data.navigationExpanded }) },
  toggleReviewMaterial(event: any) { const index = Number(event.currentTarget.dataset.index); this.setData({ review: this.data.review.map((item: any, i: number) => i === index ? { ...item, materialExpanded: !item.materialExpanded } : item) }) },
  async markSelf(event: any) {
    if (this.data.busy || !this.data.attempt) return
    const selfAssessment = event.currentTarget.dataset.value
    const questionId = event.currentTarget.dataset.id || this.data.question && this.data.question.id
    if (!questionId) return
    this.setData({ busy: true, error: '' })
    try {
      const response = await callEnglish('answerExam', { attemptId: this.data.attempt.attemptId, questionId, selfAssessment, requestId: englishRequestId() })
      if (this.disposed) return
      if (this.data.result) this.showResult(await callEnglish('finishExam', { attemptId: this.data.attempt.attemptId }))
      else { this.nextAttempt = response.attempt; this.setData({ selfAssessment, feedback: feedbackView(response.feedback, this.data.question) || this.data.feedback, attempt: response.attempt }) }
    } catch (error) { if (!this.disposed) this.setData({ error: message(error) }) }
    finally { if (!this.disposed) this.setData({ busy: false }) }
  },
  startTimer() {
    this.stopTimer()
    if (this.data.mode !== 'exam' || !this.data.attempt || !this.data.attempt.deadlineAt || this.data.result) return
    const deadline = new Date(this.data.attempt.deadlineAt).getTime()
    const tick = () => { if (this.disposed) return; const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); this.setData({ remainingText: clockText(left), expired: left === 0 }); if (!left) this.stopTimer() }
    tick(); if (!this.data.expired) this.timer = setInterval(tick, 1000)
  },
  stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null },
  playAudio(event: any) { const url = event && event.currentTarget.dataset.url || this.data.question && this.data.question.audioUrl; if (url && this.audio) { this.audio.stop(); this.audio.src = englishResourceUrl(url); this.audio.play() } },
  goHome() { wx.navigateBack() }
}))
