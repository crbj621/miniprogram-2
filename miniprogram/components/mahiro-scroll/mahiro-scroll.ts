Component({
  options: { multipleSlots: true },
  data: { triggered: false, state: 'pull', imageFailed: false, scrollTarget: '' },
  lifetimes: { detached() { this.disposed = true; clearTimeout(this.refreshTimer) } },
  methods: {
    scrollTo(target: string) { this.setData({ scrollTarget: '' }, () => this.setData({ scrollTarget: target })) },
    onPulling(e: any) {
      if (this.busy) return
      this.setData({ state: Number(e.detail.dy) >= 80 ? 'ready' : 'pull' })
    },
    onRefresh() {
      if (!this.busy) this.triggerEvent('refresh')
    },
    async refresh(task: () => Promise<any>) {
      if (this.busy || this.disposed) return
      this.busy = true
      this.setData({ triggered: true, state: 'loading' })
      try {
        const result = await task()
        if (!this.disposed) this.setData({ state: result === false ? 'error' : 'success' })
      } catch (error) {
        if (!this.disposed) this.setData({ state: 'error' })
      } finally {
        if (!this.disposed) this.refreshTimer = setTimeout(() => {
          this.busy = false
          this.setData({ triggered: false })
        }, 600)
      }
    },
    onRestore() { if (!this.busy) this.setData({ state: 'pull' }) },
    onImageError() { this.setData({ imageFailed: true }) },
    onMore() { this.triggerEvent('more') }
  }
})
