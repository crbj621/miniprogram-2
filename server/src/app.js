'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const express = require('express')
const helmet = require('helmet')
const jwt = require('jsonwebtoken')
const multer = require('multer')
const cloud = require('campus-server-sdk')
const { readPortfolio, writePortfolio } = require('./portfolio-store')
const weRun = require('./we-run')
const { installEnglishMedia } = require('./english-media')
const { installGiftWeb } = require('./gift-web')
const { createServerStatus } = require('./server-status')
const { validateImage, imagePath } = require('./image-upload')

const app = express()
let serverStatus
const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 3100)
const functionsRoot = path.resolve(
  process.env.SERVICES_DIR || path.join(__dirname, '..', 'services')
)
const uploadRoot = path.resolve(
  process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')
)
const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024
const rateBuckets = new Map()
const adminCollections = new Set([
  'global_settings', 'global_admin_log', 'global_announcement',
  'global_module', 'admin_logs', 'users', 'friends', 'notifications',
  'runRecords', 'run_stats', 'realtimeData', 'teams', 'user_coupons',
  'food_category', 'food_shop', 'food_shop_user', 'food_dish', 'food_menu',
  'food_order', 'food_shop_logs', 'food_rider', 'forum_post',
  'forum_comment', 'forum_report', 'forum_admin', 'forum_admin_log',
  'forum_announcement', 'forum_user', 'forum_notification', 'forum_chat',
  'forum_chat_message', 'forum_collect', 'forum_like'
])

function rateLimit(scope, limit, windowMs) {
  return (request, response, next) => {
    const key = scope + ':' + (request.ip || request.socket.remoteAddress || 'unknown')
    const now = Date.now()
    if (rateBuckets.size > 1000) {
      for (const [bucketKey, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(bucketKey)
    }
    const current = rateBuckets.get(key)
    if (!current || current.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    current.count += 1
    if (current.count > limit) {
      response.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000))
      return response.status(429).json({ code: -1, message: '请求过于频繁，请稍后重试' })
    }
    next()
  }
}

function signSession(openid, unionid, wxSessionId) {
  return jwt.sign(
    { sub: openid, unionid: unionid || '', type: 'wechat', wxSessionId },
    process.env.JWT_SECRET,
    { expiresIn: '30d', issuer: 'campus-api', audience: 'campus-miniprogram' }
  )
}

function signAdminSession(openid, admin) {
  return jwt.sign(
    {
      sub: openid,
      type: 'admin',
      adminId: String((admin && admin._id) || ''),
      role: String((admin && admin.role) || '')
    },
    process.env.JWT_SECRET,
    { expiresIn: '12h', issuer: 'campus-api', audience: 'campus-admin' }
  )
}

function requireAuth(request, response, next) {
  const authorization = String(request.headers.authorization || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) return response.status(401).json({ code: -1, message: '请先登录' })
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'campus-api',
      audience: ['campus-miniprogram', 'campus-admin']
    })
    request.auth = {
      openid: String(payload.sub || ''),
      unionid: String(payload.unionid || ''),
      type: String(payload.type || ''),
      wxSessionId: String(payload.wxSessionId || '')
    }
    if (!request.auth.openid) throw new Error('missing openid')
    next()
  } catch (error) {
    response.status(401).json({ code: -1, message: '登录状态已过期，请重新进入小程序' })
  }
}

function hydrateSpecialValues(value) {
  if (Array.isArray(value)) return value.map(hydrateSpecialValues)
  if (!value || typeof value !== 'object') return value
  if (value.__serverDate === true) return new Date()
  const result = {}
  Object.keys(value).forEach(key => {
    result[key] = hydrateSpecialValues(value[key])
  })
  return result
}

async function exchangeWechatCode(code) {
  const appid = process.env.WECHAT_APP_ID
  const secret = process.env.WECHAT_APP_SECRET
  if (!appid || !secret) throw new Error('服务器尚未配置微信 AppSecret')

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', appid)
  url.searchParams.set('secret', secret)
  url.searchParams.set('js_code', code)
  url.searchParams.set('grant_type', 'authorization_code')
  const result = await fetch(url, { signal: AbortSignal.timeout(10000) })
  const data = await result.json()
  if (!result.ok || data.errcode || !data.openid) {
    throw new Error(data.errmsg || '微信登录失败')
  }
  return data
}

function listAvailableFunctions() {
  if (!fs.existsSync(functionsRoot)) return []
  return fs.readdirSync(functionsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => fs.existsSync(path.join(functionsRoot, name, 'index.js')))
}

const availableFunctions = new Set(listAvailableFunctions())

function loadService(functionName) {
  const functionPath = path.join(functionsRoot, functionName, 'index.js')
  const cloudFunction = require(functionPath)
  if (!cloudFunction || typeof cloudFunction.main !== 'function') {
    throw new Error('业务服务入口无效')
  }
  return cloudFunction
}

function runService(functionName, event, auth, context) {
  const cloudFunction = loadService(functionName)
  return cloud.__runWithContext(auth, () =>
    cloudFunction.main(event || {}, context || {})
  )
}

async function requireAdmin(request, response, next) {
  if (!request.auth || request.auth.type !== 'admin') {
    return response.status(403).json({ code: -1, message: '需要管理员登录' })
  }
  try {
    const check = await runService(
      'globalAdmin',
      { action: 'checkLogin' },
      request.auth,
      { requestId: request.requestId, source: 'admin-auth-check' }
    )
    if (!check || check.code !== 0) {
      return response.status(403).json({ code: -1, message: '管理员登录已失效' })
    }
    request.admin = check.data && check.data.admin
    next()
  } catch (error) {
    console.error('admin auth check error:', error)
    response.status(500).json({ code: -1, message: '管理员身份校验失败' })
  }
}

function buildQuery(collectionName, body) {
  const db = cloud.database()
  let query = db.collection(collectionName)
  if (body.query && Object.keys(body.query).length) {
    query = query.where(hydrateSpecialValues(body.query))
  }
  const orders = Array.isArray(body.orders) ? body.orders.slice(0, 3) : []
  orders.forEach(order => {
    if (order && /^[A-Za-z0-9_.]{1,64}$/.test(String(order.field || ''))) {
      query = query.orderBy(order.field, order.direction === 'asc' ? 'asc' : 'desc')
    }
  })
  if (body.skip) query = query.skip(Math.min(100000, Math.max(0, Number(body.skip))))
  if (body.limit !== undefined && body.limit !== null) {
    query = query.limit(Math.min(1000, Math.max(0, Number(body.limit))))
  }
  return query
}

async function executeDatabaseOperation(body, allowedCollections) {
  const collectionName = String((body && body.collection) || '')
  const operation = String((body && body.operation) || '')
  if (!allowedCollections.has(collectionName)) throw new Error('不允许访问此数据集合')

  const db = cloud.database()
  const collection = db.collection(collectionName)
  const documentId = String((body && body.documentId) || '')

  if (operation === 'get') {
    if (documentId) return collection.doc(documentId).get()
    return buildQuery(collectionName, body || {}).get()
  }
  if (operation === 'count') {
    return buildQuery(collectionName, body || {}).count()
  }

  if (operation === 'add') {
    return collection.add({ data: hydrateSpecialValues(body.data || {}) })
  }
  if (operation === 'set' && documentId) {
    return collection.doc(documentId).set({
      data: hydrateSpecialValues(body.data || {})
    })
  }
  if (operation === 'update') {
    const options = { data: hydrateSpecialValues(body.data || {}) }
    if (documentId) return collection.doc(documentId).update(options)
    return buildQuery(collectionName, body || {}).update(options)
  }
  if (operation === 'remove') {
    if (documentId) return collection.doc(documentId).remove()
    return buildQuery(collectionName, body || {}).remove()
  }
  throw new Error('不支持的数据操作')
}

app.set('trust proxy', 'loopback')
app.disable('x-powered-by')
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))
app.use(express.json({ limit: '2mb' }))
app.use((request, response, next) => {
  request.requestId = crypto.randomUUID()
  response.setHeader('X-Request-Id', request.requestId)
  const startedAt = Date.now()
  response.on('finish', () => {
    console.log(JSON.stringify({
      time: new Date().toISOString(),
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Date.now() - startedAt
    }))
  })
  next()
})

app.get('/', (request, response) => {
  response.json({ service: 'campus-api', status: 'ok' })
})

app.get('/health', async (request, response) => {
  try {
    await cloud.__getPool().query('SELECT 1')
    response.json({
      status: 'ok',
      database: 'ok',
      functions: availableFunctions.size,
      time: new Date().toISOString()
    })
  } catch (error) {
    response.status(503).json({ status: 'error', database: 'error' })
  }
})

app.get('/api/public/server-status', rateLimit('public-server-status', 6000, 60000), (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.json(serverStatus.snapshot())
})

// Module visibility is public information and must not depend on a login session.
app.get('/api/public/modules', rateLimit('public-modules', 120, 60000), async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store')
    const result = await runService('globalAdmin', { action: 'getPublicModules' }, {}, {
      requestId: request.requestId, source: 'public-modules'
    })
    response.status(result && result.code === 0 ? 200 : 503).json(result)
  } catch (error) {
    response.status(503).json({ code: -1, message: '校园服务配置读取失败' })
  }
})

app.get('/api/portfolio', rateLimit('portfolio-read', 180, 60000), (request, response) => {
  try {
    response.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
    response.json({ code: 0, data: readPortfolio() })
  } catch (error) {
    console.error('portfolio read error:', error)
    response.status(500).json({ code: -1, message: '个人主页内容读取失败' })
  }
})

app.put(
  '/api/admin/portfolio',
  rateLimit('portfolio-write', 30, 60000),
  requireAuth,
  requireAdmin,
  (request, response) => {
    try {
      const data = writePortfolio(request.body)
      response.json({ code: 0, message: '个人主页内容已发布', data })
    } catch (error) {
      console.error('portfolio write error:', error)
      response.status(400).json({ code: -1, message: error.message || '个人主页内容保存失败' })
    }
  }
)

app.post('/api/auth/wechat', rateLimit('wechat-login', 30, 60000), async (request, response) => {
  try {
    const code = String((request.body && request.body.code) || '').trim()
    if (!code || code.length > 128) {
      return response.status(400).json({ code: -1, message: '微信登录 code 无效' })
    }
    const session = await exchangeWechatCode(code)
    response.json({
      code: 0,
      data: {
        token: signSession(session.openid, session.unionid, weRun.createSession(session.openid, session.session_key)),
        openid: session.openid
      }
    })
  } catch (error) {
    console.error('wechat auth error:', error.message)
    response.status(502).json({ code: -1, message: error.message || '微信登录失败' })
  }
})

app.post('/api/we-run', requireAuth, rateLimit('we-run', 30, 60000), async (request, response) => {
  if (request.auth.type !== 'wechat') return response.status(403).json({ code: -1, message: '请使用微信登录' })
  try {
    const data = await weRun.sync(cloud, request.auth, request.body || {})
    response.json({ code: 0, data })
  } catch (error) {
    // 解密错误不输出原始密文或 session_key。
    response.status(400).json({ code: -1, message: error.message.includes('微信') ? error.message : '同步失败，请重新点击同步' })
  }
})

app.post('/api/auth/admin', rateLimit('admin-login', 10, 60000), async (request, response) => {
  try {
    const account = String((request.body && request.body.account) || '').trim()
    const password = String((request.body && request.body.password) || '')
    if (account.length < 4 || password.length < 8 || account.length > 64 || password.length > 128) {
      return response.status(400).json({ code: -1, message: '管理员账号或密码格式不正确' })
    }

    const adminOpenid = 'web-admin:' + crypto.randomUUID()
    const result = await runService(
      'globalAdmin',
      { action: 'login', data: { account, password } },
      { openid: adminOpenid, unionid: '', type: 'admin' },
      { requestId: request.requestId, source: 'admin-login' }
    )
    if (!result || result.code !== 0 || !result.data || !result.data.admin) {
      return response.status(401).json(result || { code: -1, message: '登录失败' })
    }

    response.json({
      code: 0,
      message: result.message,
      data: {
        admin: result.data.admin,
        token: signAdminSession(adminOpenid, result.data.admin)
      }
    })
  } catch (error) {
    console.error('admin login error:', error)
    response.status(500).json({ code: -1, message: '管理员登录失败' })
  }
})

app.post(
  '/api/auth/admin/reset-password',
  rateLimit('admin-reset-password', 5, 60000),
  async (request, response) => {
    try {
      const result = await runService(
        'globalAdmin',
        {
          action: 'resetPasswordWithVerify',
          data: {
            account: String((request.body && request.body.account) || ''),
            verifyPassword: String((request.body && request.body.verifyPassword) || ''),
            newPassword: String((request.body && request.body.newPassword) || '')
          }
        },
        { openid: 'web-admin-reset', unionid: '', type: 'admin-reset' },
        { requestId: request.requestId, source: 'admin-password-reset' }
      )
      response.status(result && result.code === 0 ? 200 : 400).json(result)
    } catch (error) {
      console.error('admin reset error:', error)
      response.status(500).json({ code: -1, message: '密码重置失败' })
    }
  }
)

app.post(
  '/api/auth/admin/logout',
  rateLimit('admin-logout', 30, 60000),
  requireAuth,
  requireAdmin,
  async (request, response) => {
    try {
      const result = await runService(
        'globalAdmin',
        { action: 'logout' },
        request.auth,
        { requestId: request.requestId, source: 'admin-logout' }
      )
      response.json(result || { code: 0, message: '已退出登录' })
    } catch (error) {
      console.error('admin logout error:', error)
      response.status(500).json({ code: -1, message: '退出登录失败' })
    }
  }
)

app.post(
  '/api/admin/database',
  rateLimit('admin-database', 600, 60000),
  requireAuth,
  requireAdmin,
  async (request, response) => {
    try {
      if (['global_settings', 'global_module', 'global_admin_log', 'admin_logs'].includes(request.body.collection) && request.admin.role !== 'super') {
        return response.status(403).json({ code: -1, message: '仅超级管理员可管理系统配置和操作日志' })
      }
      const result = await executeDatabaseOperation(
        request.body || {},
        adminCollections
      )
      response.json(result)
    } catch (error) {
      response.status(400).json({ code: -1, message: error.message || '数据库操作失败' })
    }
  }
)

app.post(
  '/api/functions/:name',
  rateLimit('cloud-function', 600, 60000),
  requireAuth,
  (request, response, next) => {
    if (request.params.name !== 'globalAdmin') return next()
    const action = request.body && request.body.action
    if (action === 'initDatabase') {
      return response.status(403).json({ code: -1, message: '请在服务器本地初始化管理员' })
    }
    if (action === 'login') return rateLimit('admin-login', 10, 60000)(request, response, next)
    if (action === 'resetPasswordWithVerify') return rateLimit('admin-reset-password', 5, 60000)(request, response, next)
    next()
  },
  async (request, response) => {
    const functionName = String(request.params.name || '')
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(functionName) || !availableFunctions.has(functionName)) {
      return response.status(404).json({ code: -1, message: '云函数不存在' })
    }

    try {
      const result = await runService(
        functionName,
        request.body || {},
        request.auth,
        {
          requestId: request.requestId,
          source: 'selfhost'
        }
      )
      response.json(result === undefined ? null : result)
    } catch (error) {
      console.error('function error:', functionName, error)
      response.status(500).json({
        code: -1,
        success: false,
        message: error.message || '服务器内部错误',
        errMsg: error.message || '服务器内部错误',
        requestId: request.requestId
      })
    }
  }
)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 1 },
  fileFilter(request, file, callback) {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype || '')) {
      return callback(new Error('仅允许上传 JPG、PNG、WebP 或 GIF 图片'))
    }
    callback(null, true)
  }
})

app.post(
  '/api/files/upload',
  rateLimit('file-upload', 60, 60000),
  requireAuth,
  upload.single('file'),
  async (request, response) => {
    try {
      if (!request.file) return response.status(400).json({ code: -1, message: '请选择文件' })
      const image = await validateImage(request.file)
      request.file.mimetype = image.mime
      const requestedPath = String((request.body && request.body.cloudPath) || '')
      // 与保存器的路径规范化一致，避免别名绕过祝福上传的资格与所有者锁。
      const normalizedPath = requestedPath.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(segment => segment && segment !== '.' && segment !== '..').join('/')
      const relativePath = path.relative(uploadRoot, path.resolve(uploadRoot, normalizedPath)).replace(/\\/g, '/')
      const namespace = process.platform === 'win32' ? relativePath.toLowerCase() : relativePath
      if (namespace === 'gift-sites' || namespace.startsWith('gift-sites/')) {
        const result = await cloud.__runWithContext(request.auth, () => require('../services/gift_sites').uploadImage(request.file, request.auth.openid))
        return response.json({ code: 0, fileID: result.fileID })
      }
      const cloudPath = imagePath(request.auth.openid, namespace, image.ext)
      const result = await cloud.__runWithContext(request.auth, () =>
        cloud.__saveFile({ cloudPath, fileContent: request.file.buffer })
      )
      response.json({ code: 0, fileID: result.fileID })
    } catch (error) {
      console.error('upload error:', error)
      response.status(400).json({ code: -1, message: error.message || '上传失败' })
    }
  }
)

installEnglishMedia(app, { uploadRoot, rateLimit })
installGiftWeb(app, { rateLimit })

app.use('/uploads', express.static(uploadRoot, {
  fallthrough: false,
  immutable: false,
  maxAge: '1h',
  dotfiles: 'deny',
  setHeaders(response) { response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox") }
}))

app.get(/^\/admin$/, (request, response) => {
  response.redirect(301, String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') + '/admin/')
})

app.use('/admin', helmet.contentSecurityPolicy({
  directives: {
    'script-src': ["'self'", "'unsafe-inline'"],
    'script-src-attr': ["'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
    'font-src': ["'self'", 'https://cdnjs.cloudflare.com', 'data:'],
    'img-src': ["'self'", 'https:', 'data:']
  }
}), express.static(path.resolve(__dirname, '../../admin-web'), { dotfiles: 'deny' }))

app.use((error, request, response, next) => {
  console.error('request error:', error)
  if (response.headersSent) return next(error)
  response.status(error.status || 500).json({
    code: -1,
    message: error.message || '服务器内部错误',
    requestId: request.requestId
  })
})

async function start() {
  if (!process.env.DB_PASSWORD || !process.env.JWT_SECRET) {
    throw new Error('缺少数据库或 JWT 环境变量')
  }
  await fs.promises.mkdir(uploadRoot, { recursive: true })
  await cloud.__ensureSchema()
  const gifts = require('../services/gift_sites')
  let cleaningGifts = false
  const cleanGifts = async () => {
    if (cleaningGifts) return
    cleaningGifts = true
    try { await gifts.purgeExpired() } catch (error) { console.error('gift cleanup:', error.message) }
    finally { cleaningGifts = false }
  }
  await cleanGifts()
  setInterval(cleanGifts, 15 * 60000).unref()
  let cleaningPreviews = false
  setInterval(async () => {
    if (cleaningPreviews) return
    cleaningPreviews = true
    try { await gifts.purgePreviews() } catch (error) { console.error('gift preview cleanup:', error.message) }
    finally { cleaningPreviews = false }
  }, 30000).unref()
  serverStatus = createServerStatus({ getPool: () => cloud.__getPool() })
  const server = app.listen(port, host, () => {
    console.log(`campus-api listening on http://${host}:${port}`)
  })
  server.once('close', () => serverStatus.close())
}

if (require.main === module) {
  start().catch(error => {
    console.error('startup failed:', error)
    process.exitCode = 1
  })
}

module.exports = app
