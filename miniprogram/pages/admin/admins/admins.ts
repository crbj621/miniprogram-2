import { api } from '../../../utils/api-client'
Page({
  data: {
    loading: true,
    list: [] as any[],

    showModal: false,
    submitting: false,
    form: {
      account: '',
      username: '',
      password: ''
    }
  },

  preventTouchMove() {},

  onLoad() {
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'getAdminList', data: {} }
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
    this.setData({ showModal: true, form: { account: '', username: '', password: '' } })
  },

  closeModal() {
    this.setData({ showModal: false, submitting: false })
  },

  onInput(e: any) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  async submit() {
    if (this.data.submitting) return
    const { account, username, password } = this.data.form
    if (!account || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'createAdmin', data: { account, username, password, role: 'normal' } }
      }) as any

      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '创建成功', icon: 'success' })
        this.closeModal()
        this.load()
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '创建失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '创建失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  toggleStatus(e: any) {
    const item = e.currentTarget.dataset.item
    if (!item || item.role === 'super') {
      wx.showToast({ title: '超级管理员不可禁用', icon: 'none' })
      return
    }
    const next = item.status === 'disabled' ? 'active' : 'disabled'
    wx.showModal({
      title: next === 'disabled' ? '禁用管理员' : '启用管理员',
      content: `确定要${next === 'disabled' ? '禁用' : '启用'}「${item.account}」吗？`,
      success: async (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中...' })
        try {
          const res = await api.call({
            name: 'globalAdmin',
            data: { action: 'updateAdmin', data: { id: item._id, status: next } }
          }) as any
          wx.hideLoading()
          if (res.result && res.result.code === 0) {
            wx.showToast({ title: '已更新', icon: 'success' })
            this.load()
          } else {
            wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '操作失败', icon: 'none' })
          }
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
      }
    })
  },

  resetPwd(e: any) {
    const item = e.currentTarget.dataset.item
    wx.showModal({
      title: '重置密码',
      content: '请输入新密码',
      editable: true,
      placeholderText: '8至128位',
      success: async (r) => {
        if (!r.confirm) return
        const pwd = (r.content || '').trim()
        if (pwd.length < 8 || pwd.length > 128) {
          wx.showToast({ title: '密码应为8至128位', icon: 'none' })
          return
        }
        wx.showLoading({ title: '重置中...' })
        try {
          const res = await api.call({
            name: 'globalAdmin',
            data: { action: 'resetAdminPassword', data: { id: item._id, newPassword: pwd } }
          }) as any
          wx.hideLoading()
          if (res.result && res.result.code === 0) {
            wx.showToast({ title: '密码已重置', icon: 'success' })
          } else {
            wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '重置失败', icon: 'none' })
          }
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '重置失败', icon: 'none' })
        }
      }
    })
  },

  remove(e: any) {
    const item = e.currentTarget.dataset.item
    if (!item || item.role === 'super') return
    wx.showModal({
      title: '删除管理员',
      content: `确定要删除「${item.account}」吗？`,
      success: async (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '删除中...' })
        try {
          const res = await api.call({
            name: 'globalAdmin',
            data: { action: 'deleteAdmin', data: { id: item._id } }
          }) as any
          wx.hideLoading()
          if (res.result && res.result.code === 0) {
            wx.showToast({ title: '已删除', icon: 'success' })
            this.load()
          } else {
            wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '删除失败', icon: 'none' })
          }
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  }
})
