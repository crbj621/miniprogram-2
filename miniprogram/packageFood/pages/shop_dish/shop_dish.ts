import { api } from '../../../utils/api-client'
Page({
  data: {
    shopId: '',
    dishes: [] as any[],
    featuredDishes: [] as any[],
    showModal: false,
    isEdit: false,
    form: {
      _id: '',
      name: '',
      price: '',
      category: '',
      image: '',
      description: '',
      stock: '999'
    },
    uploading: false,
    saving: false
  },

  onLoad() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageFood/pages/shop_dish/shop_dish')
      })
      return
    }
    const shopId = wx.getStorageSync('food_shop_id')
    if (!shopId) {
      wx.redirectTo({ url: '/packageFood/pages/shop_login/shop_login' })
      return
    }
    this.setData({ shopId })
    this.loadDishes()
    this.loadShopInfo()
  },

  onPullDownRefresh() {
    Promise.all([this.loadDishes(), this.loadShopInfo()]).then(() => wx.stopPullDownRefresh())
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
        this.setData({ 
          featuredDishes: res.result.shop.featuredDishes || [] 
        })
      }
    } catch (err) {
      console.error(err)
    }
  },

  async loadDishes() {
    try {
      const res = await api.call({
        name: 'food_manager',
        data: {
          action: 'getShopDishes',
          data: { shopId: this.data.shopId }
        }
      }) as any

      if (res.result.success) {
        const dishes = res.result.dishes || []
        this.setData({ dishes })
      }
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  showAddModal() {
    this.setData({
      showModal: true,
      isEdit: false,
      form: {
        _id: '',
        name: '',
        price: '',
        category: '',
        image: '',
        description: '',
        stock: '999'
      }
    })
  },

  showEditModal(e: any) {
    const item = e.currentTarget.dataset.item
    this.setData({
      showModal: true,
      isEdit: true,
      form: {
        _id: item._id,
        name: item.name || '',
        price: String(item.price || ''),
        category: item.category || '',
        image: item.image || '',
        description: item.description || '',
        stock: String(item.stock || 999)
      }
    })
  },

  hideModal() {
    this.setData({ showModal: false })
  },

  onInputChange(e: any) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        this.setData({ uploading: true })

        try {
          const cloudPath = 'dishes/' + Date.now() + '.jpg'
          const uploadRes = await api.uploadFile({
            cloudPath: cloudPath,
            filePath: tempFilePath
          })
          this.setData({
            'form.image': uploadRes.fileID,
            uploading: false
          })
          wx.showToast({ title: '上传成功', icon: 'success' })
        } catch (err) {
          this.setData({ uploading: false })
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  },

  async saveDish() {
    const { form, isEdit, saving, shopId } = this.data
    
    if (saving) return
    
    if (!form.name) {
      wx.showToast({ title: '请输入菜品名称', icon: 'none' })
      return
    }
    if (!form.price) {
      wx.showToast({ title: '请输入价格', icon: 'none' })
      return
    }
    if (Number(form.price) <= 0) {
      wx.showToast({ title: '菜品价格必须大于0', icon: 'none' })
      return
    }
    if (!Number.isFinite(Number(form.stock)) || Number(form.stock) < 0) {
      wx.showToast({ title: '请输入正确的库存数量', icon: 'none' })
      return
    }

    this.setData({ saving: true })

    try {
      const dishData: any = {
        name: form.name,
        price: Number(form.price),
        category: form.category || '默认分类',
        image: form.image,
        description: form.description,
        stock: Number(form.stock || 999),
        isAvailable: true,
        shopId: shopId
      }

      if (isEdit && form._id) {
        dishData._id = form._id
      }

      const res = await api.call({
        name: 'food_manager',
        data: {
          action: 'manageDish',
          data: {
            type: isEdit ? 'update' : 'add',
            dishData: dishData
          }
        }
      }) as any

      this.setData({ saving: false })
      
      if (res.result.success) {
        wx.showToast({ title: '保存成功', icon: 'success' })
        this.hideModal()
        this.loadDishes()
      } else {
        wx.showToast({ title: res.result.msg || '保存失败', icon: 'none' })
      }
    } catch (err: any) {
      this.setData({ saving: false })
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  deleteDish(e: any) {
    const id = e.currentTarget.dataset.id
    
    wx.showModal({
      title: '删除菜品',
      content: '确定要删除这道菜品吗？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' })
          try {
            const result = await api.call({
              name: 'food_manager',
              data: {
                action: 'manageDish',
                data: {
                  type: 'delete',
                  dishData: { 
                    _id: id,
                    shopId: this.data.shopId
                  }
                }
              }
            }) as any
            wx.hideLoading()
            if (result.result && result.result.success) {
              wx.showToast({ title: '删除成功', icon: 'success' })
              this.loadDishes()
            } else {
              wx.showToast({ title: (result.result && result.result.msg) || '删除失败', icon: 'none' })
            }
          } catch (err) {
            wx.hideLoading()
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      }
    })
  },

  toggleAvailable(e: any) {
    const { id, available } = e.currentTarget.dataset
    wx.showLoading({ title: '处理中...' })
    api.call({
      name: 'food_manager',
      data: {
        action: 'manageDish',
        data: {
          type: 'update',
          dishData: {
            _id: id,
            isAvailable: !available,
            shopId: this.data.shopId
          }
        }
      }
    }).then((res: any) => {
      wx.hideLoading()
      if (res.result && res.result.success) {
        this.loadDishes()
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '操作失败', icon: 'none' })
      }
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    })
  },

  async toggleFeatured(e: any) {
    const dish = e.currentTarget.dataset.item
    const { featuredDishes, shopId } = this.data
    
    let newFeatured: any[] = []
    let isRemove = false
    
    for (let i = 0; i < featuredDishes.length; i++) {
      if (featuredDishes[i]._id === dish._id) {
        isRemove = true
      } else {
        newFeatured.push(featuredDishes[i])
      }
    }
    
    if (!isRemove) {
      if (featuredDishes.length >= 2) {
        wx.showToast({ title: '最多只能设置2个推荐菜品', icon: 'none' })
        return
      }
      newFeatured = [...featuredDishes, {
        _id: dish._id,
        name: dish.name,
        image: dish.image,
        price: dish.price
      }]
    }
    
    wx.showLoading({ title: '处理中...' })
    
    try {
      const res = await api.call({
        name: 'food_manager',
        data: {
          action: 'updateFeaturedDishes',
          data: {
            shopId: shopId,
            featuredDishes: newFeatured
          }
        }
      }) as any
      
      wx.hideLoading()
      
      if (res.result.success) {
        this.setData({ featuredDishes: newFeatured })
        wx.showToast({ 
          title: isRemove ? '已取消推荐' : '已设为推荐', 
          icon: 'success' 
        })
      } else {
        wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  }
})
