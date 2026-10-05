import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    username: '',
    password: '',
    loading: false,
    error: ''
  },

  onUsernameInput(e) {
    this.setData({ username: e.detail.value })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  async onLogin() {
    if (this.data.loading) return
    var username = this.data.username.trim()
    var password = this.data.password
    
    if (!username) {
      wx.showToast({ title: '请输入账号', icon: 'none' })
      return
    }
    
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }

    this.setData({ loading: true, error: '' })

    try {
      // 统一走 globalAdmin：避免动态/跑步等多个后台各自维护账号体系
      var res = await api.call({
        name: 'globalAdmin',
        data: {
          action: 'login',
          data: {
            account: username,
            password: password
          }
        }
      }) as any

      if (res.result && res.result.code === 0) {
        wx.setStorageSync('isAdmin', true)
        wx.setStorageSync('adminInfo', res.result.data && res.result.data.admin ? res.result.data.admin : {})
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(function() {
          wx.redirectTo({
            url: '/pages/admin/index/index'
          })
        }, 1000)
      } else {
        this.setData({ loading: false })
        var msg = '登录失败'
        if (res.result && res.result.message) {
          msg = res.result.message
        }
        this.setData({ error: msg })
      }
    } catch (err) {
      this.setData({ loading: false, error: err.message || err.errMsg || '网络连接失败，请稍后重试' })
    }
  }
}))
