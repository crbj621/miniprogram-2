import { withSharing } from '../../../utils/page-share'
import { callCanteen, canReview, newCanteenId } from '../../utils/api'
import { api } from '../../../utils/api-client'
import { API_BASE_URL } from '../../../config/api'
import { callEnglish } from '../../../utils/english-api'

const uploadPrefix = API_BASE_URL.replace(/\/+$/, '') + '/uploads/'
function isUploadedImage(url: any) { return typeof url === 'string' && url.startsWith(uploadPrefix) }

Page(withSharing({
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.load()) },
  data: { id: '', dish: null as any, stall: null as any, reviews: [] as any[],
    score: 0, count: 0, reviewCount: 0, myRating: null as any, rateWithComment: false, ratingLocked: false, myScore: 0, comment: '', images: [] as string[], uploading: false,
    uploadError: '', likingReview: '', deletingReview: '', reviewSort: 'latest', saving: false, stars: [1, 2, 3, 4, 5] },
  disposed: false,
  loadVersion: 0,
  draftVersion: 0,
  draftEdited: false,
  formOwner: '',
  pendingPost: null as any,
  onLoad(options: any) { this.setData({ id: options.id || '' }) },
  onShow() {
    const owner = wx.getStorageSync('openid') || ''
    if (owner !== this.formOwner) {
      this.formOwner = owner; this.draftEdited = false; this.draftVersion += 1
      this.pendingPost = null
      this.setData({ myScore: 0, myRating: null, rateWithComment: false, ratingLocked: false, comment: '', images: [], uploadError: '' })
    }
    if (this.data.id) this.load()
  },
  onUnload() { this.disposed = true; this.loadVersion += 1 },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  isCurrent(owner: string) { return !this.disposed && owner === (wx.getStorageSync('openid') || '') },
  async load(fillForm = true) {
    const version = ++this.loadVersion, draftVersion = this.draftVersion
    const owner = wx.getStorageSync('openid') || ''
    try {
      const result = await callCanteen('reviews', { dishId: this.data.id, sort: this.data.reviewSort })
      if (!this.isCurrent(owner) || version !== this.loadVersion) return false
      const reviews = (result.reviews || []).map((row: any) => Object.assign({}, row, {
        images: Array.isArray(row.images) ? row.images.filter(isUploadedImage).slice(0, 4) : [],
        likeCount: Number(row.likeCount) || 0, isLiked: Boolean(row.isLiked)
      }))
      const update: any = { dish: result.dish, stall: result.stall, reviews, score: result.score, count: result.count, reviewCount: result.reviewCount,
        myRating: result.myRating || null, ratingLocked: Boolean(result.myRating && ['contested', 'excluded', 'hidden'].includes(result.myRating.status)) }
      if (fillForm && !this.draftEdited && !this.data.uploading && draftVersion === this.draftVersion) {
        Object.assign(update, { myScore: result.myRating ? result.myRating.score : 0, rateWithComment: false })
      }
      this.setData(update)
      wx.setNavigationBarTitle({ title: result.dish.name })
      return true
    } catch (error: any) { if (this.isCurrent(owner) && version === this.loadVersion) wx.showToast({ title: error.message || '加载失败', icon: 'none' })
      return false }
  },
  editDraft(update: any) { this.draftEdited = true; this.draftVersion += 1; this.setData(update) },
  selectScore(e: any) { if (!this.data.saving && !this.data.deletingReview && !this.data.ratingLocked) this.editDraft({ myScore: Number(e.currentTarget.dataset.score), rateWithComment: true }) },
  toggleRating() { if (!this.data.saving && !this.data.ratingLocked) this.editDraft({ rateWithComment: !this.data.rateWithComment }) },
  onComment(e: any) { if (!this.data.saving && !this.data.deletingReview) this.editDraft({ comment: e.detail.value }) },
  preview() { if (this.data.dish && this.data.dish.image) wx.previewImage({ urls: [this.data.dish.image] }) },
  previewImages(e: any) {
    const { reviewId, url } = e.currentTarget.dataset
    const review = reviewId && this.data.reviews.find(row => row._id === reviewId)
    const urls = reviewId ? review && review.images : this.data.images
    if (urls && urls.indexOf(url) >= 0) wx.previewImage({ current: url, urls })
  },
  requireReviewer() {
    if (canReview()) return true
    wx.navigateTo({ url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent('/packageCanteen/pages/dish/dish?id=' + this.data.id) })
    return false
  },
  async chooseImages() {
    const remaining = 4 - this.data.images.length
    if (this.data.saving || this.data.uploading || this.data.deletingReview || remaining <= 0 || !this.requireReviewer()) return
    const owner = wx.getStorageSync('openid') || ''
    this.setData({ uploading: true, uploadError: '' })
    try {
      const chosen = await new Promise<any>((resolve, reject) => wx.chooseMedia({ count: remaining,
        mediaType: ['image'], sourceType: ['album', 'camera'], success: resolve, fail: reject }))
      if (!this.isCurrent(owner)) return
      const uploaded: string[] = []
      let failed = 0
      for (const file of (chosen.tempFiles || []).slice(0, remaining)) {
        if (!this.isCurrent(owner)) return
        try {
          const extension = (file.tempFilePath.match(/\.(jpg|jpeg|png|webp|gif)$/i) || [])[1] || 'jpg'
          const result = await api.uploadFile({ filePath: file.tempFilePath,
            cloudPath: 'canteen-reviews/' + this.data.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '.' + extension }) as any
          if (!this.isCurrent(owner)) return
          if (!isUploadedImage(result.fileID)) throw new Error('照片上传结果无效')
          uploaded.push(result.fileID)
        } catch (error) { failed += 1 }
      }
      if (!this.isCurrent(owner)) return
      if (uploaded.length) this.editDraft({ images: this.data.images.concat(uploaded).slice(0, 4) })
      if (failed) this.setData({ uploadError: failed + ' 张照片上传失败，已上传的照片已保留，可再选择。' })
    } catch (error: any) {
      if (this.isCurrent(owner) && !/cancel/i.test(error.errMsg || error.message || '')) this.setData({ uploadError: error.message || error.errMsg || '选图失败，请重试' })
    } finally {
      if (!this.disposed) {
        this.setData({ uploading: false })
        if (!this.isCurrent(owner)) this.load()
      }
    }
  },
  removeImage(e: any) {
    if (this.data.saving || this.data.uploading || this.data.deletingReview) return
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0 || index >= this.data.images.length) return
    this.editDraft({ images: this.data.images.filter((image, position) => position !== index), uploadError: '' })
  },
  async likeReview(e: any) {
    const reviewId = e.currentTarget.dataset.id
    if (this.data.likingReview || this.data.deletingReview || !this.data.reviews.some(row => row._id === reviewId) || !this.requireReviewer()) return
    const owner = wx.getStorageSync('openid') || ''
    this.setData({ likingReview: reviewId })
    try {
      const result = await callCanteen('voteReview', { reviewId, vote: e.currentTarget.dataset.vote || 'up' })
      if (!this.isCurrent(owner)) return
      this.setData({ reviews: this.data.reviews.map(row => row._id === reviewId ? Object.assign({}, row, { likeCount: result.likeCount, isLiked: result.isLiked, myVote: result.myVote, downCount: result.downCount, disputed: result.disputed }) : row) })
      await this.load(false)
    } catch (error: any) { if (this.isCurrent(owner)) wx.showToast({ title: error.message || '点赞失败', icon: 'none' }) }
    finally { if (!this.disposed) this.setData({ likingReview: '' }) }
  },
  switchReviewSort(e: any) {
    const sort = e.currentTarget.dataset.sort
    if (this.disposed || !['latest', 'hot'].includes(sort) || sort === this.data.reviewSort) return
    this.setData({ reviewSort: sort })
    return this.load(false)
  },
  async deleteReview(e: any) {
    const reviewId = e.currentTarget.dataset.id
    if (this.data.deletingReview || this.data.saving || this.data.uploading || this.data.likingReview || !this.data.reviews.some(row => row._id === reviewId && row.mine) || !this.requireReviewer()) return
    const owner = wx.getStorageSync('openid') || ''
    this.setData({ deletingReview: reviewId })
    try {
      const choice = await new Promise<any>((resolve, reject) => wx.showModal({ title: '删除我的评论', content: '删除这条文字和晒图，你的最新评分会保留。', confirmText: '删除', confirmColor: '#a86a7c', success: resolve, fail: reject }))
      if (!choice.confirm || !this.isCurrent(owner)) return
      this.loadVersion += 1
      await callCanteen('deleteReview', { reviewId })
      if (!this.isCurrent(owner)) return
      const reviews = this.data.reviews.filter(row => row._id !== reviewId)
      this.setData({ reviews, reviewCount: Math.max(0, this.data.reviewCount - 1) })
      wx.showToast({ title: '评论已删除', icon: 'success' })
      await this.load(false)
    } catch (error: any) { if (this.isCurrent(owner)) wx.showToast({ title: error.message || '删除失败', icon: 'none' }) }
    finally { if (!this.disposed) this.setData({ deletingReview: '' }) }
  },
  report(e: any) {
    if (!this.requireReviewer()) return
    const type = e.currentTarget.dataset.type || 'dish', id = e.currentTarget.dataset.id || this.data.id
    wx.showActionSheet({ itemList: ['信息不准确', '重复或广告内容', '不适当的内容'], success: async result => {
      try { const response = await callCanteen('report', { targetType: type, targetId: id, reason: ['inaccurate', 'spam', 'inappropriate'][result.tapIndex] }); wx.showToast({ title: response.msg || '反馈已收到', icon: 'none' }) }
      catch (error: any) { wx.showToast({ title: error.message || '反馈失败', icon: 'none' }) }
    } })
  },
  async submit() {
    if (this.data.saving || this.data.uploading || this.data.deletingReview || !this.requireReviewer()) return
    if (this.data.images.length > 4 || !this.data.images.every(isUploadedImage)) { this.setData({ uploadError: '请先完成照片上传，再发布评价' }); return }
    const owner = wx.getStorageSync('openid') || ''
    const post = { dishId: this.data.id, ...(this.data.rateWithComment && !this.data.ratingLocked ? { score: this.data.myScore } : {}), comment: this.data.comment, images: this.data.images.slice() }
    const fingerprint = JSON.stringify(post)
    if (!this.pendingPost || this.pendingPost.fingerprint !== fingerprint) this.pendingPost = { fingerprint, clientId: newCanteenId() }
    this.setData({ saving: true })
    try {
      await callCanteen('saveReview', { ...post, clientId: this.pendingPost.clientId })
      if (!this.isCurrent(owner)) return
      this.draftEdited = false
      this.pendingPost = null; this.draftVersion += 1
      this.setData({ comment: '', images: [], uploadError: '', rateWithComment: false })
      wx.showToast({ title: '评论已发布', icon: 'success' })
      callEnglish('claimCampusRewards').catch(() => {})
      await this.load()
    } catch (error: any) { if (this.isCurrent(owner)) wx.showToast({ title: error.message || '发布失败', icon: 'none' }) }
    finally { if (!this.disposed) this.setData({ saving: false }) }
  }
}))
