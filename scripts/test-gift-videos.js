'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
const assetDirectory = path.resolve(__dirname, '../server/public/gifts')
const backgrounds = require('../server/data/gifts/catalog.json').backgrounds.filter(row => row.video)
const output = path.resolve(__dirname, '../docs/ui-preview/gifts/videos')
const viewports = [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]

function monitorVideo({ noWebGL = false, blockedFirst = false, deferredFirst = false } = {}) {
  const monitor = window.__videoMonitor = { hidden: false, playCalls: 0, pauseCalls: 0, loads: 0, webglRequests: 0 }
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => monitor.hidden })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => monitor.hidden ? 'hidden' : 'visible' })
  const play = HTMLMediaElement.prototype.play, pause = HTMLMediaElement.prototype.pause, load = HTMLMediaElement.prototype.load
  HTMLMediaElement.prototype.play = function() {
    monitor.playCalls++
    if (monitor.playCalls === 1 && blockedFirst) return Promise.reject(new DOMException('Regression: autoplay blocked', 'NotAllowedError'))
    if (monitor.playCalls === 1 && deferredFirst) return new Promise((resolve, reject) => { monitor.rejectFirst = reject })
    return play.call(this)
  }
  HTMLMediaElement.prototype.pause = function() { monitor.pauseCalls++; return pause.call(this) }
  HTMLMediaElement.prototype.load = function() { monitor.loads++; return load.call(this) }
  const getContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    if (/^webgl|^experimental-webgl/.test(type)) { monitor.webglRequests++; if (noWebGL) return null }
    return getContext.call(this, type, ...args)
  }
}

async function checkPoster(page, label) {
  await page.waitForFunction(() => {
    const image = document.querySelector('.scene-image'), source = image && image.parentElement.querySelector('source')
    const selected = source && matchMedia(source.media).matches ? new URL(source.srcset, location.href).href : image && image.src
    return image && image.complete && image.currentSrc === selected && image.naturalWidth > 0
  })
  const poster = await page.evaluate(() => {
    const image = document.querySelector('.scene-image'), rect = image.getBoundingClientRect()
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 32, 32)
    const pixels = context.getImageData(0, 0, 32, 32).data, colors = new Set()
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) colors.add(pixels[i] + ',' + pixels[i + 1] + ',' + pixels[i + 2])
    return { src: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight, colors: colors.size, covers: rect.left <= 0 && rect.top <= 0 && rect.right >= innerWidth - 1 && rect.bottom >= innerHeight - 1, overflow: document.documentElement.scrollWidth > innerWidth }
  })
  assert.ok(poster.colors > 20, label + ' decodes real poster pixels')
  assert.equal(poster.covers, true, label + ' poster covers the viewport')
  assert.equal(poster.overflow, false, label + ' has no horizontal overflow')
  return poster
}

async function checkPlaying(page, background, label) {
  const selected = background.video[page.viewportSize().width >= page.viewportSize().height ? 'wide' : 'portrait']
  await page.waitForFunction(source => {
    const video = document.querySelector('.scene-video')
    return video && video.currentSrc.includes(source) && video.readyState >= 2 && !video.paused && video.currentTime > 0 && video.classList.contains('is-playing')
  }, selected)
  await page.evaluate(() => new Promise(resolve => document.querySelector('.scene-video').requestVideoFrameCallback(resolve)))
  const video = await page.evaluate(() => {
    const element = document.querySelector('.scene-video'), rect = element.getBoundingClientRect()
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32
    const context = canvas.getContext('2d'); context.drawImage(element, 0, 0, 32, 32)
    const pixels = context.getImageData(0, 0, 32, 32).data, colors = new Set()
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) colors.add(pixels[i] + ',' + pixels[i + 1] + ',' + pixels[i + 2])
    return { src: element.currentSrc, width: element.videoWidth, height: element.videoHeight, duration: element.duration, time: element.currentTime, colors: colors.size, muted: element.muted && element.defaultMuted, loop: element.loop, inline: element.playsInline, preload: element.preload, sources: element.querySelectorAll('source').length, opacity: getComputedStyle(element).opacity, covers: rect.left <= 0 && rect.top <= 0 && rect.right >= innerWidth - 1 && rect.bottom >= innerHeight - 1, overflow: document.documentElement.scrollWidth > innerWidth }
  })
  assert.ok(Number.isFinite(video.duration) && video.duration > 1, label + ' has decoded duration')
  assert.ok(video.colors > 20, label + ' decodes real video pixels')
  assert.equal(video.muted && video.loop && video.inline, true, label + ' is muted, looping and inline')
  assert.equal(video.preload, 'none'); assert.equal(video.sources, 0, label + ' uses one selected src')
  assert.equal(video.opacity, '1'); assert.equal(video.covers, true); assert.equal(video.overflow, false)
  assert.equal(video.width >= video.height, selected === background.video.wide, label + ' selects the correct orientation')
  assert.equal(await page.evaluate(() => document.querySelector('.video-controls').getBoundingClientRect().bottom <= document.querySelector('.eyebrow').getBoundingClientRect().top), true, label + ' playback controls do not overlap the heading')
  await page.waitForFunction(before => {
    const element = document.querySelector('.scene-video')
    return element.currentSrc === before.src && !element.paused && (element.currentTime - before.time + element.duration) % element.duration > .15
  }, { src: video.src, time: video.time })
  return video
}

async function checkReleased(page, label) {
  // With no src/source, native resource selection returns NETWORK_EMPTY before changing currentSrc.
  await page.waitForFunction(() => {
    const video = document.querySelector('.scene-video')
    return !video.hasAttribute('src') && video.paused && video.readyState === video.HAVE_NOTHING && video.networkState === video.NETWORK_EMPTY && video.buffered.length === 0 && !video.classList.contains('is-playing')
  }).catch(async error => {
    const state = await page.evaluate(() => { const video = document.querySelector('.scene-video'); return { src: video.getAttribute('src'), currentSrc: video.currentSrc, paused: video.paused, readyState: video.readyState, networkState: video.networkState, classes: video.className, monitor: window.__videoMonitor } })
    throw new Error(label + ' release failed: ' + JSON.stringify(state) + '; ' + error.message)
  })
  const state = await page.evaluate(() => {
    const video = document.querySelector('.scene-video')
    return { src: video.getAttribute('src'), currentSrc: video.currentSrc, paused: video.paused, readyState: video.readyState, networkState: video.networkState, bufferedRanges: video.buffered.length, opacity: getComputedStyle(video).opacity, loads: window.__videoMonitor.loads, playCalls: window.__videoMonitor.playCalls }
  })
  assert.equal(state.opacity, '0', label + ' exposes the poster fallback')
  if (state.playCalls > 0) assert.ok(state.loads > 0, label + ' invokes native load to release the source')
  return state
}

async function checkBirthday(page, label) {
  await page.locator('#open-gift').click()
  await page.waitForFunction(() => !document.getElementById('letter').hidden && getComputedStyle(document.getElementById('letter')).opacity === '1')
  const materials = await page.evaluate(() => {
    const colors = value => [...value.matchAll(/rgba?\(([^)]+)\)/g)].map(match => { const channels = match[1].split(',').map(Number); return channels.length === 4 ? channels[3] : 1 })
    const paint = element => {
      const style = getComputedStyle(element), background = style.backgroundImage === 'none' ? style.backgroundColor : style.backgroundImage
      const alphas = colors(background)
      return { selector: element.className || element.id, opacity: Number(style.opacity), alphas }
    }
    const bodies = [...document.querySelectorAll('.cake .layer,.cake .icing,.cake .drip,.cake .candle')].map(paint)
    const glass = ['.envelope', '.envelope-letter', '.envelope-fold', '.envelope-flap', '#letter'].map(selector => paint(document.querySelector(selector)))
    const ancestorOpacity = []
    for (let element = document.querySelector('.cake'); element; element = element.parentElement) ancestorOpacity.push(Number(getComputedStyle(element).opacity))
    return { bodies, glass, ancestorOpacity, candles: document.querySelectorAll('.candle').length, flames: document.querySelectorAll('.flame').length, overflow: document.documentElement.scrollWidth > innerWidth }
  })
  assert.equal(materials.candles, 7); assert.equal(materials.flames, 35)
  for (const body of materials.bodies) assert.ok(body.opacity === 1 && body.alphas.length > 0 && body.alphas.every(alpha => alpha === 1), label + ' keeps ' + body.selector + ' opaque')
  assert.ok(materials.ancestorOpacity.every(alpha => alpha === 1), label + ' has no translucent cake ancestor')
  for (const glass of materials.glass) assert.ok(glass.opacity === 1 && glass.alphas.some(alpha => alpha > 0 && alpha < 1), label + ' keeps ' + glass.selector + ' glass translucent')
  assert.equal(materials.overflow, false, label + ' opened letter has no horizontal overflow')
  return materials
}

async function run() {
  const startedAt = new Date().toISOString()
  assert.ok(backgrounds.length > 0, 'catalog contains video backgrounds')
  for (const background of backgrounds) for (const asset of [background.poster, background.widePoster, background.nativePoster, ...Object.values(background.video)]) assert.ok(fs.statSync(path.join(assetDirectory, asset)).size > 0, asset + ' exists')
  const sourceFiles = ['scripts/test-gift-videos.js', 'server/src/gift-web.js', 'server/public/gifts/gift.css', 'server/public/gifts/gift.js', 'server/public/gifts/background.js', 'server/data/gifts/catalog.json', ...backgrounds.flatMap(background => [...new Set([background.poster, background.widePoster, background.nativePoster, ...Object.values(background.video)])].map(asset => 'server/public/gifts/' + asset))]
  const fileHashes = () => Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex')]))
  const sourceHashes = fileHashes()
  const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json')), express = serverRequire('express')
  const { renderGift, installGiftWeb } = require('../server/src/gift-web')
  for (const background of backgrounds) {
    const html = renderGift({ background: background.id, templateId: 'stars', effects: [] }, '/gift-assets')
    const video = html.match(/<video\b[^>]*>/)[0]
    assert.ok(!/\ssrc=/.test(video), 'initial HTML does not preload either video source')
    assert.match(video, /muted/); assert.match(video, /loop/); assert.match(video, /playsinline/)
    assert.ok(html.includes('id="video-toggle"'), 'A video background needs a visible manual play/retry control')
    assert.ok(html.includes('id="video-status"'), 'Autoplay or media failures must be explained')
  }
  const { chromium } = require(process.env.PLAYWRIGHT_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
  const app = express(), rows = [], errors = [], originalPublicBase = process.env.PUBLIC_BASE_URL
  app.get('/fixture/:background', (request, response) => response.type('html').send(renderGift({ id: '', templateId: request.query.template || 'stars', title: '把星光与风景送给你', recipient: '亲爱的你', sender: '校园伙伴', message: '愿你的每一天都有光。', background: request.params.background, effects: [], expiresAt: new Date(Date.now() + 86400000).toISOString() }, '/gift-assets')))
  app.get('/favicon.ico', (request, response) => response.sendStatus(204))
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1'
  installGiftWeb(app, { rateLimit: () => (request, response, next) => next() })
  const httpServer = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
  let browser
  try {
    fs.mkdirSync(output, { recursive: true })
    const base = 'http://127.0.0.1:' + httpServer.address().port
    const gifts = require('../server/services/gift_sites'), published = gifts.published
    try {
      for (const background of [...backgrounds, { id: 'not-a-video' }, null]) {
        gifts.published = async () => background ? { id: 'fixture', background: background.id } : null
        const response = await fetch(base + '/api/gifts/fixture'), payload = await response.json()
        assert.equal(response.status, background ? 200 : 410)
        if (background) assert.deepEqual(payload.data.backgroundVideo, background.video || null, 'Public view API supplies video URLs only for actual videos')
        else assert.equal(payload.data, null, 'Expired public view exposes no video or site')
      }
    } finally { gifts.published = published }
    browser = await chromium.launch({ channel: process.env.PREVIEW_BROWSER || 'msedge', headless: true })
    const makePage = async (background, options = {}, mode = 'normal') => {
      const page = await browser.newPage({ viewport: viewports[1], reducedMotion: options.reducedMotion || 'no-preference' }); page.setDefaultTimeout(15000)
      const requests = []
      page.on('request', request => { if (/\.mp4(?:\?|$)/.test(request.url())) requests.push(request.url()) })
      page.on('pageerror', error => errors.push(background.id + '-' + mode + ': ' + error.message))
      page.on('console', message => { if (message.type() === 'error' && !(mode === 'error' && /404/.test(message.text()))) errors.push(background.id + '-' + mode + ': ' + message.text()) })
      await page.addInitScript(monitorVideo, options)
      return { page, requests }
    }
    for (const background of backgrounds) {
      const releases = []
      const { page, requests } = await makePage(background)
      await page.setViewportSize(viewports[0]); await page.goto(base + '/fixture/' + background.id)
      for (const viewport of viewports) {
        await page.setViewportSize(viewport)
        const poster = await checkPoster(page, background.id), video = await checkPlaying(page, background, background.id + '-' + viewport.width)
        assert.equal(await page.locator('#scene canvas').count(), 0, 'video backgrounds do not start WebGL overlays')
        assert.equal(await page.locator('script[src*="vendor/three"],script[src*="vendor/starrysky"],script[src*="vendor/vanta"],script[src*="vendor/Fire"]').count(), 0, 'video backgrounds do not load 3D or particle engines')
        if (viewport.width < viewport.height) assert.ok(requests.every(url => url.includes(background.video.portrait)), 'portrait visits never request the wide video')
        await page.screenshot({ path: path.join(output, background.id + '-' + viewport.width + '.png') })
        rows.push({ background: background.id, viewport, poster, video })
      }
      assert.equal(new Set(requests).size, 2, background.id + ' requests only selected portrait and wide files')
      await page.setViewportSize(viewports[1]); await checkPlaying(page, background, background.id + ' resized back to portrait')
      await page.evaluate(() => { const video = document.querySelector('.scene-video'); video.currentTime = video.duration - .22 })
      await page.waitForFunction(() => { const video = document.querySelector('.scene-video'); return video.currentTime < 1 && !video.paused && video.classList.contains('is-playing') })
      for (let cycle = 0; cycle < 3; cycle++) {
        await page.evaluate(() => { window.__videoMonitor.hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
        releases.push({ phase: 'hidden-' + cycle, ...await checkReleased(page, background.id + ' hidden') })
        await page.evaluate(() => { window.__videoMonitor.hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
        await checkPlaying(page, background, background.id + ' visible')
      }
      await page.emulateMedia({ reducedMotion: 'reduce' }); releases.push({ phase: 'reduced-motion', ...await checkReleased(page, background.id + ' reduced motion') })
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await checkPlaying(page, background, background.id + ' motion restored')
      await page.locator('#video-toggle').click(); releases.push({ phase: 'manual-pause', ...await checkReleased(page, background.id + ' manual pause') })
      const pausedCalls = await page.evaluate(() => window.__videoMonitor.playCalls)
      await page.locator('#open-gift').click()
      await page.evaluate(() => { window.__videoMonitor.hidden = true; document.dispatchEvent(new Event('visibilitychange')); window.__videoMonitor.hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
      await page.setViewportSize(viewports[2]); await checkReleased(page, background.id + ' manual pause survives events')
      assert.equal(await page.evaluate(() => window.__videoMonitor.playCalls), pausedCalls)
      await page.locator('#video-toggle').click(); await checkPlaying(page, background, background.id + ' manual resume')
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
      releases.push({ phase: 'persisted-hide', ...await checkReleased(page, background.id + ' persisted hide') })
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
      await checkPlaying(page, background, background.id + ' persisted show')
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })))
      releases.push({ phase: 'destroy', ...await checkReleased(page, background.id + ' permanent destroy') })
      const calls = await page.evaluate(() => window.__videoMonitor.playCalls)
      await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); window.giftScene.resume(); document.dispatchEvent(new Event('visibilitychange')) })
      await page.setViewportSize(viewports[2]); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.evaluate(() => document.getElementById('open-gift').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await checkReleased(page, background.id + ' destroy guard')
      assert.equal(await page.evaluate(() => window.__videoMonitor.playCalls), calls, 'destroyed scenes cannot play again')
      rows.push({ background: background.id, mode: 'lifecycle', releases })
      await page.close()

      for (const mode of ['reduced-motion', 'no-webgl', 'error', 'autoplay-blocked', 'stale-rejection']) {
        const options = { reducedMotion: mode === 'reduced-motion' ? 'reduce' : 'no-preference', noWebGL: mode === 'no-webgl', blockedFirst: mode === 'autoplay-blocked', deferredFirst: mode === 'stale-rejection' }
        const { page, requests } = await makePage(background, options, mode)
        if (mode === 'error') await page.route('**/*.mp4', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Fixture: unavailable video' }))
        await page.goto(base + '/fixture/' + background.id)
        const poster = await checkPoster(page, background.id + '-' + mode)
        let video
        if (mode === 'reduced-motion' || mode === 'error' || mode === 'autoplay-blocked') {
          if (mode !== 'reduced-motion') await page.waitForFunction(() => window.__videoMonitor.playCalls > 0)
          await checkReleased(page, background.id + '-' + mode)
          assert.equal(await page.locator('#video-status').isVisible(), true, mode + ' explains the stopped background')
          assert.ok((await page.locator('#video-status').innerText()).length > 0)
          if (mode === 'reduced-motion') { assert.equal(requests.length, 0, 'reduced motion initially downloads no video'); assert.equal(await page.evaluate(() => window.__videoMonitor.playCalls), 0) }
          if (mode === 'error') await page.unroute('**/*.mp4')
          await page.locator('#video-toggle').click(); video = await checkPlaying(page, background, background.id + '-' + mode + ' explicit retry')
          assert.equal(await page.locator('#video-status').isVisible(), false, 'playing clears the failure hint')
        } else {
          if (mode === 'stale-rejection') {
            await page.locator('#video-toggle').click(); await checkPlaying(page, background, background.id + ' second play')
            await page.evaluate(() => window.__videoMonitor.rejectFirst(new DOMException('Regression: old autoplay failure', 'NotAllowedError')))
          }
          video = await checkPlaying(page, background, background.id + '-' + mode)
        }
        if (mode === 'no-webgl') assert.equal(await page.evaluate(() => window.__videoMonitor.webglRequests), 0, 'native video needs no WebGL context')
        await page.screenshot({ path: path.join(output, background.id + '-' + mode + '.png') }); rows.push({ background: background.id, mode, poster, video })
        await page.close()
      }
      const { page: birthday } = await makePage(background, {}, 'birthday')
      await birthday.goto(base + '/fixture/' + background.id + '?template=birthday')
      for (const viewport of viewports) {
        await birthday.setViewportSize(viewport); await checkPlaying(birthday, background, background.id + ' birthday')
        if (viewport === viewports[0]) {
          const materials = await checkBirthday(birthday, background.id + ' birthday')
          rows.push({ background: background.id, mode: 'birthday', materials })
        }
        assert.equal(await birthday.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'birthday fits ' + viewport.width + 'px')
        await birthday.screenshot({ path: path.join(output, background.id + '-birthday-' + viewport.width + '.png'), fullPage: true })
      }
      await birthday.locator('#blow-candles').click(); assert.equal(await birthday.locator('.flame').count(), 0)
      await birthday.close()
    }
    const demo = await browser.newPage({ viewport: viewports[1] })
    const response = await demo.goto(base + '/gifts/demo/birthday?background=' + backgrounds[0].id)
    assert.match(response.headers()['content-security-policy'], /media-src 'self'/)
    await checkPlaying(demo, backgrounds[0], 'official video demo')
    await demo.goto(base + '/gifts/demo/birthday?background=not-a-video')
    const defaultBackground = require('../server/data/gifts/catalog.json').templates.find(row => row.id === 'birthday').previewBackground
    assert.equal(await demo.evaluate(() => JSON.parse(document.getElementById('gift-data').textContent).background), defaultBackground, 'invalid demo background falls back to the template default')
    await demo.close()
    assert.deepEqual(errors, [], 'videos produce no unexpected browser errors')
    assert.deepEqual(fileHashes(), sourceHashes, 'tested source and media stay unchanged throughout this run')
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ startedAt, time: new Date().toISOString(), browser: 'headless Microsoft Edge / native MP4 decoder', browserVersion: browser.version(), sourceHashes, backgroundCount: backgrounds.length, viewportPlayback: backgrounds.length * viewports.length, decodedVideoPixels: true, oneSelectedSource: true, realLoopWrap: true, lifecycle: { hiddenCycles: 3, visibility: 'browser callbacks with simulated document.hidden', liveReducedMotion: true, pageTransitions: 'constructed PageTransitionEvent persisted hide/show; nonpersisted destroy guard', resourceRelease: 'src removed, load called, paused, HAVE_NOTHING, NETWORK_EMPTY and no buffered ranges; currentSrc may retain its historical URL' }, recovery: { unavailableVideoPoster: true, autoplayGestureRetry: true, oldRejectionCannotStopNewPlayback: true }, birthdayOpaqueBodiesAndGlassPaper: true, officialDemoAndCSP: true, boundaries: ['Viewport sizes are desktop browser simulation, not phones.', 'PageTransitionEvent tests do not establish a native back-forward cache hit.', 'WeChat, iOS autoplay, hardware decoding, cellular performance and locking the phone remain unverified.'], rows, errors }, null, 2))
    console.log('Gift videos passed: ' + backgrounds.length + ' backgrounds at 320/390/1440px, native decoded MP4 pixels/time/loop, selected sources, resize, lifecycle release, poster/error/autoplay/race recovery, opaque birthday cake and glass paper')
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => httpServer.close(resolve))
    if (originalPublicBase === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = originalPublicBase
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
