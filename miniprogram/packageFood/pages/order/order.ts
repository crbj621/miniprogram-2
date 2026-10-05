import { withSharing } from '../../../utils/page-share'
import { callFoodFunction } from '../../utils/food-cloud'

Page(withSharing({
  data: {
    shop: null as any,
    items: [] as any[],
    totalPrice: 0,
    type: 'pickup' as 'pickup' | 'delivery',
    phone: '',
    address: '',
    pickupTime: '',
    remark: '',
    submitting: false,
    isLoggedIn: false,
    userInfo: null as any,
    finalPrice: 0,
    runDiscount: 0,
    actualDiscount: 0,
    actualCouponDiscount: 0,
    todayRunDistance: 0,
    runRule: '今日每跑1公里抵0.1元，每日最多1元',
    coupon: null as any,
    useCoupon: true,
    useRunDiscount: true
  },

  onLoad() {
    this.checkLogin()
    const orderData = wx.getStorageSync('current_order')
    if (!orderData) {
      wx.showToast({ title: '订单数据异常', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
      return
    }
    this.setData({
      shop: orderData.shop,
      items: orderData.items,
      totalPrice: orderData.totalPrice,
      finalPrice: orderData.totalPrice
    })

    if (this.data.isLoggedIn) this.fetchCheckoutBenefits()
  },

  checkLogin() {
    const app = getApp()
    const isLoggedIn = app.isLoggedIn()
    const userInfo = isLoggedIn ? app.getUserInfo() : null
    this.setData({
      isLoggedIn,
      userInfo: userInfo
    })
  },

  goToLogin() {
    wx.reLaunch({
      url: '/pages/login/login?forceLogin=true&redirect=' +
        encodeURIComponent('/packageFood/pages/order/order')
    })
  },

  async fetchCheckoutBenefits() {
    try {
      const result = await callFoodFunction('getCheckoutBenefits', {})
      const coupons = Array.isArray(result.coupons) ? result.coupons : []
      this.setData({
        runDiscount: Number(result.runDiscount || 0),
        todayRunDistance: Number(result.todayDistance || 0),
        runRule: result.runRule || this.data.runRule,
        coupon: coupons[0] || null,
        useCoupon: coupons.length > 0
      })
      this.calculatePrice()
    } catch (error) {
      console.error('获取结算优惠失败:', error)
      this.setData({
        runDiscount: 0,
        coupon: null,
        useCoupon: false
      })
      this.calculatePrice()
    }
  },

  toggleRunDiscount(e: any) {
    this.setData({ useRunDiscount: e.detail.value });
    this.calculatePrice();
  },

  toggleCoupon(e: any) {
    this.setData({ useCoupon: e.detail.value });
    this.calculatePrice();
  },

  calculatePrice() {
    const { totalPrice, shop, type, runDiscount, coupon, useCoupon, useRunDiscount } = this.data;
    let finalPrice = totalPrice;
    let actualDiscount = 0;
    let actualCouponDiscount = 0;
    
    if (type === 'delivery') {
      let deliveryFee = shop.deliveryFee || 0;
      finalPrice += deliveryFee;
    }
    
    if (useRunDiscount && runDiscount > 0) {
      actualDiscount = Math.min(runDiscount, finalPrice);
      finalPrice -= actualDiscount;
    }
    
    if (useCoupon && coupon && coupon.value > 0) {
      actualCouponDiscount = Math.min(Number(coupon.value || 0), Math.max(0, finalPrice));
      finalPrice -= actualCouponDiscount;
    }
    
    this.setData({
      finalPrice: Math.max(0, Math.round(finalPrice * 100) / 100),
      actualDiscount: useRunDiscount ? actualDiscount : 0,
      actualCouponDiscount: useCoupon ? actualCouponDiscount : 0
    });
  },

  onTypeChange(e: any) {
    this.setData({ type: e.detail.value }, () => {
      this.calculatePrice();
    });
  },

  onPhoneInput(e: any) {
    this.setData({ phone: e.detail.value })
  },

  onAddressInput(e: any) {
    this.setData({ address: e.detail.value })
  },

  onPickupTimeChange(e: any) {
    this.setData({ pickupTime: e.detail.value })
  },

  onRemarkInput(e: any) {
    this.setData({ remark: e.detail.value })
  },

  async submitOrder() {
    const {
      shop,
      items,
      coupon,
      useCoupon,
      useRunDiscount,
      finalPrice,
      type,
      phone,
      address,
      pickupTime,
      remark,
      submitting,
      isLoggedIn
    } = this.data
    
    if (submitting) return

    if (!isLoggedIn) {
      wx.showModal({
        title: '请先登录',
        content: '提交订单需要登录，是否立即登录？',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            this.goToLogin()
          }
        }
      })
      return
    }

    if (!phone) {
      wx.showToast({ title: '请输入联系电话', icon: 'none' })
      return
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的11位手机号', icon: 'none' })
      return
    }
    if (type === 'delivery' && !address) {
      wx.showToast({ title: '请输入配送地址', icon: 'none' })
      return
    }
    if (type === 'pickup' && !pickupTime) {
      wx.showToast({ title: '请选择取餐时间', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    try {
      const res = await callFoodFunction('createOrder', {
        shopId: shop._id,
        items,
        totalPrice: finalPrice,
        type,
        phone,
        address,
        pickupTime,
        remark,
        useRunDiscount,
        couponId: (useCoupon && coupon) ? coupon._id : null
      }, { showLoading: true, loadingTitle: '提交中' })

      wx.removeStorageSync('current_order')
      
      wx.showModal({
        title: '下单成功',
        content: type === 'pickup' ? `取餐码: ${res.pickupCode}` : '请等待商家配送',
        showCancel: false,
        success: () => {
          wx.redirectTo({
            url: '/packageFood/pages/order_list/order_list'
          })
        }
      })
    } catch (err: any) {
      wx.showToast({ title: err.message || '下单失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
}))
