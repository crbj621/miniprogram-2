import { withSharing } from '../../../utils/page-share'
import { withPageCopy } from '../../../utils/page-copy'
import { callGifts } from '../../../utils/gifts-api'
import { API_BASE_URL } from '../../../config/api'
Page(withSharing(withPageCopy('gifts', {
  data: { loading: false, error: '', catalog: null as any, sites: [] as any[], gallery: [] as any[], galleryHasMore: false, galleryLoading: false, galleryPage: 1 },
  catalogVersion: 0, destroyed: false,
  onShow() { return this.load(true) },
  onUnload() { this.destroyed = true; this.catalogVersion += 1 },
  onPullDownRefresh() { this.load(true).finally(() => wx.stopPullDownRefresh()) },
  async load(force = false) {
    if ((this.data.loading && force !== true) || this.destroyed) return
    const version = ++this.catalogVersion
    this.setData({ loading: true, error: '', galleryLoading: false })
    try {
      const catalog = await callGifts('catalog')
      if (this.destroyed || version !== this.catalogVersion) return
      this.setData({ catalog, sites: catalog.sites.map((site: any) => ({ ...site, expiresText: new Date(site.expiresAt).toLocaleString('zh-CN') })), gallery: catalog.gallery.sites, galleryHasMore: catalog.gallery.hasMore, galleryPage: 1 })
    } catch (error: any) { if (!this.destroyed && version === this.catalogVersion) this.setData({ error: error.message }) }
    finally { if (!this.destroyed && version === this.catalogVersion) this.setData({ loading: false }) }
  },
  async moreGallery() {
    if (this.data.loading || this.destroyed || this.data.galleryLoading || !this.data.galleryHasMore) return
    const version = this.catalogVersion
    this.setData({ galleryLoading: true })
    try {
      const page = this.data.galleryPage + 1, result = await callGifts('gallery', { page })
      if (this.destroyed || version !== this.catalogVersion) return
      this.setData({ gallery: this.data.gallery.concat(result.sites.filter((row: any) => !this.data.gallery.some(site => site.id === row.id))), galleryHasMore: result.hasMore, galleryPage: page })
    } catch (error: any) { if (!this.destroyed && version === this.catalogVersion) wx.showToast({ title: error.message, icon: 'none' }) }
    finally { if (!this.destroyed && version === this.catalogVersion) this.setData({ galleryLoading: false }) }
  },
  create(event: any) {
    if (this.data.sites.filter((site: any) => site.status === 'published').length >= 3) { wx.showToast({ title: '已上线3个，请先删除一个或等待到期', icon: 'none' }); return }
    wx.navigateTo({ url: '/packageGifts/pages/editor/editor?template=' + event.currentTarget.dataset.id })
  },
  edit(event: any) { wx.navigateTo({ url: '/packageGifts/pages/editor/editor?id=' + event.currentTarget.dataset.id }) },
  view(event: any) { wx.navigateTo({ url: '/packageGifts/pages/view/view?id=' + event.currentTarget.dataset.id }) },
  copy(event: any) { wx.setClipboardData({ data: event.currentTarget.dataset.url }) },
  tasks() { wx.navigateTo({ url: '/packageProfile/pages/tasks/tasks' }) },
  back() { wx.navigateTo({ url: '/pages/portal/portal' }) },
  preview(event: any) { wx.setClipboardData({ data: API_BASE_URL + '/gifts/demo/' + event.currentTarget.dataset.id }) },
  remove(event: any) {
    const id = event.currentTarget.dataset.id
    wx.showModal({ title: '删除这份祝福？', content: '网站链接会立即失效，已花费金币不退还。', success: async result => {
      if (!result.confirm) return
      try { await callGifts('delete', { id }); this.load(true) } catch (error: any) { this.setData({ error: error.message }) }
    } })
  }
})))
