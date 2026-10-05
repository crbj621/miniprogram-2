import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
import { callCanteen, newCanteenId, mealOptions, mealSelection, mealIndex } from '../../utils/api'

function emptyForm() { return { stallId: '', stallName: '', location: '', dishName: '', price: '', description: '', image: '' } }
Page(withSharing({
  refreshPage() { return this.selectComponent('#page-refresh').refresh(() => this.load()) },
  data: {
    stalls: [] as any[], submissions: [] as any[], stallIndex: 0, stallNames: ['新增一个档口'],
    kind: 'dish', editingId: '', mealIndex: 1, mealOptions, form: emptyForm(),
    uploading: false, saving: false, deleting: '', loading: false, checking: false,
    match: null as any, candidates: [] as any[], checkMessage: ''
  },
  disposed: false, loadVersion: 0, checkVersion: 0, owner: '', preferredStallId: '', pendingPost: null as any,
  onLoad(options: any) {
    this.preferredStallId = options.stallId || ''
    if (['dish', 'stall', 'photo'].includes(options.kind)) this.setData({ kind: options.kind })
  },
  onShow() {
    const owner = wx.getStorageSync('openid') || ''
    if (this.owner !== owner) { this.owner = owner; this.pendingPost = null; this.checkVersion += 1; this.setData({ editingId: '', form: emptyForm(), submissions: [], match: null, candidates: [], checkMessage: '' }) }
    this.load()
  },
  onUnload() { this.disposed = true; this.loadVersion += 1; this.checkVersion += 1 },
  current(owner: string) { return !this.disposed && owner === (wx.getStorageSync('openid') || '') },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    const version = ++this.loadVersion, owner = wx.getStorageSync('openid') || ''
    this.setData({ loading: true })
    try {
      const catalog = await callCanteen('list')
      if (!this.current(owner) || version !== this.loadVersion) return false
      const stalls = catalog.stalls || [], stallId = this.data.form.stallId || this.preferredStallId
      const index = stalls.findIndex((row: any) => row._id === stallId)
      this.preferredStallId = ''
      this.setData({ stalls, stallNames: ['新增一个档口', ...stalls.map((row: any) => row.name + ' · ' + row.location)],
        stallIndex: index + 1, 'form.stallId': index >= 0 ? stallId : '' })
      if (getApp().isLoggedIn()) {
        const mine = await callCanteen('mySubmissions')
        if (!this.current(owner) || version !== this.loadVersion) return false
        this.setData({ submissions: mine.submissions || [] })
      } else this.setData({ submissions: [] })
      return true
    } catch (error: any) { if (this.current(owner) && version === this.loadVersion) wx.showToast({ title: error.message || '读取失败', icon: 'none' }); return false }
    finally { if (this.current(owner) && version === this.loadVersion) this.setData({ loading: false }) }
  },
  input(e: any) {
    if (this.data.saving || this.data.deleting) return
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
    if (['stallName', 'location'].includes(field)) { this.checkVersion += 1; this.setData({ match: null, candidates: [], checkMessage: '', checking: false }) }
  },
  switchKind(e: any) {
    const kind = e.currentTarget.dataset.kind
    if (this.data.saving || this.data.uploading || this.data.deleting || this.data.editingId || !['dish', 'stall', 'photo'].includes(kind)) return
    this.checkVersion += 1; this.pendingPost = null
    this.setData({ kind, form: { ...emptyForm(), stallId: this.data.form.stallId }, match: null, candidates: [], checkMessage: '', checking: false })
  },
  chooseMeal(e: any) { if (!this.data.saving) this.setData({ mealIndex: Number(e.detail.value) }) },
  chooseStall(e: any) {
    if (this.data.editingId || this.data.saving || this.data.uploading) return
    const index = Number(e.detail.value)
    if (!Number.isInteger(index) || index < 0 || index > this.data.stalls.length) return
    this.checkVersion += 1
    this.setData({ stallIndex: index, 'form.stallId': index ? this.data.stalls[index - 1]._id : '', match: null, candidates: [], checkMessage: '', checking: false })
  },
  useStall(e: any) {
    const index = this.data.stalls.findIndex(row => row._id === e.currentTarget.dataset.id)
    if (index >= 0) this.chooseStall({ detail: { value: index + 1 } })
  },
  async checkStall() {
    if (this.data.form.stallId || this.data.editingId || !this.data.form.stallName.trim() || !this.data.form.location.trim()) return
    const version = ++this.checkVersion, owner = wx.getStorageSync('openid') || ''
    const fields = { stallName: this.data.form.stallName, location: this.data.form.location }
    this.setData({ checking: true })
    try {
      const result = await callCanteen('checkStall', fields)
      if (!this.current(owner) || version !== this.checkVersion) return
      this.setData({ match: result.stall || null, candidates: result.candidates || [],
        checkMessage: result.exists ? (result.stall.available ? '已有这个档口，会归入已有档口，不会重复新建。' : '已有这个档口但暂未开放，请联系管理员。') : '未发现同名同位置档口。提交时服务器会再次查重。' })
    } catch (error: any) { if (this.current(owner) && version === this.checkVersion) this.setData({ checkMessage: error.message || '暂时无法查重，提交时仍会检查' }) }
    finally { if (this.current(owner) && version === this.checkVersion) this.setData({ checking: false }) }
  },
  requireLogin() {
    if (getApp().isLoggedIn()) return true
    wx.navigateTo({ url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent('/packageCanteen/pages/submit/submit') })
    return false
  },
  async chooseImage() {
    if (this.data.uploading || this.data.saving || this.data.deleting || !this.requireLogin()) return
    const owner = wx.getStorageSync('openid') || ''
    this.setData({ uploading: true })
    try {
      const res = await new Promise<any>((resolve, reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: resolve, fail: reject }))
      if (!this.current(owner)) return
      const filePath = res.tempFiles[0].tempFilePath, suffix = filePath.match(/\.(jpg|jpeg|png|webp)$/i)
      const result = await api.uploadFile({ cloudPath: 'canteen-submissions/' + newCanteenId() + '.' + (suffix ? suffix[1] : 'jpg'), filePath })
      if (this.current(owner)) this.setData({ 'form.image': result.fileID })
    } catch (error: any) { if (this.current(owner) && !/cancel/i.test(error.errMsg || error.message || '')) wx.showToast({ title: error.message || '上传失败', icon: 'none' }) }
    finally { if (!this.disposed) this.setData({ uploading: false }) }
  },
  editSubmission(e: any) {
    if (this.data.saving || this.data.uploading || this.data.deleting) return
    const row = this.data.submissions.find(item => item._id === e.currentTarget.dataset.id && item.status === 'approved')
    if (!row) return
    const index = this.data.stalls.findIndex(stall => stall._id === row.stallId)
    if (index < 0) { wx.showToast({ title: '档口暂未开放，请联系管理员', icon: 'none' }); return }
    this.pendingPost = null; this.checkVersion += 1
    this.setData({ editingId: row._id, kind: row.kind || 'dish', stallIndex: index + 1, mealIndex: mealIndex(row.meals),
      form: { stallId: row.stallId, stallName: row.stallName || '', location: row.location || '', dishName: row.dishName || '',
        price: row.price == null ? '' : String(row.price), description: row.description || '', image: row.image || '' }, match: null, candidates: [], checkMessage: '' })
    this.selectComponent('#page-refresh').scrollTo('canteen-form-start')
  },
  cancelEdit() { if (!this.data.saving && !this.data.uploading) { this.pendingPost = null; this.setData({ editingId: '', form: emptyForm(), stallIndex: 0 }) } },
  async deleteSubmission(e: any) {
    const id = e.currentTarget.dataset.id
    if (this.data.saving || this.data.uploading || this.data.deleting || !this.data.submissions.some(row => row._id === id) || !this.requireLogin()) return
    const owner = wx.getStorageSync('openid') || ''
    this.setData({ deleting: id })
    try {
      const result = await new Promise<any>((resolve, reject) => wx.showModal({ title: '删除我的投稿', content: '删除你的说明和照片。已有其他同学投稿、评论或评分的档口／菜品会保留。', confirmText: '删除', success: resolve, fail: reject }))
      if (!result.confirm || !this.current(owner)) return
      await callCanteen('deleteSubmission', { id })
      if (!this.current(owner)) return
      this.loadVersion += 1
      this.setData({ submissions: this.data.submissions.filter(row => row._id !== id) })
      if (this.data.editingId === id) this.cancelEdit()
      wx.showToast({ title: '投稿已删除', icon: 'success' })
      await this.load()
    } catch (error: any) { if (this.current(owner)) wx.showToast({ title: error.message || '删除失败', icon: 'none' }) }
    finally { if (!this.disposed) this.setData({ deleting: '' }) }
  },
  async submit() {
    if (this.data.saving || this.data.uploading || this.data.deleting || !this.requireLogin()) return
    const owner = wx.getStorageSync('openid') || ''
    const post = { ...this.data.form, kind: this.data.kind, meals: mealSelection(this.data.mealIndex) }, fingerprint = JSON.stringify(post)
    if (!this.pendingPost || this.pendingPost.fingerprint !== fingerprint) this.pendingPost = { fingerprint, clientId: newCanteenId() }
    const editingId = this.data.editingId
    this.setData({ saving: true })
    try {
      const result = await callCanteen(editingId ? 'updateSubmission' : 'submit', editingId ? { ...post, id: editingId } : { ...post, clientId: this.pendingPost.clientId })
      if (!this.current(owner)) return
      this.pendingPost = null
      wx.showToast({ title: result.msg || '投稿已保存', icon: 'none' })
      this.setData({ editingId: '', stallIndex: 0, form: emptyForm(), match: null, candidates: [], checkMessage: '' })
      await this.load()
    } catch (error: any) { if (this.current(owner)) wx.showToast({ title: error.message || '提交失败', icon: 'none' }) }
    finally { if (!this.disposed) this.setData({ saving: false }) }
  }
}))
