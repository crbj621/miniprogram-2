'use strict'
// Read credentials from a protected file outside the source tree. Never print secrets.
const fs = require('node:fs')
const crypto = require('node:crypto')
const cloud = require('campus-server-sdk')

async function main() {
  const file = process.argv[2] || '/etc/campus-api/bootstrap-admin.json'
  const credentials = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!/^[A-Za-z0-9_]{4,32}$/.test(credentials.account) || String(credentials.password || '').length < 8) {
    throw new Error('账号格式或密码长度不符合要求')
  }
  const db = cloud.database()
  const admins = (await db.collection('global_admin').where({ role: 'super' }).get()).data
  const target = credentials.adminId ? admins.find(row => row._id === credentials.adminId) : admins.length === 1 ? admins[0] : null
  if (!target) throw new Error('请在私密凭证文件中指定 adminId，避免修改错误管理员')
  const collision = (await db.collection('global_admin').where({ account: credentials.account }).get()).data
  if (collision.some(row => row._id !== target._id)) throw new Error('账号已被其他管理员使用')
  const salt = crypto.randomBytes(16).toString('hex')
  await db.collection('global_admin').doc(target._id).update({ data: {
    account: credentials.account,
    passwordHash: 'scrypt$' + salt + '$' + crypto.scryptSync(credentials.password, salt, 32).toString('hex'),
    password: db.command.remove(), loginOpenid: db.command.remove(), updateTime: db.serverDate()
  } })
  const response = await fetch('http://127.0.0.1:' + (process.env.PORT || 3100) + '/api/auth/admin', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: credentials.account, password: credentials.password }),
    signal: AbortSignal.timeout(10000)
  })
  const result = await response.json()
  if (!response.ok || result.code !== 0 || !result.data.token) throw new Error('修改后管理员登录验证失败')
  // Verification must not leave the administrator bound to a test browser session.
  const payload = JSON.parse(Buffer.from(result.data.token.split('.')[1], 'base64url').toString('utf8'))
  await db.collection('global_admin').where({ _id: target._id, loginOpenid: payload.sub })
    .update({ data: { loginOpenid: db.command.remove() } })
  console.log('Administrator credentials updated; HTTP password login verified; verification session cleared')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
  .finally(async () => { await cloud.__getPool().end() })
