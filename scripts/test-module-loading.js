const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const flags = { running: true, food: false, canteen: true, forum: false, rider: false }

async function checkPage(name) {
  let response = { result: { code: -1, message: 'Unknown action: getPublicModules' } }
  const wx = { cloud: { callFunction: async () => {
    if (response instanceof Error) throw response
    return response
  } } }
  function load(file) {
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText
    vm.runInNewContext(code, {
      wx, module, exports: module.exports, console: { error() {} },
      require: ref => ref.endsWith('/api-client') ? { api: { call: wx.cloud.callFunction } } : load(path.resolve(path.dirname(file), ref + '.ts')),
      Page: definition => { module.exports = definition }
    })
    return module.exports
  }
  const page = load(path.resolve(__dirname, '../miniprogram/pages/' + name + '/' + name + '.ts'))
  page.setData = data => Object.assign(page.data, data)
  await page.loadModules()
  assert.equal(page.data.modulesState, 'error', name + ': business errors must be visible')
  response = { result: { code: 0, data: {} } }
  await page.loadModules()
  assert.equal(page.data.modulesState, 'error', name + ': malformed responses must be visible')
  response = new Error('network unavailable')
  await page.loadModules()
  assert.equal(page.data.modulesState, 'error', name + ': network errors must be visible')
  response = { result: { code: 0, data: { modules: flags } } }
  await page.loadModules()
  assert.equal(page.data.modulesState, 'ready', name + ': retry must recover')
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.modules)), flags)
  if (name === 'profile') {
    assert.deepEqual(Array.from(page.data.menuGroups, group => group.key), ['running', 'social', 'other'], '关闭模块不应留在个人菜单')
  }
  response = { result: { code: 0, data: { modules: Object.fromEntries(Object.keys(flags).map(key => [key, false])) } } }
  await page.loadModules()
  assert.equal(page.data.modulesState, 'ready')
  assert.equal(page.data.hasOpenModules, false, name + ': all disabled is different from failure')
  if (name === 'profile') assert.deepEqual(Array.from(page.data.menuGroups, group => group.key), ['other'])
}

Promise.all(['portal', 'profile'].map(checkPage)).then(() => {
  console.log('Module loading regression checks passed')
}).catch(error => { console.error(error); process.exitCode = 1 })
