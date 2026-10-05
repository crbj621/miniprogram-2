import { withSharing } from '../../../utils/page-share'
import { callGifts, giftRequestId } from '../../../utils/gifts-api'
import { api } from '../../../utils/api-client'
import { API_BASE_URL } from '../../../config/api'
import { defaultLayout, elementText } from '../../utils/layout'
import { backgroundVideoData, backgroundVideoPlayer } from '../../utils/video'
Page(withSharing({
  ...backgroundVideoPlayer,
  data: { ...backgroundVideoData, loading: false, saving: false, error: '', id: '', templateId: 'birthday', catalog: null as any,
    recipient: '', sender: '', title: '', message: '', background: 'peach', backgroundPoster: '', backgroundDescription: '', selectedBackgroundVideo: false, effects: ['balloons', 'sparkles'] as string[],
    effectOptions: [] as any[], purchasedEffects: [] as string[], purchasedBackgrounds: [] as string[], staticBackgrounds: [] as any[], dynamicBackgrounds: [] as any[], suggestions: [] as string[],
    layout: null as any, canvasElements: [] as any[], canvasWidth: 280, canvasHeight: 540, selectedId: '', selectedElement: null as any, uploading: false,
    durationId: '3d', trial: false, domainLabel: '', listed: false, price: 0, published: null as any, preview: null as any, previewSyncing: false, previewError: '', durationText: '3天' },
  previewTimer: 0, leaseTimer: 0, previewWanted: false, previewVisible: false, previewDirty: false, previewDestroyed: false, lastPreviewId: '', previewPromise: null as Promise<void> | null,
  onLoad(options: any) { this.setData({ id: options.id || '', templateId: options.template || 'birthday' }); this.load() },
  onShow() { this.showBackgroundVideo(); this.previewVisible = true; if (this.previewWanted) this.queuePreview(); clearInterval(this.leaseTimer); this.leaseTimer = setInterval(() => { if (this.previewWanted && !this.data.published) this.renewPreview() }, 45000) as unknown as number },
  onHide() { this.hideBackgroundVideo(); this.stopPreview() },
  onUnload() { this.destroyBackgroundVideo(); this.previewDestroyed = true; this.stopPreview() },
  stopPreview() {
    this.previewVisible = false; clearInterval(this.leaseTimer); clearTimeout(this.previewTimer)
    Promise.resolve(this.previewPromise).then(() => {
      if (!this.previewVisible && this.lastPreviewId) return callGifts('releasePreview', { id: this.lastPreviewId })
      return undefined
    }).catch(() => {})
  },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const catalog = await callGifts('catalog'), site = this.data.id && catalog.sites.find((row: any) => row.id === this.data.id)
      if (this.previewDestroyed) return
      if (this.data.id && !site) throw Error('网站已到期或不存在，请返回重新创建')
      const template = catalog.templates.find((row: any) => row.id === (site ? site.templateId : this.data.templateId))
      if (!template) throw Error('模板不存在')
      this.setData({ catalog, ...(site ? { ...site, published: null } : { title: template.defaultTitle, message: template.defaultMessage, layout: defaultLayout(), background: catalog.trialAvailable ? template.previewBackground : 'peach', effects: catalog.trialAvailable ? template.previewEffects : ['balloons', 'sparkles'], trial: catalog.trialAvailable }), templateId: template.id })
      this.quote()
      this.setData({ suggestions: template.suggestions || [template.defaultMessage] }); this.updateCanvas()
    } catch (error: any) { if (!this.previewDestroyed) this.setData({ error: error.message }) }
    finally { if (!this.previewDestroyed) this.setData({ loading: false }) }
  },
  input(event: any) { const field = event.currentTarget.dataset.field; if (['recipient', 'sender', 'title', 'message', 'domainLabel'].includes(field)) { this.setData({ [field]: event.detail.value }); this.quote(); this.updateCanvas(); this.queuePreview() } },
  chooseListed(event: any) { this.setData({ listed: event.detail.value }); this.queuePreview() },
  chooseBackground(event: any) {
    const background = this.data.catalog.backgrounds.find((row: any) => row.id === event.currentTarget.dataset.id)
    this.setData({ background: background.id }); this.quote(); this.queuePreview()
  },
  recommend() { wx.showActionSheet({ itemList: this.data.suggestions.map(row => row.slice(0, 22)), success: result => { this.setData({ message: this.data.suggestions[result.tapIndex] }); this.updateCanvas(); this.queuePreview() } }) },
  chooseDuration(event: any) { this.setData({ durationId: event.currentTarget.dataset.id, trial: false }); this.quote() },
  chooseTrial() { if (!this.data.id && this.data.catalog.trialAvailable) { this.setData({ trial: true, domainLabel: '' }); this.quote() } },
  chooseEffect(event: any) {
    const id = event.currentTarget.dataset.id
    this.setData({ effects: this.data.effects.includes(id) ? this.data.effects.filter(value => value !== id) : this.data.effects.concat(id) }); this.quote(); this.queuePreview()
  },
  quote() {
    const catalog = this.data.catalog; if (!catalog) return
    const effects = catalog.effects.map((item: any) => ({ ...item, selected: this.data.effects.includes(item.id), purchased: this.data.purchasedEffects.includes(item.id) }))
    const effectPrice = effects.filter((item: any) => item.selected && !item.purchased).reduce((sum: number, item: any) => sum + item.price, 0)
    const backgrounds = catalog.backgrounds.map((item: any) => ({ ...item, posterUrl: (item.nativePoster || item.poster) ? API_BASE_URL + '/gift-assets/' + (item.nativePoster || item.poster) : '', purchased: this.data.purchasedBackgrounds.includes(item.id) }))
    const selectedBackground = backgrounds.find((item: any) => item.id === this.data.background)
    const backgroundPrice = this.data.purchasedBackgrounds.includes(this.data.background) ? 0 : backgrounds.find((item: any) => item.id === this.data.background).price
    const duration = catalog.durations.find((item: any) => item.id === this.data.durationId) || catalog.durations[0]
    const price = this.data.trial ? 0 : this.data.id ? effectPrice + backgroundPrice : duration.price + (this.data.domainLabel.trim() ? catalog.customDomainPrice : 0) + effectPrice + backgroundPrice
    this.setData({ effectOptions: effects, staticBackgrounds: backgrounds.filter((row: any) => row.kind === 'static'), dynamicBackgrounds: backgrounds.filter((row: any) => row.kind === 'dynamic'), backgroundPoster: selectedBackground.posterUrl, backgroundDescription: selectedBackground.description || '', selectedBackgroundVideo: Boolean(selectedBackground.video), price, durationText: this.data.trial ? this.data.id ? '首次体验（原到期时间保留）' : '2小时（首次全特效体验）' : duration.name })
    this.setBackgroundVideo(this.data.published ? null : selectedBackground.video, selectedBackground.widePoster || selectedBackground.nativePoster || selectedBackground.poster || '')
  },
  previewPayload() { const { templateId, recipient, sender, title, message, background, effects, layout, listed } = this.data; return JSON.parse(JSON.stringify({ templateId, recipient, sender, title, message, background, effects, layout, listed })) },
  queuePreview() {
    if (!this.previewWanted || !this.previewVisible || this.previewDestroyed || this.data.published || this.data.saving) return
    this.previewDirty = true; clearTimeout(this.previewTimer)
    this.previewTimer = setTimeout(() => this.syncPreview(), 500) as unknown as number
  },
  async syncPreview(): Promise<void> {
    if (this.previewPromise) { await this.previewPromise; if (this.previewDirty && this.previewVisible && !this.previewDestroyed && !this.data.published) return this.syncPreview(); return }
    this.previewPromise = (async () => {
      while (this.previewDirty && this.previewVisible && !this.previewDestroyed && !this.data.published) {
        this.previewDirty = false; this.setData({ previewSyncing: true, previewError: '' })
        try { const result = await callGifts('preview', this.previewPayload()); this.lastPreviewId = result.site.id; if (!this.previewDestroyed) this.setData({ preview: result.site }) }
        catch (error: any) { if (!this.previewDestroyed) this.setData({ previewError: error.message }); break }
        finally { if (!this.previewDestroyed) this.setData({ previewSyncing: false }) }
      }
    })().finally(() => { this.previewPromise = null })
    return this.previewPromise
  },
  async renewPreview() {
    if (!this.previewVisible || this.previewDestroyed || this.previewPromise || this.data.saving || this.data.published) return
    if (this.previewDirty) { await this.syncPreview(); return }
    if (!this.lastPreviewId) { this.queuePreview(); return }
    this.previewPromise = callGifts('renewPreview', { id: this.lastPreviewId }).then(result => {
      if (this.previewDestroyed) return
      if (result.site) this.setData({ preview: result.site })
      else { this.lastPreviewId = ''; this.setData({ preview: null }); this.queuePreview() }
    }).catch(() => {}).finally(() => { this.previewPromise = null })
    await this.previewPromise
  },
  async previewWebsite() {
    if (!this.data.recipient.trim() || !this.data.title.trim() || !this.data.message.trim()) { this.setData({ error: '请先填写姓名、标题和祝福内容' }); return }
    this.previewWanted = true; this.previewDirty = true; clearTimeout(this.previewTimer); await this.syncPreview()
    if (this.previewDestroyed) return
    this.setData({ error: this.data.previewError })
    if (this.data.preview && !this.data.previewError) wx.showToast({ title: '免费预览已准备好', icon: 'success' })
  },
  copyPreview() { if (this.data.preview) wx.setClipboardData({ data: this.data.preview.url }) },
  toggleLayout() { this.setData({ layout: this.data.layout ? null : defaultLayout(), selectedId: '', selectedElement: null }); this.updateCanvas(); this.queuePreview() },
  updateCanvas() {
    if (!this.data.layout) { this.setData({ canvasElements: [] }); return }
    wx.nextTick(() => { if (this.previewDestroyed) return; this.createSelectorQuery().select('#gift-canvas').boundingClientRect((rect: any) => {
      if (!this.data.layout || this.previewDestroyed) return
      const width = rect && rect.width || this.data.canvasWidth, height = width * this.data.layout.height / 360
      this.setData({ layout: this.data.layout, canvasWidth: width, canvasHeight: height, canvasElements: this.data.layout.elements.map((row: any) => ({ ...row, px: row.x / 100 * width, py: row.y / 100 * height, text: elementText(row, this.data), size: row.fontSize * width / 360 })) })
    }).exec() })
  },
  selectElement(event: any) { const id = event.currentTarget.dataset.id; this.setData({ selectedId: id, selectedElement: this.data.layout.elements.find((row: any) => row.id === id) }) },
  moveElement(event: any) {
    if (!this.data.layout || !['touch', 'touch-out-of-bounds'].includes(event.detail.source)) return
    const row = this.data.layout.elements.find((item: any) => item.id === event.currentTarget.dataset.id)
    if (!row) return
    row.x = Math.max(0, Math.min(100 - row.width, event.detail.x / this.data.canvasWidth * 100)); row.y = Math.max(0, Math.min(95, event.detail.y / this.data.canvasHeight * 100))
    this.queuePreview()
  },
  addElement(event: any) {
    if (!this.data.layout || this.data.layout.elements.length >= 12) { wx.showToast({ title: '画布最多12个元素', icon: 'none' }); return }
    const type = event.currentTarget.dataset.type
    if (type === 'image') { this.addImage(); return }
    const row = { id: 'e-' + giftRequestId(), type, x: 10, y: 55, width: type === 'sticker' ? 20 : 75, fontSize: type === 'sticker' ? 40 : 18, color: '#906489', value: type === 'sticker' ? '🌷' : '写一点特别的话' }
    this.data.layout.elements.push(row); this.setData({ selectedId: row.id, selectedElement: row }); this.updateCanvas(); this.queuePreview()
  },
  addImage() {
    wx.chooseMedia({ count: 1, mediaType: ['image'], success: async result => {
      this.setData({ uploading: true })
      try {
        const compressed = await wx.compressImage({ src: result.tempFiles[0].tempFilePath, quality: 70 })
        const upload = await api.uploadFile({ cloudPath: 'gift-sites/' + giftRequestId() + '.jpg', filePath: compressed.tempFilePath })
        if (!this.data.layout || this.data.layout.elements.length >= 12) return
        const row = { id: 'e-' + giftRequestId(), type: 'image', x: 15, y: 45, width: 60, fontSize: 18, color: '#906489', value: upload.fileID }
        this.data.layout.elements.push(row); this.setData({ selectedId: row.id, selectedElement: row }); this.updateCanvas(); this.queuePreview()
      } catch (error: any) { wx.showToast({ title: error.message || '图片上传失败', icon: 'none' }) }
      finally { this.setData({ uploading: false }) }
    } })
  },
  changeElement(event: any) {
    const row = this.data.layout.elements.find((item: any) => item.id === this.data.selectedId), field = event.currentTarget.dataset.field
    if (!row) return
    if (field === 'value' && ['text', 'sticker'].includes(row.type)) row.value = event.detail.value
    if (field === 'fontSize') row.fontSize = Number(event.detail.value)
    if (field === 'width') { row.width = Number(event.detail.value); row.x = Math.min(row.x, 100 - row.width) }
    if (field === 'color') row.color = event.currentTarget.dataset.color
    this.setData({ selectedElement: { ...row } }); this.updateCanvas(); this.queuePreview()
  },
  removeElement() { this.data.layout.elements = this.data.layout.elements.filter((row: any) => row.id !== this.data.selectedId); this.setData({ selectedId: '', selectedElement: null }); this.updateCanvas(); this.queuePreview() },
  canvasHeight(event: any) { this.data.layout.height = Number(event.detail.value); this.updateCanvas(); this.queuePreview() },
  async submit() {
    if (this.data.saving || this.data.uploading || !this.data.catalog) return
    if (!this.data.recipient.trim() || !this.data.title.trim() || !this.data.message.trim()) { this.setData({ error: '请填写姓名、标题和祝福内容' }); return }
    if (!this.previewWanted) { await this.previewWebsite(); return }
    this.previewDirty = true; clearTimeout(this.previewTimer); await this.syncPreview()
    if (this.previewDestroyed || !this.previewVisible) return
    if (this.data.previewError || !this.data.preview) return
    wx.showModal({ title: this.data.id ? '确认保存修改' : '预览满意，确认上线', content: '本次共' + this.data.price + '金币。' + (this.data.id ? '仅新增背景／特效收费；原域名和到期时间保留。' : '有效期' + this.data.durationText + '，到期自动清理。') + (this.data.listed ? '将公示到祝福广场。' : '不在广场列出，可通过链接分享。'), success: result => { if (result.confirm) this.publish() } })
  },
  async publish() {
    if (this.data.saving) return
    this.setData({ saving: true, error: '' })
    try {
      this.previewDirty = true; clearTimeout(this.previewTimer); await this.syncPreview()
      if (this.previewDestroyed || !this.previewVisible || this.data.previewError || !this.data.preview) return
      if (!this.requestId) this.requestId = giftRequestId()
      const { id, templateId, recipient, sender, title, message, background, effects, durationId, trial, domainLabel, layout, listed } = this.data
      const result = await callGifts(id ? 'update' : 'create', { id, templateId, recipient, sender, title, message, background, effects, durationId: trial ? '2h' : durationId, trial, domainLabel, layout, listed, previewId: this.data.preview && this.data.preview.id, requestId: this.requestId })
      this.lastPreviewId = ''; this.previewDirty = false; this.previewWanted = false; clearInterval(this.leaseTimer); clearTimeout(this.previewTimer)
      if (this.previewDestroyed) return
      this.setData({ id: result.site.id, published: result.site, 'catalog.coins': result.coins,
        purchasedEffects: [...new Set(this.data.purchasedEffects.concat(effects))],
        purchasedBackgrounds: [...new Set(this.data.purchasedBackgrounds.concat(background))], preview: null }); this.requestId = ''; this.quote(); clearInterval(this.leaseTimer)
      wx.showToast({ title: '心意已经上线', icon: 'success' })
    } catch (error: any) { if (!this.previewDestroyed) this.setData({ error: error.message }) }
    finally { if (!this.previewDestroyed) this.setData({ saving: false }) }
  },
  copy() { if (this.data.published) wx.setClipboardData({ data: this.data.published.url }) },
  view() { if (this.data.published) wx.navigateTo({ url: '/packageGifts/pages/view/view?id=' + this.data.published.id }) },
  back() { wx.navigateBack() }
}))
