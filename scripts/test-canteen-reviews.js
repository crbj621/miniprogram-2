'use strict'

const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

const collections = new Map()
let currentOpenid = 'admin'
let nextId = 1

function rows(name) {
  if (!collections.has(name)) collections.set(name, new Map())
  return collections.get(name)
}

function query(name, filters = {}, offset = 0, size = Infinity) {
  return {
    where(next) { return query(name, next, offset, size) },
    skip(next) { return query(name, filters, next, size) },
    limit(next) { return query(name, filters, offset, next) },
    async get() {
      const matches = [...rows(name).values()].filter(row => Object.entries(filters).every(([key, expected]) =>
        expected && expected.neq !== undefined ? row[key] !== expected.neq : row[key] === expected))
      return { data: matches.slice(offset, offset + size) }
    },
    async add({ data }) {
      const _id = String(nextId++)
      rows(name).set(_id, { ...data, _id })
      return { _id }
    },
    doc(id) {
      return {
        async get() {
          const data = rows(name).get(id)
          return { data: data || null }
        },
        async create({ data }) {
          if (rows(name).has(id)) throw new Error('duplicate')
          rows(name).set(id, { ...data, _id: id })
          return { _id: id }
        },
        async set({ data }) { rows(name).set(id, { ...data, _id: id }) },
        async update({ data }) {
          const old = rows(name).get(id)
          if (!old) throw new Error('not found')
          rows(name).set(id, { ...old, ...data })
        }
      }
    }
  }
}

const cloud = {
  DYNAMIC_CURRENT_ENV: 'test', init() {}, getWXContext: () => ({ OPENID: currentOpenid }),
  database: () => ({ command: { neq: value => ({ neq: value }) }, collection: name => query(name),
    runTransaction: callback => callback(),
    createCollection: async name => { rows(name) } })
}
const originalLoad = Module._load
Module._load = function(request, parent, isMain) {
  if (request === 'campus-server-sdk') return cloud
  return originalLoad.call(this, request, parent, isMain)
}
const service = require(path.resolve(__dirname, '../server/services/canteen_reviews/index.js'))
Module._load = originalLoad

async function call(openid, action, data = {}) {
  currentOpenid = openid
  return service.main({ action, ...data })
}

async function main() {
  rows('global_admin').set('a', { _id: 'a', loginOpenid: 'admin', status: 'active' })
  rows('users').set('u1', { openid: 'student1', nickName: '甲' })
  rows('users').set('u2', { openid: 'student2', nickName: '乙' })
  assert.equal((await call('student1', 'init')).success, false)
  assert.equal((await call('admin', 'init')).success, true)
  const stall = await call('admin', 'saveStall', { name: '一食堂 A 档口', location: '一楼', status: 'published' })
  assert.equal(stall.success, true)
  const good = await call('admin', 'saveDish', { stallId: stall.id, name: '红烧肉', status: 'published' })
  const bad = await call('admin', 'saveDish', { stallId: stall.id, name: '黑暗料理', status: 'published' })
  await call('admin', 'saveDish', { stallId: stall.id, name: '未发布菜', status: 'draft' })
  assert.equal((await call('student1', 'saveDish', { stallId: stall.id, name: '伪造菜' })).success, false)
  assert.equal((await call('stranger', 'saveReview', { dishId: good.id, score: 5, comment: '好吃' })).success, false)
  assert.equal((await call('student1', 'saveReview', { dishId: good.id, score: 6, comment: '好吃' })).success, false)
  assert.equal((await call('student1', 'saveReview', { dishId: good.id, score: 5, comment: '好吃' })).success, true)
  assert.equal((await call('student1', 'random', { mode: 'quality' })).dish, null)
  await call('student2', 'saveReview', { dishId: good.id, score: 4, comment: '不错' })
  await call('student1', 'saveReview', { dishId: bad.id, score: 1, comment: '不好吃' })
  await call('student2', 'saveReview', { dishId: bad.id, score: 2, comment: '不推荐' })
  assert.equal((await call('student1', 'random', { mode: 'quality' })).dish._id, good.id)
  assert.equal((await call('student1', 'random', { mode: 'unusual' })).dish._id, bad.id)
  const list = await call('student1', 'list')
  assert.equal(list.dishes.length, 2)
  assert.equal(list.dishes[0]._id, good.id)
  assert.equal(list.dishes[0].verdict, '推荐')
  assert.equal(list.dishes[1].verdict, '避雷')
  assert.equal(list.stalls[0].score, 3)
  await call('student1', 'saveReview', { dishId: good.id, score: 4, comment: '改评' })
  assert.equal((await call('student1', 'reviews', { dishId: good.id })).count, 2)
  const badReviews = await call('admin', 'adminCatalog')
  const toHide = badReviews.reviews.find(row => row.dishId === bad.id)
  await call('admin', 'hideReview', { id: toHide._id })
  assert.equal((await call('student1', 'random', { mode: 'unusual' })).dish, null)
  const movedStall = await call('admin', 'saveStall', { name: '第二档口', location: '二楼', status: 'published' })
  assert.equal((await call('admin', 'saveDish', { id: good.id, stallId: movedStall.id, name: '红烧肉', status: 'published' })).success, false)
  // 模拟后续数据维护调整归属；普通管理接口仍保持禁止移动的规则。
  rows('canteen_dishes').get(good.id).stallId = movedStall.id
  const afterMove = await call('student1', 'list')
  assert.equal(afterMove.stalls.find(row => row._id === movedStall.id).score, 4, '移动菜品后评价随当前档口归属')
  const submission = { clientId: 'same-request', stallName: '新档口', location: '一楼东侧', dishName: '番茄面', description: '汤很好喝', price: '8' }
  assert.equal((await call('stranger', 'submit', submission)).success, false)
  const submitted = await call('student1', 'submit', submission)
  assert.equal(submitted.success, true)
  assert.equal((await call('student1', 'submit', submission)).id, submitted.id, '投稿请求幂等')
  assert.equal(rows('canteen_submissions').size, 1)
  assert.equal((await call('student2', 'mySubmissions')).submissions.length, 0, '投稿记录只属于本人')
  assert.equal((await call('student1', 'moderateSubmission', { id: submitted.id, status: 'approved' })).success, false)
  assert.equal((await call('student1', 'list')).dishes.some(row => row.name === '番茄面'), false, '待审核不公开')
  assert.equal((await call('admin', 'moderateSubmission', { id: submitted.id, status: 'approved' })).success, true)
  await call('admin', 'moderateSubmission', { id: submitted.id, status: 'approved' })
  assert.equal([...rows('canteen_dishes').values()].filter(row => row.submissionId === submitted.id).length, 1, '重复审核不重复发布')
  const approved = (await call('student1', 'list')).dishes.find(row => row.name === '番茄面')
  assert.equal(approved.count, 0, '投稿说明不伪造评分')
  rows('global_settings').set('settings', { modules: { canteen: { enabled: false } } })
  assert.equal((await call('student1', 'list')).success, false)
  assert.equal((await call('admin', 'adminCatalog')).success, true)
  console.log('canteen review tests passed')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
