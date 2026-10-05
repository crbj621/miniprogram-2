'use strict'

const express = require('express')
const path = require('node:path')
const crypto = require('node:crypto')
const fs = require('node:fs')
const gifts = require('../services/gift_sites')
const catalog = require('../data/gifts/catalog.json')
const assetVersion = crypto.createHash('sha256').update(['gift.css', 'gift.js', 'background.js'].map(name => fs.readFileSync(path.join(__dirname, '../public/gifts', name))).join('\n')).digest('hex').slice(0, 12)
const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
function renderLetter(site) {
  if (!site.layout) return `<div class="letter-top"><span>Dear ${escape(site.recipient)}</span><span>✧</span></div><p class="message">${escape(site.message)}</p><p class="sender">${escape(site.sender || '一个在乎你的人')}</p>`
  const nodes = site.layout.elements.map(row => {
    const value = ['title', 'recipient', 'message', 'sender'].includes(row.type) ? site[row.type] : row.value
    const content = row.type === 'image' ? `<img src="${escape(value)}" alt="送给你的照片" loading="lazy">` : escape(value)
    return `<div class="canvas-element" style="left:${row.x}%;top:${row.y}%;width:${row.width}%;font-size:${row.fontSize / 3.6}cqw;color:${row.color}" data-font="${row.fontSize}">${content}</div>`
  }).join('')
  return `<div class="gift-canvas" style="padding-top:${site.layout.height / 360 * 100}%">${nodes}</div>`
}
function renderGift(site, assetBase) {
  const template = catalog.templates.find(row => row.id === site.templateId)
  const apiBase = assetBase.replace(/gift-assets$/, 'api/gifts/') + site.id
  const background = catalog.backgrounds.find(row => row.id === site.background)
  const data = JSON.stringify({ ...site, apiBase, backgroundVideo: background && background.video }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  const cake = site.templateId === 'birthday' ? '<section class="birthday-stage"><div class="cake"><div class="icing"></div><div class="drip"></div><div class="drip"></div><div class="drip"></div><div class="drip"></div><div class="drip"></div><div class="layer top"></div><div class="layer middle"></div><div class="layer bottom"></div></div></section><button id="blow-candles">许个愿，点一下吹灭蜡烛 🕯️</button><p id="wish-status" class="wish-status" aria-live="polite">先把愿望悄悄放在心里</p>' : ''
  const wall = '<section id="wall"><p class="section-kicker">WISHES FROM FRIENDS</p><h2>把朋友的祝福也收进来</h2><p class="wall-intro">可以写下名字，也可以悄悄送一份匿名祝福。</p><div id="wall-messages" aria-live="polite"></div><form id="wall-form"><label id="name-label">你的名字（可不填）<input name="name" maxlength="20" placeholder="想让 TA 知道是谁吗？" autocomplete="nickname"></label><label>留下一句话<textarea name="message" maxlength="200" required placeholder="生日快乐，愿你的每个愿望都有回音。"></textarea></label><label class="anonymous-label"><input type="checkbox" name="anonymous">匿名送出这份心意</label><button type="submit">送出我的祝福 ✦</button><p id="wall-status" aria-live="polite"></p></form></section>'
  const scenic = background && background.poster
  const landscape = scenic ? `<picture class="scene-backdrop"><source media="(min-aspect-ratio: 1/1)" srcset="${assetBase}/${background.widePoster}"><img class="scene-image" src="${assetBase}/${background.poster}" alt="" decoding="async"></picture>${background.video ? '<video class="scene-video" muted loop playsinline preload="none"></video>' : ''}` : ''
  const videoControls = background && background.video ? '<div class="video-controls"><button id="video-toggle" type="button" aria-pressed="false" aria-controls="scene">▶ 播放背景</button><span id="video-status" role="status" hidden></span></div>' : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escape(site.recipient)}，有一份心意正在等你"><meta name="referrer" content="no-referrer"><title>${escape(site.title)} · ${escape(site.recipient)}</title><link rel="icon" href="${assetBase}/favicon.svg">${cake ? `<link rel="stylesheet" href="${assetBase}/vendor/birthday-cake.css">` : ''}<link rel="stylesheet" href="${assetBase}/gift.css?v=${assetVersion}"></head><body class="background-${escape(site.background)} template-${escape(site.templateId)}${scenic ? ' landscape' : ''}"><div id="scene" aria-hidden="true">${landscape}</div>${videoControls}<div class="scene-vignette" aria-hidden="true"></div><div id="particles" aria-hidden="true"></div><div id="fireworks" aria-hidden="true"></div><main><p class="eyebrow">A LITTLE GIFT, JUST FOR YOU</p><span class="template-badge">${escape(template ? template.name : '一份小惊喜')}</span><div class="gift-hero"><div class="orbit orbit-one" aria-hidden="true"></div><div class="orbit orbit-two" aria-hidden="true"></div><span class="hero-star star-one" aria-hidden="true">✦</span><span class="hero-star star-two" aria-hidden="true">✧</span><div class="envelope" id="envelope"><div class="envelope-letter"><span>FOR YOU</span><i></i><i></i><i></i></div><div class="envelope-flap"></div><div class="envelope-fold"></div><span class="seal">${template ? template.icon : '💌'}</span></div></div><h1 id="gift-title">${escape(site.title)}</h1><p class="recipient" id="gift-recipient">给 ${escape(site.recipient)}</p><button id="open-gift">${site.templateId === 'prank' ? '来抓住这个神秘礼物 🎁' : '打开这份小惊喜 ✨'}</button><p id="play-status" aria-live="polite"></p>${site.preview ? '<p class="preview-banner" id="preview-status">免费预览 · 正在同步编辑内容</p>' : ''}<article id="letter" hidden>${cake}<div id="letter-content">${renderLetter(site)}</div><p id="fortune" class="fortune" hidden></p><button id="celebrate">${site.templateId === 'daily' ? '再抽一张今日幸运签 ☁️' : site.templateId === 'stars' ? '点亮一颗属于你的星 ✧' : '把这份快乐再放大一点 ✨'}</button>${wall}</article><p class="footer">这份心意，有效至 <time id="expires"></time><br>校园伙伴 · 祝福小站</p></main><script id="gift-data" type="application/json">${data}</script><script defer src="${assetBase}/vendor/fireworks-2.10.8.js"></script><script defer src="${assetBase}/vendor/confetti-1.9.4.js"></script><script defer src="${assetBase}/background.js?v=${assetVersion}"></script><script defer src="${assetBase}/gift.js?v=${assetVersion}"></script></body></html>`
}
function installGiftWeb(app, { rateLimit }) {
  const visitorId = (request, response) => {
    const cookie = String(request.get('cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith('gift_visitor='))
    const [id, signature] = String(cookie || '').slice(13).split('.')
    const sign = value => crypto.createHmac('sha256', process.env.JWT_SECRET).update(value).digest('hex')
    if (/^[a-f0-9]{32}$/.test(id) && /^[a-f0-9]{64}$/.test(signature) && crypto.timingSafeEqual(Buffer.from(sign(id)), Buffer.from(signature))) return id
    const created = crypto.randomBytes(16).toString('hex')
    response.cookie('gift_visitor', created + '.' + sign(created), { httpOnly: true, sameSite: 'lax', secure: request.secure || process.env.NODE_ENV === 'production', maxAge: 31 * 86400000, path: '/' })
    return created
  }
  app.use(['/gifts', '/gift-domain'], (request, response, next) => {
    const imageOrigin = new URL(process.env.PUBLIC_BASE_URL || 'https://www.crbuj.icu/campus-api').origin
    response.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: " + imageOrigin + "; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
    next()
  })
  app.use('/gift-assets', express.static(path.join(__dirname, '../public/gifts'), { maxAge: '1d', dotfiles: 'deny' }))
  const publicBase = () => new URL(process.env.PUBLIC_BASE_URL || 'https://www.crbuj.icu/campus-api').pathname.replace(/\/$/, '') + '/gift-assets'
  const domainOf = request => {
    const root = String(process.env.GIFT_DOMAIN || '').toLowerCase(), host = request.hostname.toLowerCase()
    return root && host.endsWith('.' + root) && host.slice(0, -(root.length + 1)).match(/^[a-z0-9-]{3,32}$/) ? host.slice(0, -(root.length + 1)) : ''
  }
  app.get('/api/gifts/:id', rateLimit('gift-read', 120, 60000), async (request, response) => {
    response.set('Cache-Control', 'no-store')
    const site = await gifts.published(request.params.id)
    const background = site && catalog.backgrounds.find(row => row.id === site.background)
    response.status(site ? 200 : 410).json({ success: Boolean(site), data: site ? { ...site, backgroundPoster: background && (background.nativePoster || background.poster) || '', backgroundVideo: background && background.video || null } : null, message: site ? '' : '这份祝福已到期或暂未开放' })
  })
  app.get('/api/gifts/:id/messages', rateLimit('gift-messages-read', 60, 60000), async (request, response) => {
    visitorId(request, response)
    response.set('Cache-Control', 'no-store').json({ success: true, data: await gifts.messages(request.params.id) })
  })
  app.post('/api/gifts/:id/messages', rateLimit('gift-messages-ip', 120, 60000), (request, response, next) => {
    request.giftVisitor = visitorId(request, response)
    return rateLimit('gift-messages-write:' + request.giftVisitor, 6, 60000)(request, response, next)
  }, async (request, response) => {
    response.set('Cache-Control', 'no-store')
    try {
      const origin = request.get('origin')
      // 原生小程序不携带 Origin；浏览器的跨站写入仍拒绝。
      if (origin && new URL(origin).host !== request.get('host')) return response.status(403).json({ success: false, message: '请在原网站中留言' })
      const visitor = request.giftVisitor
      response.json({ success: true, data: await gifts.leaveMessage(request.params.id, visitor, request.body) })
    } catch (error) { response.status(400).json({ success: false, message: error.message }) }
  })
  app.get('/gifts/demo/:template', (request, response) => {
    const template = catalog.templates.find(item => item.id === request.params.template)
    if (!template) return response.sendStatus(404)
    const videoBackground = catalog.backgrounds.find(item => item.video && item.id === request.query.background)
    response.set('Cache-Control', 'no-store').type('html').send(renderGift({ id: '', templateId: template.id, recipient: '小小的你', sender: '校园伙伴', title: template.defaultTitle, message: template.defaultMessage, background: videoBackground ? videoBackground.id : template.previewBackground, effects: template.previewEffects, expiresAt: new Date(Date.now() + 3 * 86400000).toISOString() }, publicBase()))
  })
  app.get(['/gifts/:id', '/gift-domain'], rateLimit('gift-html', 120, 60000), async (request, response) => {
    response.set('Cache-Control', 'no-store')
    const label = request.path === '/gift-domain' ? domainOf(request) : ''
    const site = label ? await gifts.publishedDomain(label) : await gifts.published(request.params.id)
    if (!site) return response.status(410).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>祝福暂不可用</title><p>这份祝福已到期、下架或尚未创建。</p>')
    response.type('html').send(renderGift(site, label ? '/gift-assets' : publicBase()))
  })
}
module.exports = { renderGift, installGiftWeb }
