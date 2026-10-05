/* Native video landscapes; their picture posters remain the static fallback. */
(() => {
  const data = JSON.parse(document.getElementById('gift-data').textContent)
  const element = document.getElementById('scene'), video = element.querySelector('.scene-video')
  if (!video || !data.backgroundVideo) return
  const assetBase = new URL('.', document.currentScript.src).href
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'), wide = matchMedia('(min-aspect-ratio: 1/1)')
  const open = document.getElementById('open-gift'), toggle = document.getElementById('video-toggle'), status = document.getElementById('video-status')
  let destroyed = false, paused = false, generation = 0, intent = 'auto', state = 'idle', timeout
  const allowed = () => !destroyed && !paused && !document.hidden && intent !== 'pause' && (!reducedMotion.matches || intent === 'play')
  function display(next, message = '') {
    state = next
    toggle.textContent = next === 'playing' ? 'Ⅱ 暂停背景' : next === 'error' ? '↻ 重试视频' : next === 'loading' ? '↻ 重新播放' : '▶ 播放背景'
    toggle.setAttribute('aria-pressed', String(next === 'playing'))
    status.textContent = message; status.hidden = !message
  }
  function release() {
    clearTimeout(timeout); generation++; video.classList.remove('is-playing'); video.pause()
    if (video.hasAttribute('src')) { video.removeAttribute('src'); video.load() }
  }
  function start(retry = false) {
    if (!allowed()) {
      if (!destroyed && !paused && !document.hidden) display('idle', intent === 'pause' ? '动态背景已暂停' : '系统已减少动态，点击播放可开启视频')
      return
    }
    const source = new URL(data.backgroundVideo[wide.matches ? 'wide' : 'portrait'], assetBase).href
    if (!retry && state === 'playing' && !video.paused && video.getAttribute('src') === source) return
    if (retry || video.getAttribute('src') !== source) {
      release(); video.src = source
    }
    const attempt = ++generation
    display('loading', '正在加载动态背景…')
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      if (generation !== attempt || state === 'playing' || !allowed()) return
      release(); display('error', '视频加载较慢，点击重试')
    }, 15000)
    video.muted = true; video.defaultMuted = true
    const result = video.play()
    if (result && result.catch) result.catch(error => {
      if (generation !== attempt) return
      release(); display(error.name === 'NotAllowedError' ? 'blocked' : 'error', error.name === 'NotAllowedError' ? '浏览器需要你点击播放背景' : '视频未能播放，点击重试')
    })
  }
  const playing = () => { if (allowed() && video.hasAttribute('src')) { clearTimeout(timeout); video.classList.add('is-playing'); display('playing') } else release() }
  const failed = () => { if (video.error && video.hasAttribute('src')) { release(); display('error', '视频加载失败，点击重试') } }
  const manual = () => {
    if (destroyed) return
    if (state === 'playing') { intent = 'pause'; release(); display('idle', '动态背景已暂停') }
    else { intent = 'play'; start(true) }
  }
  const visibility = () => document.hidden ? release() : start()
  const motion = () => { if (!allowed()) release(); start() }
  const resized = () => start()
  const opened = () => start()
  video.addEventListener('playing', playing); video.addEventListener('error', failed)
  document.addEventListener('visibilitychange', visibility)
  reducedMotion.addEventListener('change', motion); wide.addEventListener('change', resized)
  open.addEventListener('click', opened); toggle.addEventListener('click', manual)
  window.giftScene = {
    pause() { paused = true; release() },
    resume() { paused = false; start() },
    destroy() {
      destroyed = true; release()
      video.removeEventListener('playing', playing); video.removeEventListener('error', failed)
      document.removeEventListener('visibilitychange', visibility)
      reducedMotion.removeEventListener('change', motion); wide.removeEventListener('change', resized)
      open.removeEventListener('click', opened); toggle.removeEventListener('click', manual)
      toggle.parentElement.hidden = true
    },
    burst() {}
  }
  start()
})()
