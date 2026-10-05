import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    loading: true,
    list: [] as any[],
    moduleOptions: [
      { key: '', name: '全部' },
      { key: 'admin', name: '管理员' },
      { key: 'system', name: '系统' },
      { key: 'food', name: '点餐' },
      { key: 'forum', name: '校园动态' },
      { key: 'running', name: '校园跑' }
    ],
    actionOptions: [
      { key: '', name: '全部' },
      { key: 'create', name: '创建' },
      { key: 'update', name: '更新' },
      { key: 'delete', name: '删除' },
      { key: 'login', name: '登录' },
      { key: 'logout', name: '退出' }
    ],
    moduleIndex: 0,
    actionIndex: 0
  },

  onLoad() {
    this.load()
  },

  formatTime(value: any) {
    if (!value) return ''
    const d = new Date(typeof value === 'number' ? value : value)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  },

  onModulePicker(e: any) {
    this.setData({ moduleIndex: Number(e.detail.value || 0) })
  },

  onActionPicker(e: any) {
    this.setData({ actionIndex: Number(e.detail.value || 0) })
  },

  reload() {
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const moduleKey = this.data.moduleOptions[this.data.moduleIndex].key
      const actionKey = this.data.actionOptions[this.data.actionIndex].key
      const data: any = { page: 1, pageSize: 50 }
      if (moduleKey) data.module = moduleKey
      if (actionKey) data.action = actionKey
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'getOperationLogs', data }
      }) as any

      if (res.result && res.result.code === 0) {
        const rawList = (res.result.data && res.result.data.list) ? res.result.data.list : []
        const list = rawList.map((item: any) => ({
          ...item,
          createTimeText: this.formatTime(item.createTime)
        }))
        this.setData({ list })
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '加载失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
}))
