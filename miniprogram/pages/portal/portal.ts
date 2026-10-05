import { withSharing } from '../../utils/page-share'
import { withPageCopy, getPageCopy } from '../../utils/page-copy'
import { api } from '../../utils/api-client'
import { getPublicModules } from '../../utils/public-modules'
import { getPortalDaily } from '../../utils/portal-daily'
import { getCompanionAppearance, companionImageUrl } from '../../components/campus-companion/companion-data'
import { getSavedCampusTheme, getCampusTheme, saveCampusThemes } from '../../utils/campus-theme'

function statusClock(value: number | null): string {
  if (value === null) return '未确认'
  const time = new Date(value)
  return [time.getHours(), time.getMinutes(), time.getSeconds()].map(item => String(item).padStart(2, '0')).join(':')
}
function statusPercent(value: number | null): string { return value === null ? '—' : value.toFixed(1) + '%' }
function statusBytes(value: number | null): string { return value === null ? '—' : value >= 1024 ** 3 ? (value / 1024 ** 3).toFixed(2) + ' GiB' : Math.round(value / 1024 ** 2) + ' MiB' }
function statusDateClock(value: number | null): string {
  if (value === null) return '未确认'
  const time = new Date(value)
  return (time.getMonth() + 1) + '/' + time.getDate() + ' ' + statusClock(value).slice(0, 5)
}
function statusUptime(value: number | null): string {
  if (value === null) return '—'
  const seconds = Math.floor(value), minutes = Math.floor(seconds / 60) % 60, hours = Math.floor(seconds / 3600) % 24, days = Math.floor(seconds / 86400)
  return days ? days + '天' + hours + '时' : hours ? hours + '时' + minutes + '分' : seconds >= 60 ? minutes + '分' : seconds + '秒'
}
function statusExternal(value: any): any {
  return { state: value.state, label: value.state === 'reachable' ? '可达' : value.state === 'unreachable' ? '不可达' : value.state === 'restricted' ? '受限' : '未确认', checkedAt: statusDateClock(value.checkedAt), route: value.route === 'proxy' ? '代理' : value.route === 'direct' ? '直连' : '未确认' }
}
const emptyServerHealth = { state: 'unconfirmed', label: '未检测', database: '未确认', elapsed: '—', checkedAt: '—', sampledAt: '未确认', cpu: '—', memory: '—', memoryDetail: '—', diskTotal: '—', diskUsed: '—', diskAvailable: '—', diskUsage: '—', diskProgress: null as number | null, websiteStorage: '—', websiteStorageCheckedAt: '未确认', uptime: '—', uptimeDetail: '', bootedAt: '未确认', giftActiveCount: '—', giftPublicCount: '—', google: { state: 'unconfirmed', label: '未确认', checkedAt: '未确认', route: '未确认' }, youtube: { state: 'unconfirmed', label: '未确认', checkedAt: '未确认', route: '未确认' }, updating: false, note: '主机状态约每10秒更新' }

Page(withSharing(withPageCopy('portal', {
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => Promise.all([this.loadModules(), this.loadCompanion(), this.loadServerHealth()]).then(results => results[0] && results[2])) },
  data: {
    userInfo: null,
    isLoggedIn: false,
    daily: getPortalDaily(),
    sectionCopy: { title: '你的校园小站', subtitle: '把日常安排得刚刚好' },
    moduleCopy: {},
    modules: { running: false, food: false, canteen: false, forum: false, rider: false, english: false, gifts: false },
    modulesState: 'loading',
    hasOpenModules: false,
    companion: getCompanionAppearance(null),
    companionState: 'loading',
    theme: getSavedCampusTheme('portal'),
    serverHealth: { ...emptyServerHealth },
    serverDetailsExpanded: false,
    serverMascotImage: companionImageUrl('/english-assets/companions/girl-base.png'),
    personalHomepage: 'https://www.crbuj.icu/'
  },
  _companionVersion: 0,
  _healthVersion: 0,
  _healthTimer: null as number | null,
  _healthPromise: null as Promise<boolean> | null,
  _visible: false,

  onLoad() {
    this.setData({
      sectionCopy: getPageCopy('portalSection'),
      moduleCopy: {
        running: getPageCopy('running'), food: getPageCopy('food'), canteen: getPageCopy('canteen'),
        forum: getPageCopy('forum'), english: getPageCopy('english'), gifts: getPageCopy('gifts')
      }
    })
  },

  onShow() {
    this._visible = true
    const app = getApp()
    const isLoggedIn = app.isLoggedIn()
    const userInfo = isLoggedIn ? app.getUserInfo() : null
    this.setData({ userInfo, isLoggedIn, daily: getPortalDaily(), theme: getSavedCampusTheme('portal') })

    this.loadModules()
    this.loadCompanion()
    this.loadServerHealth()

    this.showAnnouncementIfNeeded()
  },
  onHide() { this._visible = false; this._companionVersion += 1; this.stopServerStatusPolling() },
  onUnload() { this._visible = false; this._companionVersion += 1; this.stopServerStatusPolling() },

  stopServerStatusPolling() {
    if (this._healthTimer !== null) clearTimeout(this._healthTimer)
    this._healthTimer = null; this._healthPromise = null; this._healthVersion += 1
  },
  loadServerHealth(): Promise<boolean> {
    if (!this._visible) return Promise.resolve(false)
    if (this._healthPromise) return this._healthPromise
    if (this._healthTimer !== null) clearTimeout(this._healthTimer)
    this._healthTimer = null
    const version = ++this._healthVersion
    this.setData({ serverHealth: { ...this.data.serverHealth, ...(this.data.serverHealth.label === '未检测' ? { state: 'loading', label: '检测中' } : {}), updating: true } })
    let request: Promise<boolean>
    request = (async () => {
      try {
        const health = await api.getServerStatus()
        if (!this._visible || version !== this._healthVersion) return false
        this.setData({ serverHealth: {
          state: health.state, label: health.state === 'online' ? '在线' : health.state === 'error' ? '异常' : '未确认',
          database: health.database === 'ok' ? '正常' : health.database === 'error' ? '异常' : '未确认',
          elapsed: health.elapsedMs === null ? '—' : health.elapsedMs + ' ms', checkedAt: statusClock(health.checkedAt), sampledAt: statusClock(health.sampledAt),
          cpu: statusPercent(health.cpuUsagePercent), memory: statusPercent(health.memoryUsagePercent),
          memoryDetail: statusBytes(health.memoryUsedBytes) + ' / ' + statusBytes(health.memoryTotalBytes), uptime: statusUptime(health.uptimeSeconds),
          diskTotal: statusBytes(health.diskTotalBytes), diskUsed: statusBytes(health.diskUsedBytes), diskAvailable: statusBytes(health.diskAvailableBytes), diskUsage: statusPercent(health.diskUsagePercent), diskProgress: health.diskUsagePercent,
          websiteStorage: statusBytes(health.websiteStorageUsedBytes), websiteStorageCheckedAt: statusDateClock(health.websiteStorageCheckedAt),
          uptimeDetail: health.uptimeSeconds === null ? '' : Math.floor(health.uptimeSeconds / 86400) + '天 ' + Math.floor(health.uptimeSeconds / 3600) % 24 + '小时 ' + Math.floor(health.uptimeSeconds / 60) % 60 + '分钟', bootedAt: statusDateClock(health.bootedAt),
          giftActiveCount: health.giftActiveCount === null ? '—' : String(health.giftActiveCount), giftPublicCount: health.giftPublicCount === null ? '—' : String(health.giftPublicCount),
          google: statusExternal(health.external.google), youtube: statusExternal(health.external.youtube), updating: false,
          note: health.state === 'online' ? '主机状态约每10秒更新' : health.state === 'error' ? '服务暂时异常，可以稍后再试' : '暂未确认状态，请稍后重试'
        } })
        return health.state === 'online'
      } catch (error) {
        if (this._visible && version === this._healthVersion) this.setData({ serverHealth: { ...emptyServerHealth, label: '未确认', checkedAt: statusClock(Date.now()), note: '暂未确认状态，请检查网络后重试' } })
        return false
      }
    })().finally(() => {
      if (this._healthPromise !== request) return
      this._healthPromise = null
      if (this._visible && version === this._healthVersion) this._healthTimer = setTimeout(() => { this._healthTimer = null; this.loadServerHealth() }, 10000) as any
    })
    this._healthPromise = request
    return request
  },
  toggleServerDetails() { this.setData({ serverDetailsExpanded: !this.data.serverDetailsExpanded }) },
  copyPersonalHomepage() { wx.setClipboardData({ data: this.data.personalHomepage }) },

  async loadCompanion() {
    const version = ++this._companionVersion
    if (!getApp().isLoggedIn()) {
      this.setData({ companion: getCompanionAppearance(null), companionState: 'guest' })
      return true
    }
    this.setData({ companionState: 'loading' })
    try {
      const response = await api.call({ name: 'english_learning', data: { action: 'wardrobe' } }) as any
      const result = response.result
      if (!result || result.success !== true || !result.data) throw new Error(result && (result.message || result.errMsg || result.msg) || '伙伴暂时无法加载')
      if (!this._visible || version !== this._companionVersion) return false
      const wardrobe = result.data
      const themes = wardrobe.equipped && wardrobe.equipped.themes || { portal: wardrobe.theme || 'default' }
      saveCampusThemes(themes)
      this.setData({ companion: getCompanionAppearance(wardrobe), companionState: 'ready', theme: getCampusTheme(themes.portal || 'default', 'portal') }, () => {
        const component = this.selectComponent('#portal-companion')
        if (component) component.retryImages()
      })
      return true
    } catch (error) {
      if (this._visible && version === this._companionVersion) this.setData({ companionState: 'error' })
      return false
    }
  },
  onCompanionImageError() { this.setData({ companionState: 'error' }) },

  async loadModules() {
    this.setData({ modulesState: 'loading' })
    try {
      const modules = await getPublicModules()
      this.setData({ modules, modulesState: 'ready', hasOpenModules: modules.running || modules.food || modules.canteen || modules.forum || modules.english || modules.gifts })
      return true
    } catch (error) {
      console.error('读取模块开关失败', error)
      this.setData({ modulesState: 'error' })
      return false
    }
  },

  async showAnnouncementIfNeeded() {
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'getPublishedAnnouncements', data: { page: 1, pageSize: 1 } }
      }) as any

      if (!(res.result && res.result.code === 0)) return
      const list = (res.result.data && res.result.data.list) ? res.result.data.list : []
      if (!list.length) return

      const a = list[0]
      const lastShown = wx.getStorageSync('lastAnnouncementId')
      if (lastShown === a._id) return

      wx.setStorageSync('lastAnnouncementId', a._id)
      wx.showModal({
        title: a.title || '公告',
        content: a.content || '',
        showCancel: false,
        confirmText: '我知道了'
      })
    } catch (e) {}
  },

  onPullDownRefresh() { Promise.all([this.loadModules(), this.loadServerHealth()]).finally(() => wx.stopPullDownRefresh()) },

  goToRun() {
    wx.navigateTo({
      url: '/pages/index/index'
    })
  },

  goToFood() {
    wx.navigateTo({
      url: '/packageFood/pages/index/index'
    })
  },

  goToCanteen() {
    wx.navigateTo({ url: '/packageCanteen/pages/index/index' })
  },

  goToForum() {
    wx.navigateTo({
      url: '/packageForum/pages/index/index'
    })
  },

  goToEnglish() { wx.navigateTo({ url: '/packageEnglish/pages/index/index' }) },
  goToGifts() { wx.navigateTo({ url: '/packageGifts/pages/index/index' }) },

  goToWardrobe() {
    if (!getApp().isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent('/packageProfile/pages/wardrobe/wardrobe') })
      return
    }
    wx.navigateTo({ url: '/packageProfile/pages/wardrobe/wardrobe' })
  },

  goToProfile() {
    wx.navigateTo({
      url: '/pages/profile/profile'
    })
  },

  goToAdminLogin() {
    wx.navigateTo({
      // 统一管理端入口
      url: '/pages/admin/login/login'
    })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出吗？',
      success: (res) => {
        if (res.confirm) {
          const app = getApp()
          app.doLogout()
          this.setData({ userInfo: null, isLoggedIn: false })
          wx.reLaunch({
            url: '/pages/login/login?forceLogin=true'
          })
        }
      }
    })
  }
})))
