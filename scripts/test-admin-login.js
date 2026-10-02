const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(fs.readFileSync('miniprogram/pages/admin/login/login.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText

function createPage(call) {
  let page
  const stored = new Map()
  const context = {
    exports: {}, require: () => ({ api: { call } }),
    Page: value => { page = value },
    wx: { showToast() {}, setStorageSync: (key, value) => stored.set(key, value), redirectTo() {} },
    setTimeout: callback => callback()
  }
  vm.runInNewContext(code, context)
  page.setData = patch => Object.assign(page.data, patch)
  page.data.username = 'test-admin'
  page.data.password = ' test-password '
  return { page, stored }
}

async function main() {
  const network = createPage(async () => { throw new Error('服务器连接失败') })
  await network.page.onLogin()
  assert.equal(network.page.data.error, '服务器连接失败', 'Error.message 应显示真实请求错误')
  assert.equal(network.page.data.loading, false)
  assert.equal(network.stored.has('isAdmin'), false)

  const rejected = createPage(async () => ({ result: { code: -1, message: '账号或密码错误' } }))
  await rejected.page.onLogin()
  assert.equal(rejected.page.data.error, '账号或密码错误')
  assert.equal(rejected.page.data.loading, false)
  assert.equal(rejected.stored.has('isAdmin'), false)

  let calls = 0, complete, request
  const success = createPage(value => {
    calls++; request = value
    return new Promise(resolve => { complete = resolve })
  })
  const pending = success.page.onLogin()
  await success.page.onLogin()
  assert.equal(calls, 1, '连续点击不能重复登录')
  assert.equal(request.data.data.password, ' test-password ', '密码按原值验证，不截断空格')
  complete({ result: { code: 0, data: { admin: { account: 'test-admin', role: 'super' } } } })
  await pending
  assert.equal(success.stored.get('isAdmin'), true)
  assert.equal(success.stored.get('adminInfo').account, 'test-admin')

  const wxml = fs.readFileSync('miniprogram/pages/admin/login/login.wxml', 'utf8')
  assert.ok(/<input[^>]*\bpassword(?:\s|=)/.test(wxml), '使用微信原生 password 属性')
  assert.ok(!wxml.includes('type="password"'))
  console.log('管理员登录错误展示、重复提交保护、密码原值与登录状态：通过')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
