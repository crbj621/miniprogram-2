Component({
  properties: {
    selected: {
      type: Number,
      value: 0
    }
  },
  data: {
    list: [
      {
        pagePath: "/pages/index/index",
        text: "跑步"
      },
      {
        pagePath: "/pages/rank/rank",
        text: "排行榜"
      },
      {
        pagePath: "/pages/profile/profile?source=running",
        text: "我的"
      }
    ]
  },
  methods: {
    switchTab(e: any) {
      const data = e.currentTarget.dataset;
      const url = data.path;
      wx.redirectTo({
        url
      });
    }
  }
});
