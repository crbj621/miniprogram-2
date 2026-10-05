'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const stall = { _id: 'stall', name: '香香面馆', location: '一食堂二楼' }
const image = 'https://www.crbuj.icu/campus-api/uploads/real-photo.jpg'
function pageFor(request, upload = async () => ({ fileID: image })) {
  const storage = new Map([['openid', 'owner']]), calls = [], notices = [], scrolls = [], cache = new Map()
  const wx = { getStorageSync: key => storage.get(key), showToast: event => notices.push(event.title), navigateTo() {}, stopPullDownRefresh() {}, showModal: event => event.success({ confirm: true }), chooseMedia: event => event.success({ tempFiles: [{ tempFilePath: 'photo.jpg' }] }) }
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText
    vm.runInNewContext(code, { wx, getApp: () => ({ isLoggedIn: () => true }), Date, Math, console, exports: module.exports, module,
      Page: value => { module.exports = value }, require: ref => {
        if (ref.endsWith('/page-share')) return { withSharing: value => value }
        if (ref.endsWith('/api-client')) return { api: { call: async event => { calls.push(event.data); return { result: await request(event.data) } }, uploadFile: upload } }
        return load(path.resolve(path.dirname(file), ref + '.ts'))
      } })
    cache.set(file, module.exports); return module.exports
  }
  const page = load(path.resolve(__dirname, '../miniprogram/packageCanteen/pages/submit/submit.ts'))
  page.setData = update => { for (const [key, value] of Object.entries(update)) { const parts = key.split('.'); let target = page.data; for (const part of parts.slice(0, -1)) target = target[part]; target[parts[parts.length - 1]] = value } }
  page.selectComponent = () => ({ scrollTo: target => scrolls.push(target) })
  page.onLoad({}); return { page, calls, notices, wx, storage, scrolls }
}
const catalog = input => input.action === 'list' ? { success: true, stalls: [stall] } : { success: true, submissions: [] }
async function main() {
  let requestFail = true
  const editor = pageFor(async input => {
    if (input.action !== 'submit') return catalog(input)
    if (requestFail) { requestFail = false; throw new Error('网络中断') }
    return { success: true }
  })
  await editor.page.load()
  editor.page.chooseStall({ detail: { value: 1 } })
  editor.page.input({ currentTarget: { dataset: { field: 'dishName' } }, detail: { value: '番茄面' } })
  editor.page.input({ currentTarget: { dataset: { field: 'description' } }, detail: { value: '好吃' } })
  await editor.page.submit(); await editor.page.submit()
  const posts = editor.calls.filter(row => row.action === 'submit')
  assert.equal(posts.length, 2); assert.equal(posts[0].clientId, posts[1].clientId)
  assert.deepEqual(Array.from(posts[0].meals), ['lunch', 'dinner'])
  assert.equal(editor.page.data.form.dishName, '')
  const history = { _id: 'mine', kind: 'dish', status: 'approved', stallId: stall._id, stallName: stall.name, location: stall.location, dishName: '番茄面', description: '原来的说明', price: 8, image: '', meals: ['breakfast'] }
  const edit = pageFor(async input => input.action === 'list' ? catalog(input) : input.action === 'mySubmissions' ? { success: true, submissions: [history] } : { success: true })
  await edit.page.load(); edit.page.editSubmission({ currentTarget: { dataset: { id: 'mine' } } })
  assert.equal(edit.page.data.editingId, 'mine'); assert.equal(edit.page.data.mealIndex, 0); assert.equal(edit.scrolls[0], 'canteen-form-start')
  edit.page.chooseStall({ detail: { value: 0 } }); assert.equal(edit.page.data.form.stallId, 'stall', 'editing cannot move dish to another stall')
  await edit.page.chooseImage(); assert.equal(edit.page.data.form.image, image)
  await edit.page.submit()
  const changed = edit.calls.find(row => row.action === 'updateSubmission')
  assert.equal(changed.id, 'mine'); assert.equal(changed.image, image); assert.equal(changed.stallId, 'stall')
  assert.equal(edit.page.data.editingId, '')

  let finishCheck
  const checking = pageFor(input => input.action === 'checkStall' ? new Promise(resolve => { finishCheck = resolve }) : Promise.resolve(catalog(input)))
  checking.page.data.form.stallName = '旧输入'; checking.page.data.form.location = '一楼'
  const pending = checking.page.checkStall()
  checking.page.input({ currentTarget: { dataset: { field: 'stallName' } }, detail: { value: '新输入' } })
  finishCheck({ success: true, exists: true, stall: { ...stall, available: true } }); await pending
  assert.equal(checking.page.data.match, null, 'old duplicate-check response cannot bind new form to wrong stall')
  assert.equal(checking.page.data.checking, false)
  const selection = pageFor(async () => ({ success: true, exists: true, stall: { ...stall, available: true } }))
  selection.page.data.form.stallName = stall.name; selection.page.data.form.location = stall.location
  await selection.page.checkStall(); assert.match(selection.page.data.checkMessage, /不会重复/)

  let deleteCalls = 0
  const deleting = pageFor(async input => { if (input.action === 'deleteSubmission') deleteCalls++; return catalog(input) })
  deleting.page.data.submissions = [history]
  deleting.wx.showModal = event => event.success({ confirm: false })
  await deleting.page.deleteSubmission({ currentTarget: { dataset: { id: 'mine' } } }); assert.equal(deleteCalls, 0)
  deleting.wx.showModal = event => event.success({ confirm: true })
  await deleting.page.deleteSubmission({ currentTarget: { dataset: { id: 'not-mine' } } }); assert.equal(deleteCalls, 0)
  await deleting.page.deleteSubmission({ currentTarget: { dataset: { id: 'mine' } } }); assert.equal(deleteCalls, 1)

  for (const exit of ['account', 'unload']) {
    let finish
    const late = pageFor(async input => catalog(input), () => new Promise(resolve => { finish = resolve }))
    const selecting = late.page.chooseImage(); await new Promise(resolve => setImmediate(resolve))
    if (exit === 'account') late.storage.set('openid', 'other')
    else late.page.onUnload()
    finish({ fileID: image }); await selecting
    assert.equal(late.page.data.form.image, '', 'late upload ignored after ' + exit)
  }
  console.log('食堂投稿前端回归通过：重试幂等、餐次、本人修改／补图／删除、查重竞态、账号与卸载保护')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
