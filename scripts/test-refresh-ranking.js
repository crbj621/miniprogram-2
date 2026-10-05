const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(file, services = {}) {
  let value
  const timers = []
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020
  } }).outputText
  vm.runInNewContext(code, { exports: {}, require: () => ({ withSharing: value => value, withPageCopy: (_scope, value) => value, getSavedCampusTheme: () => ({ style: '' }), ...services }),
    Page: input => { value = input }, Component: input => { value = input },
    getApp: () => ({ getGlobalOpenId: () => 'me', isLoggedIn: () => true }),
    wx: { showToast() {} }, console, setTimeout: task => { timers.push(task); return timers.length }, clearTimeout() {} })
  Object.assign(value, value.methods || {})
  value.setData = patch => Object.assign(value.data, patch)
  value.triggerEvent = () => {}
  return { value, timers }
}
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
async function main() {
  const { value: refresh, timers } = load('miniprogram/components/mahiro-scroll/mahiro-scroll.ts')
  refresh.onPulling({ detail: { dy: 81 } }); assert.equal(refresh.data.state, 'ready')
  refresh.onRestore(); assert.equal(refresh.data.state, 'pull')
  const request = deferred(); let calls = 0
  const first = refresh.refresh(() => { calls++; return request.promise })
  await refresh.refresh(async () => { calls++; return true })
  assert.equal(calls, 1, 'pulling twice must not duplicate requests')
  assert.equal(refresh.data.state, 'loading')
  request.resolve(false); await first
  assert.equal(refresh.data.state, 'error', 'business failure must not celebrate success')
  timers.shift()(); assert.equal(refresh.data.triggered, false)
  await refresh.refresh(async () => true); assert.equal(refresh.data.state, 'success'); timers.shift()()
  await refresh.refresh(async () => { throw new Error('offline') }); assert.equal(refresh.data.state, 'error'); timers.shift()()
  const pending = deferred(), unfinished = refresh.refresh(() => pending.promise)
  refresh.lifetimes.detached.call(refresh); const before = refresh.data.state
  pending.resolve(true); await unfinished; assert.equal(refresh.data.state, before, 'destroyed component must not update')

  const shops = [deferred(), deferred(), deferred()]; let shopCall = 0
  const food = load('miniprogram/packageFood/pages/index/index.ts', { callFoodFunction: () => shops[shopCall++].promise }).value
  const old = food.loadShops(); food.data.keyword = 'new'; const latest = food.loadShops()
  shops[1].resolve({ list: [{ _id: 'new' }] }); await latest
  shops[0].resolve({ list: [{ _id: 'old' }] }); await old
  assert.equal(food.data.shops[0]._id, 'new')
  food.data.hasMore = true
  const pageBefore = food.data.page
  const failedPage = food.loadShops(true)
  shops[2].reject(new Error('offline'))
  await failedPage
  assert.equal(food.data.page, pageBefore, 'failed pagination must not skip page')

  const posts = [deferred(), deferred()]; let postCall = 0
  const forum = load('miniprogram/packageForum/pages/index/index.ts', { api: { call: () => posts[postCall++].promise } }).value
  const oldPost = forum.loadPosts(); forum.data.currentCategory = 'new'; const newPost = forum.loadPosts()
  posts[1].resolve({ result: { success: true, posts: [{ _id: 'new' }], hasMore: false } }); await newPost
  posts[0].resolve({ result: { success: true, posts: [{ _id: 'old' }], hasMore: false } }); await oldPost
  assert.equal(forum.data.posts[0]._id, 'new')

  const ranks = load('miniprogram/pages/rank/rank.ts', { api: { call: async options => {
    options.success({ result: { code: 0, data: [
      { _id: 'pair-a', distance: 1000, memberOpenids: ['a', 'b'] },
      { _id: 'pair-b', distance: 850, memberOpenids: ['me', 'c'] },
      { _id: 'pair-c', distance: 850, memberOpenids: ['d', 'e'] }
    ] } }); options.complete()
  } } }).value
  ranks.data.activeTab = 'couple'; await ranks.getRankList()
  assert.equal(ranks.data.myRank.position, 2)
  assert.equal(ranks.data.myRank.gap, 150)
  assert.equal(ranks.data.rankList[0].medal, '冠军')
  assert.equal(ranks.data.rankList[1].medal, '亚军')
  assert.equal(ranks.data.rankList[2].medal, '季军')
  assert.equal(ranks.data.rankList[2].gap, 0)
  assert.match(ranks.data.rankList[2].gapText, /同里程/)
  console.log('角色刷新成功/失败/防重/销毁、列表请求竞态与排行榜奖牌/追赶距离：通过')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
