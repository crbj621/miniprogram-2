import { withSharing } from '../../../utils/page-share'
import { callEnglish, openEnglishDocument } from '../../../utils/english-api'
import { message, timeText } from '../../utils/format'
import { getSavedCampusTheme } from '../../../utils/campus-theme'

Page(withSharing({
  data: { theme: getSavedCampusTheme('english'), level: 'CET4', loading: false, error: '', papers: [] as any[], visiblePapers: [] as any[],
    years: [] as string[], yearIndex: 0, kind: 'full', view: 'papers', historyType: 'exam', history: [] as any[], wrong: [] as any[], openingId: '', coverageText: '' },
  onLoad(options: any) {
    const years = ['全部年份']
    for (let year = new Date().getFullYear(); year >= 2019; year -= 1) years.push(String(year))
    this.setData({ level: options.level === 'CET6' ? 'CET6' : 'CET4', years, view: options.view === 'history' || options.view === 'wrong' ? options.view : 'papers' })
    this.loadPapers()
  },
  onPullDownRefresh() { this.loadPapers().finally(() => wx.stopPullDownRefresh()) },
  onShow() { this.setData({ theme: getSavedCampusTheme('english') }); if (this.loaded && !this.data.loading) this.loadPapers() },
  onUnload() { this.paperRequest = (this.paperRequest || 0) + 1 },
  async loadPapers() {
    const request = this.paperRequest = (this.paperRequest || 0) + 1
    this.setData({ loading: true, error: '' })
    try {
      if (this.data.view !== 'papers') {
        const result = await callEnglish(this.data.view === 'wrong' ? 'wrongQuestions' : this.data.historyType === 'challenge' ? 'challengeHistory' : 'examHistory', { level: this.data.level })
        if (request !== this.paperRequest) return
        this.setData(this.data.view === 'wrong' ? { wrong: (result.items || []).map((item: any) => ({ ...item, id: item.question.id })) } : { history: (result.items || []).map((item: any) => ({ ...item, dateText: timeText(item.submittedAt || item.startedAt) || item.date, active: item.status === 'active' })) })
        this.loaded = true; return
      }
      const result = await callEnglish('papers', { level: this.data.level })
      if (request !== this.paperRequest) return
      const papers = (result.papers || []).map((paper: any) => ({ ...paper, resources: (paper.resources || []).filter((resource: any) => resource.type !== 'audio'),
        isFullPaper: Boolean(paper.available && paper.authenticity === 'past_exam' && paper.coverage && paper.coverage.fullNonListening),
        durationMinutes: Math.ceil(Number(paper.durationSeconds || 0) / 60),
        coverageText: paper.coverage && (paper.coverage.note || paper.coverage.label) || '',
        badgeText: paper.available && paper.authenticity === 'past_exam' && paper.coverage && paper.coverage.fullNonListening ? '真题整卷 · 不含听力' : paper.authenticity === 'original_mock' ? '原创练习 · 非真题整卷' : paper.available ? '真题节选 · 非整卷' : '历年资料 · 非在线整卷' }))
      this.setData({ papers, coverageText: result.coverage && result.coverage.text || '' }); this.filterPapers()
      this.loaded = true
    } catch (error) { if (request === this.paperRequest) this.setData({ error: message(error) }) }
    finally { if (request === this.paperRequest) this.setData({ loading: false }) }
  },
  switchLevel(event: any) {
    const level = event.currentTarget.dataset.level
    if (level === this.data.level) return
    this.setData({ level, papers: [], visiblePapers: [], history: [], wrong: [], coverageText: '' }); this.loadPapers()
  },
  selectYear(event: any) { this.setData({ yearIndex: Number(event.detail.value) }); this.filterPapers() },
  selectView(event: any) { this.setData({ view: event.currentTarget.dataset.view, history: [], wrong: [] }); this.loadPapers() },
  selectHistoryType(event: any) { this.setData({ historyType: event.currentTarget.dataset.type, history: [] }); this.loadPapers() },
  selectKind(event: any) { this.setData({ kind: event.currentTarget.dataset.kind }); this.filterPapers() },
  filterPapers() {
    const year = this.data.yearIndex ? Number(this.data.years[this.data.yearIndex]) : null
    const visiblePapers = this.data.papers.filter((paper: any) => (!year || Number(paper.year) === year) &&
      (this.data.kind === 'full' ? paper.isFullPaper : !paper.isFullPaper && paper.authenticity !== 'original_mock')).sort((a: any, b: any) => Number(b.year) - Number(a.year) || Number(b.month) - Number(a.month) || Number(a.set) - Number(b.set))
    this.setData({ visiblePapers })
  },
  openAttempt(event: any) {
    const { id, mode } = event.currentTarget.dataset
    const paper = this.data.papers.find((item: any) => item.id === id)
    if (!paper || !paper.isFullPaper) { this.setData({ error: '该内容不是可作答的真题整卷，请查看资料范围与来源' }); return }
    wx.navigateTo({ url: '/packageEnglish/pages/attempt/attempt?paperId=' + encodeURIComponent(id) + '&mode=' + mode + '&level=' + this.data.level })
  },
  openHistory(event: any) {
    const page = this.data.historyType === 'challenge' ? 'challenge' : 'attempt'
    wx.navigateTo({ url: '/packageEnglish/pages/' + page + '/' + page + '?level=' + this.data.level + '&attemptId=' + encodeURIComponent(event.currentTarget.dataset.id) })
  },
  practiceWrong(event: any) {
    const id = event.currentTarget.dataset.id
    const questionIds = id ? [id] : this.data.wrong.slice(0, 20).map((item: any) => item.question.id)
    if (!questionIds.length) return
    wx.navigateTo({ url: '/packageEnglish/pages/attempt/attempt?level=' + this.data.level + '&mode=practice&questionIds=' + encodeURIComponent(JSON.stringify(questionIds)) })
  },
  async openResource(event: any) {
    if (this.data.openingId) return
    const { paperId, resourceId } = event.currentTarget.dataset
    const paper = this.data.papers.find((item: any) => item.id === paperId)
    const resource = paper && paper.resources.find((item: any) => item.id === resourceId)
    if (!resource) return
    if (!resource.downloadUrl) { wx.setClipboardData({ data: resource.url }); return }
    this.setData({ openingId: resourceId, error: '' })
    try { await openEnglishDocument(resource.downloadUrl) }
    catch (error) { this.setData({ error: message(error) }) }
    finally { this.setData({ openingId: '' }) }
  },
  copySource(event: any) { const url = event.currentTarget.dataset.url; if (url) wx.setClipboardData({ data: url }) }
}))
