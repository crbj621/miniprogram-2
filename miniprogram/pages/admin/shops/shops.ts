import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    list: [] as any[],
    loading: true,
    keyword: '',
    showEditModal: false,
    editShop: null as any,
    editForm: {
      name: '',
      contact: '',
      phone: '',
      minPrice: '0',
      deliveryFee: '0'
    },
    showAccountModal: false,
    accountShop: null as any,
    accountForm: {
      username: '',
      password: ''
    }
  },

  onLoad() {
    this.loadList()
  },

  onPullDownRefresh() {
    this.loadList().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  showAddShop() {
    this.setData({
      showEditModal: true,
      editShop: null,
      editForm: {
        name: '',
        contact: '',
        phone: '',
        minPrice: '0',
        deliveryFee: '0'
      }
    })
  },

  deleteShop(e: any) {
    const shop = e.currentTarget.dataset.shop
    wx.showModal({
      title: '删除商家',
      content: `确定要永久删除「${shop.name}」吗？相关菜品和订单可能受到影响！`,
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' })
          try {
            const result = await api.call({
              name: 'globalAdmin',
              data: {
                action: 'adminDeleteShop',
                data: { shopId: shop._id }
              }
            }) as any
            wx.hideLoading()
            if (result.result && result.result.code === 0) {
              wx.showToast({ title: '删除成功', icon: 'success' })
              this.loadList()
            } else {
              wx.showToast({ title: (result.result && result.result.message) ? result.result.message : '删除失败', icon: 'none' })
            }
          } catch (err) {
            wx.hideLoading()
            wx.showToast({ title: '网络错误', icon: 'none' })
          }
        }
      }
    })
  },

  async loadList() {
    this.setData({ loading: true })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: {
          action: 'getShopManageList',
          data: { keyword: this.data.keyword }
        }
      }) as any

      if (res.result && res.result.code === 0) {
        this.setData({
          list: (res.result.data && res.result.data.list) ? res.result.data.list : [],
          loading: false
        })
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  onSearchInput(e: any) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.loadList()
  },

  toggleStatus(e: any) {
    const shop = e.currentTarget.dataset.shop
    const newStatus = shop.status === 'open' ? 'closed' : 'open'
    const actionText = newStatus === 'open' ? '启用' : '禁用'

    wx.showModal({
      title: `${actionText}商家`,
      content: `确定要${actionText}「${shop.name}」吗？`,
      success: async (res) => {
        if (res.confirm) {
          await this.doUpdateStatus(shop._id, newStatus)
        }
      }
    })
  },

  async doUpdateStatus(shopId: string, status: string) {
    wx.showLoading({ title: '处理中...' })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: {
          action: 'adminUpdateShopStatus',
          data: { shopId, status }
        }
      }) as any

      wx.hideLoading()
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '操作成功', icon: 'success' })
        this.loadList()
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '操作失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  showEdit(e: any) {
    const shop = e.currentTarget.dataset.shop
    this.setData({
      showEditModal: true,
      editShop: shop,
      editForm: {
        name: shop.name || '',
        contact: shop.contact || '',
        phone: shop.phone || '',
        minPrice: String(shop.minPrice || 0),
        deliveryFee: String(shop.deliveryFee || 0)
      }
    })
  },

  hideEdit() {
    this.setData({ showEditModal: false, editShop: null })
  },

  onEditInput(e: any) {
    const field = e.currentTarget.dataset.field
    this.setData({
      [`editForm.${field}`]: e.detail.value
    })
  },

  async saveEdit() {
    const { editShop, editForm } = this.data

    if (!editForm.name) {
      wx.showToast({ title: '请输入商家名称', icon: 'none' })
      return
    }

    const minPrice = Number(editForm.minPrice)
    const deliveryFee = Number(editForm.deliveryFee)
    if (!Number.isFinite(minPrice) || minPrice < 0 || !Number.isFinite(deliveryFee) || deliveryFee < 0) {
      wx.showToast({ title: '起送价和配送费应为非负金额', icon: 'none' })
      return
    }
    const shopData = { ...editForm, minPrice, deliveryFee }

    wx.showLoading({ title: '保存中...' })
    try {
      const actionName = editShop ? 'adminUpdateShopInfo' : 'adminAddShop'
      const requestData = editShop 
        ? { shopId: editShop._id, shopData }
        : { shopData }

      const res = await api.call({
        name: 'globalAdmin',
        data: {
          action: actionName,
          data: requestData
        }
      }) as any

      wx.hideLoading()
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '保存成功', icon: 'success' })
        this.hideEdit()
        this.loadList()
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '保存失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  showAccount(e: any) {
    const shop = e.currentTarget.dataset.shop
    this.setData({
      showAccountModal: true,
      accountShop: shop,
      accountForm: {
        username: '',
        password: ''
      }
    })
  },

  hideAccount() {
    this.setData({ showAccountModal: false, accountShop: null })
  },

  onAccountInput(e: any) {
    const field = e.currentTarget.dataset.field
    this.setData({
      [`accountForm.${field}`]: e.detail.value
    })
  },

  async saveAccount() {
    const { accountShop, accountForm } = this.data
    if (!accountShop) return

    if (!accountForm.username && !accountForm.password) {
      wx.showToast({ title: '请输入账号或密码', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: {
          action: 'adminUpdateShopAccount',
          data: {
            shopId: accountShop._id,
            username: accountForm.username,
            password: accountForm.password
          }
        }
      }) as any

      wx.hideLoading()
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '保存成功', icon: 'success' })
        this.hideAccount()
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '保存失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  resetPassword(e: any) {
    const shop = e.currentTarget.dataset.shop
    wx.showModal({
      title: '重置密码',
      content: `确定要重置「${shop.name}」的登录密码吗？系统会生成一条随机临时密码。`,
      success: async (res) => {
        if (res.confirm) {
          await this.doResetPassword(shop._id)
        }
      }
    })
  },

  async doResetPassword(shopId: string) {
    wx.showLoading({ title: '重置中...' })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: {
          action: 'adminResetShopPassword',
          data: { shopId }
        }
      }) as any

      wx.hideLoading()
      if (res.result && res.result.code === 0) {
        const temporaryPassword = res.result.data && res.result.data.temporaryPassword
        if (temporaryPassword) {
          wx.setClipboardData({
            data: temporaryPassword,
            success: () => {
              wx.showModal({
                title: '临时密码已复制',
                content: temporaryPassword + '\n\n请安全地发给商家，并提醒登录后立即修改。',
                showCancel: false
              })
            }
          })
        } else {
          wx.showToast({ title: '密码已重置', icon: 'success' })
        }
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '重置失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '重置失败', icon: 'none' })
    }
  },

  viewLogs(e: any) {
    const shopId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/admin/logs/logs?shopId=${shopId}`
    })
  },

  previewImage(e: any) {
    const url = e.currentTarget.dataset.url
    if (url) {
      wx.previewImage({
        current: url,
        urls: [url]
      })
    }
  }
}))
