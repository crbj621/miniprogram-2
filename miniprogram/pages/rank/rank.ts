import { api } from '../../utils/api-client'
Page({
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.getRankList()) },
  data: {
    rankList: [] as any[],
    activeTab: 'daily',
    isLoggedIn: false,
    isLoading: false,
    loadError: false,
    myRank: null as any
  },

  onLoad() {
    this.refreshLoginState();
  },

  onShow() {
    this.refreshLoginState();
    this.getRankList();
  },
  onPullDownRefresh() { this.getRankList().finally(() => wx.stopPullDownRefresh()) },

  refreshLoginState() {
    const app = getApp();
    this.setData({ isLoggedIn: app.isLoggedIn() });
  },

  getRankList() {
    const { activeTab } = this.data;
    const requestId = this.rankRequestId = (this.rankRequestId || 0) + 1;
    this.setData({ isLoading: true, loadError: false });
    
    let loaded = false;
    return api.call({
      name: 'getRankList',
      data: { type: activeTab },
      success: (res: any) => {
        if (requestId !== this.rankRequestId) return;
        if (res.result && res.result.code === 0) {
          loaded = true;
          const openid = getApp().getGlobalOpenId();
          const rows = (res.result.data || []).map((item: any, index: number, list: any[]) => {
            const gap = index ? Math.max(0, Number(list[index - 1].distance) - Number(item.distance)) : 0;
            return { ...item, position: index + 1, medal: ['冠军', '亚军', '季军'][index] || '',
              gap, gapText: index ? (gap ? '距上一名 ' + gap + ' 米' : '同里程，按稳定顺序排列') : '领跑全场 · 守住荣耀',
              isMine: activeTab === 'couple' ? (item.memberOpenids || []).includes(openid) : item.openid === openid };
          });
          this.setData({ rankList: rows, myRank: rows.find((item: any) => item.isMine) || null });
        } else {
          this.setData({ rankList: [], myRank: null, loadError: true });
        }
      },
      fail: () => {
        if (requestId !== this.rankRequestId) return;
        this.setData({ rankList: [], myRank: null, loadError: true });
      },
      complete: () => {
        if (requestId !== this.rankRequestId) return;
        this.setData({ isLoading: false });
      }
    }).then(() => loaded).catch(() => false);
  },

  switchTab(e: any) {
    const tab = e.currentTarget.dataset.tab;
    if (this.data.activeTab === tab) return;
    this.setData({ activeTab: tab, rankList: [], myRank: null, loadError: false });
    this.getRankList();
  }
});
