import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
import { callCanteen, mealOptions, mealSelection, mealIndex } from '../../utils/api'

function emptyStall() { return { id: '', name: '', location: '', description: '', image: '', status: 'draft' } }
function emptyDish() { return { id: '', stallId: '', name: '', price: '', description: '', image: '', status: 'draft' } }

Page(withSharing({
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.load()) },
  data: {
    stalls: [] as any[], dishes: [] as any[], reviews: [] as any[],
    submissions: [] as any[], reports: [] as any[], photos: [] as any[], disputes: [] as any[],
    mealOptions, dishMealIndex: 1,
    tab: 'stalls', stallForm: emptyStall(), dishForm: emptyDish(),
    stallIndex: 0, uploading: false, saving: false, loading: true
  },
  onLoad(options: any) {
    if (['stalls', 'dishes', 'reviews', 'submissions', 'reports', 'photos', 'disputes'].includes(options.tab)) this.setData({ tab: options.tab })
    this.load()
  },
  async load() {
    this.setData({ loading: true })
    try {
      await callCanteen('init')
      const result = await callCanteen('adminCatalog')
      const reasons: any = { inaccurate: '信息不准确', spam: '广告或重复内容', inappropriate: '不适当内容' }
      this.setData({ stalls: result.stalls || [], dishes: result.dishes || [], reviews: result.reviews || [], photos: result.photos || [], disputes: result.disputes || [], submissions: result.submissions || [], reports: (result.reports || []).map((row: any) => ({ ...row, reasonsText: [...new Set((row.reasons || []).map((reason: string) => reasons[reason] || reason))].join('、') })), loading: false })
      return true
    } catch (error: any) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '加载失败', icon: 'none' })
      return false
    }
  },
  switchTab(e: any) { this.setData({ tab: e.currentTarget.dataset.tab }) },
  chooseMeal(e: any) { if (!this.data.saving) this.setData({ dishMealIndex: Number(e.detail.value) }) },
  previewPhoto(e: any) { wx.previewImage({ urls: [e.currentTarget.dataset.image] }) },
  async setCover(e: any) {
    if (this.data.saving) return
    this.setData({ saving: true })
    try { await callCanteen('setStallCover', { id: e.currentTarget.dataset.id }); wx.showToast({ title: '封面已更新', icon: 'success' }); await this.load() }
    catch (error: any) { wx.showToast({ title: error.message || '设置失败', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  },
  async resolveDispute(e: any) {
    if (this.data.saving) return
    const { id, resolution } = e.currentTarget.dataset
    this.setData({ saving: true })
    try {
      const confirmed = await new Promise<any>((resolve, reject) => wx.showModal({ title: resolution === 'restore' ? '核实后恢复评分？' : '确认排除这条评分？', content: '请先核对内容，处理只影响这条评论对应的评分，不会恢复已删除的评论。', success: resolve, fail: reject }))
      if (!confirmed.confirm) return
      await callCanteen('resolveDispute', { id, resolution }); await this.load()
    } catch (error: any) { wx.showToast({ title: error.message || '处理失败', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  },
  openReportTarget(e: any) { wx.navigateTo({ url: '/packageCanteen/pages/dish/dish?id=' + encodeURIComponent(e.currentTarget.dataset.id) }) },
  resolveReport(e: any) {
    if (this.data.saving) return
    const { id, resolution } = e.currentTarget.dataset
    wx.showModal({ title: resolution === 'hide' ? '核实后下架内容？' : '标记内容无误？', content: '请先核对举报涉及的菜品或评价，再完成处理。', success: async result => {
      if (!result.confirm) return
      this.setData({ saving: true })
      try { await callCanteen('resolveReport', { id, resolution }); await this.load() }
      catch (error: any) { wx.showToast({ title: error.message || '处理失败', icon: 'none' }) }
      finally { this.setData({ saving: false }) }
    } })
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  moderate(e: any) {
    if (this.data.saving) return
    const { id, status } = e.currentTarget.dataset
    wx.showModal({ title: status === 'approved' ? '发布这份发现？' : '退回这份投稿？', content: status === 'approved' ? '通过后会新增档口或菜品，供同学评分。' : '投稿不会公开，学生可以看到退回状态。', success: async res => {
      if (!res.confirm) return
      this.setData({ saving: true })
      try { await callCanteen('moderateSubmission', { id, status }); wx.showToast({ title: '已处理', icon: 'success' }); await this.load() }
      catch (error: any) { wx.showToast({ title: error.message || '审核失败', icon: 'none' }) }
      finally { this.setData({ saving: false }) }
    } })
  },
  stallInput(e: any) { this.setData({ ['stallForm.' + e.currentTarget.dataset.field]: e.detail.value }) },
  dishInput(e: any) { this.setData({ ['dishForm.' + e.currentTarget.dataset.field]: e.detail.value }) },
  stallStatus(e: any) { this.setData({ 'stallForm.status': e.detail.value ? 'published' : 'draft' }) },
  dishStatus(e: any) { this.setData({ 'dishForm.status': e.detail.value ? 'published' : 'draft' }) },
  chooseStall(e: any) {
    const index = Number(e.detail.value)
    this.setData({ stallIndex: index, 'dishForm.stallId': this.data.stalls[index]._id })
  },
  editStall(e: any) {
    const row = this.data.stalls.find((item: any) => item._id === e.currentTarget.dataset.id)
    if (row) this.setData({ tab: 'stalls', stallForm: { id: row._id, name: row.name, location: row.location, description: row.description || '', image: row.image || '', status: row.status } })
  },
  editDish(e: any) {
    const row = this.data.dishes.find((item: any) => item._id === e.currentTarget.dataset.id)
    if (!row) return
    const stallIndex = Math.max(0, this.data.stalls.findIndex((stall: any) => stall._id === row.stallId))
    this.setData({ tab: 'dishes', stallIndex, dishMealIndex: mealIndex(row.meals), dishForm: { id: row._id, stallId: row.stallId,
      name: row.name, price: row.price == null ? '' : String(row.price),
      description: row.description || '', image: row.image || '', status: row.status } })
  },
  resetStall() { this.setData({ stallForm: emptyStall() }) },
  resetDish() { this.setData({ dishForm: emptyDish(), stallIndex: 0, dishMealIndex: 1 }) },
  chooseImage(e: any) {
    const type = e.currentTarget.dataset.type
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], success: async (result: any) => {
      this.setData({ uploading: true })
      try {
        const file = result.tempFiles[0]
        const suffix = String(file.tempFilePath).toLowerCase().match(/\.(png|jpe?g|webp)(?:\?|$)/)
        const extension = suffix ? (suffix[1] === 'jpeg' ? 'jpg' : suffix[1]) : 'jpg'
        const upload = await api.uploadFile({
          cloudPath: 'canteen-reviews/' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + extension,
          filePath: file.tempFilePath
        })
        this.setData({ [type + 'Form.image']: upload.fileID })
        wx.showToast({ title: '照片已上传', icon: 'success' })
      } catch (error: any) { wx.showToast({ title: error.message || '上传失败', icon: 'none' }) }
      finally { this.setData({ uploading: false }) }
    } })
  },
  async saveStall() {
    if (this.data.saving || this.data.uploading) return
    this.setData({ saving: true })
    try {
      await callCanteen('saveStall', this.data.stallForm)
      wx.showToast({ title: '档口已保存', icon: 'success' })
      this.resetStall()
      await this.load()
    } catch (error: any) { wx.showToast({ title: error.message || '保存失败', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  },
  async saveDish() {
    if (this.data.saving || this.data.uploading) return
    this.setData({ saving: true })
    try {
      const form = { ...this.data.dishForm, meals: mealSelection(this.data.dishMealIndex) }
      if (!form.stallId && this.data.stalls.length) form.stallId = this.data.stalls[this.data.stallIndex]._id
      await callCanteen('saveDish', form)
      wx.showToast({ title: '菜品已保存', icon: 'success' })
      this.resetDish()
      await this.load()
    } catch (error: any) { wx.showToast({ title: error.message || '保存失败', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  },
  hideReview(e: any) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '隐藏评价', content: '隐藏后这条评价不参与评分和排行。', success: async (result) => {
      if (!result.confirm) return
      try { await callCanteen('hideReview', { id }); await this.load() }
      catch (error: any) { wx.showToast({ title: error.message || '操作失败', icon: 'none' }) }
    } })
  }
}))
