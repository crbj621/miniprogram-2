'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const cloud = require('campus-server-sdk')
const catalog = require('../../data/gifts/catalog.json')
const { normalizeModules } = require('../../src/module-policy')
const { profileId, walletLock, loadWalletProfile } = require('../../src/campus-wallet')
const { normalizeLayout } = require('../../src/gift-layout')
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const validId = id => /^[a-f0-9]{24}$/.test(String(id || ''))
const reservedDomains = new Set(['www', 'api', 'admin', 'mail', 'smtp', 'ftp', 'ns1', 'ns2', 'love', 'sqyz', 'campus', 'auth', 'cdn', 'assets'])
function domainLabel(value) {
  const label = String(value || '').trim().toLowerCase()
  if (label && (!/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(label) || /^(g|p)-/.test(label) || reservedDomains.has(label))) throw Error('域名需为3至32位英文、数字或短横线，以字母开头；不能使用保留名称')
  if (label && (String(process.env.GIFT_RESERVED_DOMAINS || '').split(',').includes(label) || fs.existsSync(path.join(process.env.GIFT_EXISTING_SITES_ROOT || '/www/wwwroot/sites', label)))) throw Error('这个域名已用于现有网站，请换一个名字')
  return label
}
function text(value, max, label, required = false) {
  const result = String(value || '').trim()
  if (result.length > max || (required && !result)) throw Error(label + '请填写1至' + max + '个字')
  return result
}
function fields(input, openid) {
  if (input.listed !== undefined && typeof input.listed !== 'boolean') throw Error('公示开关格式不正确')
  if (!catalog.templates.some(item => item.id === input.templateId)) throw Error('请选择有效模板')
  if (!catalog.backgrounds.some(item => item.id === input.background)) throw Error('请选择有效背景')
  if (!Array.isArray(input.effects) || input.effects.length > catalog.effects.length || new Set(input.effects).size !== input.effects.length || input.effects.some(id => !catalog.effects.some(item => item.id === id))) throw Error('特效选择不正确')
  return { templateId: input.templateId, background: input.background, effects: input.effects, listed: input.listed === true, layout: normalizeLayout(input.layout, openid),
    recipient: text(input.recipient, 24, '收件人姓名', true), sender: text(input.sender, 24, '署名'),
    title: text(input.title, 40, '标题', true), message: text(input.message, 1200, '祝福', true) }
}
function expiresAt(now, durationId, trial) {
  if (trial) return new Date(now.getTime() + catalog.trialHours * 3600000).toISOString()
  const duration = catalog.durations.find(item => item.id === durationId)
  if (!duration) throw Error('请选择3天、7天、15天或1个月')
  if (duration.days) return new Date(now.getTime() + duration.days * 86400000).toISOString()
  const result = new Date(now.getTime() + 8 * 3600000), day = result.getUTCDate()
  result.setUTCDate(1); result.setUTCMonth(result.getUTCMonth() + duration.months)
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, last))
  return new Date(result.getTime() - 8 * 3600000).toISOString()
}
function siteUrl(site) {
  const domain = String(process.env.GIFT_DOMAIN || '').toLowerCase()
  return domain ? 'https://' + site.domainLabel + '.' + domain + '/' : String(process.env.PUBLIC_BASE_URL || 'https://www.crbuj.icu/campus-api').replace(/\/$/, '') + '/gifts/' + site.id
}
function publicView(site) {
  return { id: site.id, templateId: site.templateId, background: site.background, effects: site.effects,
    recipient: site.recipient, sender: site.sender, title: site.title, message: site.message,
    layout: site.layout || null, listed: site.listed === true, expiresAt: site.expiresAt, updatedAt: site.updatedAt, preview: site.status === 'preview', domainLabel: site.domainLabel, url: siteUrl(site) }
}
function createService(dependencies = {}) {
  const sdk = dependencies.cloud || cloud, db = sdk.database(), clock = dependencies.clock || (() => new Date())
  const get = async (name, id) => (await db.collection(name).doc(id).get()).data
  const put = (name, id, value) => db.collection(name).doc(id).set({ data: value })
  const enabled = async () => normalizeModules((await db.collection('global_settings').get()).data[0]?.modules).gifts.enabled
  async function owned(openid, id) {
    if (!validId(id)) throw Error('网站编号不正确')
    const site = await get('gift_sites', id)
    if (!site || site.openid !== openid) throw Error('网站不存在或无权操作')
    return site
  }
  const active = site => site.status === 'published' && Date.parse(site.expiresAt) > clock().getTime()
  async function published(id) {
    if (!validId(id) || !await enabled()) return null
    const site = await get('gift_sites', id)
    if (site && active(site)) return publicView(site)
    const preview = await get('gift_previews', id)
    return preview && Date.parse(preview.expiresAt) > clock().getTime() ? publicView(preview) : null
  }
  async function publishedDomain(label) {
    if (/^p-[a-f0-9]{24}$/.test(label)) return published(label.slice(2))
    const entry = await get('gift_domains', label)
    return entry ? published(entry.siteId) : null
  }
  async function gallery(page = 1) {
    if (!await enabled()) return { sites: [], hasMore: false }
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw Error('分页参数无效')
    const rows = (await db.collection('gift_sites').where({ listed: true, status: 'published', expiresAt: db.command.gt(clock().toISOString()) }).orderBy('createdAt', 'desc').skip((page - 1) * 12).limit(13).get()).data
    return { sites: rows.slice(0, 12).map(publicView), hasMore: rows.length > 12 }
  }
  async function purgeExpired() {
    await purgePreviews()
    // 删库中到期内容，不创建每人一份进程、目录或依赖包。
    const rows = (await db.collection('gift_sites').where({ expiresAt: db.command.lte(clock().toISOString()) }).get()).data
    for (const row of rows) await db.runTransaction(async () => {
      const site = await get('gift_sites', row._id)
      if (!site || Date.parse(site.expiresAt) > clock().getTime()) return
      const domain = await get('gift_domains', site.domainLabel)
      if (domain && domain.siteId === site.id) await db.collection('gift_domains').doc(site.domainLabel).remove()
      await db.collection('gift_messages').where({ siteId: site.id }).remove()
      await db.collection('gift_message_visitors').where({ siteId: site.id }).remove()
      await db.collection('gift_sites').doc(site.id).remove()
    }, { readCommitted: true })
    await purgeImages()
    return rows.length
  }
  async function removePreview(id, openid) {
    const preview = validId(id) && await get('gift_previews', id)
    if (!preview) return
    if (preview.openid !== openid) throw Error('无权操作这个预览')
    await db.collection('gift_messages').where({ siteId: id }).remove()
    await db.collection('gift_message_visitors').where({ siteId: id }).remove()
    await db.collection('gift_previews').doc(id).remove()
  }
  async function purgePreviews() {
    const expired = (await db.collection('gift_previews').where({ expiresAt: db.command.lte(clock().toISOString()) }).get()).data
    for (const row of expired) await db.runTransaction(async () => {
      const current = await get('gift_previews', row._id)
      if (current && Date.parse(current.expiresAt) <= clock().getTime()) await removePreview(row._id, current.openid)
    }, { readCommitted: true })
    return expired.length
  }
  async function uploadImage(file, openid) {
    const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[String(file.mimetype || '').toLowerCase()]
    if (!extension) throw Error('祝福图片仅支持 JPG、PNG 或 WebP')
    const owner = hash(openid), cloudPath = 'gift-sites/' + owner + '/' + clock().getTime() + '-' + crypto.randomBytes(6).toString('hex') + extension
    let saved
    try {
      return await db.runTransaction(async () => {
        saved = await sdk.__saveFile({ cloudPath, fileContent: file.buffer })
        await db.collection('gift_uploads').doc(hash(saved.fileID)).create({ data: { openid, url: saved.fileID, createdAt: clock().toISOString() } })
        return saved
      }, { lock: 'gift-upload:' + owner, readCommitted: true })
    } catch (error) {
      if (saved) await fs.promises.unlink(path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'), cloudPath)).catch(failure => { if (failure.code !== 'ENOENT') throw failure })
      throw error
    }
  }
  async function purgeImages() {
    const root = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'), 'gift-sites')
    const base = String(process.env.PUBLIC_BASE_URL || 'https://www.crbuj.icu/campus-api').replace(/\/$/, '')
    const cutoff = clock().getTime() - 86400000
    // 旧上传可能是 GIF 或错误扩展；只回收本模块实际生成的文件名。
    const filename = /^\d+-[a-f0-9]{12}(?:\.[^/\\]+)?$/i
    const targetFor = url => {
      try {
        const match = new URL(url, 'http://local').pathname.match(/(?:^|\/)uploads\/gift-sites\/([a-f0-9]{64})\/([^/]+)$/)
        const name = match && decodeURIComponent(match[2])
        return match && filename.test(name) ? path.join(root, match[1], name) : null
      } catch (_) { return null }
    }
    const references = async () => {
      const sites = [...(await db.collection('gift_sites').get()).data, ...(await db.collection('gift_previews').get()).data]
      const urls = sites.flatMap(site => (site.layout && site.layout.elements || []).filter(row => row.type === 'image').map(row => row.value))
      return { urls: new Set(urls), targets: new Set(urls.map(targetFor).filter(Boolean)) }
    }
    const uploads = (await db.collection('gift_uploads').get()).data
    const owners = fs.existsSync(root) ? await fs.promises.readdir(root, { withFileTypes: true }) : []
    for (const owner of owners) {
      if (!owner.isDirectory() || !/^[a-f0-9]{64}$/.test(owner.name)) continue
      const folder = path.join(root, owner.name)
      for (const file of await fs.promises.readdir(folder, { withFileTypes: true })) {
        if (!file.isFile() || !filename.test(file.name)) continue
        const target = path.join(folder, file.name), url = base + '/uploads/gift-sites/' + owner.name + '/' + file.name
        if ((await fs.promises.stat(target)).mtimeMs >= cutoff) continue
        const removable = await db.runTransaction(async () => {
          if ((await references()).targets.has(target)) return false
          // 与发布共用上传文档行锁，先解除可引用资格，再移除文件。
          const ids = new Set([hash(url), ...uploads.filter(row => targetFor(row.url) === target).map(row => row._id)])
          for (const id of ids) {
            const upload = await get('gift_uploads', id)
            if (upload && Date.parse(upload.createdAt) >= cutoff) return false
          }
          // 等待资格行锁期间，发布可能已经提交了新引用，必须再检查。
          if ((await references()).targets.has(target)) return false
          for (const id of ids) await db.collection('gift_uploads').doc(id).remove()
          return true
        }, { readCommitted: true })
        if (removable) await fs.promises.unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error })
      }
    }
    // 文件被外部移除时，也回收没有任何网站引用的旧资格记录。
    for (const row of uploads) await db.runTransaction(async () => {
      const refs = await references(), current = await get('gift_uploads', row._id)
      if (!current || Date.parse(current.createdAt) >= cutoff || refs.urls.has(current.url)) return
      const target = targetFor(current.url)
      if (target && (refs.targets.has(target) || fs.existsSync(target))) return
      const latest = await references()
      if (latest.urls.has(current.url) || (target && latest.targets.has(target))) return
      await db.collection('gift_uploads').doc(row._id).remove()
    }, { readCommitted: true })
    for (const owner of owners) {
      if (!owner.isDirectory() || !/^[a-f0-9]{64}$/.test(owner.name)) continue
      // 同一所有者的上传与空目录回收互斥；rmdir 不会删除非空目录。
      await db.runTransaction(() => fs.promises.rmdir(path.join(root, owner.name)).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error }), { lock: 'gift-upload:' + owner.name, readCommitted: true })
    }
  }
  async function validateMedia(value, openid) {
    for (const row of value.layout && value.layout.elements || []) if (row.type === 'image') {
      const upload = await get('gift_uploads', hash(row.value))
      if (!upload || upload.openid !== openid) throw Error('图片已清理或不属于你，请重新上传')
    }
  }
  async function messages(id) {
    const site = await published(id)
    if (!site) return []
    return (await db.collection('gift_messages').where({ siteId: id }).get()).data.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40).map(row => ({ id: row._id, name: row.name, message: row.message, createdAt: row.createdAt }))
  }
  async function leaveMessage(id, visitor, input) {
    if (!visitor || !validId(id)) throw Error('留言请求不正确')
    return db.runTransaction(async () => {
      const site = await published(id)
      if (!site) throw Error('这份祝福已到期或暂不可用')
      const rows = (await db.collection('gift_messages').where({ siteId: id }).get()).data
      const today = new Date(clock().getTime() + 8 * 3600000).toISOString().slice(0, 10), visitorId = hash('gift-message|' + id + '|' + visitor)
      const visit = await get('gift_message_visitors', visitorId), count = visit && visit.day === today ? visit.count : 0
      if (count >= 3) throw Error('今天已留下3份心意，明天再来吧')
      const now = clock().toISOString(), message = text(input.message, 200, '留言', true), name = input.anonymous === true ? '匿名朋友' : text(input.name, 20, '署名') || '匿名朋友'
      await put('gift_message_visitors', visitorId, { siteId: id, visitor, day: today, count: count + 1 })
      await db.collection('gift_messages').add({ data: { siteId: id, visitor, name, message, createdAt: now } })
      // 有界留言墙，旧留言随网站到期一起删除。
      for (const row of rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(39)) await db.collection('gift_messages').doc(row._id).remove()
      return messages(id)
    }, { lock: 'gift-site:' + id, readCommitted: true })
  }
  async function main(input = {}) {
    const openid = sdk.getWXContext().OPENID
    if (input.action === 'view') return { success: true, data: await published(input.id) }
    if (input.action === 'gallery') {
      try { return { success: true, data: await gallery(input.page === undefined ? 1 : input.page) } }
      catch (error) { return { success: false, msg: error.message } }
    }
    if (!openid) return { success: false, msg: '请先登录' }
    try {
      if (['adminList', 'adminHide', 'grantCoins'].includes(input.action)) {
        const admins = (await db.collection('global_admin').where({ loginOpenid: openid }).get()).data
        const admin = admins.find(admin => admin.status !== 'disabled' && ['super', 'normal'].includes(admin.role))
        if (!admin) throw Error('需要管理员权限')
        if (input.action === 'grantCoins') {
          if (admin.role !== 'super') throw Error('仅超级管理员可发放金币')
          const target = await get('users', text(input.userId, 64, '用户编号', true)), targetOpenid = target && (target._openid || target.openid)
          if (!targetOpenid || target.status === 'disabled') throw Error('用户不存在或已禁用')
          const amount = Number(input.amount), requestId = text(input.requestId, 100, '请求编号', true), reason = text(input.reason, 120, '奖励说明') || '管理员奖励'
          if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000 || !/^[A-Za-z0-9_.:-]+$/.test(requestId)) throw Error('金币须为1至1000000的整数，请填写有效请求编号')
          return await db.runTransaction(async () => {
            const verified = (await db.collection('global_admin').where({ loginOpenid: openid }).get()).data
            if (!verified.some(row => row.role === 'super' && row.status !== 'disabled')) throw Error('管理员权限已失效')
            const user = await get('users', target._id)
            if (!user || user.status === 'disabled' || (user._openid || user.openid) !== targetOpenid) throw Error('用户状态已变化')
            const profile = await loadWalletProfile(db, targetOpenid, clock().toISOString()), ledgerId = hash('admin-grant|' + openid + '|' + requestId), previous = await get('english_coin_ledger', ledgerId)
            if (previous) {
              if (previous.openid !== targetOpenid || previous.amount !== amount || previous.reason !== reason) throw Error('此请求已处理，不能修改接收人或金额后重发')
              return { success: true, data: { coins: profile.coins, amount, userId: target._id, name: user.nickName || '同学', duplicate: true } }
            }
            if (!Number.isSafeInteger(profile.coins + amount)) throw Error('金币余额超出范围')
            profile.coins += amount
            const now = clock().toISOString()
            await db.collection('english_coin_ledger').doc(ledgerId).create({ data: { openid: targetOpenid, actor: openid, kind: 'admin_grant', amount, requestId, reason, createdAt: now } })
            await put('english_profiles', profileId(targetOpenid), profile)
            await db.collection('global_admin_log').add({ data: { _openid: openid, module: 'coins', action: 'grant', adminName: admin.username || admin.name || '超级管理员', detail: '给' + (user.nickName || '同学') + '发放' + amount + '金币：' + reason, userId: target._id, amount, createTime: now } })
            return { success: true, data: { coins: profile.coins, amount, userId: target._id, name: user.nickName || '同学', duplicate: false } }
          }, { lock: walletLock(targetOpenid), readCommitted: true })
        }
        if (input.action === 'adminHide') await db.runTransaction(async () => {
          const verified = (await db.collection('global_admin').where({ loginOpenid: openid }).get()).data
          if (!verified.some(admin => admin.status !== 'disabled' && ['super', 'normal'].includes(admin.role))) throw Error('需要管理员权限')
          const site = validId(input.id) && await get('gift_sites', input.id)
          if (!site) throw Error('网站不存在')
          site.status = 'blocked'; site.moderatedAt = clock().toISOString()
          await put('gift_sites', site.id, site)
          await db.collection('global_admin_log').add({ data: { _openid: openid, module: 'gifts', action: 'hide', siteId: site.id, createTime: clock().toISOString() } })
        }, { lock: 'gift-site:' + input.id, readCommitted: true })
        return { success: true, data: { admin: { role: admin.role }, sites: (await db.collection('gift_sites').get()).data.filter(active).map(publicView) } }
      }
      if (!await enabled()) throw Error('祝福网站模块暂未开放')
      return await db.runTransaction(async () => {
        if (input.action === 'preview') {
          const value = fields(input, openid)
          // 与图片清理一致：先锁预览，再锁上传资格，避免反向等待。
          const previews = (await db.collection('gift_previews').where({ openid }).get()).data
          await validateMedia(value, openid)
          let preview = previews.find(row => Date.parse(row.expiresAt) > clock().getTime())
          for (const row of previews) if (!preview || row._id !== preview._id) await removePreview(row._id, openid)
          const now = clock().toISOString(), id = preview ? preview.id : crypto.randomBytes(12).toString('hex')
          preview = { ...value, id, openid, domainLabel: 'p-' + id, status: 'preview', createdAt: preview ? preview.createdAt : now, updatedAt: now, expiresAt: new Date(clock().getTime() + catalog.previewLeaseSeconds * 1000).toISOString() }
          await put('gift_previews', id, preview)
          return { success: true, data: { site: publicView(preview) } }
        }
        if (input.action === 'releasePreview' || input.action === 'renewPreview') {
          const preview = validId(input.id) && await get('gift_previews', input.id)
          if (preview && preview.openid !== openid) throw Error('无权操作这个预览')
          if (preview && Date.parse(preview.expiresAt) > clock().getTime()) {
            preview.expiresAt = new Date(clock().getTime() + catalog.previewLeaseSeconds * 1000).toISOString(); await put('gift_previews', input.id, preview)
            return { success: true, data: { site: publicView(preview) } }
          }
          return { success: true, data: { site: null } }
        }
        const profile = await loadWalletProfile(db, openid, clock().toISOString())
        if (input.action === 'catalog') return { success: true, data: { ...catalog, coins: profile.coins, trialAvailable: !profile.giftTrialUsedAt, gallery: await gallery(), sites: (await db.collection('gift_sites').where({ openid }).get()).data.filter(site => Date.parse(site.expiresAt) > clock().getTime()).map(site => ({ ...publicView(site), status: site.status, trial: site.trial, purchasedEffects: site.purchasedEffects, purchasedBackgrounds: site.purchasedBackgrounds || [site.background] })) } }
        if (input.action === 'create') {
          const requestId = text(input.requestId, 100, '请求编号', true)
          if (!/^[A-Za-z0-9_.:-]+$/.test(requestId)) throw Error('请求编号不正确')
          const ledgerId = hash('gift|' + openid + '|' + requestId), previous = await get('english_coin_ledger', ledgerId)
          if (previous) {
            const existing = await get('gift_sites', previous.siteId)
            if (!existing || !active(existing)) throw Error('该创建请求已完成，网站已到期或下架，请使用新的请求')
            return { success: true, data: { site: publicView(existing), coins: profile.coins } }
          }
          const live = (await db.collection('gift_sites').where({ openid }).get()).data.filter(active)
          if (live.length >= 3) throw Error('每人最多同时上线3个网站，请先删除一个或等待到期')
          const value = fields(input, openid), trial = input.trial === true
          // 同事务消费预览；与清理一致先锁预览，再锁上传，失败会整体回滚。
          if (input.previewId) await removePreview(input.previewId, openid)
          await validateMedia(value, openid)
          const customLabel = domainLabel(input.domainLabel)
          const duration = catalog.durations.find(item => item.id === input.durationId)
          if ((trial && input.durationId !== '2h') || (!trial && !duration)) throw Error('时长规则已更新，请重新选择2小时体验、3天、7天、15天或1个月')
          if (trial && profile.giftTrialUsedAt) throw Error('首次免费体验已使用')
          if (trial && customLabel) throw Error('免费体验使用默认随机域名')
          const background = catalog.backgrounds.find(item => item.id === value.background)
          const price = trial ? 0 : catalog.creationPrice + duration.price + (customLabel ? catalog.customDomainPrice : 0) + background.price + value.effects.reduce((sum, id) => sum + catalog.effects.find(item => item.id === id).price, 0)
          if (profile.coins < price) throw Error('金币不足，完成每日任务可赚取金币')
          const now = clock(), id = crypto.randomBytes(12).toString('hex')
          const label = customLabel || 'g-' + id.slice(0, 16)
          const domain = await get('gift_domains', label)
          if (domain) throw Error('这个域名已被使用，请换一个名字')
          await db.collection('gift_domains').doc(label).create({ data: { siteId: id } })
          const site = { ...value, id, openid, trial, domainLabel: label, status: 'published', purchasedEffects: value.effects.slice(), purchasedBackgrounds: [value.background], price,
            durationId: trial ? '2h' : duration.id, createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: expiresAt(now, duration && duration.id, trial) }
          profile.coins -= price
          if (trial) profile.giftTrialUsedAt = now.toISOString()
          await db.collection('gift_sites').doc(id).create({ data: site })
          await db.collection('english_coin_ledger').doc(ledgerId).create({ data: { openid, kind: 'gift', siteId: id, requestId, amount: -price, createdAt: now.toISOString() } })
          await put('english_profiles', profileId(openid), profile)
          return { success: true, data: { site: publicView(site), coins: profile.coins } }
        }
        const site = await owned(openid, input.id)
        // 与管理员操作共用行锁；已有下架标记绝不能被编辑恢复。
        if (input.action === 'delete') {
          const domain = await get('gift_domains', site.domainLabel)
          if (domain && domain.siteId === site.id) await db.collection('gift_domains').doc(site.domainLabel).remove()
          await db.collection('gift_messages').where({ siteId: site.id }).remove()
          await db.collection('gift_message_visitors').where({ siteId: site.id }).remove()
          await db.collection('gift_sites').doc(site.id).remove()
          return { success: true, data: {} }
        }
        if (!active(site)) throw Error('网站已到期或被下架，不能再编辑')
        if (input.action === 'update') {
          const value = fields(input, openid)
          if (input.previewId) await removePreview(input.previewId, openid)
          await validateMedia(value, openid)
          if (value.templateId !== site.templateId) throw Error('已创建的网站不能切换模板')
          const newEffects = value.effects.filter(id => !site.purchasedEffects.includes(id))
          const background = catalog.backgrounds.find(item => item.id === value.background)
          if (!site.purchasedBackgrounds) site.purchasedBackgrounds = [site.background]
          const price = site.trial ? 0 : newEffects.reduce((sum, id) => sum + catalog.effects.find(item => item.id === id).price, 0) + (site.purchasedBackgrounds.includes(value.background) ? 0 : background.price)
          if (profile.coins < price) throw Error('金币不足')
          profile.coins -= price
          site.purchasedEffects.push(...newEffects)
          if (!site.purchasedBackgrounds.includes(value.background)) site.purchasedBackgrounds.push(value.background)
          Object.assign(site, value, { updatedAt: clock().toISOString() })
          await put('gift_sites', site.id, site)
          if (price) await db.collection('english_coin_ledger').add({ data: { openid, kind: 'gift_effect', siteId: site.id, amount: -price, createdAt: clock().toISOString() } })
          await put('english_profiles', profileId(openid), profile)
          return { success: true, data: { site: publicView(site), coins: profile.coins } }
        }
        throw Error('不支持的网站操作')
      }, { lock: walletLock(openid), readCommitted: true })
    } catch (error) { return { success: false, msg: error.code === 'ER_DUP_ENTRY' ? '这个域名已被使用，请换一个名字' : error.message || '祝福网站服务暂不可用' } }
  }
  return { main, published, publishedDomain, gallery, purgeExpired, purgePreviews, messages, leaveMessage, uploadImage }
}
const service = createService()
module.exports = { ...service, createService, publicView, expiresAt }
