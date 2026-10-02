import { api } from '../../../utils/api-client'
Page({
  data: {
    shopId: '',
    shopInfo: null as any,
    form: {
      name: '',
      status: 'open',
      notice: '',
      minPrice: '',
      deliveryFee: '',
      supportDelivery: true
    },
    loading: false,
    uploadingLogo: false
  },

  onLoad() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageFood/pages/shop_settings/shop_settings')
      })
      return
    }
    const shopId = wx.getStorageSync('food_shop_id')
    if (!shopId) {
      wx.redirectTo({ url: '/packageFood/pages/shop_login/shop_login' })
      return
    }
    this.setData({ shopId })
    this.loadShopInfo()
  },

  formatTime(value: any) {
    if (!value) return ''
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value)
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return y + '-' + m + '-' + d
  },

  async loadShopInfo() {
    try {
      const res = await api.call({
        name: 'food_manager',
        data: {
          action: 'getShopDetail',
          data: { shopId: this.data.shopId }
        }
      }) as any

      if (res.result.success) {
        const shop = res.result.shop
        this.setData({
          shopInfo: {
            ...shop,
            createTimeText: this.formatTime(shop.createTime)
          },
          form: {
            name: shop.name || '',
            status: shop.status || 'open',
            notice: shop.notice || '',
            minPrice: String(shop.minPrice || 0),
            deliveryFee: String(shop.deliveryFee || 0),
            supportDelivery: shop.supportDelivery !== false
          }
        })
      }
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onInputChange(e: any) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onStatusChange(e: any) {
    this.setData({ 'form.status': e.detail.value ? 'open' : 'closed' })
  },

  onDeliveryChange(e: any) {
    this.setData({ 'form.supportDelivery': e.detail.value })
  },

  chooseLogo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        this.setData({ uploadingLogo: true })

        try {
          const cloudPath = 'shops/logo_' + Date.now() + '.jpg'
          const uploadRes = await api.uploadFile({
            cloudPath: cloudPath,
            filePath: tempFilePath
          })
          
          await api.call({
            name: 'food_manager',
            data: {
              action: 'updateShopLogo',
              data: {
                shopId: this.data.shopId,
                logo: uploadRes.fileID
              }
            }
          })
          
          this.setData({
            'shopInfo.logo': uploadRes.fileID,
            uploadingLogo: false
          })
          wx.showToast({ title: '上传成功', icon: 'success' })
        } catch (err) {
          this.setData({ uploadingLogo: false })
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  },

  async saveSettings() {
    const { form, shopId, loading } = this.data
    
    if (loading) return
    
    this.setData({ loading: true })

    try {
      const res = await api.call({
        name: 'food_manager',
        data: {
          action: 'updateShopInfo',
          data: {
            shopId: shopId,
            shopData: {
              name: form.name,
              status: form.status,
              notice: form.notice,
              minPrice: Number(form.minPrice || 0),
              deliveryFee: Number(form.deliveryFee || 0),
              supportDelivery: form.supportDelivery
            }
          }
        }
      }) as any

      this.setData({ loading: false })
      
      if (res.result.success) {
        wx.showToast({ title: '保存成功', icon: 'success' })
        this.loadShopInfo()
      } else {
        wx.showToast({ title: res.result.msg || '保存失败', icon: 'none' })
      }
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  }
})
