'use strict'
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const { createRequire } = require('node:module')
const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'))
const express = serverRequire('express'), helmet = serverRequire('helmet')
const { chromium } = require(process.env.PLAYWRIGHT_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
const gifts = require('../server/services/gift_sites'), catalog = require('../server/data/gifts/catalog.json')
const { renderGift, installGiftWeb } = require('../server/src/gift-web')
const output = path.resolve(__dirname, '../docs/ui-preview/gifts')
let httpServer, browser
const visitors = [], problems = [], results = [], sites = new Map(), notes = new Map()
let sequence = 256
const fixture = (background, extra = {}) => {
  const site = { id: (++sequence).toString(16).padStart(24, '0'), templateId: 'wall', title: '送你一份小小的快乐', recipient: '亲爱的你', sender: '校园伙伴', message: '愿每一天都明亮，也愿你一直被温柔以待。', background, effects: ['sparkles', 'confetti', 'fireworks'], expiresAt: new Date(Date.now() + 86400000).toISOString(), ...extra }
  sites.set(site.id, site); return site
}
const mobileFits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
async function checkScene(page, background) {
  const item = catalog.backgrounds.find(row => row.id === background)
  assert.ok(item, 'the selected background exists')
  assert.equal(item.kind, item.video ? 'dynamic' : 'static', background + ' is categorized by actual landscape motion')
  if (item.video) {
    await page.waitForFunction(() => { const video = document.querySelector('.scene-video'); return video && !video.paused && video.readyState >= 2 && video.currentTime > .15 })
    assert.equal(await page.locator('.scene-video').evaluate(video => video.muted && video.loop && video.playsInline), true, background + ' plays a muted inline loop')
  } else if (item.poster) {
    await page.waitForFunction(() => { const image = document.querySelector('.scene-image'); return image && image.complete && image.naturalWidth > 0 })
    assert.equal(await page.locator('.scene-video').count(), 0, background + ' is a static picture')
  }
  assert.equal(await page.locator('#scene canvas,.scene-sky,.scene-mist').count(), 0, background + ' has no simulated landscape animation')
  assert.equal(await page.locator('script[src*="three-"],script[src*="vanta-"],script[src*="starrysky-"],script[src*="Fire.js"]').count(), 0, background + ' loads no WebGL landscape library')
}
function watch(page, label) {
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => { problems.push(label + ': ' + error.message); console.error(label + ': ' + error.message) })
  page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('Failed to load resource: the server responded with a status of 410')) problems.push(label + ': ' + msg.text()) })
}
async function openGift(page, template) {
  for (let i = 0; i < (template === 'prank' ? 4 : 1); i++) await page.locator('#open-gift').click()
  assert.equal(await page.locator('#letter').isVisible(), true, template + ' opens')
}
async function submitNote(page, message, { anonymous = false, name = '朋友' } = {}) {
  const nameInput = page.locator('#wall-form input[name=name]')
  if (await nameInput.isVisible()) await nameInput.fill(name)
  await page.locator('#wall-form input[name=anonymous]').setChecked(anonymous)
  assert.equal(await nameInput.isVisible(), !anonymous, 'anonymous option hides the name field')
  await page.locator('#wall-form textarea').fill(message)
  const response = page.waitForResponse(row => row.request().method() === 'POST' && /\/messages$/.test(row.url()))
  await page.locator('#wall-form button').click(); await response
  await page.waitForFunction(() => document.getElementById('wall-status').textContent.includes('已贴'))
}
async function run() {
  fs.mkdirSync(output, { recursive: true })
  const app = express(); app.use(helmet()); app.use(express.json()); app.get('/favicon.ico', (req, res) => res.sendStatus(204))
  app.use((req, res, next) => { res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:"); next() })
  process.env.JWT_SECRET = 'gift-browser-regression-local-only'; process.env.NODE_ENV = 'development'
  gifts.published = async id => sites.get(id) || null
  gifts.messages = async id => notes.get(id) || []
  gifts.leaveMessage = async (id, visitor, input) => {
    visitors.push({ id, visitor, input }); const rows = notes.get(id) || []
    rows.push({ name: input.anonymous === true ? '匿名朋友' : input.name || '匿名朋友', message: input.message }); notes.set(id, rows)
    return rows
  }
  app.get('/fixture/:background', (req, res) => res.type('html').send(renderGift(fixture(req.params.background), '/gift-assets')))
  app.get('/layout', (req, res) => res.type('html').send(renderGift({ ...fixture('lavender'), layout: { height: 700, elements: [{ id: 'title', type: 'title', x: 10, y: 10, width: 80, color: '#715364', fontSize: 30, value: '' }, { id: 'message', type: 'message', x: 10, y: 30, width: 80, color: '#906489', fontSize: 18, value: '' }, { id: 'sticker', type: 'sticker', x: 40, y: 70, width: 20, color: '#715364', fontSize: 40, value: '🌷' }] } }, '/gift-assets')))
  installGiftWeb(app, { rateLimit: () => (req, res, next) => next() })
  httpServer = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
  const base = 'http://127.0.0.1:' + httpServer.address().port; process.env.PUBLIC_BASE_URL = base
  browser = await chromium.launch({ channel: process.env.PREVIEW_BROWSER || 'msedge', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] })
  for (const item of catalog.templates) {
    console.log('Checking premium template:', item.id)
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    watch(page, item.id)
    await page.goto(base + '/gifts/demo/' + item.id)
    const data = await page.locator('#gift-data').textContent()
    assert.equal(JSON.parse(data).background, item.previewBackground, item.id + ' uses the curated premium background')
    assert.deepEqual(JSON.parse(data).effects, item.previewEffects, item.id + ' uses every curated premium effect')
    await checkScene(page, item.previewBackground)
    await page.screenshot({ path: path.join(output, item.id + '-closed.png') })
    console.log('  scene captured')
    await openGift(page, item.id)
    console.log('  letter opened')
    if (item.id === 'birthday') { assert.equal(await page.locator('.candle').count(), 7); await page.locator('#blow-candles').click(); assert.equal(await page.locator('.flame').count(), 0) }
    console.log('  birthday interaction checked')
    assert.equal(await page.locator('#wall-form').isVisible(), true, item.id + ' has a guestbook')
    assert.equal(await page.locator('#wall-form input[name=anonymous]').count(), 1, item.id + ' has anonymous wishes')
    await page.waitForFunction(() => document.querySelectorAll('.wall-note').length === 2)
    console.log('  demo wishes ready')
    await page.waitForTimeout(800)
    assert.equal(await mobileFits(page), true, item.id + ' fits 390px mobile')
    await page.screenshot({ path: path.join(output, item.id + '.png'), fullPage: true })
    await page.setViewportSize({ width: 320, height: 740 }); await page.waitForTimeout(100)
    assert.equal(await mobileFits(page), true, item.id + ' fits 320px mobile')
    await page.screenshot({ path: path.join(output, item.id + '-320.png'), fullPage: true })
    results.push({ template: item.id, opened: true, curatedPremiumPreview: true, guestbook: true, anonymousOption: true, widths: [390, 320], mobileOverflow: false }); await page.close()
  }
  for (const item of catalog.templates) {
    const site = fixture('peach', { templateId: item.id }), page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    watch(page, item.id + '-messages'); await page.goto(base + '/gifts/' + site.id); await openGift(page, item.id)
    await submitNote(page, '这份祝福送给最特别的你。')
    assert.equal(await page.locator('.wall-note strong').last().innerText(), '朋友', item.id + ' named wishes')
    await submitNote(page, '<script>只当文字显示</script>', { anonymous: true, name: '匿名时不可显示的名字' })
    assert.equal(await page.locator('.wall-note strong').last().innerText(), '匿名朋友', item.id + ' anonymous wishes')
    assert.equal(await page.locator('.wall-note p').last().innerText(), '<script>只当文字显示</script>', item.id + ' messages are safely rendered')
    assert.equal(visitors.at(-1).input.anonymous, true, 'anonymous intent is sent to the backend')
    assert.equal(visitors.at(-1).visitor, visitors.at(-2).visitor, 'visitor cookie stays stable')
    await page.close()
  }
  for (const background of ['meteors', 'campfire', 'clouds3d', 'halo3d', ...catalog.backgrounds.filter(row => row.video).map(row => row.id)]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    watch(page, background)
    await page.goto(base + '/fixture/' + background); await checkScene(page, background)
    await page.screenshot({ path: path.join(output, background + '-closed.png') })
    await openGift(page, 'wall'); await submitNote(page, '<script>只当文字显示</script>')
    assert.equal(await page.locator('.wall-note p').innerText(), '<script>只当文字显示</script>')
    await page.screenshot({ path: path.join(output, background + '.png'), fullPage: true }); results.push({ background, video: Boolean(catalog.backgrounds.find(row => row.id === background).video) }); await page.close()
  }
  const context = await browser.newContext(), page = await context.newPage()
  watch(page, 'layout')
  await page.goto(base + '/fixture/night'); await page.locator('#open-gift').click()
  for (let i = 0; i < 2; i++) await submitNote(page, '同一个人的留言')
  assert.equal(visitors.at(-1).visitor, visitors.at(-2).visitor, 'visitor cookie stays stable')
  assert.notEqual(visitors.at(-1).visitor, visitors[0].visitor, 'different browsers behind same IP have distinct visitors')
  await page.goto(base + '/layout'); await page.locator('#open-gift').click(); await page.waitForTimeout(800)
  assert.equal(await page.locator('.canvas-element').count(), 3)
  await page.screenshot({ path: path.join(output, 'custom-layout.png'), fullPage: true })
  await context.close()
  const id = fixture('peach').id, endpoint = base + '/api/gifts/' + id + '/messages', beforeWrites = visitors.length
  const nativePost = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '小程序朋友', message: '原生客户端不需要浏览器 Origin。' }) })
  assert.equal(nativePost.status, 200, 'a native miniapp without Origin can leave a wish')
  assert.equal((await nativePost.json()).success, true)
  const crossSitePost = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: JSON.stringify({ name: '跨站', message: '这条不能保存。' }) })
  assert.equal(crossSitePost.status, 403, 'a cross-site browser is rejected')
  assert.equal(visitors.length, beforeWrites + 1, 'cross-site requests never reach the message writer')
  const preview = fixture('peach', { templateId: 'birthday', preview: true, expiresAt: new Date(Date.now() + 120000).toISOString() })
  const live = await browser.newPage({ viewport: { width: 390, height: 844 } }); watch(live, 'live-preview')
  await live.goto(base + '/gifts/' + preview.id); await openGift(live, 'birthday'); await live.locator('#blow-candles').click()
  let previewReads = 0
  live.on('request', request => { if (request.url() === base + '/api/gifts/' + preview.id) previewReads++ })
  Object.assign(preview, { title: '最新生日祝福', recipient: '小夏', sender: '好朋友', message: '<img src=x onerror="alert(1)">安全显示的新版祝福', updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 180000).toISOString() })
  await live.waitForFunction(() => document.getElementById('gift-title').textContent === '最新生日祝福')
  assert.equal(await live.locator('#gift-recipient').innerText(), '给 小夏')
  assert.equal(await live.locator('#letter-content .message').innerText(), preview.message)
  assert.equal(await live.locator('#letter-content img').count(), 0, 'live text never becomes executable HTML')
  assert.equal(await live.locator('.flame').count(), 0, 'text changes preserve the blown candles')
  preview.layout = { height: 500, elements: [{ id: 'title', type: 'title', x: 5, y: 10, width: 90, color: '#715364', fontSize: 26, value: '' }, { id: 'message', type: 'message', x: 8, y: 30, width: 84, color: '#906489', fontSize: 16, value: '' }, { id: 'sticker', type: 'sticker', x: 35, y: 60, width: 30, color: '#715364', fontSize: 36, value: '🌷' }] }
  await live.waitForFunction(() => document.querySelectorAll('#letter-content .canvas-element').length === 3)
  assert.equal(await live.locator('.canvas-element').nth(1).innerText(), preview.message)
  assert.equal(await live.locator('.canvas-element').nth(2).evaluate(element => element.style.left), '35%')
  preview.layout.elements[2].x = 55; preview.layout.elements[2].value = '💗'; preview.title = '拖动也会实时同步'
  await live.waitForFunction(() => document.querySelectorAll('.canvas-element')[2].style.left === '55%')
  assert.equal(await live.locator('.canvas-element').nth(2).innerText(), '💗')
  assert.equal(await live.locator('#gift-title').innerText(), '拖动也会实时同步')
  await live.screenshot({ path: path.join(output, 'live-preview-layout.png'), fullPage: true })
  let navigations = 0; live.on('framenavigated', frame => { if (frame === live.mainFrame()) navigations++ })
  preview.background = 'video-stars'; preview.effects = ['hearts', 'sparkles', 'confetti']
  await live.waitForFunction(() => document.body.classList.contains('background-video-stars'))
  await checkScene(live, preview.background)
  await live.waitForFunction(() => !document.getElementById('letter').hidden && document.getElementById('blow-candles').disabled)
  assert.equal(navigations, 1, 'background and effect changes reload once')
  assert.equal(await live.locator('.flame').count(), 0, 'effect reload preserves the blown candles')
  assert.equal(await live.locator('.canvas-element').nth(2).innerText(), '💗', 'effect reload preserves the latest layout')
  await live.setViewportSize({ width: 320, height: 740 }); assert.equal(await mobileFits(live), true, 'live layout fits 320px')
  await live.screenshot({ path: path.join(output, 'live-preview-video-stars.png'), fullPage: true })
  sites.delete(preview.id)
  await live.waitForFunction(() => document.querySelector('main').textContent.includes('临时预览已回收'))
  assert.equal(await live.locator('#wall-form').count(), 0, 'reclaimed previews cannot post wishes')
  const readsAfterExpiry = previewReads; await live.waitForTimeout(2800)
  assert.equal(previewReads, readsAfterExpiry, 'expired preview stops polling')
  assert.equal((await fetch(base + '/gifts/' + preview.id)).status, 410, 'reclaimed preview cannot be opened again')
  await live.screenshot({ path: path.join(output, 'live-preview-expired.png') }); await live.close()
  assert.deepEqual(problems, [], 'No browser JS/CSP/WebGL errors')
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ time: new Date().toISOString(), results, visitorIsolation: true, namedAndAnonymousWishes: 8, nativeNoOriginPost: true, crossSitePostRejected: true, customLayout: true, livePreview: { text: true, safeRendering: true, layout: true, drag: true, effectReload: true, openedStateRetained: true, blownCandlesRetained: true, expiry410: true, pollingStops: true }, errors: problems }, null, 2))
  console.log('Gift browser verification passed: 8 video demos at 390/320px, 8 named/anonymous guestbooks, 4 static landscapes, 2 actual video backgrounds, live preview/drag/reload/410 and visitor isolation')
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { if (browser) await browser.close(); if (httpServer) await new Promise(resolve => httpServer.close(resolve)) })
