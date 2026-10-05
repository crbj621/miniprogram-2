'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const jwt = require('jsonwebtoken')

async function main() {
  const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'campus-http-security-'))
  const previous = { ...process.env }
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex')
  process.env.UPLOAD_DIR = uploadRoot
  const app = require('../src/app')
  const cloud = require('campus-server-sdk')
  const admin = require('../services/globalAdmin')
  const original = admin.main
  let serviceCalls = 0
  admin.main = async () => { serviceCalls++; return { code: -1, message: '测试账号拒绝' } }
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  process.env.PUBLIC_BASE_URL = base
  const openid = 'security-test-user'
  const token = jwt.sign({ sub: openid, type: 'wechat' }, process.env.JWT_SECRET, {
    expiresIn: '5m', issuer: 'campus-api', audience: 'campus-miniprogram'
  })
  let checks = 0
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++ }
  const post = (route, data, authenticated = false) => fetch(base + route, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(data)
  })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOqoAAAAASUVORK5CYII=', 'base64')
  const upload = (bytes, cloudPath, filename, mime = 'image/png') => {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mime }), filename)
    form.append('cloudPath', cloudPath)
    return fetch(base + '/api/files/upload', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: form })
  }
  try {
    for (const collection of ['users', 'teams', 'runRecords']) {
      equal((await post('/api/public/database', { collection, operation: 'get' })).status, 404, 'anonymous generic database is absent')
    }
    equal((await post('/api/admin/database', { collection: 'users', operation: 'get' })).status, 401, 'admin database requires login')
    equal((await post('/api/admin/database', { collection: 'users', operation: 'get' }, true)).status, 403, 'student cannot use admin database')
    equal((await post('/api/functions/globalAdmin', { action: 'initDatabase', data: { account: 'attacker', password: 'testing-only' } }, true)).status, 403, 'HTTP cannot bootstrap an administrator')
    equal(serviceCalls, 0, 'rejected bootstrap does not reach service or database')
    const rejected = await upload(Buffer.from('<html><script>alert(1)</script></html>'), 'forum/a.html', 'a.html')
    equal(rejected.status, 400, 'spoofed image MIME cannot upload HTML')
    equal((await fs.readdir(uploadRoot)).length, 0, 'invalid content is never persisted')
    equal((await upload(Buffer.alloc(0), 'avatars/empty.png', 'empty.png')).status, 400, 'empty images are rejected')
    const owner = crypto.createHash('sha256').update(openid).digest('hex')
    const urls = []
    for (const requested of ['forum/existing.html', '../forum/other-user/existing.jpg', 'english-cache/overwrite.pdf']) {
      const response = await upload(png, requested, 'fake.html')
      equal(response.status, 200, 'valid PNG works with legacy cloudPath')
      const data = await response.json()
      const url = new URL(data.fileID)
      const namespace = requested.includes('forum') ? 'forum' : 'uploads'
      equal(url.pathname.startsWith('/uploads/' + namespace + '/' + owner + '/'), true, 'owner and namespace are server-controlled')
      equal(url.pathname.endsWith('.png'), true, 'extension follows actual bytes')
      const saved = await fetch(data.fileID)
      equal(saved.headers.get('content-type').startsWith('image/png'), true, 'served as image, never HTML')
      equal(saved.headers.get('content-security-policy'), "default-src 'none'; sandbox", 'uploads cannot execute script')
      equal(Buffer.from(await saved.arrayBuffer()), png, 'image bytes preserved')
      urls.push(data.fileID)
    }
    equal(new Set(urls).size, urls.length, 'requests cannot overwrite prior files')
    await cloud.__saveFile({ cloudPath: 'legacy.html', fileContent: Buffer.from('<script>alert(1)</script>') })
    equal((await fetch(base + '/uploads/legacy.html')).headers.get('content-security-policy'), "default-src 'none'; sandbox", 'legacy files are sandboxed too')
    for (let index = 0; index < 10; index++) equal((await post('/api/functions/globalAdmin', { action: 'login', data: {} }, true)).status, 200, 'legacy mini-program login keeps working')
    equal((await post('/api/functions/globalAdmin', { action: 'login', data: {} }, true)).status, 429, 'function alias cannot bypass login rate limit')
    equal((await post('/api/auth/admin', { account: 'test-admin', password: 'testing-only' })).status, 429, 'login aliases share one rate bucket')
    for (let index = 0; index < 5; index++) await post('/api/functions/globalAdmin', { action: 'resetPasswordWithVerify', data: {} }, true)
    equal((await post('/api/auth/admin/reset-password', { account: 'test-admin' })).status, 429, 'reset aliases share one rate bucket')
    equal(serviceCalls, 15, 'rate-limited requests never reach password verification')
    console.log('HTTP security regression passed: ' + checks + ' checks')
  } finally {
    admin.main = original
    await new Promise(resolve => server.close(resolve))
    server.closeAllConnections()
    for (const key of ['JWT_SECRET', 'UPLOAD_DIR', 'PUBLIC_BASE_URL']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    assert.equal(path.dirname(uploadRoot), path.resolve(os.tmpdir()))
    assert.ok(path.basename(uploadRoot).startsWith('campus-http-security-'))
    await fs.rm(uploadRoot, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
