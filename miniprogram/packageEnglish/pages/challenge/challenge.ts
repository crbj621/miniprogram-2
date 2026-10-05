import { withSharing } from '../../../utils/page-share'
import { callEnglish, englishRequestId } from '../../../utils/english-api'
import { clockText, message, timeText } from '../../utils/format'
import { getSavedCampusTheme } from '../../../utils/campus-theme'
import { reviewView } from '../../utils/exam-view'

Page(withSharing({
  data: { theme: getSavedCampusTheme('english'), level: 'CET4', loading: false, busy: false, error: '', challenge: null as any, question: null as any,
    remainingText: '', urgent: false, expired: false, result: null as any, chosen: '', attemptId: '', review: [] as any[] },
  onLoad(options: any) { this.setData({ level: options.level === 'CET6' ? 'CET6' : 'CET4', attemptId: options.attemptId || '' }); if (options.attemptId) this.beginChallenge() },
  onShow() { this.visible = true; this.setData({ theme: getSavedCampusTheme('english') }); if (this.data.challenge && !this.data.result) this.beginChallenge() },
  onHide() { this.visible = false; this.stopTimer() },
  onUnload() { this.visible = false; this.disposed = true; this.stopTimer() },
  async beginChallenge() {
    if (this.data.loading || this.data.busy || this.data.result) return
    this.setData({ loading: true, error: '' })
    try {
      const challenge = this.data.attemptId ? await callEnglish('challengeDetail', { attemptId: this.data.attemptId }) : await callEnglish('startChallenge', { level: this.data.level })
      if (this.disposed) return
      this.setData({ level: challenge.level || this.data.level })
      if (challenge.status !== 'active') {
        this.setData({ challenge })
        if (this.data.attemptId) this.showResult(challenge)
        else await this.finishChallenge()
        return
      }
      this.showChallenge(challenge)
      if (!challenge.question || challenge.status === 'finished' || challenge.status === 'completed') await this.finishChallenge()
    } catch (error) { if (!this.disposed) this.setData({ error: message(error) }) }
    finally { if (!this.disposed) this.setData({ loading: false }) }
  },
  showChallenge(challenge: any) {
    this.answerRequest = null
    this.setData({ challenge, question: challenge.question, chosen: '', error: '' })
    const deadline = Date.parse(challenge.deadlineAt)
    this.deadline = Number.isFinite(deadline) ? deadline : Date.now() + Math.max(0, Number(challenge.remainingSeconds || 0)) * 1000
    if (this.visible !== false) this.startTimer()
  },
  startTimer() {
    this.stopTimer()
    const tick = () => {
      if (this.disposed || this.visible === false || this.data.result) return
      const remaining = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000))
      this.setData({ remainingText: clockText(remaining), urgent: remaining <= 30, expired: remaining === 0 })
      if (!remaining) { this.stopTimer(); if (!this.data.busy && !this.finishing) this.finishChallenge() }
    }
    tick(); if (!this.data.expired && !this.data.result) this.timer = setInterval(tick, 1000)
  },
  stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null },
  async chooseAnswer(event: any) {
    if (this.data.busy || this.data.loading || this.data.expired || !this.data.question || this.data.result) return
    const answer = event.currentTarget.dataset.id, questionId = this.data.question.id
    if (!this.answerRequest || this.answerRequest.answer !== answer) this.answerRequest = { answer, requestId: englishRequestId() }
    this.setData({ busy: true, chosen: answer, error: '' })
    try {
      const challenge = await callEnglish('answerChallenge', { attemptId: this.data.challenge.attemptId, questionId, answer, requestId: this.answerRequest.requestId })
      if (this.disposed) return
      this.showChallenge(challenge)
    } catch (error) { if (!this.disposed) this.setData({ error: message(error) }) }
    finally {
      if (!this.disposed) {
        this.setData({ busy: false })
        if (this.data.expired || (this.data.challenge && !this.data.question)) this.finishChallenge()
        else if (this.visible !== false && !this.data.result) this.startTimer()
      }
    }
  },
  async finishChallenge() {
    if (!this.data.challenge || this.data.busy || this.finishing || this.data.result) return
    this.finishing = true; this.setData({ busy: true, error: '' }); this.stopTimer()
    try {
      const result = await callEnglish('finishChallenge', { attemptId: this.data.challenge.attemptId })
      if (!this.disposed) this.showResult(result)
    } catch (error) { if (!this.disposed) this.setData({ error: message(error) }) }
    finally { this.finishing = false; if (!this.disposed) this.setData({ busy: false }) }
  },
  showResult(result: any) { this.stopTimer(); this.setData({ result: { ...result, answersAvailableText: timeText(result.answersAvailableAt), myRank: result.myRank || (result.rank && typeof result.rank === 'object' ? result.rank.myRank : result.rank) || null }, question: null, review: reviewView(result.review || []) }) },
  switchLevel(event: any) {
    const level = event.currentTarget.dataset.level
    if (level === this.data.level || this.data.challenge || this.data.loading || this.data.busy) return
    this.setData({ level, error: '' })
  },
  openRank() { wx.redirectTo({ url: '/packageEnglish/pages/rank/rank?level=' + this.data.level + '&type=challenge' }) },
  goHome() { wx.redirectTo({ url: '/packageEnglish/pages/index/index?level=' + this.data.level }) }
}))
