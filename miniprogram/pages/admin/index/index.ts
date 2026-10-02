import { api } from '../../../utils/api-client'
Page({
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.loadStats()) },
  data: {
    adminInfo: null as any,
    expandedGroup: '',
    statsLoading: false,
    stats: {
      pendingShops: 0,
      pendingRiders: 0,
      pendingCanteen: 0,
      pendingReports: 0,
      orderCount: 0,
      runCount: 0,
      postCount: 0
    },

    // 系统设置弹窗（global_settings）
    showSettingsModal: false,
    settingsLoading: false,
    settingsReady: false,
    settingsSaving: false,
    settingsError: '',
    settingsForm: {
      appName: '',
      themeColor: '#667eea',
      contactPhone: '',
      modules: {
        running: { enabled: true, name: '校园跑' },
        food: { enabled: true, name: '食堂点餐' },
        canteen: { enabled: true, name: '食堂饭菜评价' },
        forum: { enabled: true, name: '校园动态' },
        rider: { enabled: true, name: '骑手兼职' }
      }
    } as any
  },

  preventTouchMove() {},

  onLoad() {
    this.checkAdmin()
  },

  onShow() {
    if (wx.getStorageSync('isAdmin')) {
      this.loadStats()
    }
  },

  async checkAdmin() {
    const isAdmin = wx.getStorageSync('isAdmin')
    if (!isAdmin) {
      wx.reLaunch({
        url: '/pages/admin/login/login'
      })
      return
    }

    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'checkLogin' }
      }) as any
      if (!(res.result && res.result.code === 0 && res.result.data && res.result.data.admin)) {
        throw new Error((res.result && res.result.message) || '登录已失效')
      }
      const adminInfo = res.result.data.admin
      wx.setStorageSync('adminInfo', adminInfo)
      this.setData({ adminInfo })
      this.loadStats()
    } catch (error) {
      wx.removeStorageSync('isAdmin')
      wx.removeStorageSync('adminInfo')
      wx.showToast({ title: '管理员登录已失效', icon: 'none' })
      wx.reLaunch({ url: '/pages/admin/login/login' })
    }
  },

  async loadStats() {
    if (this.data.statsLoading) return
    this.setData({ statsLoading: true })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'getDashboardStats' }
      }) as any

      if (res.result && res.result.code === 0) {
        const d = res.result.data || {}
        this.setData({
          stats: {
            pendingShops: d.pendingShops || 0,
            pendingRiders: d.pendingRiders || 0,
            pendingCanteen: d.pendingCanteen || 0,
            pendingReports: d.pendingReports || 0,
            orderCount: d.orderCount || 0,
            runCount: d.runCount || 0,
            postCount: d.postCount || 0
          }
        })
        return true
      }
      throw new Error((res.result && res.result.message) || '读取失败')
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '读取失败，请点击刷新重试', icon: 'none' })
      return false
    } finally {
      this.setData({ statsLoading: false })
    }
  },
  toggleGroup(e: any) {
    const group = e.currentTarget.dataset.group
    this.setData({ expandedGroup: this.data.expandedGroup === group ? '' : group })
  },
  onPullDownRefresh() { this.loadStats().finally(() => wx.stopPullDownRefresh()) },

  goToRankManage() {
    wx.navigateTo({
      url: '/pages/admin/rank/rank'
    })
  },

  goToShopAudit() {
    wx.navigateTo({
      url: '/pages/admin/audit/audit'
    })
  },

  goToShopManage() {
    wx.navigateTo({
      url: '/pages/admin/shops/shops'
    })
  },

  goToRiderAudit() {
    wx.navigateTo({
      url: '/pages/admin/riders/riders'
    })
  },

  goToFoodOrders() {
    wx.navigateTo({
      url: '/packageFood/pages/adminOrder/adminOrder'
    })
  },

  goToFoodMenus() {
    wx.navigateTo({
      url: '/packageFood/pages/adminMenu/adminMenu'
    })
  },

  goToCanteenManage() {
    wx.navigateTo({ url: '/packageCanteen/pages/admin/admin' + (this.data.stats.pendingCanteen ? '?tab=submissions' : '') })
  },

  goToForumPosts() {
    wx.navigateTo({
      url: '/packageForum/pages/admin_posts/admin_posts'
    })
  },

  goToForumReports() {
    wx.navigateTo({
      url: '/packageForum/pages/admin_reports/admin_reports'
    })
  },

  goToForumUsers() {
    wx.navigateTo({
      url: '/packageForum/pages/admin_users/admin_users'
    })
  },

  goToAnnouncements() {
    wx.navigateTo({ url: '/pages/admin/announcements/announcements' })
  },

  goToAdminManage() {
    wx.navigateTo({ url: '/pages/admin/admins/admins' })
  },

  goToOperationLogs() {
    wx.navigateTo({ url: '/pages/admin/oplogs/oplogs' })
  },

  openSettings() {
    if (!this.data.adminInfo || this.data.adminInfo.role !== 'super') {
      wx.showToast({ title: '仅超级管理员可修改', icon: 'none' })
      return
    }
    this.setData({ showSettingsModal: true })
    this.loadSettings()
  },

  closeSettings() {
    if (this.data.settingsSaving) return
    this.setData({ showSettingsModal: false })
  },

  async loadSettings() {
    if (this.data.settingsLoading || this.data.settingsSaving) return
    this.setData({ settingsLoading: true, settingsReady: false, settingsError: '' })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'getGlobalSettings' }
      }) as any

      if (res.result && res.result.code === 0) {
        const d = res.result.data || {}
        this.setData({
          settingsReady: true,
          settingsForm: {
            appName: d.appName || '智慧校园',
            themeColor: d.themeColor || '#667eea',
            contactPhone: d.contactPhone || '',
            modules: { ...this.data.settingsForm.modules, ...(d.modules || {}) }
          }
        })
      } else {
        throw new Error((res.result && res.result.message) || '获取设置失败')
      }
    } catch (e) {
      this.setData({ settingsError: '读取设置失败，请重试' })
    } finally {
      this.setData({ settingsLoading: false })
    }
  },

  toggleModule(e: any) {
    if (!this.data.settingsReady || this.data.settingsSaving) return
    const key = e.currentTarget.dataset.key
    const enabled = e.detail.value
    this.setData({ [`settingsForm.modules.${key}.enabled`]: enabled })
  },

  setModulePreset(e: any) {
    if (!this.data.settingsReady || this.data.settingsSaving) return
    const preset = e.currentTarget.dataset.preset
    const patch: any = {}
    for (const key of Object.keys(this.data.settingsForm.modules)) {
      patch[`settingsForm.modules.${key}.enabled`] = preset === 'all' || (preset === 'reviews' && ['running', 'canteen'].includes(key))
    }
    this.setData(patch)
  },

  async saveSettings() {
    if (!this.data.settingsReady || this.data.settingsLoading || this.data.settingsSaving || !this.data.adminInfo || this.data.adminInfo.role !== 'super') return
    this.setData({ settingsSaving: true })
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'updateGlobalSettings', data: this.data.settingsForm }
      }) as any
      if (!res.result || res.result.code !== 0) throw new Error((res.result && res.result.message) || '保存失败')
      this.setData({ showSettingsModal: false })
      wx.showToast({ title: '已保存，重新进入页面生效', icon: 'none' })
    } catch (e) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ settingsSaving: false })
    }
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出管理员账号吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.call({
              name: 'globalAdmin',
              data: { action: 'logout' }
            })
          } catch (error) {
            console.warn('管理员服务端退出失败，将继续清理本地状态', error)
          }
          wx.removeStorageSync('isAdmin')
          wx.removeStorageSync('adminInfo')
          wx.reLaunch({
            url: '/pages/admin/login/login'
          })
        }
      }
    })
  }
})
