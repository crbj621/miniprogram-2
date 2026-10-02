import { api } from '../../utils/api-client'
import { getPublicModules } from '../../utils/public-modules'

Page({
  data: {
    // 个人中心来源：用于决定功能区优先级（running/forum/food）
    source: 'profile',
    menuGroups: [] as any[],
    modules: { running: false, food: false, canteen: false, forum: false, rider: false },
    modulesState: 'loading',
    hasOpenModules: false,

    userInfo: null as any,
    isLoggedIn: false,
    openid: '',
    userId: '',
    runStats: { totalDistance: 0, totalRuns: 0, totalDuration: 0, bestDistance: 0, bestPace: 0, averagePace: 0 },
    showSearchModal: false,
    searchType: 'name',
    searchKeyword: '',
    searchResults: [] as any[],
    hasSearched: false,
    friendCount: 0,
    showQrModal: false,
    qrCodeUrl: '',
    isGuest: false
  },

  onLoad(options: any) {
    const source = options && options.source ? options.source : 'profile'
    this.setData({ source })

    const app = getApp()
    
    if (!app.checkLogin({ redirect: false })) {
      const redirect = encodeURIComponent('/pages/profile/profile?source=' + source)
      wx.redirectTo({ url: '/pages/login/login?forceLogin=true&redirect=' + redirect })
      return
    }

    const userInfo = app.getUserInfo()
    const openid = app.getOpenIdSync()
    const userId = wx.getStorageSync('userId')
    const isLoggedIn = app.isLoggedIn()

    this.setData({
      userInfo: isLoggedIn ? userInfo : null,
      isLoggedIn,
      openid: isLoggedIn ? openid : '',
      userId: isLoggedIn ? (userId || '') : '',
      isGuest: !isLoggedIn
    })

    this.buildMenuGroups()
    this.loadModules()
  },

  onShow() {
    const app = getApp()
    const isLoggedIn = app.isLoggedIn()
    const userInfo = isLoggedIn ? app.getUserInfo() : null
    const openid = isLoggedIn ? app.getOpenIdSync() : ''
    const userId = wx.getStorageSync('userId')

    this.setData({
      userInfo,
      isLoggedIn,
      isGuest: !isLoggedIn,
      openid,
      userId: isLoggedIn ? (userId || '') : '',
      friendCount: isLoggedIn ? this.data.friendCount : 0,
      runStats: isLoggedIn
        ? this.data.runStats
        : { totalDistance: 0, totalRuns: 0, totalDuration: 0, bestDistance: 0, bestPace: 0, averagePace: 0 }
    })

    if (isLoggedIn) {
      this.calculateStats()
      this.loadFriendCount()
    }

    // 来源可能通过重定向变化，保持菜单优先级正确
    this.buildMenuGroups()
    this.loadModules()
  },

  async loadModules() {
    this.setData({ modulesState: 'loading' })
    try {
      const modules = await getPublicModules()
      this.setData({ modules, modulesState: 'ready', hasOpenModules: Object.values(modules).some(Boolean) })
      this.buildMenuGroups()
    } catch (error) {
      console.error('读取模块开关失败', error)
      this.setData({ modulesState: 'error' })
    }
  },

  buildMenuGroups() {
    const groups: any[] = []

    const runningGroup = {
      key: 'running',
      title: '校园跑',
      items: [
        { id: 'run_history', icon: '🏃', title: '跑步记录', desc: '查看历史跑步数据', bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', action: 'runHistory', needLogin: true },
        { id: 'rank', icon: '🏆', title: '排行榜', desc: '查看跑步排行榜', bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', action: 'rank', needLogin: false }
      ]
    }

    const forumGroup = {
      key: 'forum',
      title: '校园动态',
      items: [
        { id: 'forum_msgs', icon: '🔔', title: '动态消息', desc: '回复和评论提醒', bg: 'linear-gradient(135deg, #FFB6C1 0%, #FFDAB9 100%)', action: 'forumMessages', needLogin: true },
        { id: 'forum_posts', icon: '📝', title: '我的动态', desc: '查看发布的内容', bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', action: 'forumMyPosts', needLogin: true },
        { id: 'forum_collect', icon: '⭐', title: '我的收藏', desc: '收藏的精彩内容', bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', action: 'forumMyCollections', needLogin: true },
        { id: 'job', icon: '💼', title: '兼职互助', desc: '查看兼职信息板块', bg: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)', action: 'forumJob', needLogin: false }
      ]
    }

    const foodGroup = {
      key: 'food',
      title: '点餐',
      items: [
        { id: 'food_orders', icon: '📋', title: '我的点餐订单', desc: '查看点餐订单列表', bg: 'linear-gradient(135deg, #fddb92 0%, #d1fdff 100%)', action: 'foodOrders', needLogin: true },
        { id: 'food_merchant', icon: '🏪', title: '商家入口', desc: '商家登录与管理', bg: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)', action: 'foodMerchant', needLogin: true }
      ]
    }

    const riderGroup = {
      key: 'rider',
      title: '骑手兼职',
      items: [
        { id: 'rider_hall', icon: '🛵', title: '接单大厅', desc: '查看可接配送单', bg: 'linear-gradient(135deg, #c2ffd8 0%, #465efb 100%)', action: 'riderHall', needLogin: true },
        { id: 'rider_my', icon: '📦', title: '我的配送订单', desc: '配送状态流转管理', bg: 'linear-gradient(135deg, #b8c6ff 0%, #6f86d6 100%)', action: 'riderMy', needLogin: true },
        { id: 'rider_reg', icon: '📝', title: '骑手注册/信息', desc: '注册或修改骑手信息', bg: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)', action: 'riderRegister', needLogin: true }
      ]
    }

    const socialGroup = {
      key: 'social',
      title: '社交',
      items: [
        { id: 'friends', icon: '👥', title: '我的好友', desc: '管理好友列表', bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', action: 'friends', needLogin: true },
        { id: 'search_friend', icon: '🔍', title: '搜索好友', desc: '添加新的好友', bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', action: 'searchFriend', needLogin: true },
        { id: 'qr', icon: '📱', title: '我的二维码', desc: '分享给好友扫码', bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', action: 'qr', needLogin: true }
      ]
    }

    const otherGroup = {
      key: 'other',
      title: '其他',
      items: [
        { id: 'settings', icon: '⚙️', title: '设置', desc: '应用设置', bg: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)', action: 'settings', needLogin: false },
        { id: 'logout', icon: '🚪', title: '退出登录', desc: '退出当前账号', bg: 'linear-gradient(135deg, #ff6b6b 0%, #feca57 100%)', action: 'logout', needLogin: true, onlyWhenLoggedIn: true }
      ]
    }

    const map: any = { running: runningGroup, forum: forumGroup, food: foodGroup, rider: riderGroup, social: socialGroup, other: otherGroup }

    const source = this.data.source || 'profile'
    const priority: string[] =
      source === 'running' ? ['running', 'forum', 'food', 'rider', 'social', 'other']
      : source === 'forum' ? ['forum', 'running', 'food', 'rider', 'social', 'other']
      : source === 'food' ? ['food', 'running', 'forum', 'rider', 'social', 'other']
      : source === 'rider' ? ['rider', 'food', 'running', 'forum', 'social', 'other']
      : ['running', 'forum', 'food', 'rider', 'social', 'other']

    priority.forEach((k) => {
      if (k === 'other' || (k === 'social' ? this.data.modules.running : this.data.modules[k])) groups.push(map[k])
    })
    this.setData({ menuGroups: groups })
  },

  onMenuTap(e: any) {
    const action = e.currentTarget.dataset.action
    if (!action) return

    switch (action) {
      case 'runHistory':
        return this.viewRunHistory()
      case 'rank':
        return this.goToRank()
      case 'forumMessages':
        return wx.navigateTo({ url: '/packageForum/pages/messages/messages' })
      case 'forumMyPosts':
        return wx.navigateTo({ url: '/packageForum/pages/list/list?tab=posts' })
      case 'forumMyCollections':
        return wx.navigateTo({ url: '/packageForum/pages/list/list?tab=collections' })
      case 'forumJob':
        return wx.navigateTo({ url: '/packageForum/pages/list/list?category=job' })
      case 'foodOrders':
        return wx.navigateTo({ url: '/packageFood/pages/order_list/order_list' })
      case 'foodMerchant':
        return wx.navigateTo({ url: '/packageFood/pages/shop_login/shop_login' })
      case 'riderHall':
        return wx.navigateTo({ url: '/packageRider/pages/hall/hall' })
      case 'riderMy':
        return wx.navigateTo({ url: '/packageRider/pages/my/my' })
      case 'riderRegister':
        return wx.navigateTo({ url: '/packageRider/pages/register/register' })
      case 'friends':
        return this.viewFriendList()
      case 'searchFriend':
        return this.showSearchFriend()
      case 'qr':
        return this.showQrCode()
      case 'settings':
        return this.goToSettings()
      case 'logout':
        return this.logout()
      default:
        return
    }
  },

  statsOpenid: '',
  statsRequestId: 0,
  async calculateStats() {
    const openid = getApp().getOpenIdSync()
    if (!openid) return
    const requestId = ++this.statsRequestId
    const cached = wx.getStorageSync('run_stats_' + openid)
    if (cached || this.statsOpenid !== openid) this.setData({ runStats: cached || {
      totalDistance: 0, totalRuns: 0, totalDuration: 0, bestDistance: 0, bestPace: 0, averagePace: 0
    } })
    this.statsOpenid = openid
    try {
      const res: any = await api.call({ name: 'getUserRunStats', data: {} })
      if (openid !== getApp().getOpenIdSync() || requestId !== this.statsRequestId) return
      if (!res.result || res.result.success === false) throw new Error('运动统计加载失败')
      wx.setStorageSync('run_stats_' + openid, res.result)
      this.setData({ runStats: res.result })
    } catch (error) { wx.showToast({ title: '统计同步失败，请稍后刷新', icon: 'none' }) }
  },

  loadFriendCount() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      this.setData({ friendCount: 0 })
      return
    }
    const openid = app.getOpenIdSync()
    api.call({
      name: 'getFriends',
      data: { openid },
      success: (res: any) => { this.setData({ friendCount: (res.result || []).length }) },
      fail: () => { this.setData({ friendCount: 0 }) }
    })
  },

  copyUserId() {
    const userId = this.data.userId
    if (!userId) { wx.showToast({ title: '暂无用户ID', icon: 'none' }); return }
    wx.setClipboardData({ data: userId, success: () => { wx.showToast({ title: 'ID已复制', icon: 'success' }) } })
  },

  chooseAvatar() {
    const app = getApp()
    wx.chooseImage({
      count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const avatarUrl = res.tempFilePaths[0]
        app.updateAvatar(avatarUrl)
        this.setData({ userInfo: app.getUserInfo() })
        this.saveUserInfoToCloud()
        wx.showToast({ title: '头像修改成功', icon: 'success' })
      },
      fail: () => { wx.showToast({ title: '选择头像失败', icon: 'none' }) }
    })
  },

  editNickname() {
    wx.showModal({
      title: '修改昵称', editable: true, placeholderText: '请输入新昵称',
      success: (res) => {
        if (res.confirm && res.content) {
          const newNickname = res.content.trim()
          if (!newNickname) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return }
          if (newNickname.length > 20) { wx.showToast({ title: '昵称最多20个字符', icon: 'none' }); return }
          const app = getApp()
          app.updateNickname(newNickname)
          this.setData({ userInfo: app.getUserInfo() })
          this.saveUserInfoToCloud()
          wx.showToast({ title: '昵称修改成功', icon: 'success' })
        }
      }
    })
  },

  saveUserInfoToCloud() {
    const app = getApp()
    const userInfo = app.getUserInfo()
    api.call({
      name: 'saveUserInfo',
      data: { nickName: userInfo.nickName, avatarUrl: userInfo.avatarUrl },
      success: (res: any) => {
        if (res.result && res.result.userId) {
          wx.setStorageSync('userId', res.result.userId)
          this.setData({ userId: res.result.userId })
        }
      },
      fail: (err) => { console.error('保存用户信息失败：', err) }
    })
  },

  showSearchFriend() {
    this.setData({ showSearchModal: true, searchType: 'name', searchKeyword: '', searchResults: [], hasSearched: false })
  },

  showUserIdInput() {
    this.setData({ showSearchModal: true, searchType: 'id', searchKeyword: '', searchResults: [], hasSearched: false })
  },

  hideSearchModal() { this.setData({ showSearchModal: false }) },

  catchTapPrevent() {
    // 阻止冒泡，防止点击卡片内部触发 overlay 的 hideSearchModal
  },

  switchSearchType(e: any) {
    this.setData({ searchType: e.currentTarget.dataset.type, searchKeyword: '', searchResults: [], hasSearched: false })
  },

  onSearchInput(e: any) { this.setData({ searchKeyword: e.detail.value.toUpperCase() }) },

  searchFriend() {
    const keyword = this.data.searchKeyword.trim()
    if (!keyword) { wx.showToast({ title: '请输入搜索内容', icon: 'none' }); return }
    if (this.data.searchType === 'id' && keyword.length !== 6) { wx.showToast({ title: '用户ID为6位', icon: 'none' }); return }
    wx.showLoading({ title: '搜索中...' })
    const app = getApp()
    const openid = app.getOpenIdSync()
    api.call({
      name: 'searchUser',
      data: { keyword, searchType: this.data.searchType },
      success: (res: any) => {
        wx.hideLoading()
        const filteredResults = (res.result || []).filter((user: any) => user.openid !== openid)
        this.setData({ searchResults: filteredResults, hasSearched: true })
        if (filteredResults.length === 0) wx.showToast({ title: '未找到该用户', icon: 'none' })
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '搜索失败', icon: 'none' }) }
    })
  },

  addFriend(e: any) {
    const friend = e.currentTarget.dataset.user
    const app = getApp()
    wx.showLoading({ title: '添加中...' })
    api.call({
      name: 'addFriend',
      data: { friendOpenid: friend.openid },
      success: (res: any) => {
        wx.hideLoading()
        if (res.result && res.result.success) {
          wx.showToast({ title: '添加成功', icon: 'success' })
          const results = this.data.searchResults.map(u => u.openid === friend.openid ? { ...u, isFriend: true } : u)
          this.setData({ searchResults: results })
          this.loadFriendCount()
        } else {
          wx.showToast({ title: (res.result && res.result.errMsg) ? res.result.errMsg : '添加失败', icon: 'none' })
        }
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '添加失败', icon: 'none' }) }
    })
  },

  showQrCode() {
    const userId = this.data.userId
    if (!userId) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    wx.showLoading({ title: '生成中...' })
    api.call({
      name: 'getQrCode',
      data: { userId },
      success: (res: any) => {
        wx.hideLoading()
        if (res.result && res.result.fileID) {
          this.setData({ showQrModal: true, qrCodeUrl: res.result.fileID })
        } else {
          wx.showToast({ title: '生成失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '生成失败', icon: 'none' })
      }
    })
  },

  hideQrModal() { this.setData({ showQrModal: false }) },

  saveQrCode() {
    const qrCodeUrl = this.data.qrCodeUrl
    if (!qrCodeUrl) return
    wx.showLoading({ title: '保存中...' })
    api.downloadFile({
      fileID: qrCodeUrl,
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => { 
            wx.hideLoading()
            wx.showToast({ title: '已保存到相册', icon: 'success' }) 
          },
          fail: () => { 
            wx.hideLoading()
            wx.showToast({ title: '保存失败', icon: 'none' }) 
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '下载失败', icon: 'none' })
      }
    })
  },

  shareToFriend() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })
  },

  logout() {
    wx.showModal({
      title: '退出登录', content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          const app = getApp()
          app.doLogout()
          wx.showToast({ title: '已退出登录', icon: 'success' })
          wx.reLaunch({ url: '/pages/login/login' })
        }
      }
    })
  },

  viewRunHistory() { wx.navigateTo({ url: '/packageProfile/pages/history/history' }) },
  viewFriendList() { wx.navigateTo({ url: '/pages/friends/friends' }) },
  viewFoodOrders() { wx.navigateTo({ url: '/packageFood/pages/order_list/order_list' }) },
  goToRank() { wx.navigateTo({ url: '/pages/rank/rank' }) },
  goToSettings() { wx.navigateTo({ url: '/packageProfile/pages/settings/settings' }) },
  viewTeam() { wx.navigateTo({ url: '/packageProfile/pages/team/team' }) },
  goToRun() { wx.navigateTo({ url: '/pages/index/index' }) },

  goToCoupons() {
    wx.navigateTo({ url: '/packageProfile/pages/coupons/coupons' })
  },

  goToLogin() {
    const redirect = encodeURIComponent('/pages/profile/profile?source=' + (this.data.source || 'profile'))
    wx.navigateTo({ url: '/pages/login/login?redirect=' + redirect })
  },

  onShareAppMessage() {
    const app = getApp()
    const userInfo = app.getUserInfo()
    const nickName = userInfo && userInfo.nickName ? userInfo.nickName : '用户'
    return {
      title: `我是${nickName}，ID: ${this.data.userId}，快来加我好友一起跑步吧！`,
      path: `/pages/index/index?addFriend=${this.data.userId}`,
      imageUrl: ''
    }
  },

  onShareTimeline() {
    return {
      title: `校园跑 - 我的ID: ${this.data.userId}`,
      query: `addFriend=${this.data.userId}`
    }
  }
})
