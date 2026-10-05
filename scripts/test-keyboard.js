const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function compile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
  }).outputText
}

let windowInfo = { windowHeight: 720, windowWidth: 360, screenHeight: 800 }
const listeners = new Set()
const keyboard = {}
const wx = {
  getWindowInfo: () => windowInfo,
  onKeyboardHeightChange: callback => listeners.add(callback),
  offKeyboardHeightChange: callback => listeners.delete(callback)
}
vm.runInNewContext(compile('miniprogram/utils/keyboard-viewport.ts'), { exports: keyboard, wx })
const updates = []
const page = { data: {}, setData: patch => { Object.assign(page.data, patch); updates.push(patch) } }
const controller = keyboard.createKeyboardViewport(page)
const height = value => controller.onHeightChange({ detail: { height: value } })
controller.start(); controller.start()
assert.equal(listeners.size, 1, '重复聚焦不能重复订阅')
height(300)
assert.equal(page.data.keyboardViewportHeight, 420, '覆盖式键盘缩减可视区域')
const previousUpdates = updates.length
height(300)
assert.equal(updates.length, previousUpdates, '相同高度事件去重')
windowInfo = { ...windowInfo, windowHeight: 420 }
controller.resize({ size: windowInfo })
assert.equal(page.data.keyboardViewportHeight, 420, '安卓窗口已缩小不能再扣一次键盘高度')
assert.equal(page.data.keyboardInset, 0)
height(340)
assert.equal(page.data.keyboardViewportHeight, 380, '中文候选栏增高后重新避让')
height(0)
assert.equal(page.data.keyboardViewportHeight, 420, '关闭回调先到时仍受当前窗口限制')
windowInfo = { ...windowInfo, windowHeight: 720 }
controller.resize({ size: windowInfo })
assert.equal(page.data.keyboardViewportHeight, 720, '安卓返回键收起后恢复')
windowInfo = { ...windowInfo, windowHeight: 440 }
controller.resize({ size: windowInfo })
height(280)
assert.equal(page.data.keyboardViewportHeight, 440, '窗口缩小先到时不会重复上移')
controller.stop(); controller.stop()
assert.equal(listeners.size, 0, '离开页面解除监听')
assert.equal(page.data.keyboardViewportHeight, 0)
const stoppedUpdates = updates.length
height(300); controller.resize()
assert.equal(updates.length, stoppedUpdates, '离开后忽略迟到事件')
windowInfo = { ...windowInfo, windowHeight: 720 }
controller.start(); height(280)
windowInfo = { windowHeight: 170, windowWidth: 800, screenHeight: 450 }
controller.resize({ size: windowInfo })
assert.equal(page.data.keyboardViewportHeight, 90, '输入时转横屏按新屏幕重算')
height(0)
windowInfo = { ...windowInfo, windowHeight: 370 }
controller.resize({ size: windowInfo })
assert.equal(page.data.keyboardViewportHeight, 370)
controller.stop()

// Older WeChat clients still expose getSystemInfoSync.
const legacyModule = {}
vm.runInNewContext(compile('miniprogram/utils/keyboard-viewport.ts'), {
  exports: legacyModule, wx: { ...wx, getWindowInfo: undefined, getSystemInfoSync: () => windowInfo }
})
legacyModule.createKeyboardViewport(page).start()

function loadPage(file, api) {
  let value
  vm.runInNewContext(compile(file), {
    exports: {}, Page: definition => { value = definition }, console,
    require: () => ({ withSharing: value => value, api, getSavedCampusTheme: () => ({ style: '' }) }),
    getApp: () => ({ getOpenIdSync: () => 'me' }),
    wx: { showToast() {}, showLoading() {}, hideLoading() {} }
  })
  value.setData = patch => {
    for (const [key, item] of Object.entries(patch)) {
      const path = key.split('.'); let target = value.data
      for (const part of path.slice(0, -1)) target = target[part]
      target[path.at(-1)] = item
    }
  }
  return value
}

async function checkForms() {
  let searchRequest
  const profile = loadPage('miniprogram/pages/profile/profile.ts', { call: request => { searchRequest = request } })
  profile.onSearchInput({ detail: { value: '小a橘同学' } })
  assert.equal(profile.data.searchKeyword, '小a橘同学', '昵称原样保留，输入中不改写光标文字')
  profile.data.searchType = 'name'; profile.searchFriend()
  assert.equal(searchRequest.data.keyword, '小a橘同学')
  profile.data.searchType = 'id'; profile.data.searchKeyword = 'ab1234'; profile.searchFriend()
  assert.equal(searchRequest.data.keyword, 'AB1234', 'ID 只在提交时标准化')

  const requests = []
  const shops = loadPage('miniprogram/pages/admin/shops/shops.ts', { call: async request => {
    requests.push(request); return { result: { code: 0 } }
  } })
  shops.loadShops = () => Promise.resolve()
  shops.loadList = () => Promise.resolve()
  shops.data.editForm = { name: '测试档口', minPrice: '0', deliveryFee: '0' }
  const edit = value => shops.onEditInput({ currentTarget: { dataset: { field: 'deliveryFee', type: 'number' } }, detail: { value } })
  for (const value of ['0', '0.', '0.5', '']) {
    edit(value)
    assert.equal(shops.data.editForm.deliveryFee, value, '金额录入保留中间状态')
  }
  for (const value of ['-1', 'abc']) {
    edit(value); await shops.saveEdit()
    assert.equal(requests.length, 0, '非法金额不提交')
  }
  edit('0.5'); await shops.saveEdit()
  assert.equal(requests[0].data.data.shopData.deliveryFee, 0.5, '提交时转换金额')
  assert.equal(requests[0].data.data.shopData.minPrice, 0)
}

checkForms().then(() => console.log('键盘事件顺序、重复通知、候选栏、返回复位、横屏、监听清理、昵称和金额输入：通过'))
  .catch(error => { console.error(error); process.exitCode = 1 })
