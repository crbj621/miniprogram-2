import { api } from '../../utils/api-client'
import { getPublicModules } from '../../utils/public-modules'
import { getPortalDaily } from '../../utils/portal-daily'

Page({
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.loadModules()) },
  data: {
    userInfo: null,
    isLoggedIn: false,
    daily: getPortalDaily(),
    modules: { running: false, food: false, canteen: false, forum: false, rider: false },
    modulesState: 'loading',
    hasOpenModules: false
  },

  onShow() {
    const app = getApp()
    const isLoggedIn = app.isLoggedIn()
    const userInfo = isLoggedIn ? app.getUserInfo() : null
    this.setData({ userInfo, isLoggedIn, daily: getPortalDaily() })

    this.loadModules()

    this.showAnnouncementIfNeeded()
  },

  async loadModules() {
    this.setData({ modulesState: 'loading' })
    try {
      const modules = await getPublicModules()
      this.setData({ modules, modulesState: 'ready', hasOpenModules: modules.running || modules.food || modules.canteen || modules.forum })
      return true
    } catch (error) {
      console.error('读取模块开关失败', error)
      this.setData({ modulesState: 'error' })
      return false
    }
  },

  async showAnnouncementIfNeeded() {
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'getPublishedAnnouncements', data: { page: 1, pageSize: 1 } }
      }) as any

      if (!(res.result && res.result.code === 0)) return
      const list = (res.result.data && res.result.data.list) ? res.result.data.list : []
      if (!list.length) return

      const a = list[0]
      const lastShown = wx.getStorageSync('lastAnnouncementId')
      if (lastShown === a._id) return

      wx.setStorageSync('lastAnnouncementId', a._id)
      wx.showModal({
        title: a.title || '公告',
        content: a.content || '',
        showCancel: false,
        confirmText: '我知道了'
      })
    } catch (e) {}
  },

  onPullDownRefresh() { this.loadModules().finally(() => wx.stopPullDownRefresh()) },

  goToRun() {
    wx.navigateTo({
      url: '/pages/index/index'
    })
  },

  goToFood() {
    wx.navigateTo({
      url: '/packageFood/pages/index/index'
    })
  },

  goToCanteen() {
    wx.navigateTo({ url: '/packageCanteen/pages/index/index' })
  },

  goToForum() {
    wx.navigateTo({
      url: '/packageForum/pages/index/index'
    })
  },

  goToProfile() {
    wx.navigateTo({
      url: '/pages/profile/profile'
    })
  },

  goToAdminLogin() {
    wx.navigateTo({
      // 统一管理端入口
      url: '/pages/admin/login/login'
    })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出吗？',
      success: (res) => {
        if (res.confirm) {
          const app = getApp()
          app.doLogout()
          this.setData({ userInfo: null, isLoggedIn: false })
          wx.reLaunch({
            url: '/pages/login/login?forceLogin=true'
          })
        }
      }
    })
  }
})
