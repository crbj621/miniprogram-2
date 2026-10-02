'use strict'
// 只允许独立测试库；微信登录接口替身仅存在于测试子进程。
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const cloud = require('campus-server-sdk')
if (!/^campus_run_review_/.test(process.env.DB_NAME || '')) throw new Error('HTTP 模拟必须使用 campus_run_review_ 开头的独立测试库')
const prefix = 'http-run-' + crypto.randomBytes(6).toString('hex')
const identities = { a: { openid: prefix + '-a', key: crypto.randomBytes(16).toString('base64') },
  b: { openid: prefix + '-b', key: crypto.randomBytes(16).toString('base64') } }
const port = 3112
const server = spawn(process.execPath, ['-e', `
  const identities = JSON.parse(process.env.TEST_WECHAT_IDENTITIES);
  const original = global.fetch;
  global.fetch = async (url, options) => {
    const value = new URL(url);
    if (value.hostname !== 'api.weixin.qq.com' || value.pathname !== '/sns/jscode2session') return original(url, options);
    const id = identities[value.searchParams.get('js_code')];
    return { ok: true, json: async () => id ? { openid: id.openid, session_key: id.key } : { errcode: 40029 } };
  };
  require('./src/app');
`], { cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, PORT: String(port),
  UPLOAD_DIR: '/tmp/campus-running-http-uploads', SERVICES_DIR: require('node:path').resolve(__dirname, '../services'),
  TEST_WECHAT_IDENTITIES: JSON.stringify(identities) }, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
server.stdout.on('data', value => { logs += value })
server.stderr.on('data', value => { logs += value })
const request = async (path, data, token) => {
  const response = await fetch('http://127.0.0.1:' + port + path, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(data) })
  return { status: response.status, body: await response.json() }
}
async function main() {
  for (let i = 0; i < 50 && !logs.includes('campus-api listening'); i++) {
    if (server.exitCode !== null) throw new Error(logs || '测试服务启动失败')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(logs.includes('campus-api listening'), '独立 HTTP 服务启动')
  assert.equal((await request('/api/we-run', {})).status, 401)
  const a = (await request('/api/auth/wechat', { code: 'a' })).body.data
  const b = (await request('/api/auth/wechat', { code: 'b' })).body.data
  assert.ok(a.token && b.token)
  assert.equal(a.session_key, undefined, '接口不返回微信会话密钥')
  const iv = crypto.randomBytes(16), stamp = Math.floor(Date.now() / 1000)
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(identities.a.key, 'base64'), iv)
  const payload = { iv: iv.toString('base64'), encryptedData: Buffer.concat([cipher.update(JSON.stringify({
    watermark: { appid: process.env.WECHAT_APP_ID, timestamp: stamp }, stepInfoList: [{ timestamp: stamp, step: 4321 }] })), cipher.final()]).toString('base64') }
  const synced = await request('/api/we-run', payload, a.token)
  assert.equal(synced.status, 200); assert.equal(synced.body.data.today, 4321)
  assert.equal((await request('/api/we-run', payload, b.token)).status, 400, '他人登录态不能解密当前用户的微信数据')
  const run = await request('/api/functions/saveRunData', { runId: prefix, distance: 600, duration: 300 }, a.token)
  assert.equal(run.body.success, true, run.body.errMsg)
  const stats = await request('/api/functions/getUserRunStats', {}, a.token)
  assert.equal(stats.body.totalDistance, 600)
  const history = await request('/api/functions/getUserRunStats', { action: 'history' }, b.token)
  assert.equal(history.body.data.length, 0, 'HTTP 历史记录鉴权隔离')
  console.log('独立 HTTP 回归通过：登录会话、微信步数同步、越权拒绝、运动保存与历史隔离')
}
main().finally(async () => {
  const exited = new Promise(resolve => server.once('exit', resolve))
  if (server.exitCode === null) { server.kill(); await exited }
  const db = cloud.database()
  for (const collection of ['runRecords', 'wechat_steps']) {
    for (const row of (await db.collection(collection).get()).data) {
      if (Object.values(identities).some(id => id.openid === row.openid)) await db.collection(collection).doc(row._id).remove()
    }
  }
  await cloud.__getPool().end()
}).catch(error => { console.error(error); process.exitCode = 1 })
