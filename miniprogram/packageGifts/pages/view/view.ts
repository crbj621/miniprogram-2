import { withSharing } from '../../../utils/page-share'
import { API_BASE_URL } from '../../../config/api'
import { callGifts } from '../../../utils/gifts-api'
import { api } from '../../../utils/api-client'
import { elementText } from '../../utils/layout'
import { backgroundVideoData, backgroundVideoPlayer } from '../../utils/video'
Page(withSharing({
  ...backgroundVideoPlayer,
  data: { ...backgroundVideoData, id: '', demo: '', loading: false, error: '', site: null as any, backgroundPoster: '', opened: false, candleLit: true, expiresText: '', url: '', demoIcon: '💌', canvasElements: [] as any[], canvasPadding: 0, canvasFontScale: .8, messages: [] as any[], messageName: '', messageText: '', anonymous: false, sending: false, messageError: '' },
  previewTimer: 0, requesting: false, destroyed: false, contentVersion: 0,
  onLoad(options: any) { this.setData({ id: options.id || '', demo: options.demo || '' }); this.load() },
  onShow() { this.showBackgroundVideo(); clearInterval(this.previewTimer); this.previewTimer = setInterval(() => { if (this.data.site && this.data.site.preview) this.load(true) }, 2500) as unknown as number },
  onHide() { this.hideBackgroundVideo(); clearInterval(this.previewTimer) },
  onUnload() { this.destroyBackgroundVideo(); this.destroyed = true; this.contentVersion += 1; clearInterval(this.previewTimer) },
  load(quiet = false) {
    if (this.requesting || this.destroyed) return
    this.requesting = true
    if (quiet !== true) this.setData({ loading: true, error: '' })
    if (this.data.demo) {
      return callGifts('catalog').then(catalog => {
        const template = catalog.templates.find((row: any) => row.id === this.data.demo)
        if (!template) throw Error('模板不存在')
        const background = catalog.backgrounds.find((row: any) => row.id === template.previewBackground)
        if (!this.destroyed) this.setData({ site: { templateId: template.id, recipient: '小小的你', title: template.defaultTitle, message: template.defaultMessage, sender: '校园伙伴', background: template.previewBackground, effects: template.previewEffects }, backgroundPoster: background && (background.nativePoster || background.poster) ? API_BASE_URL + '/gift-assets/' + (background.nativePoster || background.poster) : '', demoIcon: template.icon, url: API_BASE_URL + '/gifts/demo/' + template.id })
        if (!this.destroyed) this.setBackgroundVideo(background && background.video, background && (background.widePoster || background.nativePoster || background.poster) || '')
      }).catch(error => { if (!this.destroyed) this.setData({ error: error.message }) }).finally(() => { this.requesting = false; if (!this.destroyed) this.setData({ loading: false }) })
    }
    return api.getPublic('/api/gifts/' + encodeURIComponent(this.data.id)).then(result => {
        if (this.destroyed) return
        if (!result || !result.success) throw Error(result && result.message || '这份祝福已到期或暂未开放')
        this.setData({ site: result.data, backgroundPoster: result.data.backgroundPoster ? API_BASE_URL + '/gift-assets/' + result.data.backgroundPoster : '', error: '', url: result.data.url, expiresText: new Date(result.data.expiresAt).toLocaleString('zh-CN') })
        this.setBackgroundVideo(result.data.backgroundVideo, result.data.backgroundPoster || '')
        if (result.data.layout) this.setData({ canvasElements: result.data.layout.elements.map((row: any) => ({ ...row, text: elementText(row, result.data) })), canvasPadding: result.data.layout.height / 360 * 100 })
        else this.setData({ canvasElements: [], canvasPadding: 0 })
    }).catch(error => {
      if (this.destroyed) return
      this.setData({ error: error.message })
      if (error.statusCode === 410) { this.contentVersion += 1; clearInterval(this.previewTimer); this.setBackgroundVideo(null, ''); this.setData({ site: null, backgroundPoster: '', url: '', messages: [], canvasElements: [], canvasPadding: 0, expiresText: '', opened: false }) }
    }).finally(() => { this.requesting = false; if (!this.destroyed) this.setData({ loading: false }) })
  },
  open() { this.setData({ opened: true }, () => this.createSelectorQuery().select('.gift-canvas-preview').boundingClientRect((rect: any) => { if (rect && rect.width) this.setData({ canvasFontScale: rect.width / 360 }) }).exec()); this.loadMessages() },
  async loadMessages() {
    if (!this.data.id || this.destroyed || !this.data.site) return
    const version = this.contentVersion
    try { const result = await api.getPublic('/api/gifts/' + this.data.id + '/messages'); if (!this.destroyed && version === this.contentVersion && result.success) this.setData({ messages: result.data }) }
    catch (error: any) { if (!this.destroyed && version === this.contentVersion) this.setData({ messageError: error.message }) }
  },
  messageInput(event: any) { const key = event.currentTarget.dataset.field; if (['messageName', 'messageText'].includes(key)) this.setData({ [key]: event.detail.value }) },
  anonymousChange(event: any) { this.setData({ anonymous: event.detail.value }) },
  async sendMessage() {
    if (this.destroyed || this.data.sending || !this.data.site || !this.data.id || !this.data.messageText.trim()) return
    const submitted = this.data.messageText, version = this.contentVersion
    this.setData({ sending: true, messageError: '' })
    try {
      const result = await api.postPublic('/api/gifts/' + this.data.id + '/messages', { name: this.data.messageName, message: submitted, anonymous: this.data.anonymous })
      if (this.destroyed || version !== this.contentVersion) return
      if (!result.success) throw Error(result.message)
      this.setData({ messages: result.data, messageText: this.data.messageText === submitted ? '' : this.data.messageText })
      wx.showToast({ title: '祝福已送达', icon: 'success' })
    } catch (error: any) { if (!this.destroyed && version === this.contentVersion) this.setData({ messageError: error.message }) }
    finally { if (!this.destroyed) this.setData({ sending: false }) }
  },
  blow() { this.setData({ candleLit: false }); wx.showToast({ title: '愿你的小愿望都实现 ✨', icon: 'none' }) },
  copy() { if (this.data.url) wx.setClipboardData({ data: this.data.url }) },
  home() { wx.navigateTo({ url: '/packageGifts/pages/index/index' }) }
}))
