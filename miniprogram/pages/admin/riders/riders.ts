import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    activeStatus: 'pending',
    loading: false,
    list: [] as any[]
  },

  onLoad() {
    this.loadList()
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh())
  },

  switchStatus(e: any) {
    const status = e.currentTarget.dataset.status
    if (!status || status === this.data.activeStatus) return
    this.setData({ activeStatus: status, list: [] })
    this.loadList()
  },

  async loadList() {
    this.setData({ loading: true })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: {
          action: 'getRiderAuditList',
          data: { status: this.data.activeStatus }
        }
      }) as any
      if (res.result && res.result.code === 0) {
        this.setData({ list: (res.result.data && res.result.data.list) || [] })
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '加载失败', icon: 'none' })
      }
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  approve(e: any) {
    const rider = e.currentTarget.dataset.rider
    wx.showModal({
      title: '通过骑手申请',
      content: `确定通过「${rider.realName}」的骑手申请吗？`,
      success: (result) => {
        if (result.confirm) this.submitAudit(rider._id, 'approved', '')
      }
    })
  },

  reject(e: any) {
    const rider = e.currentTarget.dataset.rider
    wx.showModal({
      title: '拒绝骑手申请',
      editable: true,
      placeholderText: '请填写拒绝原因',
      success: (result: any) => {
        if (!result.confirm) return
        const reason = String(result.content || '').trim()
        if (!reason) {
          wx.showToast({ title: '请填写拒绝原因', icon: 'none' })
          return
        }
        this.submitAudit(rider._id, 'rejected', reason)
      }
    } as any)
  },

  async submitAudit(riderId: string, status: string, reason: string) {
    wx.showLoading({ title: '处理中...', mask: true })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: {
          action: 'auditRider',
          data: { riderId, status, reason }
        }
      }) as any
      wx.hideLoading()
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: status === 'approved' ? '已通过' : '已拒绝', icon: 'success' })
        this.loadList()
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '操作失败', icon: 'none' })
      }
    } catch (error) {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  }
}))
