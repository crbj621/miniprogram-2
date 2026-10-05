import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    hasTeam: false,
    teamInfo: null as any,
    leaderDetail: null as any,
    members: [] as any[],
    isLeader: false,
    currentOpenid: '',
    createModalVisible: false,
    joinModalVisible: false,
    newTeamName: '',
    inviteCode: '',
    inviteCodeExpire: 0,
    expireText: ''
  },

  onLoad() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageProfile/pages/team/team')
      })
      return
    }
  },

  onShow() {
    this.startExpireTimer()
    if (getApp().isLoggedIn()) this.loadTeamInfo()
  },
  onPullDownRefresh() { this.loadTeamInfo().finally(() => wx.stopPullDownRefresh()) },
  goRun() { wx.redirectTo({ url: '/pages/index/index' }) },
  async answerInvite(e: any) {
    wx.showLoading({ title: '处理中', mask: true })
    try {
      const res: any = await api.call({ name: 'teamManager', data: { action: e.currentTarget.dataset.accept ? 'acceptCouple' : 'leaveTeam', teamId: this.data.teamInfo._id } })
      if (!res.result?.success) throw new Error(res.result?.errMsg || '操作失败')
      await this.loadTeamInfo()
    } catch (error: any) { wx.showToast({ title: error.message || '操作失败', icon: 'none' }) }
    finally { wx.hideLoading() }
  },

  onHide() {
    this.stopExpireTimer()
  },

  onUnload() {
    this.stopExpireTimer()
  },

  expireTimer: null as any,

  startExpireTimer() {
    this.stopExpireTimer()
    this.updateExpireText()
    this.expireTimer = setInterval(() => this.updateExpireText(), 1000)
  },

  stopExpireTimer() {
    if (this.expireTimer) {
      clearInterval(this.expireTimer)
      this.expireTimer = null
    }
  },

  updateExpireText() {
    const now = Date.now()
    const remain = this.data.inviteCodeExpire - now
    if (remain <= 0) {
      this.setData({ expireText: '已过期' })
    } else {
      const minutes = Math.floor(remain / 60000)
      const seconds = Math.floor((remain % 60000) / 1000)
      this.setData({ 
        expireText: minutes + '分' + seconds + '秒后过期' 
      })
    }
  },

  async loadTeamInfo() {
    wx.showLoading({ title: '加载中...' })
    try {
      const res = await api.call({
        name: 'teamManager',
        data: { action: 'getMyTeam' }
      })

      const result = res.result as any
      if (!result.success) throw new Error(result.errMsg || '读取队伍失败')
      if (result.data) {
        const app = getApp()
        const openid = app.getOpenIdSync()
        const teamData = result.data
        const details = Array.isArray(teamData.memberDetails) ? teamData.memberDetails : []
        const leaderDetail = details.find((item: any) => item.openid === teamData.leaderOpenid) || {
          openid: teamData.leaderOpenid,
          nickName: '队长',
          avatarUrl: ''
        }
        const memberDetails = details.filter((item: any) => item.openid !== teamData.leaderOpenid)
        this.setData({
          hasTeam: true,
          teamInfo: teamData,
          leaderDetail,
          isLeader: teamData.leaderOpenid === openid,
          currentOpenid: openid,
          inviteCode: teamData.inviteCode || '',
          inviteCodeExpire: teamData.inviteCodeExpire || 0,
          members: memberDetails
        })
        this.updateExpireText()
        if (!memberDetails.length && teamData.members && teamData.members.length > 0) {
          this.loadMemberDetails(teamData.members)
        }
      } else {
        this.setData({
          hasTeam: false,
          teamInfo: null,
          leaderDetail: null,
          members: [],
          isLeader: false,
          inviteCode: '',
          inviteCodeExpire: 0,
          expireText: ''
        })
      }
    } catch (e: any) {
      wx.showToast({ title: e.message || '队伍加载失败，请刷新', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async loadMemberDetails(memberOpenids: string[]) {
    const members = memberOpenids.map(function(id) {
      return {
        openid: id,
        nickName: '成员' + id.slice(-4),
        avatarUrl: ''
      }
    })
    this.setData({ members })
  },

  showCreateModal() {
    this.setData({ createModalVisible: true })
  },

  hideCreateModal() {
    wx.hideKeyboard()
    this.setData({ createModalVisible: false, newTeamName: '' })
  },

  onTeamNameInput(e: any) {
    this.setData({ newTeamName: e.detail.value })
  },

  async createTeam() {
    const teamName = this.data.newTeamName.trim()
    if (teamName.length > 20) {
      wx.showToast({ title: '队伍名称最多20个字', icon: 'none' })
      return
    }
    wx.showLoading({ title: '创建中...', mask: true })
    try {
      const res = await api.call({
        name: 'teamManager',
        data: {
          action: 'create',
          teamName: teamName || '我的跑团'
        }
      })

      const result = res.result as any
      if (result.success) {
        wx.hideLoading()
        wx.showModal({
          title: '创建成功',
          content: '邀请码: ' + result.inviteCode + '\n有效期10分钟，请分享给好友',
          showCancel: false,
          success: () => {
            this.hideCreateModal()
            this.loadTeamInfo()
          }
        })
      } else {
        wx.showToast({ title: result.errMsg, icon: 'none' })
      }
    } catch (e) {
      console.error(e)
      wx.showToast({ title: '创建失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  showJoinModal() {
    this.setData({ joinModalVisible: true })
  },

  hideJoinModal() {
    wx.hideKeyboard()
    this.setData({ joinModalVisible: false, inviteCode: '' })
  },

  onInviteCodeInput(e: any) {
    this.setData({ inviteCode: e.detail.value })
  },

  async joinTeam() {
    if (!this.data.inviteCode || this.data.inviteCode.length !== 3) {
      wx.showToast({ title: '请输入3位邀请码', icon: 'none' })
      return
    }

    wx.showLoading({ title: '加入中...', mask: true })
    try {
      const res = await api.call({
        name: 'teamManager',
        data: {
          action: 'joinTeam',
          inviteCode: this.data.inviteCode
        }
      })

      const result = res.result as any
      if (result.success) {
        wx.showToast({ title: '加入成功', icon: 'success' })
        this.hideJoinModal()
        this.loadTeamInfo()
      } else {
        wx.showToast({ title: result.errMsg, icon: 'none' })
      }
    } catch (e) {
      console.error(e)
      wx.showToast({ title: '加入失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async refreshCode() {
    if (!this.data.isLeader) {
      wx.showToast({ title: '只有队长可以刷新邀请码', icon: 'none' })
      return
    }
    wx.showLoading({ title: '刷新中...' })
    try {
      const res = await api.call({
        name: 'teamManager',
        data: {
          action: 'refreshCode',
          teamId: this.data.teamInfo._id
        }
      })

      const result = res.result as any
      if (result.success) {
        this.setData({
          inviteCode: result.inviteCode,
          inviteCodeExpire: result.inviteCodeExpire
        })
        this.updateExpireText()
        wx.showToast({ title: '已刷新', icon: 'success' })
      } else {
        wx.showToast({ title: result.errMsg, icon: 'none' })
      }
    } catch (e) {
      console.error(e)
      wx.showToast({ title: '刷新失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  copyInviteCode() {
    wx.setClipboardData({
      data: '邀请码: ' + this.data.inviteCode + '，10分钟内有效，快来加入我的跑团吧！',
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' })
      }
    })
  },

  async leaveTeam() {
    const content = this.data.isLeader ? '确定要解散队伍吗？' : '确定要退出队伍吗？'
    wx.showModal({
      title: '提示',
      content: content,
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' })
          try {
            const res = await api.call({
              name: 'teamManager',
              data: {
                action: 'leaveTeam',
                teamId: this.data.teamInfo._id
              }
            })

            const result = res.result as any
            if (result.success) {
              wx.showToast({ title: result.msg, icon: 'success' })
              this.loadTeamInfo()
            } else {
              wx.showToast({ title: result.errMsg, icon: 'none' })
            }
          } catch (e) {
            console.error(e)
          } finally {
            wx.hideLoading()
          }
        }
      }
    })
  }
}))
