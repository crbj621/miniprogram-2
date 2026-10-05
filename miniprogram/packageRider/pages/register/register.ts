import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    loading: false,
    existingRider: null as any,
    form: {
      realName: '',
      phone: '',
      studentId: ''
    }
  },

  onLoad() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageRider/pages/register/register')
      })
      return
    }
    this.checkProfile()
  },

  async checkProfile() {
    try {
      const res = await api.call({
        name: 'rider',
        data: { action: 'getProfile' }
      }) as any

      if (res.result && res.result.code === 0 && res.result.data && res.result.data.registered) {
        const rider = res.result.data.rider
        wx.setStorageSync('riderInfo', rider)
        if (rider.status === 'approved') {
          wx.redirectTo({ url: '/packageRider/pages/hall/hall' })
        } else {
          this.setData({
            existingRider: rider,
            form: rider.status === 'rejected' ? {
              realName: rider.realName || '',
              phone: rider.phone || '',
              studentId: rider.studentId || ''
            } : this.data.form
          })
        }
      }
    } catch (e) {}
  },

  onInput(e: any) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  async submit() {
    if (this.data.loading) return
    const { realName, phone, studentId } = this.data.form
    if (!realName || !phone || !studentId) {
      wx.showToast({ title: '请完整填写信息', icon: 'none' })
      return
    }

    this.setData({ loading: true })
    try {
      const res = await api.call({
        name: 'rider',
        data: { action: 'register', data: this.data.form }
      }) as any

      if (res.result && res.result.code === 0) {
        const rider = res.result.data.rider
        wx.setStorageSync('riderInfo', rider)
        this.setData({ existingRider: rider })
        wx.showModal({
          title: '资料已提交',
          content: '管理员审核通过后就可以进入接单大厅，审核结果可在这里查看。',
          showCancel: false
        })
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '注册失败', icon: 'none', duration: 2500 })
      }
    } catch (e) {
      console.error('骑手注册异常:', e)
      wx.showToast({ title: '注册失败，请检查云函数是否已部署', icon: 'none', duration: 2500 })
    } finally {
      this.setData({ loading: false })
    }
  }
}))
