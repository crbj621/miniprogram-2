const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const requests = []
const modules = { running: true, food: false, canteen: true, forum: false, rider: false }
const storage = new Map([['openid', 'old-cloud-user'], ['userInfo', { nickName: '旧用户' }], ['selfhost_token', 'old-token'], ['food_shop_id', 'old-shop']])
storage.set('pending_runs_old-cloud-user', [{ runId: 'offline' }])
storage.set('active_run_old-cloud-user', { runId: 'active' })
const wx = {
  getStorageSync: key => storage.get(key) || '',
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key),
  clearStorageSync: () => storage.clear(),
  getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
  login: options => options.fail(new Error('微信登录不可用')),
  request(options) {
    requests.push(options)
    options.success({ statusCode: 200, data: { code: 0, data: { modules } } })
  }
}
const compiled = ts.transpileModule(fs.readFileSync('miniprogram/utils/api-client.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const moduleValue = { exports: {} }
vm.runInNewContext(compiled, {
  wx, module: moduleValue, exports: moduleValue.exports,
  require: () => ({ API_BASE_URL: 'https://www.crbuj.icu/campus-api', API_CACHE_VERSION: 'test-v1' })
})

async function main() {
  moduleValue.exports.initializeServerClient()
  assert.equal(wx.cloud, undefined, '不再替换或使用微信云 SDK')
  assert.equal(storage.has('userInfo'), false)
  assert.equal(storage.has('openid'), false)
  assert.equal(storage.has('selfhost_token'), false)
  assert.equal(storage.has('food_shop_id'), false)
  assert.equal(storage.get('pending_runs_old-cloud-user')[0].runId, 'offline', '更换 API 地址保留待同步运动')
  assert.equal(storage.get('active_run_old-cloud-user').runId, 'active', '更换 API 地址保留运动恢复快照')
  const result = await moduleValue.exports.api.call({ name: 'globalAdmin', data: { action: 'getPublicModules' } })
  assert.deepEqual(result.result.data.modules, modules)
  assert.equal(requests[0].url, 'https://www.crbuj.icu/campus-api/api/public/modules')
  assert.equal(requests[0].method, 'GET')
  assert.equal(requests[0].header.Authorization, undefined)
  await assert.rejects(moduleValue.exports.api.call({ name: 'globalAdmin', data: { action: 'updateGlobalSettings' } }), /无法连接校园服务器/)
  assert.equal(requests.length, 1, '其他操作仍必须登录')
  storage.set('userInfo', { nickName: '新用户' })
  moduleValue.exports.initializeServerClient()
  assert.equal(storage.get('userInfo').nickName, '新用户', '同一后端重启保留新登录缓存')
  console.log('公开模块读取不依赖微信登录；敏感操作保持鉴权：通过')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
