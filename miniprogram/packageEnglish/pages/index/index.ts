import { withSharing } from '../../../utils/page-share'
import { withPageCopy } from '../../../utils/page-copy'
import { callEnglish } from '../../../utils/english-api'
import { message, timeText } from '../../utils/format'
import { getSavedCampusTheme } from '../../../utils/campus-theme'

Page(withSharing(withPageCopy('english', {
  data: { theme: getSavedCampusTheme('english'), level: 'CET4', loading: false, saving: false, error: '', home: null as any,
    newGoal: '10', reviewGoal: '0', extraCount: '10', progress: 0, checkedAt: '', saveNote: '', checkins: [] as any[], showCheckins: false, planOpen: false, myOpen: false, estimate: null as number | null },
  onLoad(options: any) { if (options.level === 'CET6') this.setData({ level: 'CET6' }) },
  onShow() { this.setData({ theme: getSavedCampusTheme('english') }); this.loadHome() },
  onPullDownRefresh() { this.loadHome().finally(() => wx.stopPullDownRefresh()) },
  async loadHome() {
    const request = this.homeRequest = (this.homeRequest || 0) + 1
    this.setData({ loading: true, error: '' })
    try {
      const home = await callEnglish('home', { level: this.data.level })
      if (request !== this.homeRequest) return
      this.applyHome(home)
    } catch (error) { if (request === this.homeRequest) this.setData({ error: message(error) }) }
    finally { if (request === this.homeRequest) this.setData({ loading: false }) }
  },
  applyHome(home: any) {
    const target = Number(home.plan.newGoal) + Number(home.plan.reviewGoal)
    const draft = home.plan.pending && home.plan.pending.level === home.level ? home.plan.pending : home.plan
    this.setData({ home, level: home.level, newGoal: String(draft.newGoal), reviewGoal: String(draft.reviewGoal),
      progress: target ? Math.min(100, Math.round((Math.min(home.today.newCount, home.plan.newGoal) + Math.min(home.today.reviewCount, home.plan.reviewGoal)) * 100 / target)) : 0,
      checkedAt: timeText(home.today.checkedAt), planOpen: Boolean(home.plan.needsUpdate || this.data.planOpen), estimate: Number(draft.newGoal) > 0 ? Math.ceil(Number(home.stats && home.stats.newRemaining || 0) / Number(draft.newGoal)) : null,
      checkins: (home.checkins || []).map((item: any) => ({ ...item, checkedAtText: timeText(item.checkedAt), minutes: Math.floor(Number(item.studySeconds || 0) / 60) })) })
  },
  switchLevel(event: any) {
    const level = event.currentTarget.dataset.level
    if (level === this.data.level || this.data.saving) return
    this.setData({ level, home: null, saveNote: '', planOpen: false })
    this.loadHome()
  },
  inputGoal(event: any) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, saveNote: '' })
    const goal = Number(this.data.newGoal)
    this.setData({ estimate: goal > 0 && this.data.home ? Math.ceil(Number(this.data.home.stats.newRemaining || 0) / goal) : null })
  },
  toggleCheckins() { this.setData({ showCheckins: !this.data.showCheckins }) },
  togglePlan() { this.setData({ planOpen: !this.data.planOpen }) },
  toggleMy() { this.setData({ myOpen: !this.data.myOpen }) },
  inputExtraCount(event: any) { this.setData({ extraCount: event.detail.value, error: '' }) },
  async savePlan() {
    if (this.data.saving || !this.data.home) return
    const newGoal = Number(this.data.newGoal), reviewGoal = Number(this.data.reviewGoal)
    if (!/^\d+$/.test(this.data.newGoal) || !/^\d+$/.test(this.data.reviewGoal) || newGoal < 0 || reviewGoal < 0 || (!newGoal && !reviewGoal)) {
      this.setData({ error: '学习目标请填写非负整数，新词与复习不能同时为零' }); return
    }
    this.setData({ saving: true, error: '' })
    try {
      const home = await callEnglish('savePlan', { level: this.data.level, newGoal, reviewGoal })
      this.applyHome(home)
      const levelName = this.data.level === 'CET6' ? '六级' : '四级'
      this.setData({ saveNote: levelName + '计划已保存' + (home.appliesOn ? '，生效日期：' + home.appliesOn : '') })
    } catch (error) { this.setData({ error: message(error) }) }
    finally { this.setData({ saving: false }) }
  },
  openStudy(event: any) {
    const mode = event.currentTarget.dataset.mode
    const available = this.data.home && this.data.home.extraStudy
    const resume = available && Array.isArray(available.activeModes) && available.activeModes.includes(mode)
    if (!resume && mode !== 'spelling' && this.data.home && this.data.home.plan.needsUpdate) { this.setData({ error: '剩余词量不足，请调整今天目标后再开始学习' }); return }
    let extra = ''
    if (!resume && mode !== 'spelling' && available && available.enabled) {
      const count = Number(this.data.extraCount), remaining = mode === 'new' ? available.newAvailable : available.reviewAvailable
      if (!/^\d+$/.test(this.data.extraCount) || !Number.isSafeInteger(count) || count < 1 || count > available.maxCount) { this.setData({ error: '本次加练请填写1至100个单词' }); return }
      if (count > remaining) { this.setData({ error: remaining ? '当前剩余' + remaining + '个可' + (mode === 'new' ? '学新词' : '复习旧词') + '，请减少加练数量' : mode === 'new' ? '这一等级的新词已学完啦' : '今天的旧词已经全部复习过啦' }); return }
      extra = '&extraCount=' + count
    }
    wx.navigateTo({ url: '/packageEnglish/pages/study/study?level=' + this.data.level + '&mode=' + mode + extra })
  },
  openPage(event: any) {
    const page = event.currentTarget.dataset.page
    const view = page === 'history' || page === 'wrong' ? '&view=' + page : ''
    const target = view ? 'papers' : page
    if (page === 'wardrobe' || page === 'tasks') wx.navigateTo({ url: '/packageProfile/pages/' + page + '/' + page })
    else wx.redirectTo({ url: '/packageEnglish/pages/' + target + '/' + target + '?level=' + this.data.level + view })
  }
})))
