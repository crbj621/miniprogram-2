const { withSharing } = require('../../../utils/page-share')
const { api } = require('../../../utils/api-client')
const states = ['', 'pending', 'processing', 'ready', 'completed', 'cancelled']
Page(withSharing({
  data: { orders: [], loading: false, updating: false, status: '', statusIndex: 0, page: 1, hasMore: true },
  refreshPage() { return this.selectComponent('#page-refresh').refresh(() => this.loadOrders()) },
  onLoad() { this.loadOrders() },
  onReachBottom() { this.loadMore() },
  loadMore() { if (!this.data.loading && this.data.hasMore) return this.loadOrders(true) },
  async loadOrders(append = false) {
    const id = this.requestId = (this.requestId || 0) + 1
    const page = append ? this.data.page + 1 : 1
    this.setData({ loading: true })
    try {
      const res = await api.call({ name: 'globalAdmin', data: { action: 'getFoodOrders', data: { page, pageSize: 20, status: this.data.status } } })
      if (id !== this.requestId) return false
      if (!res.result || res.result.code !== 0) throw new Error(res.result && res.result.message || '读取失败')
      const rows = (res.result.data.list || []).map(order => ({ ...order,
        itemsText: Array.isArray(order.items) ? order.items.map(item => item.name + ' × ' + item.count).join('、') : String(order.items || ''),
        createTimeText: order.createTime ? new Date(order.createTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '' }))
      this.setData({ orders: append ? this.data.orders.concat(rows) : rows, page, hasMore: rows.length === 20 })
      return true
    } catch (error) {
      if (id === this.requestId) wx.showToast({ title: error.message || '读取失败', icon: 'none' })
      return false
    } finally { if (id === this.requestId) this.setData({ loading: false }) }
  },
  onStatusChange(e) {
    const index = Number(e.detail.value)
    this.setData({ status: states[index] || '', statusIndex: index, page: 1, hasMore: true, orders: [] })
    this.loadOrders()
  },
  updateOrderStatus(e) {
    if (this.data.updating) return
    const { id, status } = e.currentTarget.dataset
    if (status === 'cancelled') wx.showModal({ title: '取消订单？', content: '取消后会退回预占库存和已用优惠券。', success: res => { if (res.confirm) this.saveStatus(id, status) } })
    else this.saveStatus(id, status)
  },
  async saveStatus(id, status) {
    if (this.data.updating) return
    this.setData({ updating: true })
    try {
      const res = await api.call({ name: 'globalAdmin', data: { action: 'updateFoodOrder', data: { id, status } } })
      if (!res.result || res.result.code !== 0) throw new Error(res.result && res.result.message || '操作失败')
      wx.showToast({ title: '状态已更新', icon: 'success' })
      await this.loadOrders()
    } catch (error) { wx.showToast({ title: error.message || '操作失败', icon: 'none' }) }
    finally { this.setData({ updating: false }) }
  }
}))
