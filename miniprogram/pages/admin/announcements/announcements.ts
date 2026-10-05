import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    loading: true,
    list: [] as any[],
    status: 'published',

    showModal: false,
    submitting: false,
    editingId: '',
    form: {
      title: '',
      content: '',
      status: 'published'
    },
    statusOptions: [
      { key: 'published', name: '已发布' },
      { key: 'draft', name: '草稿' }
    ],
    statusIndex: 0
  },

  preventTouchMove() {},

  onLoad() {
    this.load()
  },

  switchStatus(e: any) {
    const status = e.currentTarget.dataset.status
    this.setData({ status, loading: true }, () => this.load())
  },

  async load() {
    this.setData({ loading: true })
    try {
      const query: any = { page: 1, pageSize: 50 }
      if (this.data.status !== 'all') query.status = this.data.status
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'getAnnouncementList', data: query }
      }) as any

      if (res.result && res.result.code === 0) {
        this.setData({ list: (res.result.data && res.result.data.list) ? res.result.data.list : [] })
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '加载失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  openCreate() {
    this.setData({
      showModal: true,
      editingId: '',
      form: { title: '', content: '', status: 'published' },
      statusIndex: 0
    })
  },

  edit(e: any) {
    const item = e.currentTarget.dataset.item
    const statusIndex = item.status === 'draft' ? 1 : 0
    this.setData({
      showModal: true,
      editingId: item._id,
      form: { title: item.title || '', content: item.content || '', status: item.status || 'published' },
      statusIndex
    })
  },

  closeModal() {
    this.setData({ showModal: false, submitting: false })
  },

  onInput(e: any) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  onStatusPicker(e: any) {
    const idx = Number(e.detail.value || 0)
    this.setData({ statusIndex: idx, 'form.status': this.data.statusOptions[idx].key })
  },

  async submit() {
    if (this.data.submitting) return
    const { title, content, status } = this.data.form
    if (!title || !content) {
      wx.showToast({ title: '请填写标题和内容', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      const action = this.data.editingId ? 'updateAnnouncement' : 'createAnnouncement'
      const payload: any = { title, content, status }
      if (this.data.editingId) payload.id = this.data.editingId
      const res = await api.call({
        name: 'globalAdmin',
        data: { action, data: payload }
      }) as any

      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '保存成功', icon: 'success' })
        this.closeModal()
        this.load()
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '保存失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  remove(e: any) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除公告',
      content: '确定要删除该公告吗？',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        try {
          const r = await api.call({
            name: 'globalAdmin',
            data: { action: 'deleteAnnouncement', data: { id } }
          }) as any
          wx.hideLoading()
          if (r.result && r.result.code === 0) {
            wx.showToast({ title: '已删除', icon: 'success' })
            this.load()
          } else {
            wx.showToast({ title: (r.result && r.result.message) ? r.result.message : '删除失败', icon: 'none' })
          }
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  }
}))
