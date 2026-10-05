import { withSharing } from '../../../utils/page-share'
import { callFoodFunction } from '../../utils/food-cloud'

Page(withSharing({
  data: {
    orderId: '',
    order: null as any,
    loading: true
  },

  onLoad(options: any) {
    const app = getApp()
    if (!app.isLoggedIn()) {
      const redirect = options.id
        ? '/packageFood/pages/order_detail/order_detail?id=' + encodeURIComponent(options.id)
        : '/packageFood/pages/order_list/order_list'
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent(redirect)
      })
      return
    }
    if (options.id) {
      this.setData({ orderId: options.id })
      this.loadOrderDetail(options.id)
    } else {
      wx.showToast({ title: '订单参数缺失', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
    }
  },

  async loadOrderDetail(orderId: string) {
    try {
      const res = await callFoodFunction('getOrderDetail', { orderId }, { showLoading: true, loadingTitle: '加载中' })
      this.setData({
        order: res.detail,
        loading: false
      })
    } catch (err: any) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  cancelOrder() {
    wx.showModal({
      title: '取消订单',
      content: '确定要取消该订单吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await callFoodFunction('updateOrderStatus', { orderId: this.data.orderId, status: 'cancelled' }, { showLoading: true, loadingTitle: '取消中' })
            wx.showToast({ title: '已取消', icon: 'success' })
            this.loadOrderDetail(this.data.orderId)
          } catch (err: any) {
            wx.showToast({ title: err.message || '取消失败', icon: 'none' })
          }
        }
      }
    })
  }
}))
