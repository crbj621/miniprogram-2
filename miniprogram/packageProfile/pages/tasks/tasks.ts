import { withSharing } from '../../../utils/page-share'
import { callEnglish } from '../../../utils/english-api'
import { getSavedCampusTheme } from '../../../utils/campus-theme'

Page(withSharing({
  data: { theme: getSavedCampusTheme('profile'), rewards: null as any, tasks: [] as any[], loading: false, saving: false, claiming: false, error: '', goalKm: '3', savedNote: '' },
  onShow() { this.setData({ theme: getSavedCampusTheme('profile') }); this.loadRewards() },
  onPullDownRefresh() { this.loadRewards().finally(() => wx.stopPullDownRefresh()) },
  onUnload() { this.disposed = true },
  showRewards(rewards: any) {
    this.setData({ rewards, goalKm: String(rewards.pendingRunGoal ? rewards.pendingRunGoal.goalKm : rewards.runGoalKm),
      tasks: (rewards.tasks || []).map((task: any) => ({ ...task,
        statusText: !task.available ? '所属模块当前未开放' : task.rewarded ? '今日奖励已领取' : task.id === 'like' ? '等待他人点赞' : '完成后自动结算' })) })
  },
  async loadRewards() {
    if (this.data.loading || this.data.saving || this.data.claiming) return
    this.setData({ loading: true, error: '' })
    try { const rewards = await callEnglish('campusRewards'); if (!this.disposed) this.showRewards(rewards) }
    catch (error) { if (!this.disposed) this.setData({ error: error instanceof Error ? error.message : '每日任务加载失败' }) }
    finally { if (!this.disposed) this.setData({ loading: false }) }
  },
  inputGoal(event: any) { this.setData({ goalKm: event.detail.value, savedNote: '' }) },
  async saveGoal() {
    if (this.data.loading || this.data.saving || this.data.claiming) return
    const goalKm = Number(this.data.goalKm)
    if (!Number.isFinite(goalKm) || goalKm < 0.5 || goalKm > 20 || Math.abs(goalKm * 10 - Math.round(goalKm * 10)) > 0.000001) { this.setData({ error: '每日跑步目标请填写0.5至20公里，保留一位小数' }); return }
    this.setData({ saving: true, error: '' })
    try {
      const rewards = await callEnglish('setCampusRunGoal', { goalKm })
      if (!this.disposed) { this.showRewards(rewards); this.setData({ savedNote: rewards.pendingRunGoal ? '目标已保存：' + rewards.pendingRunGoal.appliesOn + '起，每日' + rewards.pendingRunGoal.goalKm + '公里。' : '今日跑步目标已保存：' + rewards.runGoalKm + '公里。' }) }
    } catch (error) { if (!this.disposed) this.setData({ error: error instanceof Error ? error.message : '目标保存失败' }) }
    finally { if (!this.disposed) this.setData({ saving: false }) }
  },
  async claimRewards() {
    if (this.data.loading || this.data.saving || this.data.claiming) return
    this.setData({ claiming: true, error: '' })
    try { const rewards = await callEnglish('claimCampusRewards'); if (!this.disposed) { this.showRewards(rewards); this.setData({ savedNote: rewards.coinsEarned ? '本次领取' + rewards.coinsEarned + '金币。' : '任务进度已同步，已领取的奖励不会重复发放。' }) } }
    catch (error) { if (!this.disposed) this.setData({ error: error instanceof Error ? error.message : '奖励同步失败' }) }
    finally { if (!this.disposed) this.setData({ claiming: false }) }
  },
  openTask(event: any) {
    const task = this.data.tasks.find((item: any) => item.id === event.currentTarget.dataset.id)
    if (task && task.available && task.path) wx.navigateTo({ url: task.path })
  },
  openWardrobe() { wx.navigateTo({ url: '/packageProfile/pages/wardrobe/wardrobe' }) }
}))
