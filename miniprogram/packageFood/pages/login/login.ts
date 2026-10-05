import { withSharing } from '../../../utils/page-share'
import { withPageCopy } from '../../../utils/page-copy'
Page(withSharing(withPageCopy('foodLogin', {
  data: {
    isLoading: false,
    userInfo: {
      avatarUrl: '',
      nickName: ''
    }
  },

  onLoad() {
    this.checkLogin()
  },

  checkLogin() {
    const app = getApp()
    
    if (app.isLoggedIn()) {
      wx.redirectTo({
        url: '/packageFood/pages/index/index'
      })
    }
    
    const userInfo = app.getUserInfo()
    if (userInfo) {
      this.setData({ userInfo })
    }
  },

  onChooseAvatar(e: any) {
    const { avatarUrl } = e.detail
    this.setData({
      'userInfo.avatarUrl': avatarUrl
    })
  },

  onNicknameInput(e: any) {
    this.setData({
      'userInfo.nickName': e.detail.value
    })
  },

  onNicknameBlur(e: any) {
    this.setData({
      'userInfo.nickName': e.detail.value
    })
  },

  async doLogin() {
    const { userInfo } = this.data
    
    if (!userInfo.nickName) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }
    
    this.setData({ isLoading: true })
    wx.showLoading({ title: '登录中...', mask: true })
    
    const app = getApp()
    const result = await app.doLogin(userInfo)
    
    wx.hideLoading()
    
    if (result.success) {
      wx.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(() => {
        wx.redirectTo({
          url: '/packageFood/pages/index/index'
        })
      }, 1000)
    } else {
      wx.showToast({ title: result.message || '登录失败', icon: 'none' })
      this.setData({ isLoading: false })
    }
  },

  skipLogin() {
    const app = getApp()
    const openid = app.getOpenIdSync()
    
    if (openid) {
      wx.setStorageSync('openid', openid)
    }
    
    wx.setStorageSync('food_skip_login', true)
    wx.showToast({ title: '已跳过登录', icon: 'success' })
    setTimeout(() => {
      wx.redirectTo({
        url: '/packageFood/pages/index/index'
      })
    }, 500)
  }
})))
