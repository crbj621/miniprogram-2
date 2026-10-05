import { withSharing } from '../../../utils/page-share'
import { withPageCopy } from '../../../utils/page-copy'
import { api } from '../../../utils/api-client'
import { callFoodFunction } from '../../utils/food-cloud'
import { getPublicModules } from '../../../utils/public-modules'
import { getSavedCampusTheme } from '../../../utils/campus-theme'

Page(withSharing(withPageCopy('food', {
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.loadShops()) },
  data: {
    theme: getSavedCampusTheme('food'),
    shops: [] as any[],
    loading: true,
    keyword: '',
    page: 1,
    pageSize: 10,
    hasMore: true,
    refreshing: false,
    isLoggedIn: false
    ,riderEnabled: false
  },

  onLoad() {
    // 首次展示与从其他页面返回都统一在 onShow 刷新，避免首次重复请求。
  },

  onShow() {
    this.setData({ theme: getSavedCampusTheme('food') })
    this.checkLogin()
    this.setData({ riderEnabled: false })
    getPublicModules().then(modules => this.setData({ riderEnabled: modules.food && modules.rider })).catch(() => {})
  },

  checkLogin() {
    const app = getApp()
    const isLoggedIn = app.isLoggedIn()
    const skipLogin = wx.getStorageSync('food_skip_login')
    
    if (!isLoggedIn && !skipLogin) {
      wx.redirectTo({
        url: '/packageFood/pages/login/login'
      })
      return
    }
    
    this.setData({ isLoggedIn })
    this.loadShops()
  },

  onPullDownRefresh() {
    this.onRefresh()
  },

  onRefresh() {
    this.setData({ refreshing: true, page: 1, hasMore: true })
    this.loadShops().then(() => {
      this.setData({ refreshing: false })
      wx.stopPullDownRefresh()
    })
  },

  loadMore() {
    if (this.data.loading || !this.data.hasMore) return
    this.loadShops(true)
  },

  loadShops(isLoadMore = false) {
    const requestId = this.shopRequestId = (this.shopRequestId || 0) + 1
    const page = isLoadMore ? this.data.page + 1 : 1
    this.setData({ loading: true })
    if (!isLoadMore) {
      this.setData({ loading: true, page: 1 })
    }
    
    return callFoodFunction('getShopList', { 
      keyword: this.data.keyword,
      page,
      pageSize: this.data.pageSize
    }).then((result: any) => {
      if (requestId !== this.shopRequestId) return false
      const newList = result.list || []
      const shops = isLoadMore ? [...this.data.shops, ...newList] : newList
      
      this.setData({
        shops,
        page,
        loading: false,
        hasMore: newList.length >= this.data.pageSize
      })
      return true
    }).catch(err => {
      if (requestId !== this.shopRequestId) return false
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      this.setData({ loading: false })
      return false
    })
  },

  onSearchInput(e: any) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch(e: any) {
    this.setData({ keyword: e.detail.value, page: 1, hasMore: true })
    this.loadShops()
  },

  goToShop(e: any) {
    const shopId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: '/packageFood/pages/shop/shop?id=' + shopId
    })
  },

  goToMine() {
    wx.navigateTo({
      url: '/pages/profile/profile?source=food'
    })
  },

  goToOrders() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.navigateTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageFood/pages/order_list/order_list')
      })
      return
    }
    wx.navigateTo({
      url: '/packageFood/pages/order_list/order_list'
    })
  },

  goToRider() {
    if (!this.data.riderEnabled) return
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.navigateTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageRider/pages/register/register')
      })
      return
    }
    wx.showLoading({ title: '加载中...' })
    api.call({
      name: 'rider',
      data: { action: 'getProfile' },
      success: (res: any) => {
        wx.hideLoading()
        if (res.result && res.result.code === 0 && res.result.data && res.result.data.registered) {
          wx.setStorageSync('riderInfo', res.result.data.rider)
          wx.navigateTo({ url: '/packageRider/pages/hall/hall' })
        } else {
          wx.navigateTo({ url: '/packageRider/pages/register/register' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('获取骑手信息失败:', err)
        wx.navigateTo({ url: '/packageRider/pages/register/register' })
      }
    })
  }
})))
