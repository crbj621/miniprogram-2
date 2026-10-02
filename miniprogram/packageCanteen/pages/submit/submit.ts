import { api } from '../../../utils/api-client'
import { callCanteen } from '../../utils/api'
Page({
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.load()) },
  data: {
    stalls: [] as any[], submissions: [] as any[], stallIndex: 0,
    stallNames: ['新增一个档口'], clientId: '', uploading: false, saving: false, loading: false,
    form: { stallId: '', stallName: '', location: '', dishName: '', price: '', description: '', image: '' }
  },
  onLoad() { this.setData({ clientId: Date.now() + '-' + Math.random().toString(36).slice(2) }) },
  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    this.setData({ loading: true, submissions: [] })
    try {
      const catalog = await callCanteen('list')
      this.setData({ stalls: catalog.stalls || [], stallNames: ['新增一个档口', ...(catalog.stalls || []).map((row: any) => row.name)] })
      if (getApp().isLoggedIn()) {
        const mine = await callCanteen('mySubmissions')
        this.setData({ submissions: mine.submissions || [] })
      }
      return true
    } catch (error: any) { wx.showToast({ title: error.message || '读取失败', icon: 'none' })
      return false }
    finally { this.setData({ loading: false }) }
  },
  input(e: any) { this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value }) },
  chooseStall(e: any) {
    const index = Number(e.detail.value)
    this.setData({ stallIndex: index, 'form.stallId': index ? this.data.stalls[index - 1]._id : '' })
  },
  chooseImage() {
    if (this.data.uploading || this.data.saving) return
    if (!getApp().isLoggedIn()) { wx.navigateTo({ url: '/pages/login/login?forceLogin=true' }); return }
    wx.chooseMedia({ count: 1, mediaType: ['image'], success: async (res: any) => {
      this.setData({ uploading: true })
      try {
        const filePath = res.tempFiles[0].tempFilePath
        const extension = filePath.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] || 'jpg'
        const result = await api.uploadFile({ cloudPath: 'canteen-submissions/' + this.data.clientId + '.' + extension, filePath })
        this.setData({ 'form.image': result.fileID })
        wx.showToast({ title: '照片准备好了', icon: 'success' })
      } catch (error: any) { wx.showToast({ title: error.message || '上传失败', icon: 'none' }) }
      finally { this.setData({ uploading: false }) }
    } })
  },
  async submit() {
    if (this.data.saving || this.data.uploading) return
    if (!getApp().isLoggedIn()) { wx.navigateTo({ url: '/pages/login/login?forceLogin=true' }); return }
    this.setData({ saving: true })
    try {
      const result = await callCanteen('submit', { ...this.data.form, clientId: this.data.clientId })
      wx.showToast({ title: result.msg || '投稿已收到', icon: 'none' })
      this.setData({ clientId: Date.now() + '-' + Math.random().toString(36).slice(2), stallIndex: 0,
        form: { stallId: '', stallName: '', location: '', dishName: '', price: '', description: '', image: '' } })
      await this.load()
    } catch (error: any) { wx.showToast({ title: error.message || '提交失败', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  }
})
