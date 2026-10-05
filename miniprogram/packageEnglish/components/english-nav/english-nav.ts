Component({
  properties: { current: { type: String, value: 'words' }, level: { type: String, value: 'CET4' } },
  data: { items: [{ id: 'words', label: '单词', page: 'index' }, { id: 'papers', label: '真题', page: 'papers' }, { id: 'challenge', label: '挑战', page: 'challenge' }, { id: 'rank', label: '榜单', page: 'rank' }] },
  methods: {
    switchSection(event: any) {
      const item = this.data.items.find(item => item.id === event.currentTarget.dataset.id)
      if (!item || item.id === this.properties.current || this.navigating) return
      this.navigating = true
      wx.redirectTo({ url: '/packageEnglish/pages/' + item.page + '/' + item.page + '?level=' + (this.properties.level === 'CET6' ? 'CET6' : 'CET4'),
        fail: () => wx.showToast({ title: '分区打开失败，请重试', icon: 'none' }), complete: () => { this.navigating = false } })
    }
  }
})
