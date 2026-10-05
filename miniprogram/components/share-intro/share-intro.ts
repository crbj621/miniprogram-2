Component({
  properties: { title: String, path: String },
  methods: {
    enter() {
      const launch = wx.getLaunchOptionsSync()
      if (launch.scene === 1154) { wx.showToast({ title: '请点击微信的“进入小程序”查看完整内容', icon: 'none' }); return }
      wx.reLaunch({ url: this.data.path || '/pages/portal/portal' })
    }
  }
})
