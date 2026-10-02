import { api } from '../../../utils/api-client'
Page({
  data: {
    list: [] as any[],
    loading: true,
    filterStatus: 'pending',
    filterDate: '',
    filterName: ''
  },

  onLoad() {
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
          action: 'getShopAuditList',
          data: {
            status: this.data.filterStatus,
            // globalAdmin 侧使用 keyword 模糊匹配店铺名
            keyword: this.data.filterName
          }
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

  onFilterStatus(e: any) {
    this.setData({ filterStatus: e.detail.value }, () => {
      this.loadList()
    })
  },

  onFilterName(e: any) {
    this.setData({ filterName: e.detail.value })
  },

  onSearch() {
    this.loadList()
  },

  previewImage(e: any) {
    const url = e.currentTarget.dataset.url
    wx.previewImage({
      current: url,
      urls: [url]
    })
  },

  approve(e: any) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '审核通过',
      content: '确定通过该商家入驻申请吗？',
      success: async (res) => {
        if (res.confirm) {
          await this.doAudit(id, 'approved', '')
        }
      }
    })
  },

  reject(e: any) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '拒绝申请',
      content: '请输入拒绝原因',
      editable: true,
      placeholderText: '请输入拒绝原因',
      success: async (res) => {
        if (res.confirm) {
          const reason = res.content || '审核未通过'
          await this.doAudit(id, 'rejected', reason)
        }
      }
    })
  },

  async doAudit(shopId: string, status: string, reason: string) {
    wx.showLoading({ title: '处理中...' })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: {
          action: 'auditShop',
          data: {
            shopId,
            status,
            reason
          }
        }
      }) as any

      wx.hideLoading()
      
      if (res.result && res.result.code === 0) {
        const temporaryPassword = res.result.data && res.result.data.temporaryPassword
        if (temporaryPassword) {
          wx.setClipboardData({
            data: temporaryPassword,
            success: () => wx.showModal({
              title: '审核通过',
              content: '该旧账号没有设置过密码，已生成并复制临时密码：\n' + temporaryPassword,
              showCancel: false
            })
          })
        } else {
          wx.showToast({ title: status === 'approved' ? '已通过' : '已拒绝', icon: 'success' })
        }
        this.loadList()
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '操作失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  }
})
