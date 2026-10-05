import { withSharing } from '../../../utils/page-share'
import { withPageCopy } from '../../../utils/page-copy'
import { callEnglish } from '../../../utils/english-api'
import { message, timeText } from '../../utils/format'
import { getSavedCampusTheme } from '../../../utils/campus-theme'

Page(withSharing(withPageCopy('englishRank', {
  data: { theme: getSavedCampusTheme('english'), level: 'CET4', type: 'study', period: 'day', loading: false, error: '', topThree: [] as any[],
    rows: [] as any[], myRank: null as any, myScore: 0, scoreLabel: '学习词数' },
  onLoad(options: any) {
    this.setData({ level: options.level === 'CET6' ? 'CET6' : 'CET4', type: ['study', 'challenge', 'exam'].includes(options.type) ? options.type : 'study' })
    this.loadRank()
  },
  onPullDownRefresh() { this.loadRank().finally(() => wx.stopPullDownRefresh()) },
  onShow() { this.setData({ theme: getSavedCampusTheme('english') }) },
  async loadRank() {
    const request = this.rankRequest = (this.rankRequest || 0) + 1
    const { level, type, period } = this.data
    this.setData({ loading: true, error: '', scoreLabel: type === 'study' ? '学习词数' : type === 'challenge' ? '答对题数' : '练习答对题数' })
    try {
      const result = await callEnglish('rank', { level, type, period })
      if (request !== this.rankRequest) return
      const openid = wx.getStorageSync('openid')
      const rows = (result.items || []).map((item: any) => ({ ...item, nickName: item.nickName || '同学',
        medal: ['🥇', '🥈', '🥉'][Number(item.rank) - 1] || '', isMine: item.openid === openid,
        checkedTime: timeText(item.checkedAt || item.lastCheckedAt), studyMinutes: Math.floor(Number(item.studySeconds || 0) / 60) }))
      this.setData({ topThree: rows.slice(0, 3), rows: rows.slice(3), myRank: result.myRank, myScore: result.myScore || 0 })
    } catch (error) { if (request === this.rankRequest) this.setData({ error: message(error) }) }
    finally { if (request === this.rankRequest) this.setData({ loading: false }) }
  },
  chooseFilter(event: any) {
    const { field, value } = event.currentTarget.dataset
    if (this.data[field] === value) return
    this.setData({ [field]: value, topThree: [], rows: [], myRank: null, myScore: 0 }); this.loadRank()
  }
})))
