Component({
  properties: {
    image: { type: String, value: '' },
    outfit: { type: String, value: '' },
    accessory: { type: String, value: '' },
    shoes: { type: String, value: '' },
    accessoryStyle: { type: String, value: '' },
    shoesStyle: { type: String, value: '' },
    character: { type: String, value: 'boy' },
    feeding: { type: Boolean, value: false },
    food: { type: String, value: '🍎' },
    expression: { type: String, value: 'happy' },
    interactive: { type: Boolean, value: true }
  },
  data: { imageFailed: false, outfitFailed: false, accessoryFailed: false, shoesFailed: false, motion: 'idle', dialogue: '', paused: false },
  lifetimes: {
    attached() { this._visible = true; this._interactionIndex = 0 },
    detached() { this._visible = false; this.clearInteraction() }
  },
  pageLifetimes: {
    show() { this._visible = true; this.setData({ paused: false }) },
    hide() { this._visible = false; this.clearInteraction(); this.setData({ paused: true, motion: 'idle', dialogue: '' }) }
  },
  observers: {
    image() { this.setData({ imageFailed: false }) },
    outfit() { this.setData({ outfitFailed: false }) },
    accessory() { this.setData({ accessoryFailed: false }) },
    shoes() { this.setData({ shoesFailed: false }) },
    feeding(value: boolean) { if (value) { this.clearInteraction(); this.setData({ motion: 'idle', dialogue: '' }) } }
  },
  methods: {
    clearInteraction() { if (this._interactionTimer) clearTimeout(this._interactionTimer); this._interactionTimer = null },
    interact() {
      if (!this._visible || !this.properties.interactive || this.properties.feeding || this.data.dialogue || !this.properties.image || this.data.imageFailed) return
      const reactions = [
        { motion: 'wobble', dialogue: '你来啦，一起加油呀！' },
        { motion: 'hop', dialogue: '今天也闪闪发光 ✦' },
        { motion: 'nod', dialogue: '学一会儿，也记得休息哦。' },
        { motion: 'wobble', dialogue: '换什么衣服，都陪着你 ♡' }
      ]
      const reaction = reactions[this._interactionIndex++ % reactions.length]
      this.setData(reaction)
      this.triggerEvent('interaction', reaction)
      this._interactionTimer = setTimeout(() => {
        this._interactionTimer = null
        if (this._visible) this.setData({ motion: 'idle', dialogue: '' })
      }, 2200)
    },
    onImageError() { this.setData({ imageFailed: true }); this.triggerEvent('imageerror') },
    onOutfitError() { this.setData({ outfitFailed: true }); this.triggerEvent('imageerror') },
    onAccessoryError() { this.setData({ accessoryFailed: true }) },
    onShoesError() { this.setData({ shoesFailed: true }) },
    retryImages() { this.setData({ imageFailed: false, outfitFailed: false, accessoryFailed: false, shoesFailed: false }) }
  }
})
