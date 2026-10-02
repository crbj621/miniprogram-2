import { api } from '../../../utils/api-client'
Page({
  data: {
    list: [] as any[],
    keyword: '',
    loading: true,
    selectedIds: [] as string[],
    selectAll: false,
    demoBusy: false,
    isSuper: false
  },

  onLoad() {
    const adminInfo = wx.getStorageSync('adminInfo')
    this.setData({ isSuper: !!adminInfo && adminInfo.role === 'super' })
    this.loadList()
  },

  onPullDownRefresh() {
    this.loadList().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  async loadList() {
    this.setData({ loading: true })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: {
          action: 'getRankList',
          data: { keyword: this.data.keyword }
        }
      }) as any

      if (res.result && res.result.code === 0) {
        const list = ((res.result.data && res.result.data.list) ? res.result.data.list : []).map((item: any) => ({
          ...item,
          selected: false
        }))
        this.setData({
          list,
          selectedIds: [],
          selectAll: false,
          loading: false
        })
      } else throw new Error(res.result?.message || '读取失败')
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  onSearchInput(e: any) {
    this.setData({ keyword: e.detail.value })
  },
  demoAction(e: any) {
    if (this.data.demoBusy) return
    const remove = e.currentTarget.dataset.remove === true
    wx.showModal({ title: remove ? '移除示例成绩' : '生成示例成绩', content: remove ? '仅移除四条带示例标识的成绩和示例搭档。' : '写入四条带“示例”昵称的成绩用于检查榜单，可随时单独移除。', success: async result => {
      if (!result.confirm) return
      this.setData({ demoBusy: true })
      try {
        const res: any = await api.call({ name: 'globalAdmin', data: { action: remove ? 'clearRunDemo' : 'seedRunDemo' } })
        if (res.result?.code !== 0) throw new Error(res.result?.message || '操作失败')
        wx.showToast({ title: res.result.message, icon: 'none' })
        await this.loadList()
      } catch (error: any) { wx.showToast({ title: error.message || '操作失败', icon: 'none' }) }
      finally { this.setData({ demoBusy: false }) }
    } })
  },

  onSearch() {
    this.loadList()
  },

  toggleSelectAll() {
    const { list, selectAll } = this.data
    if (selectAll) {
      this.setData({
        selectedIds: [],
        selectAll: false,
        list: list.map((item: any) => ({ ...item, selected: false }))
      })
    } else {
      const allIds = list.map((item: any) => item._id)
      this.setData({
        selectedIds: allIds,
        selectAll: true,
        list: list.map((item: any) => ({ ...item, selected: true }))
      })
    }
  },

  toggleSelect(e: any) {
    const id = e.currentTarget.dataset.id
    const { selectedIds } = this.data
    const index = selectedIds.indexOf(id)
    
    if (index > -1) {
      selectedIds.splice(index, 1)
    } else {
      selectedIds.push(id)
    }
    
    this.setData({
      selectedIds,
      selectAll: selectedIds.length === this.data.list.length,
      list: this.data.list.map((item: any) => ({
        ...item,
        selected: selectedIds.includes(item._id)
      }))
    })
  },

  clearSingle(e: any) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该排行榜记录吗？此操作将写入日志。',
      success: async (res) => {
        if (res.confirm) {
          await this.doClear([id])
        }
      }
    })
  },

  clearSelected() {
    const { selectedIds } = this.data
    if (selectedIds.length === 0) {
      wx.showToast({ title: '请先选择记录', icon: 'none' })
      return
    }

    wx.showModal({
      title: '批量删除',
      content: `确定要删除选中的 ${selectedIds.length} 条记录吗？此操作将写入日志。`,
      success: async (res) => {
        if (res.confirm) {
          await this.doClear(selectedIds)
        }
      }
    })
  },

  async doClear(ids: string[]) {
    wx.showLoading({ title: '删除中...' })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: {
          action: 'clearRankRecords',
          data: { ids }
        }
      }) as any

      wx.hideLoading()
      
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '删除成功', icon: 'success' })
        this.setData({ selectedIds: [], selectAll: false })
        this.loadList()
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '删除失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '删除失败', icon: 'none' })
    }
  }
})
