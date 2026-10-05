import { API_BASE_URL } from '../../config/api'

export const backgroundVideoData = { backgroundVideoUrl: '', backgroundVideoPoster: '', backgroundVideoPosterError: false, videoPlayers: [] as any[], videoState: 'idle', videoError: '', videoAutoplay: true, videoCurrentTime: 0 }

// A new keyed native node gives each source/retry its own event identity.
export const backgroundVideoPlayer = {
  videoVisible: false, videoDestroyed: false, videoEpoch: 0, videoContext: null as WechatMiniprogram.VideoContext | null,
  setBackgroundVideo(this: any, video: any, poster: string) {
    const path = video && (video.wide || video.portrait), source = path ? API_BASE_URL + '/gift-assets/' + path : '', cover = poster ? API_BASE_URL + '/gift-assets/' + poster : ''
    if (this.videoDestroyed || source === this.data.backgroundVideoUrl) return
    this.stopBackgroundVideo()
    this.setData({ backgroundVideoUrl: source, backgroundVideoPoster: cover, backgroundVideoPosterError: false, videoAutoplay: true, videoCurrentTime: 0, videoState: source ? 'loading' : 'idle', videoError: '' })
    this.mountBackgroundVideo()
  },
  mountBackgroundVideo(this: any) {
    if (!this.videoVisible || this.videoDestroyed || !this.data.backgroundVideoUrl || this.data.videoPlayers.length || this.data.videoState === 'error') return
    const id = 'gift-background-video-' + ++this.videoEpoch, src = this.data.backgroundVideoUrl
    this.setData({ videoPlayers: [{ id, src, poster: this.data.backgroundVideoPoster }], videoState: this.data.videoAutoplay ? 'loading' : 'paused' }, () => wx.nextTick(() => {
      if (!this.videoVisible || this.videoDestroyed || !this.data.videoPlayers[0] || this.data.videoPlayers[0].id !== id) return
      this.videoContext = wx.createVideoContext(id, this)
      if (this.data.videoAutoplay) this.videoContext.play()
      else this.videoContext.pause()
    }))
  },
  showBackgroundVideo(this: any) { this.videoVisible = true; this.mountBackgroundVideo() },
  stopBackgroundVideo(this: any) {
    this.videoEpoch += 1
    const context = this.videoContext; this.videoContext = null
    if (!this.videoDestroyed) this.setData({ videoPlayers: [], videoState: this.data.videoState === 'error' ? 'error' : this.data.backgroundVideoUrl ? 'paused' : 'idle' })
    if (context) context.stop()
  },
  hideBackgroundVideo(this: any) { this.videoVisible = false; this.stopBackgroundVideo() },
  destroyBackgroundVideo(this: any) { this.videoVisible = false; this.videoDestroyed = true; this.stopBackgroundVideo() },
  isBackgroundVideoEvent(this: any, event: any) {
    const player = this.data.videoPlayers[0], dataset = event.currentTarget && event.currentTarget.dataset
    return Boolean(this.videoVisible && !this.videoDestroyed && player && dataset && dataset.player === player.id && dataset.src === player.src)
  },
  onBackgroundVideoPlay(this: any, event: any) { if (this.isBackgroundVideoEvent(event)) this.setData({ videoState: 'playing', videoAutoplay: true, videoError: '' }) },
  onBackgroundVideoPause(this: any, event: any) { if (this.isBackgroundVideoEvent(event)) this.setData({ videoState: 'paused', videoAutoplay: false }) },
  onBackgroundVideoWaiting(this: any, event: any) { if (this.isBackgroundVideoEvent(event) && this.data.videoAutoplay) this.setData({ videoState: 'loading' }) },
  onBackgroundVideoTime(this: any, event: any) {
    if (!this.isBackgroundVideoEvent(event)) return
    const currentTime = Number(event.detail.currentTime) || 0
    this.setData({ videoCurrentTime: currentTime, ...(this.data.videoAutoplay && currentTime !== this.data.videoCurrentTime && this.data.videoState === 'loading' ? { videoState: 'playing' } : {}) })
  },
  onBackgroundVideoError(this: any, event: any) {
    if (!this.isBackgroundVideoEvent(event)) return
    this.stopBackgroundVideo()
    this.setData({ videoState: 'error', videoError: '视频暂时无法播放，已保留封面。请检查网络后重试。' })
  },
  onBackgroundPosterError(this: any, event: any) {
    if (this.videoVisible && !this.videoDestroyed && event.currentTarget.dataset.source === this.data.backgroundVideoUrl) this.setData({ backgroundVideoPosterError: true })
  },
  toggleBackgroundVideo(this: any) {
    if (!this.videoVisible || this.videoDestroyed || !this.data.backgroundVideoUrl) return
    if (this.data.videoState === 'error') { this.retryBackgroundVideo(); return }
    if (this.data.videoState === 'playing') {
      this.setData({ videoAutoplay: false, videoState: 'paused' }); if (this.videoContext) this.videoContext.pause()
    } else {
      this.setData({ videoAutoplay: true, videoState: 'loading' }); this.mountBackgroundVideo(); if (this.videoContext) this.videoContext.play()
    }
  },
  retryBackgroundVideo(this: any) {
    if (!this.videoVisible || this.videoDestroyed || !this.data.backgroundVideoUrl) return
    this.stopBackgroundVideo()
    this.setData({ videoState: 'loading', videoAutoplay: true, videoError: '', backgroundVideoPosterError: false, videoCurrentTime: 0 }); this.mountBackgroundVideo()
  }
}
