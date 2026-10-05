'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const moduleValue = { exports: {} }, menus = []
const wx = { showShareMenu: value => menus.push(value), stopPullDownRefresh() {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('miniprogram/utils/page-share.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } }).outputText, { exports: moduleValue.exports, wx })
const { withSharing } = moduleValue.exports
function page(route, methods = {}) { const value = withSharing({ data: {}, ...methods }); value.route = route; value.setData = patch => Object.assign(value.data, patch); return value }
let loads = 0, shows = 0
const privatePage = page('packageEnglish/pages/attempt/attempt', { onLoad() { loads++ }, onShow() { shows++ } })
privatePage.onLoad({ attemptId: 'private-record', paperId: 'paper', level: 'CET6', token: 'private-token' }); privatePage.onShow()
assert.equal(loads, 1); assert.equal(shows, 1)
const friend = privatePage.onShareAppMessage()
assert.equal(friend.path, '/packageEnglish/pages/papers/papers?level=CET6')
privatePage.data.level = 'CET4'
assert.equal(privatePage.onShareAppMessage().path, '/packageEnglish/pages/papers/papers?level=CET4', 'use current level after switching')
privatePage.data.level = 'CET6'
assert.ok(!JSON.stringify(friend).includes('private-'))
const timeline = privatePage.onShareTimeline()
assert.ok(timeline.query.startsWith('sharePublic=1&entry='))
const opened = page('packageEnglish/pages/attempt/attempt', { onLoad() { throw Error('private data must not load') }, onShow() { throw Error('private requests must not run') } })
opened.onLoad({ sharePublic: '1', entry: timeline.query.split('entry=')[1] }); opened.onShow(); opened.onReady()
assert.equal(opened.data.__sharePublic, true); assert.equal(opened.data.__sharePath, friend.path)
const unsafe = page('pages/admin/index/index')
unsafe.onLoad({ sharePublic: '1', entry: '/pages/admin/index/index?token=secret' })
assert.equal(unsafe.data.__sharePath, '/pages/portal/portal')
const dish = page('packageCanteen/pages/dish/dish')
dish.onLoad({ id: 'dish-id', openid: 'private', token: 'secret' })
assert.equal(dish.onShareAppMessage().path, '/packageCanteen/pages/dish/dish?id=dish-id')
const profile = page('pages/profile/profile', { onShareAppMessage() { return { path: '/pages/index/index?addFriend=123456&token=secret', title: '一起加好友' } } })
profile.onLoad({}); assert.equal(profile.onShareAppMessage().path, '/pages/index/index?addFriend=123456')
const config = JSON.parse(fs.readFileSync('miniprogram/app.json'))
const pages = config.pages.concat(config.subpackages.flatMap(pack => pack.pages.map(page => pack.root + '/' + page)))
for (const route of pages) {
  const file = ['.ts', '.js'].map(extension => path.join('miniprogram', route + extension)).find(fs.existsSync)
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const registrations = source.statements.filter(statement => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(source) === 'Page')
  assert.equal(registrations.length, 1, route + ': one Page registration')
  const wrapper = registrations[0].expression.arguments[0]
  assert.ok(wrapper && ts.isCallExpression(wrapper) && wrapper.expression.getText(source) === 'withSharing', route + ': sharing must remain the outer wrapper')
  assert.equal(wrapper.arguments.length, 1)
  const definition = wrapper.arguments[0]
  if (!ts.isObjectLiteralExpression(definition)) {
    assert.ok(ts.isCallExpression(definition) && definition.expression.getText(source) === 'withPageCopy', route + ': supported inner copy wrapper')
    assert.equal(definition.arguments.length, 2)
    assert.ok(ts.isStringLiteral(definition.arguments[0]) && ts.isObjectLiteralExpression(definition.arguments[1]), route + ': copy scope and page definition')
  }
  assert.ok(fs.readFileSync(path.join('miniprogram', route + '.wxml'), 'utf8').includes('__sharePublic'), route + ': Timeline public introduction')
}
assert.ok(menus.length >= 2)
console.log('全' + pages.length + '页好友/朋友圈分享、公开入口、生命周期保留、隐私参数与旧好友邀请：通过')
