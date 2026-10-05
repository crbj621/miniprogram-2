'use strict'

// Default: memory. --database: a named disposable database only; caller removes the test database.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { AsyncLocalStorage } = require('node:async_hooks')
const databaseMode = process.argv.includes('--database')
if (databaseMode && !/^campus_english_(test|review)_[A-Za-z0-9_]+$/.test(process.env.DB_NAME || '')) throw new Error('Rewards database regression requires disposable campus_english_test_* or campus_english_review_* database')
const { createService } = require('../services/english_learning')
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const key = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex')
let checks = 0, writeFailure = null
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++ }
function check(value, label) { assert.ok(value, label); checks++ }

function memoryCloud() {
  const context = new AsyncLocalStorage()
  let tables = new Map(), queue = Promise.resolve()
  const table = name => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name) }
  function collection(name, where = {}) {
    return {
      where: query => collection(name, query),
      get: async () => ({ data: [...table(name).entries()].map(([id, value]) => ({ ...clone(value), _id: id })).filter(row => Object.entries(where).every(([field, expected]) => expected && expected.__in ? expected.__in.includes(row[field]) : row[field] === expected)) }),
      doc(id) {
        return {
          get: async () => ({ data: clone(table(name).get(id) || null) }),
          set: async ({ data }) => { table(name).set(id, clone({ ...data, _id: id })); return { _id: id } },
          create: async ({ data }) => { if (table(name).has(id)) throw new Error('Duplicate fixture'); table(name).set(id, clone({ ...data, _id: id })); return { _id: id } },
          remove: async () => table(name).delete(id)
        }
      }
    }
  }
  const db = { command: { in: values => ({ __in: values }) }, collection,
    async runTransaction(callback) {
      let release
      const previous = queue
      queue = new Promise(resolve => { release = resolve })
      await previous
      const snapshot = clone([...tables].map(([name, values]) => [name, [...values]]))
      try { const result = await callback(); if (result && result.success === false) tables = new Map(snapshot.map(([name, values]) => [name, new Map(values)])); return result }
      catch (error) { tables = new Map(snapshot.map(([name, values]) => [name, new Map(values)])); throw error }
      finally { release() }
    }
  }
  return { database: () => db, getWXContext: () => ({ OPENID: context.getStore()?.openid || '' }), __runWithContext: (value, callback) => context.run(value, callback) }
}

const sdk = databaseMode ? require('campus-server-sdk') : memoryCloud(), db = sdk.database()
const guardedDb = { ...db, collection(name) {
  const collection = db.collection(name), doc = collection.doc.bind(collection)
  collection.doc = id => {
    const reference = doc(id), set = reference.set.bind(reference)
    reference.set = async value => { if (writeFailure === name) { writeFailure = null; throw new Error('Injected wallet write failure') } return set(value) }
    return reference
  }
  return collection
} }
const guardedSdk = { ...sdk, database: () => guardedDb }
const source = { content: () => ({ words: [], questions: [], papers: [] }), pastExams: () => [], shop: () => ({ assets: {}, items: [{ id: 'test-accessory', category: 'accessory', character: 'all', price: 3 }] }) }
let now = new Date('2031-07-01T01:00:00Z')
const service = createService({ cloud: guardedSdk, source, clock: () => new Date(now) })
const date = () => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10)
const image = name => (process.env.PUBLIC_BASE_URL || 'https://www.crbuj.icu/campus-api').replace(/\/$/, '') + '/uploads/' + name + '.jpg'
const call = (openid, action, input = {}) => sdk.__runWithContext({ openid }, () => service.main({ action, ...input }))
async function good(openid, action = 'campusRewards', input) { const result = await call(openid, action, input); assert.equal(result.success, true, action + ': ' + result.msg); return result.data }
async function set(name, id, value) { return db.collection(name).doc(id).set({ data: value }) }
async function get(name, id) { return (await db.collection(name).doc(id).get()).data }
async function rows(name) { return (await db.collection(name).get()).data }
const task = (rewards, id) => rewards.tasks.find(item => item.id === id)
async function runRecord(openid, id, distance, extra = {}) { await set('runRecords', id, { openid, date: date(), distance, duration: Math.max(600, distance / 3), rankEligible: true, ...extra }) }
async function review(openid, id, extra = {}) { await set('canteen_reviews', id, { openid, dishId: 'dish', status: 'visible', score: 5, images: [], createdAt: now.toISOString(), ...extra }) }
async function post(openid, id, extra = {}) { await set('forum_post', id, { _openid: openid, status: 'normal', imgList: [], createTime: now.toISOString(), ...extra }) }
async function comment(openid, id, extra = {}) { await set('forum_comment', id, { _openid: openid, postId: 'post', status: 'normal', content: 'An actual campus comment', createTime: now.toISOString(), ...extra }) }

async function run() {
  if (databaseMode) {
    await sdk.__ensureSchema()
    const collections = ['global_settings', 'runRecords', 'canteen_stalls', 'canteen_dishes', 'canteen_reviews', 'canteen_review_likes', 'forum_post', 'forum_comment', 'forum_like', 'english_profiles', 'english_daily', 'english_coin_ledger']
    for (const name of collections) equal((await rows(name)).length, 0, 'Disposable database business collection must be empty: ' + name)
  }
  const modules = { english: { enabled: false }, running: { enabled: true }, canteen: { enabled: true }, forum: { enabled: true } }
  await set('global_settings', 'settings', { modules })
  await set('canteen_stalls', 'stall', { status: 'published' })
  await set('canteen_dishes', 'dish', { status: 'published', stallId: 'stall' })
  await post('publisher', 'post')
  check(!(await call('', 'campusRewards')).success, 'Reward wallet requires login')
  const initial = await good('runner')
  equal([initial.coins, initial.runGoalKm], [0, 3], 'Fresh wallet starts at zero and daily GPS goal is 3km')
  equal(task(initial, 'running').reward, 10, 'Daily GPS run reward is 10 coins')
  equal(task(initial, 'comment').reward, 3, 'Daily first comment reward is 3 coins')
  equal(task(initial, 'photo').reward, 2, 'Daily first photo reward is 2 coins')
  check(!(await call('runner', 'setCampusRunGoal', { goalKm: 0.1 })).success, 'Too small daily goal rejected')
  check(!(await call('runner', 'setCampusRunGoal', { goalKm: 21 })).success, 'Too large daily goal rejected')
  equal((await good('planner', 'setCampusRunGoal', { goalKm: 4 })).runGoalKm, 4, 'Goal can change today before any valid run')

  await good('closed-run-plan', 'setCampusRunGoal', { goalKm: 3 })
  await runRecord('closed-run-plan', 'closed-running-gps', 1000)
  modules.running.enabled = false
  await set('global_settings', 'settings', { modules })
  const closedGoal = await good('closed-run-plan', 'setCampusRunGoal', { goalKm: 0.5 })
  equal([closedGoal.runGoalKm, closedGoal.pendingRunGoal.goalKm, closedGoal.pendingRunGoal.appliesOn], [3, 0.5, '2031-07-02'], 'Existing GPS freezes today goal even while running module is disabled')
  check(closedGoal.runGoalFrozen && !task(closedGoal, 'running').available, 'Closed running task keeps goal frozen and entrance unavailable')
  modules.running.enabled = true
  await set('global_settings', 'settings', { modules })
  equal((await good('closed-run-plan')).coins, 0, 'Reopening running cannot award against prematurely lowered goal')
  await runRecord('closed-run-plan', 'closed-running-rest', 2000)
  equal((await good('closed-run-plan')).coins, 10, 'Reopened running still settles only after original today goal is reached')

  await runRecord('runner', 'run-a', 1400)
  await runRecord('runner', 'estimated', 9000, { rankEligible: false })
  await runRecord('runner', 'impossible', 40000, { duration: 100 })
  await runRecord('runner', 'negative', -100)
  await runRecord('someone-else', 'other-run', 5000)
  await runRecord('runner', 'previous-run', 5000, { date: '2031-06-30' })
  const partial = await good('runner')
  equal(partial.coins, 0, 'Estimated, invalid, other-user and other-day runs cannot award')
  equal(task(partial, 'running').progress, 1.4, 'Only valid current GPS records count in kilometres')
  check(partial.runGoalFrozen, 'First valid GPS record freezes today goal before completion')
  const pending = await good('runner', 'setCampusRunGoal', { goalKm: 5 })
  equal([pending.runGoalKm, pending.pendingRunGoal.goalKm, pending.pendingRunGoal.appliesOn], [3, 5, '2031-07-02'], 'Goal changes after valid run apply next Beijing day')
  await runRecord('runner', 'run-b', 1600)
  const runningReward = await good('runner', 'claimCampusRewards')
  equal([runningReward.coins, runningReward.coinsEarned], [10, 10], 'Two valid GPS runs accumulate to the daily goal')
  equal((await good('runner', 'claimCampusRewards')).coinsEarned, 0, 'Repeated explicit claim cannot duplicate running reward')
  check(task(runningReward, 'running').rewarded, 'Server marks daily running reward claimed')

  await review('rating-only', 'only-rating')
  equal((await good('rating-only')).coins, 3, 'A valid rating without optional text earns first daily rating reward')
  await review('social', 'rating-a', { images: [image('a')], imagesAddedAt: now.toISOString() })
  await review('social', 'rating-b', { images: [image('b')], imagesAddedAt: now.toISOString() })
  await comment('social', 'comment-a')
  await post('social', 'photo-post', { imgList: [image('forum')] })
  const social = await good('social')
  equal(social.coins, 5, 'Multiple ratings/comments/photos still grant first daily comment and photo once')
  equal([task(social, 'comment').earned, task(social, 'photo').earned], [3, 2], 'Task DTO reports actually credited coins')
  equal((await good('social')).coins, 5, 'Automatic reward sync is idempotent')

  await review('hidden', 'hidden-review', { status: 'hidden', images: [image('hidden')] })
  await comment('hidden', 'hidden-comment', { status: 'deleted' })
  await post('hidden', 'hidden-post', { status: 'deleted', imgList: [image('hidden')] })
  await set('canteen_dishes', 'draft-dish', { status: 'draft', stallId: 'stall' })
  await review('hidden', 'unpublished-dish', { dishId: 'draft-dish', images: [image('hidden')] })
  await post('publisher', 'deleted-parent', { status: 'deleted' })
  await comment('hidden', 'deleted-parent-comment', { postId: 'deleted-parent' })
  equal((await good('hidden')).coins, 0, 'Hidden/deleted content and unpublished parents cannot generate rewards')

  await comment('liked', 'liked-comment', { createTime: '2031-06-01T01:00:00Z' })
  await set('forum_like', 'self-like', { _openid: 'liked', commentId: 'liked-comment', createTime: now.toISOString() })
  equal((await good('liked')).coins, 0, 'Self comment likes never generate coins')
  for (let i = 0; i < 7; i++) await set('forum_like', 'like-' + i, { _openid: 'peer-' + i, commentId: 'liked-comment', createTime: now.toISOString() })
  const capped = await good('liked')
  equal(capped.coins, 5, 'Nonself likes earn one each with daily cap of five')
  equal(task(capped, 'like').earned, 5, 'Like task shows exact daily credited cap')
  equal((await good('liked')).coins, 5, 'Repeated like sync cannot pay same relationship twice')
  await review('review-liked', 'old-review', { createdAt: '2031-06-01T01:00:00Z' })
  await set('canteen_review_likes', 'review-self-like', { openid: 'review-liked', reviewId: 'old-review', createdAt: now.toISOString() })
  await set('canteen_review_likes', 'review-peer-like', { openid: 'peer', reviewId: 'old-review', createdAt: now.toISOString() })
  equal((await good('review-liked')).coins, 1, 'Dish review peer likes share wallet and exclude self')

  await runRecord('parallel', 'parallel-run', 3000)
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => good('parallel', 'claimCampusRewards')))
  equal(concurrent.reduce((total, result) => total + result.coinsEarned, 0), 10, 'Eight queued concurrent claims settle exactly once')
  equal((await good('parallel')).coins, 10, 'Concurrent claims preserve exact wallet balance')
  const trade = await Promise.all([good('parallel', 'claimCampusRewards'), good('parallel', 'buyItem', { itemId: 'test-accessory', requestId: 'parallel-buy' })])
  equal(trade[1].coins, 7, 'Reward claiming and buying serialize against the shared wallet')

  await good('rollback', 'setCampusRunGoal', { goalKm: 3 })
  await runRecord('rollback', 'rollback-run', 3000)
  // Existing transaction write is the last wallet mutation, after reward or purchase ledger creation.
  const beforeRollback = await get('english_profiles', key('rollback'))
  const beforeLedger = (await rows('english_coin_ledger')).filter(row => row.openid === 'rollback')
  writeFailure = 'english_profiles'
  check(!(await call('rollback', 'claimCampusRewards')).success, 'Injected wallet save failure rejects reward transaction')
  equal(await get('english_profiles', key('rollback')), beforeRollback, 'Reward transaction failure restores profile')
  equal((await rows('english_coin_ledger')).filter(row => row.openid === 'rollback'), beforeLedger, 'Reward failure rolls back ledger as well as wallet')
  await good('rollback')
  const beforePurchase = await get('english_profiles', key('rollback'))
  const purchaseLedger = (await rows('english_coin_ledger')).filter(row => row.openid === 'rollback')
  writeFailure = 'english_profiles'
  check(!(await call('rollback', 'buyItem', { itemId: 'test-accessory', requestId: 'failing-buy' })).success, 'Injected wallet save failure rejects purchase transaction')
  equal(await get('english_profiles', key('rollback')), beforePurchase, 'Failed purchase cannot deduct balance or create ownership')
  equal((await rows('english_coin_ledger')).filter(row => row.openid === 'rollback'), purchaseLedger, 'Failed purchase rolls back purchase ledger')

  now = new Date('2031-07-02T01:00:00Z')
  equal((await good('runner')).runGoalKm, 5, 'Pending daily running goal becomes active next day')
  await runRecord('runner', 'tomorrow-short', 4000)
  equal((await good('runner')).coins, 10, 'Yesterday reward does not make a short next-day run qualify')
  await runRecord('runner', 'tomorrow-rest', 1000)
  equal((await good('runner')).coins, 20, 'New day can earn its independent running reward')
  await db.collection('forum_like').doc('like-0').remove()
  await set('forum_like', 'recreated-like', { _openid: 'peer-0', commentId: 'liked-comment', createTime: now.toISOString() })
  equal((await good('liked')).coins, 5, 'Unlike and relike with a new row ID on another day cannot repay same person/comment')
  await set('forum_like', 'new-day-like', { _openid: 'new-peer', commentId: 'liked-comment', createTime: now.toISOString() })
  equal((await good('liked')).coins, 6, 'A genuinely new relationship can earn next-day coin')
  await review('late-photo', 'old-photo-less-review', { createdAt: '2031-07-01T01:00:00Z', images: [image('new-today')], imagesAddedAt: now.toISOString() })
  equal((await good('late-photo')).coins, 2, 'Adding first photo to an older valid rating counts on actual upload day')
  check(!(await call('runner', 'home')).success, 'English remains closed in these fixtures')
  check((await call('runner', 'campusRewards')).success, 'Campus reward wallet stays available while English learning is closed')
  console.log('Campus rewards ' + (databaseMode ? 'real MariaDB' : 'isolated memory') + ' regression passed: ' + checks + ' checks')
}

run().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { if (databaseMode) await sdk.__getPool().end() })
