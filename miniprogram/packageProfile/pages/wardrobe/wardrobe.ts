import { withSharing } from '../../../utils/page-share'
import { withPageCopy } from '../../../utils/page-copy'
import { api } from '../../../utils/api-client'
import { companionImageUrl, getCompanionAppearance } from '../../../components/campus-companion/companion-data'
import { CAMPUS_THEME_MODULES, getSavedCampusTheme, getCampusTheme, saveCampusThemes } from '../../../utils/campus-theme'

const categories = [
  { key: 'theme', name: '主题' }, { key: 'outfit', name: '衣服' },
  { key: 'accessory', name: '首饰' }, { key: 'shoes', name: '鞋子' }, { key: 'food', name: '食物' }
]
const symbols: any = { theme: '✿', outfit: '👕', accessory: '✧', shoes: '👟', food: '🍎' }

Page(withSharing(withPageCopy('wardrobe', {
  data: {
    state: 'loading', error: '', busy: '', wardrobe: null as any,
    appearance: getCompanionAppearance(null), theme: getSavedCampusTheme('profile'),
    categories, category: 'outfit', themeModules: CAMPUS_THEME_MODULES, themeModule: 'portal',
    items: [] as any[], feeding: false, foodSymbol: '🍎', expression: 'happy',
    view: 'shop', rankState: 'idle', rankError: '', ranking: null as any, rankItems: [] as any[]
  },
  _active: false,
  _version: 0,
  _requestIds: {} as { [key: string]: string },
  _feedingTimer: null as any,
  _rankVersion: 0,

  onLoad() {
    if (!getApp().isLoggedIn()) {
      wx.redirectTo({ url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent('/packageProfile/pages/wardrobe/wardrobe') })
    }
  },
  onShow() {
    if (!getApp().isLoggedIn()) return
    this._active = true
    this.setData({ theme: getSavedCampusTheme('profile') })
    this.loadWardrobe().then(() => { if (this._active && this.data.view === 'rank') this.loadRanking() })
  },
  onHide() { this._active = false; this._version += 1; this._rankVersion += 1; this.stopFeeding() },
  onUnload() { this._active = false; this._version += 1; this._rankVersion += 1; this.stopFeeding() },
  onPullDownRefresh() { this.loadWardrobe().then(() => this.data.view === 'rank' ? this.loadRanking() : null).finally(() => wx.stopPullDownRefresh()) },

  async callWardrobe(action: string, data: any = {}) {
    const response = await api.call({ name: 'english_learning', data: Object.assign({ action }, data) }) as any
    const result = response.result
    if (!result || result.success !== true || !result.data) {
      const error: any = new Error(result && (result.message || result.errMsg || result.msg) || '衣橱暂时无法加载')
      error.business = true
      throw error
    }
    return result.data
  },
  async loadWardrobe() {
    if (this.data.busy) return false
    const version = ++this._version
    this.setData({ state: 'loading', error: '' })
    try {
      const wardrobe = await this.callWardrobe('wardrobe')
      if (!this._active || version !== this._version) return false
      this.applyWardrobe(wardrobe)
      return true
    } catch (error) {
      if (this._active && version === this._version) this.setData({ state: 'error', error: error.message || '衣橱暂时无法加载' })
      return false
    }
  },
  applyWardrobe(wardrobe: any) {
    const themes = wardrobe.equipped && wardrobe.equipped.themes || { portal: wardrobe.theme || 'default' }
    saveCampusThemes(themes)
    this.setData({ wardrobe, state: 'ready', error: '', appearance: getCompanionAppearance(wardrobe), theme: getCampusTheme(themes.profile || 'default', 'profile') })
    this.updateItems()
  },
  selectView(event: any) {
    const view = event.currentTarget.dataset.view
    if (!['shop', 'rank'].includes(view) || view === this.data.view) return
    this.setData({ view })
    if (view === 'rank') this.loadRanking()
  },
  async loadRanking() {
    const version = ++this._rankVersion
    this.setData({ rankState: 'loading', rankError: '' })
    try {
      const ranking = await this.callWardrobe('wardrobeRank')
      if (!this._active || version !== this._rankVersion) return false
      const rankItems = (ranking.items || []).map((item: any) => Object.assign({}, item, {
        crown: item.rank === 1 ? '👑' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : '',
        title: item.rank === 1 ? '闪耀之星' : item.rank === 2 ? '人气伙伴' : item.rank === 3 ? '穿搭新星' : '校园伙伴'
      }))
      this.setData({ ranking, rankItems, rankState: 'ready' })
      return true
    } catch (error) {
      if (this._active && version === this._rankVersion) this.setData({ rankState: 'error', rankError: error.message || '装扮排行榜暂时无法加载' })
      return false
    }
  },
  updateItems() {
    const wardrobe = this.data.wardrobe
    if (!wardrobe) return
    const equipped = wardrobe.equipped || {}
    const owned = wardrobe.owned || []
    const stock = wardrobe.foodStock || {}
    const themes = equipped.themes || { portal: wardrobe.theme }
    const items = (wardrobe.catalog || []).filter((item: any) => item.category === this.data.category).map((item: any) => {
      const itemCharacter = item.character === 'girl' ? 'girl' : item.character === 'boy' ? 'boy' : wardrobe.character
      const images = item.imagesByCharacter || item.images || {}
      const compatible = !item.character || item.character === 'all' || item.character === wardrobe.character
      const isEquipped = item.category === 'theme' ? themes[this.data.themeModule] === item.id : equipped[item.category] === item.id
      return Object.assign({}, item, {
        preview: companionImageUrl(images[itemCharacter] || item.image),
        previewBase: item.renderMode === 'layer' ? companionImageUrl(wardrobe.assets && wardrobe.assets[itemCharacter]) : '',
        symbol: item.symbol || item.emoji || symbols[item.category],
        characterLabel: item.character === 'boy' ? '男生款' : item.character === 'girl' ? '女生款' : '通用',
        owned: owned.indexOf(item.id) >= 0, stock: Number(stock[item.id] || 0), compatible, isEquipped,
        previewTheme: getCampusTheme(item.themeKey || item.id, this.data.themeModule)
      })
    })
    this.setData({ items })
  },
  selectCategory(event: any) {
    const category = event.currentTarget.dataset.key
    if (!categories.some(item => item.key === category)) return
    this.setData({ category })
    this.updateItems()
  },
  selectThemeModule(event: any) {
    const themeModule = event.currentTarget.dataset.key
    if (!CAMPUS_THEME_MODULES.some(item => item.key === themeModule)) return
    this.setData({ themeModule })
    this.updateItems()
  },
  async mutate(action: string, data: any, operation: string) {
    if (this.data.busy || this.data.state !== 'ready') return null
    const requestId = this._requestIds[operation] || 'wardrobe-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
    this._requestIds[operation] = requestId
    const version = ++this._version
    this.setData({ busy: operation })
    try {
      const wardrobe = await this.callWardrobe(action, Object.assign({}, data, { requestId }))
      delete this._requestIds[operation]
      if (!this._active || version !== this._version) return null
      this.applyWardrobe(wardrobe)
      return wardrobe
    } catch (error) {
      if (error.business) delete this._requestIds[operation]
      if (this._active) wx.showToast({ title: error.message || '操作失败，请重试', icon: 'none', duration: 2600 })
      return null
    } finally {
      this.setData({ busy: '' })
      if (this._active && version !== this._version) this.loadWardrobe()
    }
  },
  async selectCharacter(event: any) {
    const character = event.currentTarget.dataset.character
    if (character !== 'boy' && character !== 'girl' || character === this.data.appearance.character) return
    if (await this.mutate('selectCharacter', { character }, 'character-' + character)) wx.showToast({ title: '形象已切换', icon: 'success' })
  },
  async buyItem(event: any) {
    const itemId = event.currentTarget.dataset.id
    if (await this.mutate('buyItem', { itemId }, 'buy-' + itemId)) wx.showToast({ title: '已放进衣橱', icon: 'success' })
  },
  async equipItem(event: any) {
    const itemId = event.currentTarget.dataset.id
    if (await this.mutate('equipItem', { itemId, module: this.data.themeModule }, 'equip-' + itemId + '-' + this.data.themeModule)) wx.showToast({ title: '装扮已保存', icon: 'success' })
  },
  async resetEquipment() {
    const slot = this.data.category
    if (slot === 'food') return
    if (await this.mutate('equipItem', { itemId: '', slot, module: this.data.themeModule }, 'reset-' + slot + '-' + this.data.themeModule)) wx.showToast({ title: '已恢复初始装扮', icon: 'success' })
  },
  async feed(event: any) {
    const itemId = event.currentTarget.dataset.id
    const item = this.data.items.find(row => row.id === itemId)
    if (!item || !item.stock || this.data.feeding) return
    const wardrobe = await this.mutate('feed', { itemId }, 'feed-' + itemId)
    if (!wardrobe) return
    this.setData({ feeding: true, foodSymbol: item.symbol, expression: wardrobe.expression || 'yum' })
    this._feedingTimer = setTimeout(() => { this._feedingTimer = null; if (this._active) this.setData({ feeding: false }) }, 1800)
  },
  stopFeeding() {
    if (this._feedingTimer) clearTimeout(this._feedingTimer)
    this._feedingTimer = null
    this.setData({ feeding: false })
  },
  goToTasks() { wx.navigateTo({ url: '/packageProfile/pages/tasks/tasks' }) }
})))
