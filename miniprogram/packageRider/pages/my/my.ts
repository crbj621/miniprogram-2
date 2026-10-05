import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    loading: false,
    status: 'all',
    list: [] as any[]
  },

  onShow() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageRider/pages/my/my')
      })
      return
    }
    this.load()
  },

  switchTab(e: any) {
    const status = e.currentTarget.dataset.status
    this.setData({ status }, () => this.load())
  },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await api.call({
        name: 'rider',
        data: { action: 'listMyOrders', data: { status: this.data.status } }
      }) as any

      if (res.result && res.result.code === 0) {
        const rawList = (res.result.data && res.result.data.list) ? res.result.data.list : []
        const list = rawList.map((item: any) => {
          const nextDeliveryStatus = this.nextAction(item.deliveryStatus)
          return {
            ...item,
            deliveryStatusText: this.formatState(item.deliveryStatus),
            nextDeliveryStatus,
            nextActionLabel: this.nextActionText(item.deliveryStatus)
          }
        })
        this.setData({ list })
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '加载失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  formatState(status: string) {
    const map: any = { accepted: '已接单', picking: '取餐中', delivering: '配送中', delivered: '已送达' }
    return map[status] || status || '已接单'
  },

  nextAction(status: string) {
    if (!status || status === 'accepted') return 'picking'
    if (status === 'picking') return 'delivering'
    if (status === 'delivering') return 'delivered'
    return ''
  },

  nextActionText(status: string) {
    const next = this.nextAction(status)
    const map: any = { picking: '开始取餐', delivering: '开始配送', delivered: '确认送达' }
    return map[next] || ''
  },

  async nextStep(e: any) {
    const id = e.currentTarget.dataset.id
    const next = e.currentTarget.dataset.next
    if (!id || !next) return

    if (next === 'delivered') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        camera: 'back',
        success: (res) => {
          const tempFilePath = res.tempFiles[0].tempFilePath
          wx.showLoading({ title: '上传照片中...' })
          
          const match = tempFilePath.match(/\.[^.]+?$/)
          const ext = (match && match[0]) ? match[0] : '.jpg'
          const cloudPath = `delivery/${id}_${Date.now()}${ext}`
          api.uploadFile({
            cloudPath,
            filePath: tempFilePath,
            success: (uploadRes) => {
              this.submitStatusUpdate(id, next, uploadRes.fileID)
            },
            fail: () => {
              wx.hideLoading()
              wx.showToast({ title: '照片上传失败', icon: 'none' })
            }
          })
        },
        fail: () => {
          wx.showToast({ title: '请先拍照证明已送达', icon: 'none' })
        }
      })
      return
    }

    const textMap: any = { picking: '开始取餐', delivering: '开始配送', delivered: '确认已送达' }
    wx.showModal({
      title: '确认操作',
      content: `确定要执行「${textMap[next] || next}」吗？`,
      success: async (res) => {
        if (!res.confirm) return
        this.submitStatusUpdate(id, next)
      }
    })
  },

  async submitStatusUpdate(id: string, next: string, photoFileId?: string) {
    wx.showLoading({ title: '提交中...' })
    try {
      const r = await api.call({
        name: 'rider',
        data: { 
          action: 'updateDeliveryStatus', 
          data: { orderId: id, deliveryStatus: next, photoFileId } 
        }
      }) as any

      wx.hideLoading()
      if (r.result && r.result.code === 0) {
        wx.showToast({ title: '已更新', icon: 'success' })
        this.load()
      } else {
        wx.showToast({ title: (r.result && r.result.message) ? r.result.message : '操作失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  }
}))
