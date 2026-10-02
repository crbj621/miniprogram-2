const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const cloud = require('campus-server-sdk')
const db = cloud.database()
const admin = require('../services/globalAdmin')
const prefix = 'dashboard-test-' + crypto.randomBytes(6).toString('hex')
const owned = []
const call = () => cloud.__runWithContext({ openid: prefix }, () => admin.main({ action: 'getDashboardStats' }))
async function put(collection, suffix, data) {
  const id = prefix + suffix; owned.push({ collection, id })
  await db.collection(collection).doc(id).create({ data })
}
async function main() {
  assert.notEqual((await call()).code, 0, 'student cannot read dashboard')
  await put('global_admin', '', { loginOpenid: prefix, role: 'admin', status: 'active' })
  const before = (await call()).data
  await put('food_rider', '-rider', { status: 'pending' })
  await put('canteen_submissions', '-submission', { status: 'pending' })
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const chinaMidnight = new Date(today + 'T00:00:00+08:00')
  await put('food_order', '-completed', { status: 'completed', totalPrice: 10.1, createTime: new Date(chinaMidnight.getTime() + 1000) })
  await put('food_order', '-pending', { status: 'pending', totalPrice: 90, createTime: new Date() })
  await put('food_order', '-cancelled', { status: 'cancelled', totalPrice: 99, createTime: new Date() })
  await put('food_order', '-yesterday', { status: 'completed', totalPrice: 78, createTime: new Date(chinaMidnight.getTime() - 1000) })
  const after = (await call()).data
  assert.equal(after.pendingRiders - before.pendingRiders, 1)
  assert.equal(after.pendingCanteen - before.pendingCanteen, 1)
  assert.equal(after.todayOrders - before.todayOrders, 3, 'use Beijing date boundary')
  assert.equal(Math.round((after.todayRevenue - before.todayRevenue) * 100), 1010, 'only completed orders counted, sum cents')
  console.log('Admin dashboard permission/pending riders/submissions/Beijing date/completed revenue passed: 5 checks')
}
main().finally(async () => {
  for (const row of owned) await db.collection(row.collection).doc(row.id).remove()
  await cloud.__getPool().end()
}).catch(error => { console.error(error); process.exitCode = 1 })
