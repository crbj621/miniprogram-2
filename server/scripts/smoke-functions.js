'use strict'

const jwt = require('jsonwebtoken')
const mysql = require('mysql2/promise')

const baseUrl = String(process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '')

function parseDocument(value) {
  if (!value) return {}
  if (typeof value === 'string') return JSON.parse(value)
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString('utf8'))
  return value
}

async function getSampleOpenid() {
  if (process.env.SMOKE_OPENID) return process.env.SMOKE_OPENID
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  })
  try {
    const [teamRows] = await connection.query(
      'SELECT document_data FROM app_documents WHERE collection_name = ?',
      ['teams']
    )
    const activeTeam = teamRows
      .map(row => parseDocument(row.document_data))
      .find(team => team.status === 'active')
    const teamOpenid = activeTeam && (
      activeTeam.leaderOpenid ||
      (Array.isArray(activeTeam.members) && activeTeam.members[0]) ||
      activeTeam._openid
    )
    if (teamOpenid) return String(teamOpenid)

    const [userRows] = await connection.query(
      'SELECT document_data FROM app_documents WHERE collection_name = ? LIMIT 20',
      ['users']
    )
    for (const row of userRows) {
      const user = parseDocument(row.document_data)
      const openid = user.openid || user._openid
      if (openid) return String(openid)
    }
    throw new Error('没有可用于只读测试的用户数据')
  } finally {
    await connection.end()
  }
}

function createToken(openid) {
  return jwt.sign(
    { sub: openid, unionid: '', type: 'wechat' },
    process.env.JWT_SECRET,
    {
      expiresIn: '5m',
      issuer: 'campus-api',
      audience: 'campus-miniprogram'
    }
  )
}

function createAdminToken(openid) {
  return jwt.sign(
    { sub: openid, type: 'admin', adminId: 'compatibility-smoke', role: 'normal' },
    process.env.JWT_SECRET,
    {
      expiresIn: '5m',
      issuer: 'campus-api',
      audience: 'campus-admin'
    }
  )
}

function containsCompatibilityError(value) {
  const text = JSON.stringify(value)
  return /is not a function|unsupported|数据库服务异常|sdk|undefined/i.test(text)
}

async function callFunction(token, name, event) {
  const response = await fetch(baseUrl + '/api/functions/' + encodeURIComponent(name), {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json'
    },
    body: JSON.stringify(event || {}),
    signal: AbortSignal.timeout(15000)
  })
  const result = await response.json()
  return {
    name,
    http: response.status,
    ok: response.ok && !containsCompatibilityError(result),
    result
  }
}

function summarize(item) {
  const result = item.result
  const summary = {
    name: item.name,
    http: item.http,
    ok: item.ok
  }
  if (Array.isArray(result)) summary.items = result.length
  if (result && Array.isArray(result.data)) summary.items = result.data.length
  if (result && typeof result.success === 'boolean') summary.success = result.success
  if (result && typeof result.code === 'number') summary.code = result.code
  if (result && result.errMsg) summary.message = String(result.errMsg).slice(0, 100)
  else if (result && result.message) summary.message = String(result.message).slice(0, 100)
  else if (result && result.msg) summary.message = String(result.msg).slice(0, 100)
  return summary
}

async function main() {
  const openid = await getSampleOpenid()
  const token = createToken(openid)
  const tests = [
    ['login', {}],
    ['getOpenid', {}],
    ['getRankList', { type: 'god' }],
    ['getUserRunStats', { openid }],
    ['getFriends', { action: 'list' }],
    ['notification', { action: 'getNotifications' }],
    ['coupon_manager', { action: 'getCoupons' }],
    ['teamManager', { action: 'getMyTeam' }],
    ['teamManager', { action: 'getMyTeamEvents' }],
    ['forum', { action: 'getCategories', data: {} }],
    ['forum', { action: 'getPosts', data: { page: 1, pageSize: 5 } }],
    ['forum', { action: 'getUserPosts', data: { page: 1, pageSize: 5 } }],
    ['forum', { action: 'getUserCollections', data: { page: 1, pageSize: 5 } }],
    ['forum', { action: 'getUserComments', data: { page: 1, pageSize: 5 } }],
    ['forum', { action: 'getUnreadCount', data: {} }],
    ['food_manager', { action: 'getShopList', data: {} }],
    ['food_manager', { action: 'getCheckoutBenefits', data: {} }],
    ['food_manager', { action: 'getUserOrders', data: { page: 1, pageSize: 5 } }],
    ['food_manager', { action: 'checkMerchantStatus', data: {} }],
    ['food_manager', { action: 'checkRiderStatus', data: {} }],
    ['rider', { action: 'getProfile', data: {} }],
    ['rider', { action: 'listAvailableOrders', data: {} }],
    ['rider', { action: 'listMyOrders', data: { page: 1, pageSize: 5 } }],
    ['globalAdmin', { action: 'getPublishedAnnouncements' }],
    ['getTempFileURL', { fileIDs: ['/uploads/__compatibility_smoke_test__.png'] }],
    ['searchUser', { keyword: '__compatibility_smoke_test__' }]
  ]

  const results = []
  for (const [name, event] of tests) {
    results.push(await callFunction(token, name, event))
  }
  const adminAudienceResult = await callFunction(
    createAdminToken('web-admin:compatibility-smoke'),
    'globalAdmin',
    { action: 'getPublishedAnnouncements' }
  )
  adminAudienceResult.name = 'globalAdmin(admin-token)'
  results.push(adminAudienceResult)
  const summaries = results.map(summarize)
  console.log(JSON.stringify({
    passed: summaries.filter(item => item.ok).length,
    total: summaries.length,
    results: summaries
  }, null, 2))
  if (summaries.some(item => !item.ok)) process.exitCode = 1
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
