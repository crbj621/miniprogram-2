const { api } = require('../../../utils/api-client')
const emptyForm = () => ({ name: '', price: '', category: '默认分类', description: '', stock: '999', isAvailable: true, image: '' })
Page({
  data: { shops: [], shopIndex: 0, shopId: '', menus: [], loading: false, saving: false, uploading: false,
    showAddModal: false, editingId: '', formData: emptyForm() },
  refreshPage() { return this.selectComponent('#page-refresh').refresh(() => this.loadMenus()) },
  async onLoad() {
    try {
      const res = await api.call({ name: 'globalAdmin', data: { action: 'getShopManageList', data: {} } })
      if (!res.result || res.result.code !== 0) throw new Error(res.result && res.result.message || '读取店铺失败')
      const shops = res.result.data.list || []
      this.setData({ shops, shopId: shops[0] && shops[0]._id || '' })
      await this.loadMenus()
    } catch (error) { wx.showToast({ title: error.message || '读取失败', icon: 'none' }) }
  },
  chooseShop(e) {
    const shopIndex = Number(e.detail.value), shop = this.data.shops[shopIndex]
    if (!shop || this.data.saving) return
    this.setData({ shopIndex, shopId: shop._id, menus: [], showAddModal: false })
    this.loadMenus()
  },
  async loadMenus() {
    if (!this.data.shopId) return true
    const requestId = this.requestId = (this.requestId || 0) + 1
    this.setData({ loading: true })
    try {
      const res = await api.call({ name: 'globalAdmin', data: { action: 'getShopDishes', data: { shopId: this.data.shopId } } })
      if (requestId !== this.requestId) return false
      if (!res.result || res.result.code !== 0) throw new Error(res.result && res.result.message || '读取失败')
      this.setData({ menus: res.result.data.dishes || [] }); return true
    } catch (error) {
      if (requestId === this.requestId) wx.showToast({ title: error.message || '读取失败', icon: 'none' })
      return false
    } finally { if (requestId === this.requestId) this.setData({ loading: false }) }
  },
  showAddModal() { if (this.data.shopId) this.setData({ showAddModal: true, editingId: '', formData: emptyForm() }) },
  hideModal() { if (!this.data.saving && !this.data.uploading) this.setData({ showAddModal: false }) },
  onInputChange(e) { this.setData({ ['formData.' + e.currentTarget.dataset.field]: e.detail.value }) },
  onSwitchChange(e) { this.setData({ 'formData.isAvailable': e.detail.value }) },
  editMenu(e) {
    const row = e.currentTarget.dataset.item
    this.setData({ showAddModal: true, editingId: row._id, formData: { ...row, price: String(row.price), stock: String(row.stock == null ? 999 : row.stock) } })
  },
  chooseImage() {
    if (this.data.uploading || this.data.saving) return
    wx.chooseMedia({ count: 1, mediaType: ['image'], success: async res => {
      this.setData({ uploading: true })
      try {
        const filePath = res.tempFiles[0].tempFilePath
        const extension = (filePath.match(/\.(jpg|jpeg|png|webp)$/i) || [])[1] || 'jpg'
        const uploaded = await api.uploadFile({ filePath, cloudPath: 'food-dishes/' + Date.now() + '.' + extension })
        this.setData({ 'formData.image': uploaded.fileID })
      } catch (error) { wx.showToast({ title: error.message || '照片上传失败', icon: 'none' }) }
      finally { this.setData({ uploading: false }) }
    } })
  },
  submitForm() { return this.saveDish(this.data.editingId ? 'update' : 'add', { ...this.data.formData, _id: this.data.editingId }) },
  deleteMenu(e) { wx.showModal({ title: '删除菜品？', content: '将从点餐菜单移除，已有订单记录保留。', success: res => { if (res.confirm) this.saveDish('delete', { _id: e.currentTarget.dataset.id }) } }) },
  async saveDish(type, dishData) {
    if (this.data.saving || this.data.uploading) return
    this.setData({ saving: true })
    try {
      const res = await api.call({ name: 'food_manager', data: { action: 'adminManageDish', data: { type, dishData: { ...dishData, shopId: this.data.shopId } } } })
      if (!res.result || !res.result.success) throw new Error(res.result && res.result.msg || '操作失败')
      this.setData({ showAddModal: false }); wx.showToast({ title: '已保存', icon: 'success' }); await this.loadMenus()
    } catch (error) { wx.showToast({ title: error.message || '操作失败', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  }
})
