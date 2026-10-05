import { withSharing } from '../../../utils/page-share'
import { callGifts, giftRequestId } from '../../../utils/gifts-api'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: { loading: false, error: '', sites: [] as any[], isSuper: false, keyword: '', users: [] as any[], searching: false, selectedUser: null as any, amount: '', reason: '', granting: false, grantResult: '', grantError: '' },
  grantRequestId: '',
  onShow() { this.load() },
  async load() {
    this.setData({ loading: true, error: '' })
    try { const result = await callGifts('adminList'); this.setData({ sites: result.sites, isSuper: result.admin.role === 'super' }) }
    catch (error: any) { this.setData({ error: error.message }) }
    finally { this.setData({ loading: false }) }
  },
  grantInput(event: any) {
    const key = event.currentTarget.dataset.field
    if (this.data.granting || !['keyword', 'amount', 'reason'].includes(key)) return
    this.setData({ [key]: event.detail.value, grantResult: '', grantError: '' }); this.grantRequestId = ''
  },
  async searchUsers() {
    if (this.data.searching || this.data.granting) return
    this.setData({ searching: true, grantError: '' })
    try {
      const response = await api.call({ name: 'globalAdmin', data: { action: 'getUsers', data: { keyword: this.data.keyword.trim(), pageSize: 20 } } }) as any
      if (!response.result || response.result.code !== 0) throw Error(response.result && response.result.message || '查找用户失败')
      this.setData({ users: response.result.data.list.map((row: any) => ({ ...row, shortId: row._id.slice(-6) })) })
    } catch (error: any) { this.setData({ grantError: error.message }) }
    finally { this.setData({ searching: false }) }
  },
  chooseUser(event: any) { if (!this.data.granting) { this.setData({ selectedUser: this.data.users.find(user => user._id === event.currentTarget.dataset.id), grantResult: '', grantError: '' }); this.grantRequestId = '' } },
  grant() {
    const amount = Number(this.data.amount), user = this.data.selectedUser
    if (!this.data.isSuper || this.data.granting) return
    if (!user || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) { this.setData({ grantError: '请选择接收同学，输入1至1000000的整数金币' }); return }
    wx.showModal({ title: '确认发放金币', content: '给' + (user.nickName || '这位同学') + '（尾号' + user.shortId + '）发放' + amount + '金币。说明：' + (this.data.reason.trim() || '管理员奖励'), success: result => { if (result.confirm) this.sendGrant() } })
  },
  async sendGrant() {
    if (this.data.granting) return
    if (!this.grantRequestId) this.grantRequestId = giftRequestId()
    this.setData({ granting: true, grantError: '' })
    try {
      const result = await callGifts('grantCoins', { userId: this.data.selectedUser._id, amount: Number(this.data.amount), reason: this.data.reason.trim(), requestId: this.grantRequestId })
      this.setData({ grantResult: '已给' + result.name + '发放' + result.amount + '金币，当前余额' + result.coins + '。', amount: '', reason: '' }); this.grantRequestId = ''
    } catch (error: any) { this.setData({ grantError: error.message }) }
    finally { this.setData({ granting: false }) }
  },
  hide(event: any) {
    wx.showModal({ title: '下架这份祝福？', content: '下架后公开链接失效，用户不能重新发布。', success: async result => {
      if (!result.confirm) return
      try { await callGifts('adminHide', { id: event.currentTarget.dataset.id }); this.load() } catch (error: any) { this.setData({ error: error.message }) }
    } })
  },
  copy(event: any) { wx.setClipboardData({ data: event.currentTarget.dataset.url }) }
}))
