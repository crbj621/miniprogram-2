const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
let control
const source = fs.readFileSync('miniprogram/components/tech-switch/tech-switch.ts', 'utf8')
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText, { Component: value => { control = value } })
control.data = { checked: false, disabled: false }
const values = []
control.triggerEvent = (name, detail) => { assert.equal(name, 'change'); values.push(detail.value) }
control.methods.toggle.call(control)
assert.equal(values.at(-1), true)
assert.equal(control.data.checked, false, '受控开关等待父页面提交新状态，不自行覆盖')
control.data.checked = true
control.methods.toggle.call(control)
assert.equal(values.at(-1), false)
control.data.disabled = true
control.methods.toggle.call(control)
assert.equal(values.length, 2, '禁用时不发送变更')

let forum
vm.runInNewContext(ts.transpileModule(fs.readFileSync('miniprogram/packageForum/pages/index/index.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
}).outputText, { Page: value => { forum = value }, exports: {}, require: () => ({ withSharing: value => value, withPageCopy: (_scope, value) => value, api: {}, getSavedCampusTheme: () => ({ style: '' }) }), console })
forum.setData = patch => Object.assign(forum.data, patch)
let requests = 0
forum.loadPosts = () => { requests++; return Promise.resolve(true) }
forum.data.categoryOptions = [{ key: '', name: '全部分区' }, { key: 'lost', name: '失物招领' }, { key: 'study', name: '学习互助' }]
forum.data.page = 3; forum.data.posts = ['old']
forum.toggleCategoryMenu()
assert.equal(forum.data.categoryExpanded, true)
forum.onCategoryChange({ currentTarget: { dataset: { index: '2' } } })
assert.equal(forum.data.currentCategory, 'study')
assert.equal(forum.data.categoryIndex, 2)
assert.equal(forum.data.page, 1)
assert.equal(forum.data.posts.length, 0)
assert.equal(requests, 1)
assert.equal(forum.data.categoryExpanded, false, '选择后直接收起菜单')
forum.onCategoryChange({ currentTarget: { dataset: { index: '99' } } })
forum.toggleCategoryMenu()
forum.onCategoryChange({ currentTarget: { dataset: { index: '2' } } })
assert.equal(forum.data.categoryExpanded, false, '选择当前分区也收起菜单')
assert.equal(requests, 1, '无效或相同分区不重复请求')
forum.onCategoryChange({ currentTarget: { dataset: { index: '0' } } })
assert.equal(forum.data.currentCategory, '')
assert.equal(requests, 2)
forum.data.categoriesLoading = true
forum.toggleCategoryMenu()
assert.equal(forum.data.categoryExpanded, false, '读取中不能展开')
forum.data.categoriesLoading = false
forum.toggleCategoryMenu()
forum.onHide()
assert.equal(forum.data.categoryExpanded, false, '离开页面后菜单收起')

const dailyModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('miniprogram/utils/portal-daily.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
}).outputText, { exports: dailyModule.exports })
const daily = dailyModule.exports.getPortalDaily
const beforeMidnight = Date.parse('2026-10-01T23:59:59+08:00')
assert.deepEqual(Object.keys(daily(beforeMidnight)), ['color'], '每日主题仅负责颜色')
assert.deepEqual(daily(beforeMidnight), daily(Date.parse('2026-10-01T00:00:00+08:00')), '同一北京时间日期保持一致')
assert.notEqual(daily(beforeMidnight).color, daily(beforeMidnight + 1000).color, '北京时间跨日换色')
for (let i = 0; i < 14; i++) {
  const current = daily(beforeMidnight + i * 86400000)
  const next = daily(beforeMidnight + (i + 1) * 86400000)
  assert.notEqual(current.color, next.color, '轮换边界也不能连续同色')
}
console.log('受控开关、直接下拉分区、分页复位与每日配色：通过')
