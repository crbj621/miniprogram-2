'use strict'

const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { campusSnapshot, settleCampusRewards } = require('../server/src/campus-rewards')

const collections = new Map()
let currentOpenid = 'admin'
let nextId = 1
let failLikeRemoval = false
const transactionOptions = [], transactionQueues = new Map()

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
        expected && expected.neq !== undefined ? row[key] !== expected.neq : expected && expected.in ? expected.in.includes(row[key]) : row[key] === expected))
      return { data: matches.slice(offset, offset + size) }
    },
    async remove() {
      if (name === 'canteen_review_likes' && failLikeRemoval) { failLikeRemoval = false; throw new Error('Injected like cleanup failure') }
      const matches = (await query(name, filters).get()).data
      for (const row of matches) rows(name).delete(row._id)
      return { stats: { removed: matches.length } }
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
        async remove() { rows(name).delete(id) },
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
  database: () => ({ command: { neq: value => ({ neq: value }), in: value => ({ in: value }) }, collection: name => query(name),
    async runTransaction(callback, options = {}) {
      transactionOptions.push(options)
      const key = options.lock || 'unlocked'
      const previous = transactionQueues.get(key) || Promise.resolve()
      let release
      transactionQueues.set(key, new Promise(resolve => { release = resolve }))
      await previous
      const snapshot = JSON.parse(JSON.stringify([...collections].map(([name, table]) => [name, [...table]])))
      const rollback = () => { collections.clear(); for (const [name, table] of snapshot) collections.set(name, new Map(table)) }
      try { const result = await callback(); if (result && result.success === false) rollback(); return result }
      catch (error) { rollback(); throw error }
      finally { release() }
    },
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
  for (const openid of ['student1', 'student2', 'owner', 'liker', 'another', 'legacy']) rows('users').set(openid, { openid, nickName: openid, avatarUrl: 'https://www.crbuj.icu/campus-api/uploads/avatar-' + openid + '.png' })
  rows('canteen_stalls').set('old-stall', { _id: 'old-stall', name: '历史档口', location: '一楼', status: 'published' })
  rows('canteen_dishes').set('old-dish', { _id: 'old-dish', name: '历史菜品', stallId: 'old-stall', status: 'published' })
  rows('canteen_reviews').set('old-review', { _id: 'old-review', dishId: 'old-dish', stallId: 'old-stall', openid: 'legacy', score: 4, comment: '历史评价', status: 'visible', createdAt: '2020-01-01T01:00:00Z' })
  const migrated = await call('legacy', 'reviews', { dishId: 'old-dish' })
  assert.equal(migrated.count, 1); assert.equal(migrated.score, 4); assert.equal(migrated.myRating.score, 4)
  assert.match(migrated.reviews[0].avatarUrl, /avatar-legacy/)
  assert.equal((await call('student1', 'init')).success, false)
  assert.equal((await call('admin', 'init')).success, true)
  const stall = await call('admin', 'saveStall', { name: '一食堂 A 档口', location: '一楼', status: 'published' })
  assert.equal(stall.success, true)
  const good = await call('admin', 'saveDish', { stallId: stall.id, name: '红烧肉', status: 'published', meals: ['lunch', 'dinner'] })
  const bad = await call('admin', 'saveDish', { stallId: stall.id, name: '黑暗料理', status: 'published' })
  await call('admin', 'saveDish', { stallId: stall.id, name: '未发布菜', status: 'draft' })
  assert.equal((await call('student1', 'saveDish', { stallId: stall.id, name: '伪造菜' })).success, false)
  const post = (dishId, score, comment, clientId, images = []) => ({ dishId, ...(score == null ? {} : { score }), comment, clientId, images })
  assert.equal((await call('stranger', 'saveReview', post(good.id, 5, '好吃', 'unauthorized'))).success, false)
  assert.equal((await call('student1', 'saveReview', post(good.id, 6, '好吃', 'bad-score'))).success, false)
  assert.equal((await call('student1', 'saveReview', { dishId: good.id, score: 0, comment: '旧版仍需选择分数' })).success, false)
  const first = await call('student1', 'saveReview', post(good.id, 5, '好吃', 'first'))
  assert.equal(first.success, true)
  assert.equal((await call('student1', 'saveReview', post(good.id, 5, '好吃', 'first'))).id, first.id, 'retry creates only one comment')
  assert.equal((await call('student1', 'saveReview', post(good.id, 1, '不同内容', 'first'))).success, false, 'same request id cannot replace content')
  assert.equal((await call('student1', 'random', { mode: 'quality' })).dish, null)
  await call('student2', 'saveReview', post(good.id, 4, '不错', 'second'))
  await call('student1', 'saveReview', post(bad.id, 1, '不好吃', 'bad-first'))
  await call('student2', 'saveReview', post(bad.id, 2, '不推荐', 'bad-second'))
  assert.equal((await call('student1', 'random', { mode: 'quality' })).dish._id, good.id)
  assert.equal((await call('student1', 'random', { mode: 'unusual' })).dish._id, bad.id)
  const revised = await call('student1', 'saveReview', post(good.id, 2, '今天偏咸，更新评分', 'revision'))
  await call('student1', 'saveReview', post(good.id, null, '交流不打分', 'chat'))
  const overview = await call('student1', 'reviews', { dishId: good.id })
  assert.equal(overview.reviews.length, 4); assert.equal(overview.count, 2); assert.equal(overview.score, 3); assert.equal(overview.myRating.score, 2)
  assert.equal(overview.reviews.find(row => row._id === revised.id).latestRating, true)
  assert.equal(overview.reviews.find(row => row._id === first.id).latestRating, false)
  assert.equal(overview.reviews.find(row => row.comment === '交流不打分').score, null)
  assert.equal(Object.hasOwn(overview.reviews[0], 'openid'), false)
  assert.equal((await call('student1', 'deleteReview', { reviewId: revised.id })).success, true)
  const retained = await call('student1', 'reviews', { dishId: good.id })
  assert.equal(retained.score, 3); assert.equal(retained.count, 2); assert.equal(retained.myRating.score, 2, 'deleting a comment retains latest independent score')
  assert.equal((await call('student1', 'saveReview', post(good.id, 2, '今天偏咸，更新评分', 'revision'))).success, false, 'deleted id cannot be restored')
  await legacyClients()
  await reviewControls(stall.id, post)
  await submissionControls(stall.id, post)
  await disputeControls(stall.id, post)
  rows('global_settings').set('settings', { modules: { canteen: { enabled: false } } })
  for (const action of ['list', 'saveReview', 'deleteReview', 'voteReview', 'submit', 'checkStall', 'updateSubmission', 'deleteSubmission']) assert.equal((await call('student1', action, {})).success, false, 'module gate: ' + action)
  assert.equal((await call('admin', 'adminCatalog')).success, true)
  assert.ok(transactionOptions.every(options => options.lock === 'canteen:write' && options.readCommitted === true), 'related writes and migration share the transaction lock')
  console.log('食堂回归通过：历史评分、最新单人评分、多评论／头像、删除／点赞／奖励、投稿查重／修改／补图、餐次及争议恢复')
}

async function legacyClients() {
  const stall = await call('admin', 'saveStall', { name: '旧版兼容档口', location: '三楼', status: 'published' })
  const dish = await call('admin', 'saveDish', { stallId: stall.id, name: '旧版兼容菜品', status: 'published' })
  const image = 'https://www.crbuj.icu/campus-api/uploads/legacy-photo.png'
  const firstPayload = { dishId: dish.id, score: 5, comment: '旧版首次发表', images: [image] }
  const first = await call('owner', 'saveReview', firstPayload)
  assert.equal(first.success, true, 'published old clients submit without clientId')
  assert.equal((await call('owner', 'saveReview', firstPayload)).id, first.id, 'old identical retry reuses current comment')
  const changed = { ...firstPayload, score: 2, comment: '旧版修改体验' }
  const concurrent = await Promise.all([call('owner', 'saveReview', changed), call('owner', 'saveReview', changed)])
  assert.ok(concurrent.every(row => row.success)); assert.equal(concurrent[0].id, concurrent[1].id)
  let overview = await call('owner', 'reviews', { dishId: dish.id })
  assert.equal(overview.reviewCount, 2); assert.equal(overview.count, 1); assert.equal(overview.myRating.score, 2)
  const repeated = await call('owner', 'saveReview', firstPayload)
  assert.equal(repeated.success, true); assert.notEqual(repeated.id, first.id, 'A to B to A updates latest score')
  assert.equal((await call('owner', 'reviews', { dishId: dish.id })).myRating.score, 5)
  const modern = await call('owner', 'saveReview', { ...firstPayload, clientId: 'modern-after-legacy', score: 3, comment: '新版更新' })
  assert.equal(modern.success, true)
  const oldAgain = await call('owner', 'saveReview', firstPayload)
  assert.equal(oldAgain.success, true); assert.notEqual(oldAgain.id, repeated.id)
  assert.equal((await call('owner', 'reviews', { dishId: dish.id })).myRating.score, 5)
  assert.equal((await call('owner', 'saveReview', { dishId: dish.id, comment: '旧契约必须选分' })).success, false)
  const chat = await call('owner', 'saveReview', { dishId: dish.id, clientId: 'modern-chat-compatible', comment: '新版仍可只交流' })
  assert.equal(chat.success, true)
  assert.equal((await call('owner', 'saveReview', firstPayload)).id, oldAgain.id, 'modern chat does not create duplicate legacy rating')
  const migratedRetry = await call('legacy', 'saveReview', { dishId: 'old-dish', score: 4, comment: '历史评价' })
  assert.equal(migratedRetry.success, true); assert.equal(migratedRetry.id, 'old-review', 'legacy migration without requestHash supports retry')
  const liked = await call('liker', 'likeReview', { reviewId: oldAgain.id })
  assert.equal(liked.success, true); assert.equal(liked.isLiked, true)
  assert.equal((await call('another', 'deleteReview', { reviewId: oldAgain.id })).success, false)
  await call('owner', 'deleteReview', { reviewId: oldAgain.id })
  const afterDelete = await call('owner', 'saveReview', firstPayload)
  assert.equal(afterDelete.success, true); assert.notEqual(afterDelete.id, oldAgain.id)
  assert.equal(rows('canteen_reviews').get(oldAgain.id).status, 'deleted', 'old resend never revives deleted record')
  await call('admin', 'hideReview', { id: afterDelete.id })
  const before = JSON.stringify([...rows('canteen_reviews')])
  assert.equal((await call('owner', 'saveReview', { ...changed, comment: '旧版不能绕过隐藏' })).success, false)
  assert.equal(JSON.stringify([...rows('canteen_reviews')]), before, 'blocked legacy score leaves database unchanged')
}

async function reviewControls(stallId, post) {
  const dish = await call('admin', 'saveDish', { stallId, name: '评论管理回归菜', status: 'published' })
  const image = 'https://www.crbuj.icu/campus-api/uploads/owner-review.jpg'
  const owner = await call('owner', 'saveReview', post(dish.id, 5, '带图评价', 'owner-original', [image]))
  const other = await call('another', 'saveReview', post(dish.id, 3, '另一位同学', 'another-original'))
  assert.equal((await call('owner', 'saveReview', post(dish.id, null, '外链', 'invalid-picture', ['https://example.org/a.jpg']))).success, false)
  for (const id of [owner.id, other.id]) rows('canteen_reviews').get(id).updatedAt = id === owner.id ? '2020-01-01T01:00:00Z' : '2030-01-01T01:00:00Z'
  assert.equal((await call('owner', 'reviews', { dishId: dish.id, sort: 'latest' })).reviews[0]._id, other.id)
  assert.equal((await call('stranger', 'likeReview', { reviewId: owner.id })).success, false)
  assert.equal((await call('owner', 'likeReview', { reviewId: owner.id })).success, false, 'self feedback is rejected')
  assert.deepEqual(await call('liker', 'likeReview', { reviewId: owner.id }), { success: true, isLiked: true, likeCount: 1 })
  await call('another', 'likeReview', { reviewId: owner.id })
  rows('canteen_review_likes').set('duplicate-like', { _id: 'duplicate-like', reviewId: owner.id, openid: 'liker', createdAt: '2020-01-01T01:00:00Z' })
  rows('canteen_review_likes').set('invalid-like', { _id: 'invalid-like', reviewId: owner.id, openid: '' })
  const hot = await call('owner', 'reviews', { dishId: dish.id, sort: 'hot' })
  assert.equal(hot.reviews[0]._id, owner.id); assert.equal(hot.reviews[0].likeCount, 2)
  assert.equal((await call('owner', 'reviews', { dishId: dish.id, sort: 'invalid' })).sort, 'latest')
  for (const who of ['stranger', 'liker', 'admin']) assert.equal((await call(who, 'deleteReview', { reviewId: owner.id })).success, false)
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), db = cloud.database(), profile = { openid: 'owner', coins: 0, campusRunPlan: { goalKm: 3 } }
  const day = { date: today, rewards: { runningReward: 10, commentReward: 3, photoReward: 2, likeReward: 1, likeDailyCap: 10 } }
  const claim = async () => settleCampusRewards({ db, get: async (name, id) => (await db.collection(name).doc(id).get()).data, profile, day, snapshot: await campusSnapshot(db, 'owner', today), now: new Date().toISOString() })
  assert.equal((await claim()).coinsEarned, 7)
  failLikeRemoval = true
  assert.equal((await call('owner', 'deleteReview', { reviewId: owner.id })).success, false)
  assert.equal(rows('canteen_reviews').get(owner.id).status, 'visible', 'failed cleanup rolls back delete')
  assert.equal((await call('owner', 'deleteReview', { reviewId: owner.id })).success, true)
  assert.equal((await call('owner', 'deleteReview', { reviewId: owner.id })).success, true)
  assert.equal([...rows('canteen_review_likes').values()].some(row => row.reviewId === owner.id), false)
  assert.equal((await call('owner', 'reviews', { dishId: dish.id })).score, 4)
  const replacement = await call('owner', 'saveReview', post(dish.id, null, '新的交流', 'new-chat', [image]))
  assert.notEqual(replacement.id, owner.id)
  assert.equal((await claim()).coinsEarned, 0, 'multiple comments and photos cannot duplicate daily task reward')
  const concurrent = await Promise.all([call('owner', 'deleteReview', { reviewId: replacement.id }), call('another', 'likeReview', { reviewId: replacement.id })])
  assert.equal(concurrent[0].success, true)
  assert.equal([...rows('canteen_review_likes').values()].some(row => row.reviewId === replacement.id), false)
  const hidden = await call('owner', 'saveReview', post(dish.id, 4, '审核测试', 'hide-me', [image]))
  await Promise.all([call('admin', 'hideReview', { id: hidden.id }), call('owner', 'saveReview', post(dish.id, 4, '审核测试', 'hide-me', [image]))])
  assert.equal(rows('canteen_reviews').get(hidden.id).status, 'hidden')
  assert.equal((await call('owner', 'deleteReview', { reviewId: hidden.id })).success, true, 'owner can delete hidden text without restoring its rating')
  assert.equal((await call('owner', 'reviews', { dishId: dish.id })).myRating.status, 'hidden')
}

async function submissionControls(stallId, post) {
  const base = { kind: 'dish', stallName: '香香Ａ面馆', location: '一食堂 二楼 ３号窗口', dishName: '番茄面', description: '汤很好喝', price: '8', meals: ['lunch', 'dinner'] }
  assert.equal((await call('stranger', 'submit', { ...base, clientId: 'unauth' })).success, false)
  const requests = await Promise.all([call('student1', 'submit', { ...base, clientId: 'discovery-1' }),
    call('student2', 'submit', { ...base, stallName: '香香a 面馆', location: '一食堂二楼3号窗口', clientId: 'discovery-2' })])
  assert.ok(requests.every(row => row.success)); assert.equal(requests[0].stallId, requests[1].stallId); assert.equal(requests[0].dishId, requests[1].dishId, 'concurrent canonical dish reuse')
  const original = requests[0], image = 'https://www.crbuj.icu/campus-api/uploads/stall-original.jpg', secondImage = 'https://www.crbuj.icu/campus-api/uploads/stall-new.jpg'
  assert.equal((await call('student1', 'submit', { ...base, clientId: 'discovery-1' })).id, original.id)
  assert.equal((await call('student1', 'checkStall', { stallName: '香香a面馆', location: '一食堂二楼3号窗口' })).exists, true)
  const elsewhere = await call('student2', 'submit', { ...base, clientId: 'elsewhere', location: '二食堂一楼' })
  assert.notEqual(elsewhere.stallId, original.stallId, 'same name at another location remains separate')
  const suggestions = await call('student1', 'checkStall', { stallName: '香香', location: '待确认的位置' })
  assert.equal(suggestions.exists, false); assert.ok(suggestions.candidates.length >= 2, 'partial names only suggest, never auto merge')
  assert.equal((await call('admin', 'saveStall', { name: '香香a面馆', location: '一食堂二楼3号窗口', status: 'published' })).success, false, 'admin shares duplicate guard')
  assert.equal((await call('admin', 'saveDish', { stallId: original.stallId, name: '番茄 面', status: 'published' })).success, false)
  await call('student2', 'saveReview', post(original.dishId, 4, '保留这条评价', 'shared-review'))
  const revised = { id: original.id, dishName: '番茄面', description: '新增实拍和说明', price: 9, image, meals: ['lunch', 'dinner'] }
  assert.equal((await call('student2', 'updateSubmission', revised)).success, false, 'other contributor cannot edit original contribution')
  assert.equal((await call('student1', 'updateSubmission', revised)).success, true)
  assert.equal(rows('canteen_dishes').get(original.dishId).image, image)
  assert.equal((await call('student1', 'reviews', { dishId: original.dishId })).count, 1)
  assert.equal((await call('student1', 'updateSubmission', { ...revised, dishName: '番茄鸡蛋面', image: secondImage })).success, true)
  assert.equal((await call('student1', 'reviews', { dishId: original.dishId })).dish.name, '番茄鸡蛋面', 'rename keeps same id and reviews')
  assert.equal((await call('student1', 'deleteSubmission', { id: requests[1].id })).success, false)
  assert.equal((await call('student1', 'deleteSubmission', { id: original.id })).success, true)
  assert.equal(rows('canteen_dishes').get(original.dishId).status, 'published', 'other contributions and ratings retain the catalog')
  assert.equal(rows('canteen_dishes').get(original.dishId).image, '', 'deleted owner photo removed from shared catalog')
  const stallOnly = await call('student1', 'submit', { kind: 'stall', clientId: 'stall-only', stallName: '早餐小铺', location: '一食堂北门', description: '', meals: ['breakfast'] })
  assert.equal(stallOnly.success, true); assert.equal(stallOnly.dishId, '')
  assert.equal((await call('student1', 'list', { meal: 'lunch' })).stalls.some(row => row._id === stallOnly.stallId), false)
  const photo1 = await call('student1', 'submit', { kind: 'photo', clientId: 'photo-1', stallId: stallOnly.stallId, image, description: '早餐窗口实拍' })
  const photo2 = await call('student2', 'submit', { kind: 'photo', clientId: 'photo-2', stallId: stallOnly.stallId, image: secondImage })
  assert.equal(photo1.success, true); assert.equal(photo2.success, true)
  assert.equal(rows('canteen_stalls').get(stallOnly.stallId).image, image, 'first photo fills empty cover, later photo does not overwrite')
  assert.equal((await call('student1', 'detail', { stallId: stallOnly.stallId })).photos.length, 2)
  assert.equal((await call('student1', 'setStallCover', { id: photo2.id })).success, false)
  assert.equal((await call('admin', 'setStallCover', { id: photo2.id })).success, true)
  assert.equal(rows('canteen_stalls').get(stallOnly.stallId).image, secondImage)
  await call('student2', 'deleteSubmission', { id: photo2.id })
  assert.equal(rows('canteen_stalls').get(stallOnly.stallId).image, image, 'deleting current cover falls back to remaining contribution')
  assert.equal((await call('admin', 'setStallCover', { id: photo2.id })).success, false, 'deleted photos cannot be restored')
  await call('student1', 'deleteSubmission', { id: photo1.id })
  await call('student1', 'deleteSubmission', { id: stallOnly.id })
  assert.equal((await call('student1', 'list')).stalls.some(row => row._id === stallOnly.stallId), false, 'empty unshared own stall is withdrawn')
  const revived = await call('student1', 'submit', { kind: 'stall', clientId: 'stall-revived', stallName: '早餐小铺', location: '一食堂北门', meals: ['breakfast'] })
  assert.equal(revived.stallId, stallOnly.stallId, 'withdrawn canonical entity can be safely reused')
  await call('admin', 'saveStall', { id: revived.stallId, name: '早餐新店名', location: '一食堂北门', status: 'published' })
  const different = await call('student1', 'submit', { kind: 'stall', clientId: 'reuse-old-name', stallName: '早餐小铺', location: '一食堂北门', meals: ['breakfast'] })
  assert.notEqual(different.stallId, revived.stallId, 'renaming cannot cause a natural-key id overwrite')
  assert.equal(rows('canteen_stalls').get(revived.stallId).name, '早餐新店名')
  const breakfast = await call('admin', 'saveDish', { stallId, name: '早餐包子', status: 'published', meals: ['breakfast'] })
  await call('student1', 'saveReview', post(breakfast.id, 5, '早餐评价', 'breakfast-review'))
  const breakfastList = await call('student1', 'list', { meal: 'breakfast' }), lunchList = await call('student1', 'list', { meal: 'lunch' })
  assert.equal(breakfastList.dishes.some(row => row._id === breakfast.id), true)
  assert.equal(lunchList.dishes.some(row => row._id === breakfast.id), false)
  for (let i = 0; i < 10; i++) assert.equal((await call('student1', 'random', { meal: 'breakfast', mode: 'all' })).dish.meals.includes('breakfast'), true)
  const legacyPending = 'pending-legacy'
  const sharedForm = { ...base, stallName: '空档口清理回归', location: '测试一楼', dishName: '临时菜品' }
  const sharedA = await call('student1', 'submit', { ...sharedForm, clientId: 'shared-a' }), sharedB = await call('student2', 'submit', { ...sharedForm, clientId: 'shared-b' })
  await call('student1', 'deleteSubmission', { id: sharedA.id })
  assert.equal(rows('canteen_dishes').get(sharedA.dishId).status, 'published')
  await call('student2', 'deleteSubmission', { id: sharedB.id })
  assert.equal(rows('canteen_dishes').get(sharedA.dishId).status, 'deleted', 'last withdrawal clears orphan created by earlier author')
  assert.equal(rows('canteen_stalls').get(sharedA.stallId).status, 'deleted')
  rows('canteen_submissions').set(legacyPending, { _id: legacyPending, openid: 'student1', ...base, stallName: '早餐新店名', location: '一食堂北门', status: 'pending', createdAt: new Date().toISOString() })
  assert.equal((await call('admin', 'moderateSubmission', { id: legacyPending, status: 'approved' })).success, true)
  assert.equal(rows('canteen_submissions').get(legacyPending).stallId, revived.stallId, 'legacy moderation reuses existing stall too')
  assert.equal((await call('student1', 'mySubmissions')).submissions.some(row => row._id === original.id), false)
}

async function disputeControls(stallId, post) {
  for (let i = 1; i <= 9; i++) rows('users').set('voter' + i, { openid: 'voter' + i, nickName: '反馈人' + i })
  const dish = await call('admin', 'saveDish', { stallId, name: '争议评分菜', status: 'published' })
  const rating = await call('owner', 'saveReview', post(dish.id, 5, '争议测试', 'disputed-score'))
  await call('another', 'saveReview', post(dish.id, 3, '另一位评分', 'other-score'))
  for (let i = 1; i <= 3; i++) await call('voter' + i, 'voteReview', { reviewId: rating.id, vote: 'up' })
  for (let i = 4; i <= 8; i++) await call('voter' + i, 'voteReview', { reviewId: rating.id, vote: 'down' })
  assert.equal((await call('owner', 'reviews', { dishId: dish.id })).count, 2, 'five negatives but below 70 percent does not suspend')
  await call('voter1', 'voteReview', { reviewId: rating.id, vote: 'down' })
  const paused = await call('owner', 'reviews', { dishId: dish.id })
  assert.equal(paused.count, 1); assert.equal(paused.score, 3); assert.equal(paused.myRating.status, 'contested')
  const disputed = paused.reviews.find(row => row._id === rating.id)
  assert.equal(disputed.likeCount, 2); assert.equal(disputed.downCount, 6); assert.equal(disputed.disputed, true)
  assert.equal((await call('voter1', 'reviews', { dishId: dish.id })).reviews.find(row => row._id === rating.id).myVote, 'down')
  assert.equal((await call('owner', 'saveReview', post(dish.id, 5, '不能绕过暂停', 'blocked-score'))).success, false)
  assert.equal((await call('owner', 'saveReview', post(dish.id, null, '核查中仍可交流', 'allowed-chat'))).success, true)
  assert.equal((await call('student1', 'resolveDispute', { id: rating.id, resolution: 'restore' })).success, false)
  assert.equal((await call('admin', 'adminCatalog')).disputes.some(row => row._id === rating.id), true)
  assert.equal((await call('admin', 'resolveDispute', { id: rating.id, resolution: 'restore' })).success, true)
  assert.equal((await call('owner', 'reviews', { dishId: dish.id })).count, 2)
  await call('voter9', 'voteReview', { reviewId: rating.id, vote: 'down' })
  assert.equal((await call('owner', 'reviews', { dishId: dish.id })).myRating.status, 'visible', 'unchanged dispute cannot undo admin restoration')
  const newest = await call('owner', 'saveReview', post(dish.id, 2, '新的体验，更新评分', 'fresh-score'))
  for (let i = 1; i <= 5; i++) await call('voter' + i, 'voteReview', { reviewId: newest.id, vote: 'down' })
  assert.equal((await call('owner', 'reviews', { dishId: dish.id })).myRating.status, 'contested')
  await call('owner', 'deleteReview', { reviewId: newest.id })
  assert.equal((await call('admin', 'adminCatalog')).disputes.find(row => row._id === newest.id).comment, '新的体验，更新评分', 'moderator retains dispute evidence when author deletes public content')
  await call('admin', 'resolveDispute', { id: newest.id, resolution: 'restore' })
  assert.equal(rows('canteen_reviews').get(newest.id).status, 'deleted')
  assert.equal((await call('owner', 'reviews', { dishId: dish.id })).myRating.score, 2)
  const chat = await call('owner', 'saveReview', post(dish.id, null, '纯交流', 'pure-chat'))
  for (let i = 1; i <= 5; i++) await call('voter' + i, 'voteReview', { reviewId: chat.id, vote: 'down' })
  assert.equal((await call('owner', 'reviews', { dishId: dish.id })).myRating.status, 'visible', 'unscored discussion cannot remove someone latest vote')
  for (const who of ['voter1', 'voter2', 'voter3']) await call(who, 'report', { targetType: 'dish', targetId: dish.id, reason: 'inaccurate' })
  await call('voter1', 'report', { targetType: 'dish', targetId: dish.id, reason: 'inaccurate' })
  const report = (await call('admin', 'adminCatalog')).reports.find(row => row.targetId === dish.id)
  assert.equal(report.count, 3)
  await call('admin', 'resolveReport', { id: report.caseId, resolution: 'hide' })
  assert.equal((await call('owner', 'list')).dishes.some(row => row._id === dish.id), false)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
