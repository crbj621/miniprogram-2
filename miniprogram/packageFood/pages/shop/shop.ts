import { withSharing } from '../../../utils/page-share'
import { callFoodFunction } from '../../utils/food-cloud'

Page(withSharing({
  data: {
    shopId: '',
    shop: null as any,
    menu: [] as any[],
    currentCategory: -1,
    scrollIntoView: '',
    cart: {} as Record<string, number>,
    cartList: [] as any[],
    totalCount: 0,
    totalPrice: 0,
    showCartModal: false
  },

  onLoad(options: any) {
    if (options.id) {
      this.setData({ shopId: options.id })
      this.loadShopDetail(options.id)
    }
  },

  loadShopDetail(shopId: string) {
    callFoodFunction('getShopDetail', { shopId }, { showLoading: true, loadingTitle: '加载中' }).then((result: any) => {
      // 提取店长推荐/置顶菜品
      const recommendItems: any[] = []
      result.menu.forEach((cat: any) => {
        cat.items.forEach((dish: any) => {
          if (dish.isSignature) {
            recommendItems.push(dish)
          }
        })
      })
      
      let finalMenu = result.menu
      if (recommendItems.length > 0) {
        finalMenu = [{ name: '店长推荐', items: recommendItems }, ...result.menu]
      }

      this.setData({
        shop: result.shop,
        menu: finalMenu
      })
    }).catch(err => {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    })
  },

  onDishImageError(e: any) {
    const dish = e.currentTarget.dataset.dish
    console.log('菜品图片加载失败:', dish.name, dish.image)
    const { menu } = this.data
    for (let i = 0; i < menu.length; i++) {
      for (let j = 0; j < menu[i].items.length; j++) {
        if (menu[i].items[j]._id === dish._id) {
          menu[i].items[j].image = ''
          this.setData({ menu })
          return
        }
      }
    }
  },

  switchCategory(e: any) {
    const index = e.currentTarget.dataset.index
    this.setData({ 
      currentCategory: index,
      scrollIntoView: index >= 0 ? `cat-${index}` : ''
    })
  },

  updateCart(e: any) {
    const { dish, action } = e.currentTarget.dataset
    const { cart } = this.data
    const currentCount = cart[dish._id] || 0
    
    let newCount = currentCount
    if (action === 'plus') {
      newCount += 1
    } else if (action === 'minus') {
      newCount = Math.max(0, newCount - 1)
    }

    if (newCount === 0) {
      delete cart[dish._id]
    } else {
      cart[dish._id] = newCount
    }

    this.setData({ cart })
    this.computeTotals()
  },

  computeTotals() {
    const { cart, menu } = this.data
    let totalCount = 0
    let totalPrice = 0
    const cartList: any[] = []
    const addedDishIds = new Set<string>() // 用来去重，防止同一个菜品属于多个分类时被加两遍

    menu.forEach(cat => {
      cat.items.forEach((dish: any) => {
        if (cart[dish._id] && !addedDishIds.has(dish._id)) {
          const count = cart[dish._id]
          totalCount += count
          totalPrice += dish.price * count
          cartList.push({ ...dish, count })
          addedDishIds.add(dish._id)
        }
      })
    })

    this.setData({
      totalCount,
      totalPrice: Math.round(totalPrice * 100) / 100,
      cartList
    })
    
    if (totalCount === 0) {
      this.setData({ showCartModal: false })
    }
  },

  showCartDetail() {
    if (this.data.totalCount > 0) {
      this.setData({ showCartModal: !this.data.showCartModal })
    }
  },

  hideCartDetail() {
    this.setData({ showCartModal: false })
  },

  clearCart() {
    wx.showModal({
      title: '清空购物车',
      content: '确定要清空吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            cart: {},
            totalCount: 0,
            totalPrice: 0,
            cartList: [],
            showCartModal: false
          })
        }
      }
    })
  },

  goToCheckout() {
    const { totalPrice, shop, cartList, shopId } = this.data
    if (totalPrice < (shop.minPrice || 0)) {
      wx.showToast({ title: `还差¥${((shop.minPrice || 0) - totalPrice).toFixed(2)}起送`, icon: 'none' })
      return
    }
    
    wx.setStorageSync('current_order', {
      shop,
      items: cartList,
      totalPrice
    })

    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.navigateTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageFood/pages/order/order')
      })
      return
    }

    wx.navigateTo({
      url: `/packageFood/pages/order/order`
    })
  }
}))
