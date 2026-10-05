'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createRequire } = require('node:module')
const serverRequire = createRequire(path.resolve(__dirname, '../server/package.json'))
const express = serverRequire('express'), { renderGift } = require('../server/src/gift-web')
const { chromium } = require(process.env.PLAYWRIGHT_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
const catalog = require('../server/data/gifts/catalog.json'), output = path.resolve(__dirname, '../docs/ui-preview/gifts/landscapes')
const scenes = catalog.backgrounds.filter(row => row.kind === 'static' && row.poster)
async function run() {
  assert.equal(scenes.length, 4, 'four illustrated landscapes are explicitly static')
  assert.ok(catalog.backgrounds.filter(row => row.kind === 'dynamic').every(row => row.video), 'every dynamic background has an actual video')
  const app = express(), errors = [], rows = []
  app.use('/gift-assets', express.static(path.resolve(__dirname, '../server/public/gifts')))
  app.get('/favicon.ico', (request, response) => response.sendStatus(204))
  app.get('/fixture/:background', (request, response) => response.type('html').send(renderGift({ id: '', templateId: 'stars', title: '静态风景图片', recipient: '亲爱的你', sender: '校园伙伴', message: '静态插画归入静态背景。', background: request.params.background, effects: [], expiresAt: new Date(Date.now() + 86400000).toISOString() }, '/gift-assets')))
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)) })
  let browser
  try {
    fs.mkdirSync(output, { recursive: true })
    browser = await chromium.launch({ channel: 'msedge', headless: true })
    for (const scene of scenes) for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const page = await browser.newPage({ viewport })
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('http://127.0.0.1:' + server.address().port + '/fixture/' + scene.id)
      await page.waitForFunction(() => { const image = document.querySelector('.scene-image'); return image.complete && image.naturalWidth > 0 })
      const result = await page.evaluate(() => {
        const image = document.querySelector('.scene-image'), rect = image.getBoundingClientRect(), canvas = document.createElement('canvas')
        canvas.width = canvas.height = 16
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 16, 16)
        const pixels = ctx.getImageData(0, 0, 16, 16).data, colors = new Set()
        for (let i = 0; i < pixels.length; i += 4) colors.add(pixels[i] + ',' + pixels[i + 1] + ',' + pixels[i + 2])
        return { src: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight, colors: colors.size, fit: rect.width >= innerWidth && rect.height >= innerHeight, overflow: document.documentElement.scrollWidth > innerWidth, sceneCanvases: document.querySelectorAll('#scene canvas').length, videos: document.querySelectorAll('#scene video').length, engines: [...document.scripts].filter(row => /vendor\/(three|vanta|starrysky)/.test(row.src)).length }
      })
      assert.ok(result.colors > 20 && result.fit, 'actual image pixels cover the viewport')
      assert.equal(result.overflow, false); assert.equal(result.sceneCanvases + result.videos + result.engines, 0, 'static scenery loads no animation engines or video')
      await page.screenshot({ path: path.join(output, 'static-' + scene.id + '-' + viewport.width + '.png') })
      rows.push({ background: scene.id, viewport, ...result }); await page.close()
    }
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ time: new Date().toISOString(), classification: 'User requested all image-only landscapes belong to static backgrounds; current dynamic items are video only.', rows, errors }, null, 2))
    console.log('Static landscape verification passed: 4 backgrounds x 3 viewports, real pixels, responsive artwork, no animation engines')
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
