import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    userInfo: null as any,
    isLoggedIn: false,
    openid: '',
    openidShort: '',
    userStats: { postCount: 0, collectCount: 0, commentCount: 0 },
    unreadCount: 0,
    showNicknameModal: false,
    newNickname: ''
  },

  onLoad() {
    // 统一个人中心：动态模块进入时，优先显示动态功能区
    wx.redirectTo({ url: '/pages/profile/profile?source=forum' })
    return
  },

  onShow() {
    this.loadUserInfo()
    this.loadUnreadCount()
  },

  loadUserInfo() {
    const app = getApp()
    const isLoggedIn = app.isLoggedIn()
    const userInfo = app.getUserInfo()
    const openid = app.getOpenIdSync()
    const skipAuth = wx.getStorageSync('skipAuth')

    const actualLoggedIn = isLoggedIn && !skipAuth

    this.setData({
      userInfo: userInfo,
      isLoggedIn: actualLoggedIn,
      openid: openid,
      openidShort: openid ? openid.substring(0, 8) : ''
    })

    if (!openid && isLoggedIn) {
      this.tryGetOpenId()
    }

    if (actualLoggedIn && userInfo && userInfo.nickName) {
      this.loadUserStats()
    }
  },

  async tryGetOpenId() {
    try {
      const res = await api.call({ name: 'login' }) as any
      if (res.result && res.result.openid) {
        wx.setStorageSync('openid', res.result.openid)
        this.setData({
          openid: res.result.openid,
          openidShort: res.result.openid.substring(0, 8)
        })
      }
    } catch (err) {
      console.error('获取 openid 失败:', err)
    }
  },

  async loadUnreadCount() {
    if (!this.data.isLoggedIn) return
    try {
      const res = await api.call({
        name: 'forum',
        data: { action: 'getUnreadCount' }
      }) as any
      if (res.result && res.result.success) {
        this.setData({ unreadCount: res.result.count })
      }
    } catch (err) {
      console.error('获取未读数失败:', err)
    }
  },

  async loadUserStats() {
    try {
      const res = await api.call({
        name: 'forum',
        data: { action: 'getUserInfo' }
      }) as any
      if (res.result && res.result.success) {
        const user = res.result.user
        this.setData({
          userStats: {
            postCount: user.postCount || 0,
            collectCount: user.collectCount || 0,
            commentCount: user.commentCount || 0
          }
        })
      }
    } catch (err) {
      console.error('加载用户统计失败:', err)
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: '/pages/index/index' })
      }
    })
  },

  goToLogin() {
    wx.navigateTo({
      url: '/pages/login/login?redirect=/packageForum/pages/mine/mine'
    })
  },

  goToNotifications() {
    if (!this.data.isLoggedIn) {
      this.goToLogin()
      return
    }
    wx.navigateTo({
      url: '/packageForum/pages/messages/messages'
    })
  },

  goToMyPosts() {
    if (!this.data.isLoggedIn) {
      this.goToLogin()
      return
    }
    wx.navigateTo({
      url: '/packageForum/pages/list/list?tab=posts'
    })
  },

  goToMyCollections() {
    if (!this.data.isLoggedIn) {
      this.goToLogin()
      return
    }
    wx.navigateTo({
      url: '/packageForum/pages/list/list?tab=collections'
    })
  },

  goToMyComments() {
    if (!this.data.isLoggedIn) {
      this.goToLogin()
      return
    }
    wx.navigateTo({
      url: '/packageForum/pages/list/list?tab=comments'
    })
  },

  chooseAvatar() {
    const that = this
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function(res: any) {
        if (res.tempFilePaths && res.tempFilePaths.length > 0) {
          const tempFilePath = res.tempFilePaths[0]
          that.uploadAvatar(tempFilePath)
        }
      },
      fail: function() {
        wx.showToast({ title: '选择头像失败', icon: 'none' })
      }
    })
  },

  async uploadAvatar(tempFilePath: string) {
    wx.showLoading({ title: '上传中...', mask: true })
    try {
      const cloudPath = 'avatars/' + Date.now() + '-' + Math.random().toString(36).substr(2, 9) + '.jpg'
      const uploadRes = await api.uploadFile({
        cloudPath: cloudPath,
        filePath: tempFilePath
      })
      
      if (uploadRes.fileID) {
        const avatarUrl = uploadRes.fileID
        const app = getApp()
        const userInfo = app.getUserInfo() || {}
        userInfo.avatarUrl = avatarUrl
        this.setData({ userInfo })
        app.doLogin(userInfo)
        await this.saveUserInfoToCloud()
        wx.hideLoading()
        wx.showToast({ title: '头像修改成功', icon: 'success' })
      } else {
        throw new Error('上传失败')
      }
    } catch (err) {
      wx.hideLoading()
      console.error('上传头像失败:', err)
      wx.showToast({ title: '上传失败', icon: 'none' })
    }
  },

  async updateAvatar(avatarUrl: string) {
    const app = getApp()
    const userInfo = app.getUserInfo() || {}
    userInfo.avatarUrl = avatarUrl
    this.setData({ userInfo })
    app.doLogin(userInfo)
    await this.saveUserInfoToCloud()
    wx.showToast({ title: '头像修改成功', icon: 'success' })
  },

  showEditNickname() {
    const app = getApp()
    const userInfo = app.getUserInfo()
    this.setData({
      showNicknameModal: true,
      newNickname: userInfo ? userInfo.nickName : ''
    })
  },

  hideEditNickname() {
    wx.hideKeyboard()
    this.setData({
      showNicknameModal: false,
      newNickname: ''
    })
  },

  onNicknameInput(e: any) {
    this.setData({ newNickname: e.detail.value })
  },

  async submitNickname() {
    const newNickname = this.data.newNickname.trim()
    if (!newNickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }
    if (newNickname.length > 10) {
      wx.showToast({ title: '昵称不能超过10个字', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...', mask: true })
    try {
      const app = getApp()
      const userInfo = app.getUserInfo() || {}
      userInfo.nickName = newNickname
      this.setData({ userInfo })
      app.doLogin(userInfo)
      this.saveUserInfoToCloud()
      wx.hideLoading()
      wx.showToast({ title: '修改成功', icon: 'success' })
      this.hideEditNickname()
    } catch (err) {
      wx.hideLoading()
      console.error('修改昵称失败:', err)
      wx.showToast({ title: '修改失败', icon: 'none' })
    }
  },

  async saveUserInfoToCloud() {
    const app = getApp()
    const userInfo = app.getUserInfo()
    try {
      await api.call({
        name: 'saveUserInfo',
        data: {
          nickName: userInfo.nickName,
          avatarUrl: userInfo.avatarUrl
        }
      })
    } catch (err) {
      console.error('保存用户信息失败:', err)
    }
  },

  logout() {
    const that = this
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: function(res: any) {
        if (res.confirm) {
          const app = getApp()
          app.doLogout()
          wx.showToast({ title: '已退出登录', icon: 'success' })
          that.setData({
            isLoggedIn: false,
            userInfo: null,
            userStats: { postCount: 0, collectCount: 0, commentCount: 0 },
            unreadCount: 0
          })
        }
      }
    })
  }
}))
