import { api } from '../../../utils/api-client'
Page({
  data: {
    username: '',
    password: '',
    loading: false,
    autoLogging: true,
    showResetPassword: false,
    resetForm: {
      username: '',
      phone: '',
      newPassword: ''
    },
    resetting: false
  },

  onLoad() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageFood/pages/shop_login/shop_login')
      })
      return
    }
    this.tryAutoLogin()
  },

  async tryAutoLogin() {
    const shopId = wx.getStorageSync('food_shop_id')
    if (shopId) {
      wx.redirectTo({ url: '/packageFood/pages/shop_index/shop_index' })
      return
    }

    try {
      const res = await api.call({
        name: 'food_manager',
        data: { action: 'shopAutoLogin' }
      }) as any

      if (res.result.success) {
        wx.setStorageSync('food_shop_id', res.result.shopId)
        wx.setStorageSync('shop_info', res.result.shopInfo)
        wx.redirectTo({ url: '/packageFood/pages/shop_index/shop_index' })
        return
      }
    } catch (err) {
      console.error('自动登录失败', err)
    }

    this.setData({ autoLogging: false })
  },

  onUsernameInput(e: any) {
    this.setData({ username: e.detail.value })
  },

  onPasswordInput(e: any) {
    this.setData({ password: e.detail.value })
  },

  async login() {
    if (!this.data.username || !this.data.password) {
      wx.showToast({ title: '请输入账号密码', icon: 'none' })
      return
    }

    this.setData({ loading: true })

    try {
      const res = await api.call({
        name: 'food_manager',
        data: {
          action: 'shopLogin',
          data: {
            username: this.data.username,
            password: this.data.password
          }
        }
      }) as any

      if (res.result.success) {
        wx.setStorageSync('food_shop_id', res.result.shopId)
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => {
          wx.redirectTo({ url: '/packageFood/pages/shop_index/shop_index' })
        }, 500)
      } else {
        wx.showToast({ title: res.result.msg || '登录失败', icon: 'none' })
      }
    } catch (err) {
      wx.showToast({ title: '登录失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  goToRegister() {
    wx.navigateTo({ url: '/packageFood/pages/shop_register/shop_register' })
  },

  showResetPasswordPage() {
    this.setData({ showResetPassword: true })
  },

  hideResetPassword() {
    this.setData({ showResetPassword: false })
  },

  onResetUsernameInput(e: any) {
    this.setData({ 'resetForm.username': e.detail.value })
  },

  onResetPhoneInput(e: any) {
    this.setData({ 'resetForm.phone': e.detail.value })
  },

  onResetPasswordInput(e: any) {
    this.setData({ 'resetForm.newPassword': e.detail.value })
  },

  async resetPassword() {
    const { resetForm, resetting } = this.data
    
    if (resetting) return
    
    if (!resetForm.username) {
      wx.showToast({ title: '请输入账号', icon: 'none' })
      return
    }
    if (!resetForm.phone) {
      wx.showToast({ title: '请输入手机号', icon: 'none' })
      return
    }
    if (!resetForm.newPassword || resetForm.newPassword.length < 8) {
      wx.showToast({ title: '新密码至少8位', icon: 'none' })
      return
    }

    this.setData({ resetting: true })

    try {
      const res = await api.call({
        name: 'food_manager',
        data: {
          action: 'resetPassword',
          data: {
            username: resetForm.username,
            phone: resetForm.phone,
            newPassword: resetForm.newPassword
          }
        }
      }) as any

      this.setData({ resetting: false })

      if (res.result.success) {
        wx.showModal({
          title: '重置成功',
          content: '密码已重置，请使用新密码登录',
          showCancel: false,
          success: () => {
            this.setData({
              showResetPassword: false,
              username: resetForm.username,
              password: '',
              resetForm: { username: '', phone: '', newPassword: '' }
            })
          }
        })
      } else {
        wx.showToast({ title: res.result.msg || '重置失败', icon: 'none' })
      }
    } catch (err) {
      this.setData({ resetting: false })
      wx.showToast({ title: '重置失败', icon: 'none' })
    }
  }
})
