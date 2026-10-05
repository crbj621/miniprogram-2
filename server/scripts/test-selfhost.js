'use strict'
// Real HTTP + SQL regression. Fixtures are uniquely identified and removed in finally.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const jwt = require('jsonwebtoken')
const cloud = require('campus-server-sdk')
const db = cloud.database()
const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3100'
const prefix = 'test-' + crypto.randomBytes(8).toString('hex')
const saved = []
let originalSettings
let settingsId
let adminOpenid
let uploadedFile
let passed = 0

function token(openid, type = 'wechat') {
  return jwt.sign({ sub: openid, type }, process.env.JWT_SECRET, {
    expiresIn: '5m', issuer: 'campus-api', audience: type === 'admin' ? 'campus-admin' : 'campus-miniprogram'
  })
}
async function request(route, body, auth, method = 'POST') {
  const response = await fetch(base + route, {
    method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}), signal: AbortSignal.timeout(15000)
  })
  return { http: response.status, body: await response.json() }
}
async function call(auth, name, event) {
  const result = await request('/api/functions/' + name, event, auth)
  assert.equal(result.http, 200)
  return result.body
}
async function create(collection, id, data) {
  saved.push([collection, id])
  await db.collection(collection).doc(id).set({ data })
}
function check(condition, message) { assert.ok(condition, message); passed += 1 }

async function main() {
  await cloud.__ensureSchema()
  const settings = await db.collection('global_settings').limit(1).get()
  assert.ok(settings.data.length, '先执行 bootstrap-app.js')
  settingsId = settings.data[0]._id
  originalSettings = settings.data[0]
  await db.collection('global_settings').doc(settingsId).update({ data: { 'modules.canteen.enabled': true } })
  const publicResult = await request('/api/public/modules', null, null, 'GET')
  check(publicResult.http === 200 && publicResult.body.data.modules.canteen === true, '无需登录读取模块开关')
  check((await request('/api/functions/globalAdmin', { action: 'updateGlobalSettings' })).http === 401, '敏感操作需要身份')
  check((await request('/api/functions/login', {}, 'invalid-token')).http === 401, '无效 token 被拒绝')

  const password = crypto.randomBytes(16).toString('hex')
  const salt = crypto.randomBytes(16).toString('hex')
  await create('global_admin', prefix + '-admin', {
    account: prefix, username: '回归测试管理员', role: 'super', permissions: ['all'], status: 'active',
    passwordHash: 'scrypt$' + salt + '$' + crypto.scryptSync(password, salt, 32).toString('hex')
  })
  const loggedIn = await request('/api/auth/admin', { account: prefix, password })
  check(loggedIn.http === 200 && loggedIn.body.code === 0, '真实管理员密码登录')
  const adminToken = loggedIn.body.data.token
  adminOpenid = jwt.decode(adminToken).sub
  const userA = prefix + '-a', userB = prefix + '-b'
  await create('users', userA, { openid: userA, nickName: '测试学生 A' })
  await create('users', userB, { openid: userB, nickName: '测试学生 B' })
  const studentA = token(userA), studentB = token(userB)
  const list = await call(adminToken, 'globalAdmin', { action: 'getAdminList' })
  check(list.code === 0 && !list.data.list.some(row => row.passwordHash || row.verifyPasswordHash), '管理员列表不包含密码')
  check((await request('/api/admin/database', { collection: 'global_admin', operation: 'get' }, adminToken)).http === 400, '禁止绕过业务接口读取账号集合')
  check(!(await call(studentA, 'canteen_reviews', { action: 'saveStall', name: '越权测试', location: '测试' })).success, '学生不能管理档口')
  await create('global_admin', prefix + '-normal', { loginOpenid: prefix + '-normal-openid', role: 'normal', status: 'active' })
  const normalToken = token(prefix + '-normal-openid', 'admin')
  check((await request('/api/admin/database', { collection: 'global_settings', operation: 'update', data: { appName: '越权' } }, normalToken)).http === 403, '普通管理员不能改系统配置')

  const moduleFlags = { running: true, canteen: true, forum: false, english: false, gifts: false }
  const moduleSave = await call(adminToken, 'globalAdmin', { action: 'updateGlobalSettings', data: {
    modules: Object.fromEntries(Object.entries(moduleFlags).map(([key, enabled]) => [key, { enabled }]))
  } })
  check(moduleSave.code === 0, '超级管理员保存五项模块开关')
  assert.deepEqual((await request('/api/public/modules', null, null, 'GET')).body.data.modules, { food: false, rider: false, ...moduleFlags })
  passed += 1
  check((await call(adminToken, 'globalAdmin', { action: 'getModuleList' })).data.list.length === 5, '后台完整返回五个模块')
  check((await call(adminToken, 'globalAdmin', { action: 'updateModuleStatus', data: { module: 'english', enabled: true } })).code === 0, '英语开关可以单独开启')
  const afterToggle = (await request('/api/public/modules', null, null, 'GET')).body.data.modules
  check(afterToggle.english === true && afterToggle.forum === false, '单项保存不覆盖其他模块')
  check((await call(normalToken, 'globalAdmin', { action: 'updateGlobalSettings', data: { modules: { english: true } } })).code !== 0, '普通管理员不能通过业务接口改开关')
  check((await call(adminToken, 'globalAdmin', { action: 'updateModuleStatus', data: { module: 'english', enabled: 'false' } })).code !== 0, '服务器拒绝无效开关值')
  await db.collection('global_settings').doc(settingsId).set({ data: originalSettings })
  await db.collection('global_settings').doc(settingsId).update({ data: { 'modules.canteen.enabled': true } })

  const stall = await call(adminToken, 'canteen_reviews', { action: 'saveStall', name: prefix, location: '测试食堂', status: 'published' })
  check(stall.success, '创建档口')
  saved.push(['canteen_stalls', stall.id])
  const dishes = []
  for (const name of ['高分菜', '低分菜']) {
    const result = await call(adminToken, 'canteen_reviews', { action: 'saveDish', stallId: stall.id, name, price: 12, status: 'published' })
    check(result.success, '创建菜品')
    dishes.push(result.id); saved.push(['canteen_dishes', result.id])
  }
  const reviewIds = new Map()
  for (let index = 0; index < dishes.length; index++) {
    for (const [openid, auth, score] of [[userA, studentA, index ? 1 : 5], [userB, studentB, index ? 2 : 5]]) {
      const review = await call(auth, 'canteen_reviews', { action: 'saveReview', dishId: dishes[index], clientId: prefix + '-initial', score, comment: '回归测试评价' })
      check(review.success, '提交评分')
      reviewIds.set(dishes[index] + ':' + openid, review.id)
      saved.push(['canteen_reviews', review.id], ['canteen_ratings', crypto.createHash('sha256').update(dishes[index] + ':' + openid).digest('hex')])
    }
  }
  const updatedReview = await call(studentA, 'canteen_reviews', { action: 'saveReview', dishId: dishes[0], clientId: prefix + '-updated', score: 4, comment: '更新自己的评分' })
  check(updatedReview.success, '追加评论并更新本人评分')
  saved.push(['canteen_reviews', updatedReview.id])
  const catalog = await call(studentA, 'canteen_reviews', { action: 'list' })
  const good = catalog.dishes.find(row => row._id === dishes[0])
  const bad = catalog.dishes.find(row => row._id === dishes[1])
  check(good.count === 2 && good.score === 4.5 && good.verdict === '推荐', '重复评分更新而非重复计票')
  check(bad.count === 2 && bad.score === 1.5 && bad.verdict === '避雷', '低分菜品避雷')
  check(catalog.dishes.findIndex(row => row._id === good._id) < catalog.dishes.findIndex(row => row._id === bad._id), '评分排名顺序')
  const quality = await call(studentA, 'canteen_reviews', { action: 'random', mode: 'quality' })
  const unusual = await call(studentA, 'canteen_reviews', { action: 'random', mode: 'unusual' })
  check(quality.dish && quality.dish.score >= 4 && quality.dish.count >= 2, '优质随机只抽高分菜')
  check(unusual.dish && unusual.dish.score <= 2.5 && unusual.dish.count >= 2, '异食癖随机只抽低分菜')
  const hiddenId = reviewIds.get(dishes[1] + ':' + userB)
  check((await call(adminToken, 'canteen_reviews', { action: 'hideReview', id: hiddenId })).success, '管理员隐藏评价')
  check(!(await call(studentB, 'canteen_reviews', { action: 'saveReview', dishId: dishes[1], clientId: prefix + '-initial', score: 5, comment: '尝试恢复' })).success, '被隐藏评论不能用原请求恢复')
  await db.collection('global_settings').doc(settingsId).update({ data: { 'modules.canteen.enabled': false } })
  const closed = await request('/api/public/modules', null, null, 'GET')
  check(closed.body.data.modules.canteen === false, '关闭模块即时反映在公开配置')
  check(!(await call(studentA, 'canteen_reviews', { action: 'list' })).success, '关闭模块也禁止业务访问')
  await db.collection('global_settings').doc(settingsId).set({ data: originalSettings })

  const counterId = prefix + '-counter'
  await create('run_stats', counterId, { count: 0 })
  await Promise.all(Array.from({ length: 40 }, () => db.collection('run_stats').doc(counterId).update({ data: { count: db.command.inc(1) } })))
  check((await db.collection('run_stats').doc(counterId).get()).data.count === 40, '并发 40 次增量不丢失')

  // Atomic multi-document rollback, including nested updates on the same connection.
  const atomicId = prefix + '-atomic'
  await create('run_stats', atomicId, { count: 0 })
  await assert.rejects(db.runTransaction(async () => {
    await db.collection('run_stats').doc(atomicId).update({ data: { count: db.command.inc(1) } })
    await db.collection('run_stats').doc(counterId).update({ data: { count: db.command.inc(1) } })
    throw new Error('intentional rollback')
  }), /intentional rollback/)
  check((await db.collection('run_stats').doc(atomicId).get()).data.count === 0 &&
    (await db.collection('run_stats').doc(counterId).get()).data.count === 40, '跨文档失败完整回滚')

  const runs = Array.from({ length: 1001 }, (_, index) => [
    'runRecords', prefix + '-run-' + index,
    JSON.stringify({ _id: prefix + '-run-' + index, openid: userA, date: '2000-01-01', distance: 10, duration: 6, pace: 10 })
  ])
  runs.push(['runRecords', prefix + '-competitor', JSON.stringify({ _id: prefix + '-competitor', openid: userB, date: '2000-01-01', distance: 10000, duration: 3600 })])
  for (const [collection, id] of runs) saved.push([collection, id])
  await cloud.__getPool().query('INSERT INTO app_documents (collection_name,document_id,document_data) VALUES ?', [runs])
  const stats = await call(studentA, 'getUserRunStats', {})
  check(stats.totalRuns === 1001 && stats.totalDistance === 10010, '超过 1000 次跑步统计完整')
  const rank = await call(studentA, 'getRankList', { type: 'all' })
  check(rank.data.findIndex(row => row.openid === userA) < rank.data.findIndex(row => row.openid === userB), '排名先汇总全部记录再取前列')

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOqoAAAAASUVORK5CYII=', 'base64')
  const form = new FormData()
  form.append('file', new Blob([png], { type: 'image/png' }), 'test.png')
  form.append('cloudPath', 'regression/' + prefix + '.png')
  const response = await fetch(base + '/api/files/upload', { method: 'POST', headers: { authorization: 'Bearer ' + studentA }, body: form })
  const uploaded = await response.json()
  check(response.ok && uploaded.fileID, '图片上传到服务器')
  const publicUrl = new URL(uploaded.fileID)
  const uploadPath = publicUrl.pathname.slice(publicUrl.pathname.indexOf('/uploads/'))
  uploadedFile = path.resolve(process.env.UPLOAD_DIR, uploadPath.slice('/uploads/'.length))
  assert.ok(uploadedFile.startsWith(path.resolve(process.env.UPLOAD_DIR) + path.sep))
  const downloaded = await fetch(base + uploadPath)
  check(downloaded.ok && Buffer.from(await downloaded.arrayBuffer()).equals(png), '服务器图片可读且内容一致')

  const compatibility = spawnSync(process.execPath, [path.join(__dirname, 'smoke-functions.js')], {
    env: { ...process.env, SMOKE_OPENID: userA }, encoding: 'utf8'
  })
  process.stdout.write(compatibility.stdout)
  assert.equal(compatibility.status, 0, '函数兼容检查失败')
  console.log(JSON.stringify({ businessChecksPassed: passed, fixtureCleanup: 'finally' }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(async () => {
  if (originalSettings) await db.collection('global_settings').doc(settingsId).set({ data: originalSettings })
  for (const [collection, id] of saved.reverse()) await db.collection(collection).doc(id).remove()
  if (adminOpenid) await db.collection('global_admin_log').where({ _openid: adminOpenid }).remove()
  if (uploadedFile && fs.existsSync(uploadedFile)) fs.unlinkSync(uploadedFile)
  await cloud.__getPool().end()
  console.log('Transient fixtures removed; original module settings restored')
})
