import { api, clearServerSession, initializeServerClient } from './utils/api-client'
import { clearIdentityCache } from './utils/auth-storage'

App({
  globalData: {
    userInfo: null as any,
    openid: '',
    hasUserInfo: false,
    distance: 0,
    runTime: 0,
    runCount: 0,
    runningState: null as any,
    authVersion: 0
  },

  onLaunch() {
    initializeServerClient()

    this.initLoginState()
  },

  initLoginState() {
    var cachedUserInfo = wx.getStorageSync('userInfo')
    var cachedOpenid = wx.getStorageSync('openid')
    
    if (cachedOpenid) {
      this.globalData.openid = cachedOpenid
    }
    
    if (cachedUserInfo && cachedOpenid) {
      this.globalData.userInfo = cachedUserInfo
      this.globalData.hasUserInfo = true
    } else if (cachedUserInfo && !cachedOpenid) {
      // 账号缓存不完整时按未登录处理，避免只剩头像却被误判为登录态。
      wx.removeStorageSync('userInfo')
    }
    
    if (!cachedOpenid) {
      this.getOpenId()
    }
  },

  async getOpenId() {
    var requestAuthVersion = this.globalData.authVersion
    try {
      const res = await api.call({
        name: 'login'
      }) as any
      console.log('获取 openid 结果:', res)

      // 退出登录可能发生在请求返回之前，旧请求不能把已清理的身份重新写回。
      if (requestAuthVersion !== this.globalData.authVersion) {
        return ''
      }
      
      if (res.result && res.result.openid) {
        this.globalData.openid = res.result.openid
        wx.setStorageSync('openid', res.result.openid)
        console.log('openid 已保存:', res.result.openid)
        return res.result.openid
      }
    } catch (err) {
      console.error('获取 openid 失败:', err)
    }
    return ''
  },

  getOpenIdSync() {
    if (this.globalData.openid) {
      return this.globalData.openid
    }
    return wx.getStorageSync('openid') || ''
  },

  getGlobalOpenId() {
    return this.getOpenIdSync()
  },

  getUserInfo() {
    if (this.globalData.userInfo) {
      return this.globalData.userInfo
    }
    return wx.getStorageSync('userInfo') || null
  },

  isLoggedIn() {
    if (
      this.globalData.hasUserInfo &&
      this.globalData.openid &&
      this.globalData.userInfo &&
      this.globalData.userInfo.nickName
    ) {
      return true
    }
    var cachedUserInfo = wx.getStorageSync('userInfo')
    var cachedOpenid = wx.getStorageSync('openid')
    return !!(cachedOpenid && cachedUserInfo && cachedUserInfo.nickName)
  },

  async doLogin(userInfo: any) {
    if (!userInfo || !userInfo.nickName) {
      return { success: false, message: '请输入昵称' }
    }

    var openid = this.getOpenIdSync()
    
    if (!openid) {
      try {
        await this.getOpenId()
        openid = this.getOpenIdSync()
      } catch (err) {
        console.error('获取 openid 失败:', err)
        return { success: false, message: '获取 openid 失败' }
      }
    }

    if (!openid) {
      return { success: false, message: '登录失败，请重试' }
    }

    const requestAuthVersion = this.globalData.authVersion
    try {
      const saveRes = await api.call({
        name: 'saveUserInfo',
        data: { nickName: userInfo.nickName, avatarUrl: userInfo.avatarUrl || '' }
      }) as any
      if (requestAuthVersion !== this.globalData.authVersion) {
        return { success: false, message: '登录已取消' }
      }
      if (!saveRes.result || !saveRes.result.userId || saveRes.result.success === false) {
        throw new Error((saveRes.result && saveRes.result.errMsg) || '保存用户信息失败')
      }
      this.globalData.userInfo = userInfo
      this.globalData.openid = openid
      this.globalData.hasUserInfo = true
      wx.setStorageSync('userInfo', userInfo)
      wx.setStorageSync('openid', openid)
      wx.setStorageSync('userId', saveRes.result.userId)
      wx.removeStorageSync('skipAuth')
      wx.removeStorageSync('food_skip_login')
      return { success: true, openid }
    } catch (error: any) {
      return { success: false, message: error.message || '服务器连接失败，请重试' }
    }
  },

  doLogout() {
    // 先让正在进行中的身份请求失效，再清理所有账号状态。
    this.globalData.authVersion += 1
    if (wx.getStorageSync('isAdmin')) {
      api.call({
        name: 'globalAdmin',
        data: { action: 'logout' }
      }).catch(function(error) {
        console.warn('管理员服务端退出失败', error)
      })
    }
    clearServerSession()

    this.globalData.userInfo = null
    this.globalData.openid = ''
    this.globalData.hasUserInfo = false
    this.globalData.runningState = null

    clearIdentityCache()

    return { success: true }
  },

  checkLogin(options?: { redirect?: boolean }) {
    var redirect = options && options.redirect !== false
    
    if (!this.isLoggedIn()) {
      if (redirect) {
        wx.reLaunch({ url: '/pages/login/login' })
      }
      return false
    }
    return true
  },

  updateUserInfo(userInfo: any) {
    this.globalData.userInfo = userInfo
    wx.setStorageSync('userInfo', userInfo)
  },

  updateAvatar(avatarUrl: string) {
    var userInfo = this.getUserInfo() || {}
    userInfo.avatarUrl = avatarUrl
    this.updateUserInfo(userInfo)
  },

  updateNickname(nickName: string) {
    var userInfo = this.getUserInfo() || {}
    userInfo.nickName = nickName
    this.updateUserInfo(userInfo)
  }
})
