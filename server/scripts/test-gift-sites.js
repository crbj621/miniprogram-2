'use strict'
const assert = require('node:assert/strict'), crypto = require('node:crypto'), { AsyncLocalStorage } = require('node:async_hooks')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm')
const databaseMode = process.argv.includes('--database')
if (databaseMode && !/^campus_english_(test|review)_[A-Za-z0-9_]+$/.test(process.env.DB_NAME || '')) throw Error('Gift regression requires a disposable campus_english_test_* database')
const { createService, expiresAt } = require('../services/gift_sites')
const { profileId, loadWalletProfile } = require('../src/campus-wallet')
const { renderGift } = require('../src/gift-web')
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
function memoryCloud() {
  const context = new AsyncLocalStorage(); let tables = new Map(), queue = Promise.resolve(), serial = 0
  const table = name => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name) }
  const collection = (name, query = {}, options = {}) => ({
    where: value => collection(name, value, options),
    orderBy: (key, direction) => collection(name, query, { ...options, key, direction }),
    skip: offset => collection(name, query, { ...options, offset }),
    limit: limit => collection(name, query, { ...options, limit }),
    get: async () => {
      let data = [...table(name)].map(([id, value]) => ({ ...clone(value), _id: id })).filter(row => Object.entries(query).every(([key, value]) => value && value.lte !== undefined ? row[key] <= value.lte : value && value.gt !== undefined ? row[key] > value.gt : row[key] === value))
      if (options.key) data.sort((a, b) => String(a[options.key]).localeCompare(String(b[options.key])) * (options.direction === 'desc' ? -1 : 1))
      return { data: data.slice(options.offset || 0, options.limit === undefined ? undefined : (options.offset || 0) + options.limit) }
    },
    add: async ({ data }) => collection(name).doc('m' + ++serial).create({ data }),
    async remove() { for (const row of (await collection(name, query).get()).data) table(name).delete(row._id) },
    doc(id) { return {
      get: async () => ({ data: clone(table(name).get(id) || null) }),
      set: async ({ data }) => { table(name).set(id, clone({ ...data, _id: id })); return { _id: id } },
      create: async ({ data }) => { if (table(name).has(id)) throw Object.assign(Error('Duplicate'), { code: 'ER_DUP_ENTRY' }); return collection(name).doc(id).set({ data }) },
      remove: async () => table(name).delete(id)
    } }
  })
  const db = { collection, command: { lte: value => ({ lte: value }), gt: value => ({ gt: value }) }, async runTransaction(callback) {
    let release; const previous = queue; queue = new Promise(resolve => { release = resolve }); await previous
    const snapshot = clone([...tables].map(([name, values]) => [name, [...values]]))
    try { return await callback() } catch (error) { tables = new Map(snapshot.map(([name, values]) => [name, new Map(values)])); throw error } finally { release() }
  } }
  return { database: () => db, getWXContext: () => ({ OPENID: context.getStore()?.openid || '' }), __runWithContext: (value, callback) => context.run(value, callback) }
}
const sdk = databaseMode ? require('campus-server-sdk') : memoryCloud(), db = sdk.database()
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-gift-test-')); process.env.UPLOAD_DIR = uploadDir
let now = new Date('2031-01-31T04:00:00Z'), failure = false, logFailure = false, uploadFailure = false, uploadReadHook, collectionReadHook, documentReadHook, documentCreateHook, checks = 0, initialized = false
const sqlOperation = new AsyncLocalStorage()
const guardedDb = { ...db, collection(name) {
  const result = db.collection(name), originalDoc = result.doc.bind(result)
  const read = result.get.bind(result)
  result.get = () => collectionReadHook ? collectionReadHook(name, read) : read()
  const add = result.add.bind(result)
  result.add = async value => { if (logFailure && name === 'global_admin_log') { logFailure = false; throw Error('Injected audit failure') }; return add(value) }
  result.doc = id => { const reference = originalDoc(id), set = reference.set.bind(reference), get = reference.get.bind(reference)
    reference.get = async () => { if (name === 'gift_uploads' && uploadReadHook) await uploadReadHook(id); return documentReadHook ? documentReadHook(name, id, get) : get() }
    const create = reference.create.bind(reference)
    reference.create = async value => { if (uploadFailure && name === 'gift_uploads') { uploadFailure = false; throw Error('Injected upload metadata failure') }; if (documentCreateHook) await documentCreateHook(name, id); return create(value) }
    reference.set = async value => { if (failure && name === 'english_profiles') { failure = false; throw Error('Injected wallet failure') }; return set(value) }; return reference }
  return result
} }
const service = createService({ cloud: { ...sdk, database: () => guardedDb, async __saveFile({ cloudPath, fileContent }) {
  const localPath = path.join(uploadDir, cloudPath)
  fs.mkdirSync(path.dirname(localPath), { recursive: true }); fs.writeFileSync(localPath, fileContent)
  return { localPath, fileID: String(process.env.PUBLIC_BASE_URL || 'https://www.crbuj.icu/campus-api').replace(/\/$/, '') + '/uploads/' + cloudPath }
} }, clock: () => new Date(now) })
const collections = ['gift_sites', 'gift_previews', 'gift_domains', 'gift_messages', 'gift_message_visitors', 'gift_uploads', 'english_profiles', 'english_coin_ledger', 'global_settings', 'global_admin', 'global_admin_log', 'users']
const call = (openid, action, data = {}) => sdk.__runWithContext({ openid }, () => service.main({ action, ...data }))
const set = (name, id, data) => db.collection(name).doc(id).set({ data })
const rows = async name => (await db.collection(name).get()).data
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
async function good(user, action, data) { const result = await call(user, action, data); equal(result.success, true, action + ': ' + result.msg); return result.data }
const input = requestId => ({ requestId, templateId: 'letter', recipient: '你', title: '一份心意', message: '愿每天都有小欢喜', sender: '我', background: 'peach', effects: ['balloons'], durationId: '3d' })
async function wallet(user, coins) { const profile = await loadWalletProfile(db, user, now.toISOString()); profile.coins = coins; await set('english_profiles', profileId(user), profile) }
async function coins(user) { return (await db.collection('english_profiles').doc(profileId(user)).get()).data.coins }
async function uploadRouting() {
  const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8')
  const start = source.indexOf('const upload = multer('), end = source.indexOf('\ninstallEnglishMedia', start)
  assert.ok(start >= 0 && end > start, 'actual upload route source exists'); checks++
  let handler, ordinaryWrites = 0
  vm.runInNewContext(source.slice(start, end), {
    app: { post(route, ...handlers) { assert.equal(route, '/api/files/upload'); handler = handlers.at(-1) } },
    multer: require('multer'), maxUploadBytes: 10 * 1024 * 1024, uploadRoot: uploadDir, path, crypto, process: { platform: process.platform },
    rateLimit: () => () => {}, requireAuth() {}, console: { error() {} },
    cloud: { __runWithContext: sdk.__runWithContext, async __saveFile({ cloudPath }) { ordinaryWrites++; return { fileID: 'ordinary:' + cloudPath } } },
    require(name) { assert.equal(name, '../services/gift_sites'); return service }
  }, { filename: 'actual-gift-upload-route.js' })
  const owner = 'route-owner', ownerHash = crypto.createHash('sha256').update(owner).digest('hex')
  const aliases = ['gift-sites/known.jpg', '/gift-sites/known.jpg', 'gift-sites\\known.jpg', './gift-sites/known.jpg', '../gift-sites//known.jpg', 'gift-sites']
  if (process.platform === 'win32') aliases.push(path.join(uploadDir, 'gift-sites', 'known.jpg'), 'Gift-Sites/known.jpg')
  for (const cloudPath of aliases) {
    const response = { statusCode: 200, status(value) { this.statusCode = value; return this }, json(value) { this.value = value; return this } }
    await handler({ body: { cloudPath }, auth: { openid: owner }, file: { mimetype: 'image/png', originalname: 'known.gif', buffer: Buffer.from('png') } }, response)
    equal(response.value.code, 0, cloudPath + ': normalized gift path uses supported upload')
    equal(response.value.fileID.includes('/uploads/gift-sites/' + ownerHash + '/'), true, 'client cannot choose another owner or filename')
    equal(response.value.fileID.endsWith('.png'), true)
    await handler({ body: { cloudPath }, auth: { openid: owner }, file: { mimetype: 'image/gif', buffer: Buffer.from('gif') } }, response)
    equal(response.statusCode, 400, cloudPath + ': GIF alias cannot bypass qualification validation')
  }
  equal(ordinaryWrites, 0, 'all gift aliases stay outside the ordinary save path')
  const response = { json(value) { this.value = value; return this } }
  await handler({ body: { cloudPath: 'forum/existing.jpg' }, auth: { openid: owner }, file: { mimetype: 'image/jpeg', buffer: Buffer.from('jpg') } }, response)
  equal(ordinaryWrites, 1, 'ordinary module keeps its upload branch')
  equal(response.value.fileID, 'ordinary:forum/existing.jpg')
}
async function sqlPublishCleanupRaces() {
  if (!databaseMode) return
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
  const bounded = async (promise, stage) => { let timeout; try { return await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('SQL gift race timed out: ' + stage)), 15000) })]) } finally { clearTimeout(timeout) } }
  const owner = 'sql-race-owner', ownerHash = crypto.createHash('sha256').update(owner).digest('hex'), folder = path.join(uploadDir, 'gift-sites', ownerHash)
  await wallet(owner, 50)
  for (const winner of ['cleanup', 'publish']) {
    const preview = await good(owner, 'preview', input('sql-race-preview-' + winner))
    const name = (winner === 'cleanup' ? '1' : '2') + '-012345abcdef.jpg', target = path.join(folder, name)
    const url = String(process.env.PUBLIC_BASE_URL || 'https://www.crbuj.icu/campus-api').replace(/\/$/, '') + '/uploads/gift-sites/' + ownerHash + '/' + name, uploadId = crypto.createHash('sha256').update(url).digest('hex')
    fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(target, 'sql-race-image')
    const old = new Date(now.getTime() - 2 * 86400000); fs.utimesSync(target, old, old)
    await set('gift_uploads', uploadId, { openid: owner, url, createdAt: old.toISOString() })
    const payload = { ...input('sql-race-' + winner), durationId: '7d', previewId: preview.site.id, layout: { height: 700, elements: [{ id: 'image', type: 'image', x: 10, y: 10, width: 80, fontSize: 20, color: '#906489', value: url }] } }
    const firstReady = deferred(), secondReady = deferred(), allowFirst = deferred(), allowSecond = deferred(), queryIssued = deferred()
    let publishing, cleaning, firstSiteSnapshot
    try {
      if (winner === 'cleanup') {
        collectionReadHook = async (name, read) => { const result = await read(); if (sqlOperation.getStore() === 'cleanup' && name === 'gift_previews') { firstReady.resolve(); await allowFirst.promise }; return result }
        documentReadHook = async (name, id, read) => {
          if (sqlOperation.getStore() === 'publish' && name === 'gift_previews' && id === preview.site.id) { secondReady.resolve(); await allowSecond.promise }
          const pending = read()
          if (sqlOperation.getStore() === 'cleanup' && name === 'gift_uploads' && id === uploadId) queryIssued.resolve()
          return pending
        }
        cleaning = sqlOperation.run('cleanup', () => service.purgeExpired())
        await bounded(firstReady.promise, 'cleanup holds preview')
        publishing = sqlOperation.run('publish', () => call(owner, 'create', payload))
        await bounded(Promise.race([secondReady.promise, publishing.then(result => { throw Error('Publishing returned before preview lock: ' + result.msg) })]), 'publishing attempts preview lock')
        allowFirst.resolve(); await bounded(queryIssued.promise, 'cleanup attempts upload lock'); allowSecond.resolve()
      } else {
        documentCreateHook = async name => { if (sqlOperation.getStore() === 'publish' && name === 'gift_sites') { firstReady.resolve(); await allowFirst.promise } }
        collectionReadHook = async (name, read) => {
          const pending = read()
          if (sqlOperation.getStore() === 'cleanup' && name === 'gift_previews') secondReady.resolve()
          const result = await pending
          if (sqlOperation.getStore() === 'cleanup' && name === 'gift_sites' && firstSiteSnapshot === undefined) firstSiteSnapshot = result.data
          return result
        }
        publishing = sqlOperation.run('publish', () => call(owner, 'create', payload))
        await bounded(Promise.race([firstReady.promise, publishing.then(result => { throw Error('Publishing returned before site insert: ' + result.msg) })]), 'publishing holds preview and upload')
        cleaning = sqlOperation.run('cleanup', () => service.purgeExpired())
        await bounded(secondReady.promise, 'cleanup attempts preview lock'); allowFirst.resolve()
      }
      const [created] = await bounded(Promise.all([publishing, cleaning]), winner + ' transactions finish')
      equal(/deadlock|lock wait timeout/i.test(created.msg || ''), false, 'real SQL transactions finish without reverse-lock failure')
      if (winner === 'cleanup') {
        equal(created.success, false); equal(/图片已清理/.test(created.msg), true)
        equal(fs.existsSync(target), false); equal((await db.collection('gift_uploads').doc(uploadId).get()).data, null)
        equal(Boolean((await db.collection('gift_previews').doc(preview.site.id).get()).data), true, 'failed publishing restores consumed preview')
        equal(await coins(owner), 50); equal((await rows('gift_sites')).length, 0); equal((await rows('english_coin_ledger')).length, 0)
      } else {
        equal(firstSiteSnapshot.length, 0, 'cleanup first reads an empty site snapshot before publishing commits')
        equal(created.success, true, created.msg); equal(created.data.site.layout.elements[0].value, url)
        equal(fs.existsSync(target), true, 'late committed site survives real SQL cleanup snapshot')
        equal(Boolean((await db.collection('gift_uploads').doc(uploadId).get()).data), true)
        equal((await db.collection('gift_previews').doc(preview.site.id).get()).data, null)
        equal(await coins(owner), 45); equal((await rows('english_coin_ledger')).length, 1, 'race commits wallet and ledger exactly once')
        await good(owner, 'delete', { id: created.data.site.id })
      }
    } finally {
      allowFirst.resolve(); allowSecond.resolve(); collectionReadHook = documentReadHook = documentCreateHook = null
      await Promise.allSettled([publishing, cleaning].filter(Boolean))
    }
    await db.collection('gift_previews').doc(preview.site.id).remove()
    await service.purgeExpired()
  }
  await db.collection('english_profiles').doc(profileId(owner)).remove()
  await db.collection('english_coin_ledger').where({ openid: owner }).remove()
}
async function run() {
  if (databaseMode) { await sdk.__ensureSchema(); for (const name of collections) equal((await rows(name)).length, 0, 'Disposable collection empty: ' + name) }
  initialized = true
  await set('global_settings', 'settings', { modules: { gifts: { enabled: true } } })
  await sqlPublishCleanupRaces()
  await uploadRouting()
  equal((await call('', 'create', input('anon'))).success, false)
  await wallet('alice', 200); await wallet('bob', 200); await wallet('rollback', 100)
  equal((await call('alice', 'create', { ...input('bad'), trial: true })).success, false, 'old trial duration must not silently change meaning')
  const trial = await good('alice', 'create', { ...input('trial'), trial: true, durationId: '2h', background: 'video-fire', effects: ['fireworks', 'ribbons', 'hearts'] })
  equal(trial.coins, 200); equal(trial.site.expiresAt, '2031-01-31T06:00:00.000Z', 'first trial lasts two hours with premium effects')
  equal((await good('alice', 'create', { ...input('trial'), trial: true, durationId: '2h' })).site.id, trial.site.id, 'retry returns one site')
  equal((await call('alice', 'create', { ...input('again'), trial: true, durationId: '2h' })).success, false, 'one lifetime free trial')
  equal((await good('alice', 'update', { ...input('trial-edit'), id: trial.site.id, background: 'video-stars', effects: ['fireworks', 'ribbons', 'starburst'] })).coins, 200, 'trial remains free when adding video and premium effects')
  const paid = await good('alice', 'create', { ...input('paid'), domainLabel: 'for-you', durationId: '1m', background: 'meteors', effects: ['fireworks'] })
  equal(paid.coins, 175, 'one month15 + custom5 + static landscape0 + fireworks5')
  equal((await call('bob', 'create', { ...input('collision'), domainLabel: 'for-you' })).success, false)
  equal(await coins('bob'), 200, 'domain collision cannot deduct coins')
  const burst = await Promise.all(['third', 'fourth', 'fifth'].map(id => call('alice', 'create', input(id))))
  equal(burst.filter(row => row.success).length, 1, 'concurrent create respects three online sites')
  equal(await coins('alice'), 175, 'basic three-day creation has no creation fee')
  equal((await rows('gift_sites')).filter(row => row.openid === 'alice').length, 3)
  const updated = await good('alice', 'update', { ...input('edit'), id: paid.site.id, background: 'halo3d', effects: ['fireworks'], message: '换一段文字' })
  equal(updated.coins, 175, 'switching static landscapes never charges')
  for (const background of ['meteors', 'campfire', 'clouds3d', 'halo3d']) equal((await good('alice', 'update', { ...input('static-' + background), id: paid.site.id, background, effects: ['fireworks'] })).coins, 175, background + ': static landscape stays free')
  equal((await good('alice', 'update', { ...input('video-stars'), id: paid.site.id, background: 'video-stars', effects: ['fireworks'] })).coins, 169, 'new star video costs exactly six coins')
  equal((await good('alice', 'update', { ...input('video-stars-reuse'), id: paid.site.id, background: 'video-stars', effects: ['fireworks'] })).coins, 169, 'purchased star video is not charged twice')
  equal((await good('alice', 'update', { ...input('video-fire'), id: paid.site.id, background: 'video-fire', effects: ['fireworks'] })).coins, 163, 'new fire video costs exactly six coins')
  equal((await good('alice', 'update', { ...input('video-fire-reuse'), id: paid.site.id, background: 'video-fire', effects: ['fireworks'] })).coins, 163, 'purchased fire video is not charged twice')
  equal((await call('bob', 'delete', { id: paid.site.id })).success, false, 'author-only delete')
  failure = true
  equal((await call('rollback', 'create', { ...input('rollback'), domainLabel: 'safe-rollback' })).success, false)
  equal(await coins('rollback'), 100); equal((await db.collection('gift_domains').doc('safe-rollback').get()).data, null, 'wallet failure rolls back site and domain')
  const layout = { height: 700, elements: [{ id: 'text', type: 'text', x: 10, y: 10, width: 80, fontSize: 20, color: '#906489', value: '<script>alert(1)</script>' }] }
  const wall = await good('bob', 'create', { ...input('wall'), templateId: 'wall', layout, recipient: '</script><svg/onload=x>', message: '<svg onload=alert(1)>', title: '告白墙' })
  const html = renderGift(wall.site, '/gift-assets')
  equal(html.includes('<img src=x onerror='), false); equal(html.includes('<svg onload='), false); equal(html.includes('<script>alert(1)</script>'), false, 'text and JSON embedding escaped')
  equal((await call('bob', 'update', { ...input('bad-layout'), id: wall.site.id, templateId: 'wall', layout: { ...layout, elements: [{ ...layout.elements[0], x: 90 }] } })).success, false, 'layout cannot overflow width')
  const publicWall = await service.published(wall.site.id)
  equal(Object.hasOwn(publicWall, 'openid'), false); equal(Object.hasOwn(publicWall, 'price'), false)
  // 预览不创建钱包、不用首次权益、不占3个正式名额，只有编辑器能续租。
  const preview = await good('preview-owner', 'preview', { ...input('preview'), templateId: 'birthday', listed: true, background: 'halo3d', effects: ['fireworks'] })
  equal((await db.collection('english_profiles').doc(profileId('preview-owner')).get()).data, null, 'free preview does not create or spend wallet')
  equal((await service.gallery()).sites.length, 0, 'temporary preview is never in gallery')
  equal((await service.publishedDomain(preview.site.domainLabel)).preview, true)
  equal((await call('bob', 'create', { ...input('stolen-preview'), durationId: '7d', previewId: preview.site.id, domainLabel: 'stolen-preview' })).success, false, 'cannot consume another user preview')
  equal(await coins('bob'), 200, 'foreign preview failure rolls back payment')
  equal((await db.collection('gift_domains').doc('stolen-preview').get()).data, null)
  now = new Date('2031-01-31T04:01:00Z')
  const changed = await good('preview-owner', 'preview', { ...input('preview-edit'), title: '生日新标题', templateId: 'birthday', background: 'campfire', effects: ['fireworks'], layout })
  equal(changed.site.id, preview.site.id, 'editing reuses one preview URL')
  equal((await service.published(preview.site.id)).title, '生日新标题', 'public read sees last saved content')
  equal((await rows('gift_previews')).length, 1)
  equal((await call('other-preview-owner', 'releasePreview', { id: preview.site.id })).success, false, 'only owner may renew/release')
  now = new Date('2031-01-31T04:02:30Z')
  await good('preview-owner', 'renewPreview', { id: preview.site.id })
  equal((await service.published(preview.site.id)).expiresAt, '2031-01-31T04:04:30.000Z', 'heartbeat renews unchanged preview')
  now = new Date('2031-01-31T04:03:00Z')
  await good('preview-owner', 'releasePreview', { id: preview.site.id })
  await service.leaveMessage(preview.site.id, 'preview-friend', { name: '实名不应保存', message: '生日快乐', anonymous: true })
  equal((await service.messages(preview.site.id))[0].name, '匿名朋友', 'birthday supports anonymous friend messages')
  now = new Date('2031-01-31T04:05:00Z')
  equal(await service.published(preview.site.id), null, 'two minutes after leaving access immediately expires')
  equal((await good('preview-owner', 'renewPreview', { id: preview.site.id })).site, null, 'expired preview cannot be resurrected by heartbeat')
  await service.purgePreviews()
  equal((await rows('gift_previews')).length, 0); equal((await service.messages(preview.site.id)).length, 0)
  now = new Date('2031-01-31T04:00:00Z')
  const payPreview = await good('preview-pay', 'preview', input('payment-preview'))
  const converted = await good('preview-pay', 'create', { ...input('payment'), trial: true, durationId: '2h', previewId: payPreview.site.id })
  equal(converted.coins, 0, 'preview never consumed first-free entitlement')
  equal(await service.published(payPreview.site.id), null, 'confirming creation removes temporary preview atomically')
  equal((await call('bob', 'create', { ...input('foreign-preview'), previewId: converted.site.id })).success, true, 'nonexistent preview does not affect a new website')
  // 公开广场只包括公示、未到期且未下架的正式网站；关闭公示不影响链接。
  equal((await good('bob', 'update', { ...input('list-wall'), id: wall.site.id, templateId: 'wall', listed: true, layout })).site.listed, true)
  equal((await service.gallery()).sites.map(row => row.id), [wall.site.id])
  await good('bob', 'update', { ...input('unlist-wall'), id: wall.site.id, templateId: 'wall', listed: false, layout })
  equal((await service.gallery()).sites.length, 0)
  equal(Boolean(await service.published(wall.site.id)), true, 'unlisted website is still shareable')
  equal((await call('bob', 'update', { ...input('invalid-list'), id: wall.site.id, listed: 'true' })).success, false, 'listed must be a boolean')
  const galleryIds = []
  for (let i = 0; i < 15; i++) {
    const id = (100 + i).toString(16).padStart(24, '0'); galleryIds.push(id)
    await set('gift_sites', id, { ...input('gallery'), id, openid: 'gallery-owner', listed: true, status: i === 13 ? 'blocked' : 'published', createdAt: new Date(now.getTime() + i * 1000).toISOString(), expiresAt: i === 14 ? now.toISOString() : '2031-02-01T04:00:00.000Z', domainLabel: 'g-' + id.slice(-16) })
  }
  const galleryPage = await good('', 'gallery', { page: 1 })
  equal(galleryPage.sites.length, 12); equal(galleryPage.hasMore, true)
  const secondGallery = await good('', 'gallery', { page: 2 })
  equal(secondGallery.sites.length, 1); equal(secondGallery.hasMore, false)
  equal(new Set(galleryPage.sites.concat(secondGallery.sites).map(row => row.id)).size, 13, 'stable pages exclude expired and blocked sites')
  equal(Object.hasOwn(galleryPage.sites[0], 'openid'), false)
  for (const id of galleryIds) await db.collection('gift_sites').doc(id).remove()
  // 各时长价格、自然月边界和非法时长。
  await wallet('durations', 50)
  for (const [durationId, charge, expiry] of [['3d', 0, '2031-02-03T04:00:00.000Z'], ['7d', 5, '2031-02-07T04:00:00.000Z'], ['15d', 10, '2031-02-15T04:00:00.000Z'], ['1m', 15, '2031-02-28T04:00:00.000Z']]) {
    const before = await coins('durations'), created = await good('durations', 'create', { ...input('d-' + durationId), durationId })
    equal(before - created.coins, charge); equal(created.site.expiresAt, expiry)
    await good('durations', 'delete', { id: created.site.id })
  }
  equal((await call('durations', 'create', { ...input('too-long'), durationId: '3m' })).success, false, 'maximum one month')
  const uploadOwner = 'upload-owner', uploadFolder = path.join(uploadDir, 'gift-sites', crypto.createHash('sha256').update(uploadOwner).digest('hex'))
  await assert.rejects(() => service.uploadImage({ mimetype: 'image/gif', originalname: 'animation.gif', buffer: Buffer.from('GIF89a') }, uploadOwner), /JPG/); checks++
  equal(fs.existsSync(uploadFolder), false, 'rejected GIF never writes a file or metadata')
  const normalizedUpload = await service.uploadImage({ mimetype: 'image/png', originalname: 'wrong.gif', buffer: Buffer.from('test-png') }, uploadOwner)
  equal(normalizedUpload.fileID.endsWith('.png'), true, 'gift extension follows supported MIME instead of original filename')
  equal(Boolean((await db.collection('gift_uploads').doc(crypto.createHash('sha256').update(normalizedUpload.fileID).digest('hex')).get()).data), true, 'upload file and qualification are saved together')
  const uploadCount = fs.readdirSync(uploadFolder).length
  uploadFailure = true
  await assert.rejects(() => service.uploadImage({ mimetype: 'image/jpeg', buffer: Buffer.from('failed-upload') }, uploadOwner), /metadata failure/); checks++
  equal(fs.readdirSync(uploadFolder).length, uploadCount, 'failed qualification removes its just-written file')
  const [concurrentUpload] = await Promise.all([service.uploadImage({ mimetype: 'image/webp', buffer: Buffer.from('concurrent-upload') }, uploadOwner), service.purgeExpired()])
  equal(fs.existsSync(concurrentUpload.localPath), true, 'upload survives a concurrent sweep and empty-directory cleanup')
  equal(Boolean((await db.collection('gift_uploads').doc(crypto.createHash('sha256').update(concurrentUpload.fileID).digest('hex')).get()).data), true)
  const folder = crypto.createHash('sha256').update('bob').digest('hex'), imageFolder = path.join(uploadDir, 'gift-sites', folder)
  fs.mkdirSync(imageFolder, { recursive: true })
  const base = String(process.env.PUBLIC_BASE_URL || 'https://www.crbuj.icu/campus-api').replace(/\/$/, '')
  const imageUrl = base + '/uploads/gift-sites/' + folder + '/123-012345abcdef.jpg'
  const imagePath = path.join(imageFolder, '123-012345abcdef.jpg'), unusedPath = path.join(imageFolder, '123-fedcba543210.jpg'), draftPath = path.join(imageFolder, '124-012345abcdef.jpg')
  for (const file of [imagePath, unusedPath, draftPath]) fs.writeFileSync(file, 'regression-image')
  for (const file of [imagePath, unusedPath]) fs.utimesSync(file, new Date('2031-01-27T04:00:00Z'), new Date('2031-01-27T04:00:00Z'))
  fs.utimesSync(draftPath, now, now)
  const imageLayout = { height: 700, elements: [{ ...layout.elements[0], type: 'image', value: imageUrl }] }
  equal((await call('bob', 'create', { ...input('missing-image'), layout: imageLayout })).success, false, 'image needs uploaded metadata')
  await set('gift_uploads', crypto.createHash('sha256').update(imageUrl).digest('hex'), { openid: 'bob', url: imageUrl })
  const imageSite = await good('bob', 'create', { ...input('image'), layout: imageLayout })
  equal((await call('alice', 'update', { ...input('wrong-owner-image'), id: trial.site.id, layout: imageLayout })).success, false, 'cannot embed another owner image')
  await service.purgeExpired()
  equal(fs.existsSync(imagePath), true, 'live reference retains old uploaded image')
  equal(fs.existsSync(unusedPath), false, 'unreferenced old image removed')
  equal(fs.existsSync(draftPath), true, 'draft upload retained for 24 hours')
  const sharedPreviewId = 'd'.repeat(24)
  await set('gift_previews', sharedPreviewId, { id: sharedPreviewId, openid: 'bob', expiresAt: new Date(now.getTime() + 120000).toISOString(), layout: imageLayout })
  await good('bob', 'delete', { id: imageSite.site.id })
  await service.purgeExpired()
  equal(fs.existsSync(imagePath), true, 'deleting one site preserves an image still used by a preview')
  const legacyGif = path.join(imageFolder, '125-012345abcdef.gif'), wrongExtension = path.join(imageFolder, '126-012345abcdef.bin')
  const referenceGif = path.join(imageFolder, '127-012345abcdef.gif'), freshGif = path.join(imageFolder, '128-012345abcdef.gif')
  const missingUrl = base + '/uploads/gift-sites/' + folder + '/129-012345abcdef.jpg', freshMissingUrl = base + '/uploads/gift-sites/' + folder + '/130-012345abcdef.jpg'
  const old = new Date(now.getTime() - 2 * 86400000), gifUrl = base + '/uploads/gift-sites/' + folder + '/127-012345abcdef.gif'
  for (const file of [legacyGif, wrongExtension, referenceGif, freshGif]) { fs.writeFileSync(file, 'legacy-upload'); fs.utimesSync(file, old, old) }
  fs.utimesSync(freshGif, now, now)
  const gifMetadataId = crypto.createHash('sha256').update(gifUrl).digest('hex'), missingMetadataId = crypto.createHash('sha256').update(missingUrl).digest('hex'), freshMissingId = crypto.createHash('sha256').update(freshMissingUrl).digest('hex')
  await set('gift_uploads', gifMetadataId, { openid: 'bob', url: gifUrl, createdAt: old.toISOString() })
  await set('gift_uploads', missingMetadataId, { openid: 'bob', url: missingUrl })
  await set('gift_uploads', freshMissingId, { openid: 'bob', url: freshMissingUrl, createdAt: now.toISOString() })
  const legacyPreviewId = 'a'.repeat(24), missingReferenceId = 'b'.repeat(24), missingReferenceUrl = base + '/uploads/gift-sites/' + folder + '/131-012345abcdef.jpg'
  const missingReferenceMetadataId = crypto.createHash('sha256').update(missingReferenceUrl).digest('hex')
  await set('gift_previews', legacyPreviewId, { id: legacyPreviewId, openid: 'bob', expiresAt: new Date(now.getTime() + 120000).toISOString(), layout: { elements: [{ type: 'image', value: gifUrl }] } })
  await set('gift_previews', missingReferenceId, { id: missingReferenceId, openid: 'bob', expiresAt: new Date(now.getTime() + 120000).toISOString(), layout: { elements: [{ type: 'image', value: missingReferenceUrl }] } })
  await set('gift_uploads', missingReferenceMetadataId, { openid: 'bob', url: missingReferenceUrl, createdAt: old.toISOString() })
  const emptyOwner = path.join(uploadDir, 'gift-sites', 'c'.repeat(64)), unrelatedFolder = path.join(uploadDir, 'forum'), unrelatedFile = path.join(unrelatedFolder, '125-012345abcdef.gif')
  fs.mkdirSync(emptyOwner); fs.mkdirSync(unrelatedFolder); fs.writeFileSync(unrelatedFile, 'forum must stay')
  const keepFile = path.join(imageFolder, 'owner-note.txt'); fs.writeFileSync(keepFile, 'not an upload filename')
  await service.purgeExpired()
  equal(fs.existsSync(legacyGif), false, 'unreferenced legacy GIF is reclaimed')
  equal(fs.existsSync(wrongExtension), false, 'unreferenced legacy wrong extension is reclaimed')
  equal(fs.existsSync(referenceGif), true, 'active legacy image reference is never deleted')
  equal(Boolean((await db.collection('gift_uploads').doc(gifMetadataId).get()).data), true)
  equal(fs.existsSync(freshGif), true, 'unreferenced fresh legacy upload keeps its 24-hour grace')
  equal((await db.collection('gift_uploads').doc(missingMetadataId).get()).data, null, 'legacy metadata without a file is reclaimed')
  equal(Boolean((await db.collection('gift_uploads').doc(freshMissingId).get()).data), true, 'fresh missing-file metadata keeps its 24-hour grace')
  equal(Boolean((await db.collection('gift_uploads').doc(missingReferenceMetadataId).get()).data), true, 'active reference protects even missing-file metadata')
  equal(fs.existsSync(emptyOwner), false, 'empty owner directories are removed')
  equal(fs.existsSync(unrelatedFile), true, 'forum files stay outside gift cleanup')
  equal(fs.existsSync(keepFile), true, 'unrecognized manual files are not removed')
  fs.unlinkSync(keepFile)
  const retryFile = path.join(imageFolder, '132-012345abcdef.gif'), retryUrl = base + '/uploads/gift-sites/' + folder + '/132-012345abcdef.gif'
  const retryId = crypto.createHash('sha256').update(retryUrl).digest('hex')
  fs.writeFileSync(retryFile, 'retry-upload'); fs.utimesSync(retryFile, old, old)
  await set('gift_uploads', retryId, { openid: 'bob', url: retryUrl, createdAt: old.toISOString() })
  const unlink = fs.promises.unlink
  fs.promises.unlink = async target => { if (target === retryFile) throw Object.assign(Error('Injected unlink failure'), { code: 'EACCES' }); return unlink(target) }
  try { await assert.rejects(() => service.purgeExpired(), /unlink failure/); checks++ } finally { fs.promises.unlink = unlink }
  equal((await db.collection('gift_uploads').doc(retryId).get()).data, null, 'failed unlink still revokes reusable upload qualification')
  equal(fs.existsSync(retryFile), true, 'failed unlink leaves an identifiable orphan for retry')
  await service.purgeExpired()
  equal(fs.existsSync(retryFile), false, 'a later sweep retries and removes the orphan')
  const racingFile = path.join(imageFolder, '133-012345abcdef.jpg'), racingUrl = base + '/uploads/gift-sites/' + folder + '/133-012345abcdef.jpg', racingId = crypto.createHash('sha256').update(racingUrl).digest('hex')
  fs.writeFileSync(racingFile, 'new-reference-during-lock-wait'); fs.utimesSync(racingFile, old, old)
  await set('gift_uploads', racingId, { openid: 'bob', url: racingUrl, createdAt: old.toISOString() })
  uploadReadHook = async id => {
    if (id !== racingId) return
    uploadReadHook = null
    await set('gift_previews', 'e'.repeat(24), { id: 'e'.repeat(24), openid: 'bob', expiresAt: new Date(now.getTime() + 120000).toISOString(), layout: { elements: [{ type: 'image', value: racingUrl }] } })
  }
  try { await service.purgeExpired() } finally { uploadReadHook = null }
  equal(fs.existsSync(racingFile), true, 'reference committed during upload-lock wait is checked again')
  equal(Boolean((await db.collection('gift_uploads').doc(racingId).get()).data), true)
  for (let i = 0; i < 3; i++) await service.leaveMessage(wall.site.id, 'visitor', { name: '朋友', message: '生日快乐' })
  await assert.rejects(() => service.leaveMessage(wall.site.id, 'visitor', { message: '第四次' })); checks++
  for (let i = 0; i < 40; i++) { now = new Date(now.getTime() + 1000); await service.leaveMessage(wall.site.id, 'v' + i, { message: '留言' + i }) }
  equal((await service.messages(wall.site.id)).length, 40, 'message storage bounded')
  equal((await rows('gift_messages')).filter(row => row.siteId === wall.site.id && row.visitor === 'visitor').length, 0, 'old visitor messages actually evicted')
  await assert.rejects(() => service.leaveMessage(wall.site.id, 'visitor', { message: '旧留言被挤掉后仍超限' })); checks++
  now = new Date('2031-01-31T15:59:00Z')
  for (let i = 0; i < 3; i++) await service.leaveMessage(wall.site.id, 'china-day', { message: '午夜前' + i })
  now = new Date('2031-01-31T16:01:00Z')
  for (let i = 0; i < 3; i++) await service.leaveMessage(wall.site.id, 'china-day', { message: '北京时间新一天' + i })
  now = new Date('2031-02-01T00:01:00Z')
  await assert.rejects(() => service.leaveMessage(wall.site.id, 'china-day', { message: '早上8点不能再次重置' })); checks++
  equal((await service.messages(wall.site.id)).length, 40, 'China midnight reset preserves wall bound')
  now = new Date('2031-01-31T04:00:00Z')
  await set('global_admin', 'admin', { loginOpenid: 'admin', role: 'normal', status: 'enabled' })
  await set('global_admin', 'super', { loginOpenid: 'super', role: 'super', status: 'enabled' })
  await set('users', 'coin-recipient', { _openid: 'coins-user', nickName: '奖励同学', status: 'active' })
  const grant = { userId: 'coin-recipient', amount: 37, reason: '任务奖励', requestId: 'grant-once' }
  equal((await call('bob', 'grantCoins', grant)).success, false, 'ordinary user cannot grant')
  equal((await call('admin', 'grantCoins', grant)).success, false, 'normal moderator cannot grant')
  for (const amount of [0, -1, 1.5, 1000001, 'abc']) equal((await call('super', 'grantCoins', { ...grant, amount })).success, false, 'grant integer bounds')
  equal((await call('super', 'grantCoins', { ...grant, userId: 'missing' })).success, false)
  const awarded = await Promise.all([call('super', 'grantCoins', grant), call('super', 'grantCoins', grant)])
  equal(awarded.every(row => row.success), true)
  equal(await coins('coins-user'), 37, 'concurrent duplicate grant credits only once')
  equal((await rows('english_coin_ledger')).filter(row => row.kind === 'admin_grant').length, 1)
  equal((await rows('global_admin_log')).filter(row => row.action === 'grant').length, 1, 'audit committed with shared wallet')
  equal((await call('super', 'grantCoins', { ...grant, amount: 38 })).success, false, 'cannot reuse request ID for a changed amount')
  logFailure = true
  equal((await call('super', 'grantCoins', { ...grant, requestId: 'rollback-audit' })).success, false)
  equal(await coins('coins-user'), 37, 'audit failure rolls back wallet')
  equal((await rows('english_coin_ledger')).filter(row => row.kind === 'admin_grant').length, 1, 'audit failure rolls back ledger')
  await set('users', 'coin-recipient', { _openid: 'coins-user', nickName: '奖励同学', status: 'disabled' })
  equal((await call('super', 'grantCoins', { ...grant, requestId: 'disabled-user' })).success, false)
  equal((await call('bob', 'adminHide', { id: paid.site.id })).success, false)
  await good('admin', 'adminHide', { id: paid.site.id })
  equal(await service.published(paid.site.id), null)
  equal((await call('alice', 'update', { ...input('hidden'), id: paid.site.id })).success, false, 'edit cannot restore hidden site')
  now = new Date('2031-02-04T04:00:00Z')
  equal(await service.published(trial.site.id), null, 'expired link stops before sweep')
  await service.purgeExpired(); equal((await db.collection('gift_sites').doc(trial.site.id).get()).data, null)
  equal((await call('alice', 'create', { ...input('trial-reuse'), trial: true })).success, false, 'expiration cannot reset free entitlement')
  await set('global_settings', 'settings', { modules: { gifts: { enabled: false } } })
  equal(await service.published(wall.site.id), null); equal((await call('bob', 'catalog')).success, false)
  await set('global_settings', 'settings', { modules: { gifts: true } })
  now = new Date('2031-06-01T04:00:00Z'); await service.purgeExpired()
  equal((await rows('gift_sites')).length, 0); equal((await rows('gift_messages')).length, 0); equal((await rows('gift_domains')).length, 0)
  equal((await rows('gift_message_visitors')).length, 0, 'visitor quota rows cleaned with websites and previews')
  equal(fs.existsSync(imagePath), false, 'expired site image removed'); equal((await rows('gift_uploads')).length, 0, 'expired image metadata removed')
  equal(fs.existsSync(imageFolder), false, 'owner directory is reclaimed after its final image')
  equal(fs.existsSync(uploadFolder), false, 'cancelled uploads and their owner directory are reclaimed after grace')
  equal(expiresAt(new Date('2031-01-30T18:00:00Z'), '1m', false), '2031-02-27T18:00:00.000Z', 'calendar expiry uses China timezone and clamps month end')
  console.log('Gift sites ' + (databaseMode ? 'SQL' : 'memory') + ' regression passed: ' + checks + ' checks')
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { if (databaseMode) { if (initialized) for (const name of collections) await db.collection(name).remove(); await sdk.__getPool().end() }; fs.rmSync(uploadDir, { recursive: true, force: true }) })
