const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const storage = new Map([['openid', 'server-user']])
let app, respond = async () => { throw new Error('服务器不可用') }
const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key) }
const code = ts.transpileModule(fs.readFileSync('miniprogram/app.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText
vm.runInNewContext(code, { wx, exports: {}, console, App: value => { app = value },
  require: ref => ref.endsWith('api-client') ? {
    api: { call: options => respond(options) }, initializeServerClient() {}, clearServerSession() {}
  } : { clearIdentityCache: () => storage.clear() }
})
async function main() {
  app.globalData.openid = 'server-user'
  const failed = await app.doLogin({ nickName: '测试学生' })
  assert.equal(failed.success, false)
  assert.equal(app.globalData.hasUserInfo, false, '服务端失败不能显示登录成功')
  assert.equal(storage.has('userInfo'), false)
  let finish
  respond = () => new Promise(resolve => { finish = resolve })
  const pending = app.doLogin({ nickName: '测试学生' })
  app.doLogout()
  finish({ result: { success: true, userId: '123456' } })
  assert.equal((await pending).success, false, '退出前发起的登录不可回写')
  assert.equal(storage.has('userInfo'), false)
  app.globalData.openid = 'server-user'
  respond = async () => ({ result: { success: true, userId: '123456' } })
  assert.equal((await app.doLogin({ nickName: '测试学生' })).success, true)
  assert.equal(app.globalData.hasUserInfo, true)
  assert.equal(storage.get('userId'), '123456')
  console.log('服务器失败及退出期间不误登录，成功保存后登录：通过')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
