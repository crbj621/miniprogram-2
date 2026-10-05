'use strict'
const gift = JSON.parse(document.getElementById('gift-data').textContent)
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
let expiry = Date.parse(gift.expiresAt)
const effects = gift.effects, previewKey = 'gift-preview:' + gift.id
document.getElementById('expires').textContent = new Date(expiry).toLocaleString('zh-CN')
let fireworks, effectsTimer, previewTimer, canvasObserver, chases = 0, expired = false, syncing = false
if (!reduced && effects.includes('fireworks')) fireworks = new Fireworks.default(document.getElementById('fireworks'), { opacity: .5, particles: 35, intensity: 12, sound: { enabled: false }, mouse: { click: false, move: false, max: 0 } })
const particleTypes = effects.filter(id => ['balloons', 'sparkles', 'hearts', 'sakura', 'leaves', 'snow'].includes(id))
if (!reduced && particleTypes.length) for (let i = 0; i < 28; i++) {
  const type = particleTypes[i % particleTypes.length]
  const element = document.createElement('span')
  element.className = 'particle particle-' + type + (['sakura', 'leaves', 'snow'].includes(type) ? ' falling' : '')
  element.textContent = type === 'snow' ? '❄' : type === 'leaves' ? '🍂' : ''
  element.style.left = i * 3.57 + '%'; element.style.animationDuration = 14 + i % 7 + 's'; element.style.animationDelay = -(i * .8) + 's'
  element.style.setProperty('--tone', ['#ffb2c8', '#c9b2ec', '#aedbe8', '#ffe1a9'][i % 4])
  document.getElementById('particles').appendChild(element)
}
const fortunes = ['今天的你，有把普通日子过好的魔法。', '幸运提示：去做一件让自己开心的小事。', '慢慢来，所有认真都会被时间看见。', '世界很大，今天的小小快乐也很珍贵。']
function celebrate() {
  if (Date.now() >= expiry) return expire()
  if (effects.includes('confetti') || effects.includes('starburst') || effects.includes('ribbons')) confetti({ particleCount: 90, spread: 90, origin: { y: .65 }, disableForReducedMotion: true, shapes: effects.includes('starburst') ? ['star'] : ['square', 'circle'], scalar: effects.includes('ribbons') ? 1.7 : 1, colors: ['#ffb3cf', '#cbb7ef', '#9cdde6', '#ffe5a7'] })
  if (fireworks && !document.hidden) { fireworks.start(); clearTimeout(effectsTimer); effectsTimer = setTimeout(() => fireworks.stop(), 8000) }
  if (gift.templateId === 'daily' || gift.templateId === 'stars') {
    const fortune = document.getElementById('fortune'); fortune.hidden = false
    fortune.textContent = gift.templateId === 'stars' ? gift.recipient + '，又有一颗星为你亮起 ✧' : fortunes[Math.floor(Math.random() * fortunes.length)]
    if (window.giftScene && window.giftScene.burst) window.giftScene.burst()
  }
}
document.getElementById('open-gift').addEventListener('click', event => {
  if (Date.now() >= expiry) return expire()
  if (gift.templateId === 'prank' && chases++ < 3 && !reduced) {
    event.currentTarget.style.transform = 'translate(' + (chases % 2 ? 45 : -45) + 'px,' + (chases * 8) + 'px)'
    document.getElementById('play-status').textContent = ['礼物溜走啦，再点一下！', '差一点点，就快追到我啦', '好啦，这一次一定抓得到'][chases - 1]
    return
  }
  document.getElementById('play-status').textContent = ''
  const letter = document.getElementById('letter'); letter.hidden = false; letter.classList.add('revealed')
  document.getElementById('envelope').classList.add('opened'); event.currentTarget.hidden = true
  celebrate(); loadWall()
})
document.getElementById('celebrate').addEventListener('click', celebrate)
if (gift.templateId === 'birthday') {
  for (let i = 0; i < 7; i++) {
    const candle = document.createElement('div'); candle.className = 'candle'
    candle.style.left = 65 + i * 72 + 'px'; candle.style.top = -50 + Math.abs(i - 3) * 7 + 'px'
    for (let j = 0; j < 5; j++) { const flame = document.createElement('div'); flame.className = 'flame'; candle.appendChild(flame) }
    document.querySelector('.cake').appendChild(candle)
  }
  document.getElementById('blow-candles').addEventListener('click', event => {
    document.querySelectorAll('.flame').forEach(flame => flame.remove())
    event.currentTarget.disabled = true; event.currentTarget.textContent = '愿你的小愿望都实现 ✨'
    document.getElementById('wish-status').textContent = '蜡烛熄灭啦，快乐与心意一起送达。'; celebrate()
  })
}
function renderWall(rows) {
  const container = document.getElementById('wall-messages'); container.replaceChildren()
  for (const row of rows) { const note = document.createElement('div'), name = document.createElement('strong'), text = document.createElement('p'); note.className = 'wall-note'; name.textContent = row.name; text.textContent = row.message; note.append(name, text); container.append(note) }
}
async function loadWall() {
  if (!gift.id) { renderWall([{ name: '示例 · 好朋友', message: '愿你一直拥有被爱包围的勇气。' }, { name: '示例 · 匿名朋友', message: '这一份小惊喜，只送给最特别的你。' }]); return }
  try { const response = await fetch(gift.apiBase + '/messages', { cache: 'no-store' }); const result = await response.json(); if (result.success) renderWall(result.data) }
  catch (_) { document.getElementById('wall-status').textContent = '暂时读不到留言，可稍后再试。' }
}
const wallForm = document.getElementById('wall-form')
const resizeCanvas = () => { const canvas = document.querySelector('.gift-canvas'); if (canvas) canvas.querySelectorAll('[data-font]').forEach(row => { row.style.fontSize = Number(row.dataset.font) * canvas.clientWidth / 360 + 'px' }) }
function observeCanvas() {
  if (canvasObserver) canvasObserver.disconnect()
  const canvas = document.querySelector('.gift-canvas')
  if (canvas && typeof ResizeObserver === 'function') { canvasObserver = new ResizeObserver(resizeCanvas); canvasObserver.observe(canvas) }
  resizeCanvas()
}
window.addEventListener('resize', resizeCanvas)
observeCanvas()
if (wallForm) wallForm.elements.anonymous.addEventListener('change', () => { document.getElementById('name-label').hidden = wallForm.elements.anonymous.checked })
if (wallForm) wallForm.addEventListener('submit', async event => {
  event.preventDefault(); const status = document.getElementById('wall-status')
  if (!gift.id) { status.textContent = '这是模板预览，创建后即可保存朋友的留言。'; return }
  if (expired) return
  const button = wallForm.querySelector('button'); button.disabled = true
  try {
    const submitted = wallForm.elements.message.value
    const response = await fetch(gift.apiBase + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: wallForm.elements.name.value, message: submitted, anonymous: wallForm.elements.anonymous.checked }) })
    const result = await response.json(); if (!result.success) throw Error(result.message)
    renderWall(result.data); if (wallForm.elements.message.value === submitted) wallForm.elements.message.value = ''; status.textContent = '心意已贴上墙 🌷'
  } catch (error) { status.textContent = error.message || '留言暂未送达，请重试' }
  finally { button.disabled = false }
})
function renderContent(site) {
  const container = document.getElementById('letter-content'); container.replaceChildren()
  if (site.layout) {
    const canvas = document.createElement('div'); canvas.className = 'gift-canvas'; canvas.style.paddingTop = site.layout.height / 360 * 100 + '%'
    for (const row of site.layout.elements) {
      const node = document.createElement('div'); node.className = 'canvas-element'
      node.style.left = row.x + '%'; node.style.top = row.y + '%'; node.style.width = row.width + '%'; node.style.color = row.color; node.dataset.font = row.fontSize
      const value = ['title', 'recipient', 'message', 'sender'].includes(row.type) ? site[row.type] : row.value
      if (row.type === 'image') { const img = document.createElement('img'); img.src = value; img.alt = '送给你的照片'; node.append(img) }
      else node.textContent = value
      canvas.append(node)
    }
    container.append(canvas)
  } else {
    const top = document.createElement('div'), dear = document.createElement('span'), star = document.createElement('span'), message = document.createElement('p'), sender = document.createElement('p')
    top.className = 'letter-top'; dear.textContent = 'Dear ' + site.recipient; star.textContent = '✧'; top.append(dear, star)
    message.className = 'message'; message.textContent = site.message; sender.className = 'sender'; sender.textContent = site.sender || '一个在乎你的人'; container.append(top, message, sender)
  }
  observeCanvas()
}
async function syncPreview() {
  if (syncing || expired || document.hidden) return
  syncing = true
  const status = document.getElementById('preview-status')
  try {
    const response = await fetch(gift.apiBase, { cache: 'no-store' })
    if (response.status === 410) return expire()
    if (!response.ok) throw Error('预览同步稍有延迟，正在重试')
    const result = await response.json(), site = result.data
    if (!site) return expire()
    expiry = Date.parse(site.expiresAt); document.getElementById('expires').textContent = new Date(expiry).toLocaleString('zh-CN')
    if (site.templateId !== gift.templateId || site.background !== gift.background || JSON.stringify(site.effects) !== JSON.stringify(effects)) {
      try { sessionStorage.setItem(previewKey, JSON.stringify({ opened: !document.getElementById('letter').hidden, blown: gift.templateId === 'birthday' && document.getElementById('blow-candles').disabled })) } catch (_) {}
      location.reload(); return
    }
    if (JSON.stringify([site.title, site.recipient, site.message, site.sender, site.layout]) !== JSON.stringify([gift.title, gift.recipient, gift.message, gift.sender, gift.layout])) {
      Object.assign(gift, site); document.title = site.title + ' · ' + site.recipient
      document.getElementById('gift-title').textContent = site.title; document.getElementById('gift-recipient').textContent = '给 ' + site.recipient; renderContent(site)
    }
    status.textContent = '免费预览 · 已同步最新内容'
  } catch (error) { if (!expired) status.textContent = error.message || '网络稍慢，正在重新同步' }
  finally { syncing = false }
}
if (gift.preview && gift.id) {
  try { const state = JSON.parse(sessionStorage.getItem(previewKey) || 'null'); if (state && state.opened) { document.getElementById('open-gift').click(); if (state.blown && gift.templateId === 'birthday') document.getElementById('blow-candles').click() }; sessionStorage.removeItem(previewKey) } catch (_) {}
  previewTimer = setInterval(syncPreview, 2500)
}
function expire() { if (expired) return; expired = true; if (fireworks) fireworks.stop(); if (window.giftScene) window.giftScene.destroy(); document.querySelector('main').textContent = gift.preview ? '临时预览已回收。回到编辑器可以重新生成，不会扣金币。' : '这份祝福已到期，期待下一份小惊喜。'; document.getElementById('particles').replaceChildren(); clearTimeout(effectsTimer); clearInterval(previewTimer); if (canvasObserver) canvasObserver.disconnect() }
setInterval(() => { if (Date.now() >= expiry) expire() }, 30000)
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('paused', document.hidden)
  if (document.hidden) { if (fireworks) fireworks.stop(); clearTimeout(effectsTimer) }
})
window.addEventListener('pagehide', event => {
  if (fireworks) fireworks.stop(); clearTimeout(effectsTimer)
  if (event.persisted) { if (window.giftScene) window.giftScene.pause(); return }
  if (window.giftScene) window.giftScene.destroy(); clearInterval(previewTimer); if (canvasObserver) canvasObserver.disconnect()
})
window.addEventListener('pageshow', event => {
  if (!event.persisted) return
  if (Date.now() >= expiry) return expire()
  document.body.classList.toggle('paused', document.hidden)
  if (window.giftScene && !expired) window.giftScene.resume()
})
