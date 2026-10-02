const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const flags = { running: true, food: false, canteen: true, forum: false, rider: false }
const settings = { modules: Object.fromEntries(Object.entries(flags).map(([key, enabled]) => [key, { enabled }])) }

async function miniCheck() {
  let response = { result: { code: -1 } }
  const calls = []
  let page
  const wx = {
    cloud: { callFunction: async request => { calls.push(request); return response } },
    showToast() {}, showLoading() {}, hideLoading() {}
  }
  const code = ts.transpileModule(fs.readFileSync('miniprogram/pages/admin/index/index.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
  }).outputText
  vm.runInNewContext(code, { wx, exports: {}, require: () => ({ api: { call: wx.cloud.callFunction } }), Page: value => { page = value } })
  page.data.adminInfo = { role: 'super' }
  page.setData = patch => {
    for (const [field, value] of Object.entries(patch)) {
      const keys = field.split('.'); let target = page.data
      for (const key of keys.slice(0, -1)) target = target[key]
      target[keys.at(-1)] = value
    }
  }
  await page.loadSettings()
  assert.equal(page.data.settingsReady, false)
  assert.ok(page.data.settingsError)
  const count = calls.length
  await page.saveSettings()
  assert.equal(calls.length, count, '加载失败不能保存默认配置')
  response = { result: { code: 0, data: settings } }
  await page.loadSettings()
  assert.equal(page.data.settingsReady, true)
  page.setModulePreset({ currentTarget: { dataset: { preset: 'reviews' } } })
  await page.saveSettings()
  const saved = calls.at(-1).data.data.modules
  assert.deepEqual(Object.fromEntries(Object.keys(flags).map(key => [key, saved[key].enabled])), flags)
  assert.equal(page.data.settingsSaving, false)
  page.data.adminInfo = { role: 'normal' }
  const previous = calls.length
  await page.saveSettings()
  assert.equal(calls.length, previous)
}

async function webCheck() {
  const html = fs.readFileSync('admin-web/settings.html', 'utf8')
  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n')
  const nodes = new Map()
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) nodes.set(id, { checked: false, value: '', style: {}, addEventListener() {} })
  const document = { addEventListener() {}, getElementById: id => {
    assert.ok(nodes.has(id), '缺少控件：' + id); return nodes.get(id)
  }, querySelector: () => ({ value: 'auto', checked: true }) }
  let response = { code: -1 }
  const calls = []
  const context = vm.createContext({ document, localStorage: { getItem: () => '{"role":"super"}' },
    callCloudFunction: async (name, data) => { calls.push(data); return response },
    showNotification() {}, console: { error() {} }, confirm: () => true })
  vm.runInContext(inline, context)
  await vm.runInContext('loadSettings()', context)
  assert.equal(nodes.get('saveSettingsButton').disabled, true)
  await vm.runInContext('saveSettings()', context)
  assert.equal(calls.length, 1)
  response = { code: 0, data: settings }
  await vm.runInContext('loadSettings()', context)
  assert.equal(nodes.get('saveSettingsButton').disabled, false)
  assert.equal(nodes.get('moduleFood').checked, false, '关闭值不能误显示为开启')
  vm.runInContext("setModulePreset('reviews')", context)
  await vm.runInContext('saveSettings()', context)
  const saved = calls.at(-1).data.modules
  assert.deepEqual(Object.fromEntries(Object.keys(flags).map(key => [key, saved[key].enabled])), flags)
  assert.equal(Object.hasOwn(saved, 'run'), false)
}
Promise.all([miniCheck(), webCheck()]).then(() => console.log('网页和小程序五项开关、快捷设置、失败保存保护：通过'))
  .catch(error => { console.error(error); process.exitCode = 1 })
