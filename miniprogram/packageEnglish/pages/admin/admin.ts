import { withSharing } from '../../../utils/page-share'
import { callEnglish } from '../../../utils/english-api'

const rewardFields = [
  { key: 'newReward', name: '完成新词任务', description: '当天的新词目标完成后发放', max: 100, unit: '金币' },
  { key: 'reviewReward', name: '完成复习任务', description: '当天的复习目标完成后发放', max: 100, unit: '金币' },
  { key: 'challengeReward', name: '完成每日挑战', description: '按服务器每日挑战完成规则发放', max: 100, unit: '金币' },
  { key: 'runningReward', name: '完成每日跑步目标', description: '当天累计有效GPS距离达到个人每日目标', max: 100, unit: '金币' },
  { key: 'commentReward', name: '每日首次评价或评论', description: '服务器认可的食堂评分或校园评论', max: 100, unit: '金币' },
  { key: 'photoReward', name: '每日首次晒图', description: '食堂评价或校园动态的有效上传图片', max: 100, unit: '金币' },
  { key: 'likeReward', name: '每次有效获赞', description: '他人给自己的评论点赞，同一人同一条不重复', max: 100, unit: '金币' },
  { key: 'likeDailyCap', name: '每日获赞奖励次数上限', description: '达到上限后，当天后续点赞不再发币', max: 20, unit: '次' }
]

Page(withSharing({
  data: {
    state: 'loading', error: '', saveError: '', saving: false, isSuperAdmin: false,
    overview: null as any, rewardFields, form: { newReward: '', reviewReward: '', challengeReward: '' } as any
  },
  _active: false,
  _version: 0,
  onLoad() {
    if (!wx.getStorageSync('isAdmin')) wx.reLaunch({ url: '/pages/admin/login/login' })
  },
  onShow() {
    if (!wx.getStorageSync('isAdmin')) return
    this._active = true
    this.loadOverview()
  },
  onHide() { this._active = false; this._version += 1 },
  onUnload() { this._active = false; this._version += 1 },
  onPullDownRefresh() { this.loadOverview().finally(() => wx.stopPullDownRefresh()) },
  applyOverview(overview: any) {
    const settings = overview.settings || {}
    this.setData({ overview, state: 'ready', error: '', isSuperAdmin: Boolean(overview.admin && overview.admin.role === 'super'),
      form: rewardFields.reduce((form: any, field) => { form[field.key] = String(settings[field.key]); return form }, {}) })
  },
  async loadOverview() {
    if (this.data.saving) return false
    const version = ++this._version
    this.setData({ state: 'loading', error: '', saveError: '', isSuperAdmin: false })
    try {
      const overview = await callEnglish('adminOverview')
      if (!this._active || version !== this._version) return false
      if (!overview || !overview.settings || !overview.counts || !overview.admin) throw new Error('英语管理配置返回不完整，请重新加载')
      this.applyOverview(overview)
      return true
    } catch (error) {
      if (this._active && version === this._version) this.setData({ state: 'error', error: error.message || '英语管理配置读取失败' })
      return false
    }
  },
  onRewardInput(event: any) {
    const key = event.currentTarget.dataset.key
    if (!this.data.isSuperAdmin || this.data.state !== 'ready' || this.data.saving || !rewardFields.some(field => field.key === key)) return
    this.setData({ ['form.' + key]: event.detail.value, saveError: '' })
  },
  async saveRewards() {
    if (!this.data.isSuperAdmin || this.data.state !== 'ready' || this.data.saving) return
    const settings: any = {}
    for (const field of rewardFields) {
      const draft = this.data.form[field.key].trim()
      const value = Number(draft)
      if (!/^\d+$/.test(draft) || !Number.isInteger(value) || value < 0 || value > field.max) {
        this.setData({ saveError: field.name + '必须为 0–' + field.max + ' 的整数' + field.unit })
        return
      }
      settings[field.key] = value
    }
    const version = ++this._version
    this.setData({ saving: true, saveError: '' })
    try {
      const overview = await callEnglish('saveGameSettings', { settings })
      if (!this._active || version !== this._version) return
      this.applyOverview(overview)
      wx.showToast({ title: '奖励配置已保存', icon: 'success' })
    } catch (error) {
      if (this._active && version === this._version) this.setData({ saveError: error.message || '保存失败，编辑内容已保留' })
    } finally {
      this.setData({ saving: false })
      if (this._active && version !== this._version) this.loadOverview()
    }
  }
}))
