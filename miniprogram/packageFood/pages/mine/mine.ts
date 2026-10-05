import { withSharing } from '../../../utils/page-share'
import { callFoodFunction } from '../../utils/food-cloud'

Page(withSharing({
  data: {
    isMerchant: false,
    shopId: '',
    shopStatus: '',
    userInfo: {
      avatarUrl: '',
      nickName: ''
    },
    isLoggedIn: false,
    userId: ''
  },

  onLoad() {
    // 统一个人中心：点餐模块进入时，优先显示点餐功能区
    wx.redirectTo({ url: '/pages/profile/profile?source=food' })
  },

  onShow() {
    this.loadUserInfo()
    this.checkMerchantStatus()
  },

  loadUserInfo() {
    const app = getApp()
    const isLoggedIn = app.isLoggedIn()
    const userInfo = isLoggedIn ? app.getUserInfo() : null
    const userId = wx.getStorageSync('userId')
    
    this.setData({
      isLoggedIn,
      userInfo: userInfo || { avatarUrl: '', nickName: '' },
      userId: userId || ''
    })
  },

  async checkMerchantStatus() {
    try {
      const res = await callFoodFunction('checkMerchantStatus', {})
      if (res.success) {
        this.setData({
          isMerchant: res.isMerchant,
          shopId: res.shopId,
          shopStatus: res.shopStatus
        })
      }
    } catch (err) {
      console.error(err)
    }
  },

  goToLogin() {
    wx.reLaunch({
      url: '/pages/login/login'
    })
  },

  goToRegister() {
    wx.navigateTo({
      url: '/packageFood/pages/shop_register/shop_register'
    })
  },

  goToShopManage() {
    wx.navigateTo({
      url: '/packageFood/pages/shop_index/shop_index'
    })
  },

  goToProductManage() {
    wx.navigateTo({
      url: '/packageFood/pages/shop_dish/shop_dish'
    })
  },

  goToShopOrders() {
    wx.navigateTo({
      url: '/packageFood/pages/shop_index/shop_index?tab=orders'
    })
  },

  goToOrderList() {
    wx.navigateTo({
      url: '/packageFood/pages/order_list/order_list'
    })
  },

  goToShopLogin() {
    wx.navigateTo({
      url: '/packageFood/pages/shop_login/shop_login'
    })
  },

  logout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          const app = getApp()
          app.doLogout()
          wx.showToast({ title: '已退出登录', icon: 'success' })
          wx.reLaunch({
            url: '/pages/login/login?forceLogin=true'
          })
        }
      }
    })
  }
}))
