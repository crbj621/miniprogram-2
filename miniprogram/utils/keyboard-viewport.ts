// Used only by chat/comment composers with adjust-position=false.
// Normal forms keep WeChat's native keyboard avoidance.
export function getKeyboardViewport(baseHeight: number, windowHeight: number, keyboardHeight: number) {
  const height = Math.max(0, Math.min(windowHeight, baseHeight - Math.max(0, keyboardHeight)))
  return { keyboardViewportHeight: height, keyboardInset: Math.max(0, windowHeight - height) }
}

export function createKeyboardViewport(page: { setData: (data: any) => void }) {
  const device = wx as any
  const readWindow = () => typeof device.getWindowInfo === 'function' ? device.getWindowInfo() : wx.getSystemInfoSync()
  const initialWindow = readWindow()
  let baseHeight = initialWindow.windowHeight
  let windowWidth = initialWindow.windowWidth
  const chromeHeight = initialWindow.screenHeight - initialWindow.windowHeight
  let active = false
  let keyboardHeight = 0
  let last = ''

  const update = (event?: any) => {
    if (!active) return
    const info = readWindow()
    const size = event && event.size
    const windowHeight = size ? size.windowHeight : info.windowHeight
    const nextWidth = size ? size.windowWidth : info.windowWidth
    if (nextWidth !== windowWidth) {
      // Recompute the baseline on orientation changes, including while typing.
      baseHeight = keyboardHeight > 0 && Number.isFinite(chromeHeight)
        ? Math.max(windowHeight, info.screenHeight - chromeHeight) : windowHeight
      windowWidth = nextWidth
    }
    // Android can resize before OR after the keyboard callback. Never subtract
    // the height a second time from an already reduced window.
    baseHeight = Math.max(baseHeight, windowHeight)
    const data = { ...getKeyboardViewport(baseHeight, windowHeight, keyboardHeight), keyboardHeight }
    const signature = JSON.stringify(data)
    if (signature === last) return
    last = signature
    page.setData(data)
  }

  const onHeightChange = (event: any) => {
    if (!active) return
    const height = Number((event.detail || event).height)
    if (!Number.isFinite(height) || height < 0) return
    keyboardHeight = height
    update()
  }

  return {
    start() {
      if (active) return
      active = true
      baseHeight = Math.max(baseHeight, readWindow().windowHeight)
      wx.onKeyboardHeightChange(onHeightChange)
      update()
    },
    onHeightChange,
    resize: update,
    stop() {
      if (!active) return
      active = false
      wx.offKeyboardHeightChange(onHeightChange)
      keyboardHeight = 0
      last = ''
      page.setData({ keyboardViewportHeight: 0, keyboardInset: 0, keyboardHeight: 0 })
    }
  }
}
