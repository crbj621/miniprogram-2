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
  await put('canteen_submissions', '-submission', { status: 'pending' })
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const chinaMidnight = new Date(today + 'T00:00:00+08:00')
  await put('forum_post', '-today', { status: 'normal', createTime: new Date(chinaMidnight.getTime() + 1000) })
  await put('forum_post', '-deleted', { status: 'deleted', createTime: new Date() })
  await put('forum_post', '-yesterday', { status: 'normal', createTime: new Date(chinaMidnight.getTime() - 1000) })
  const after = (await call()).data
  assert.equal(after.pendingCanteen - before.pendingCanteen, 1)
  assert.equal(after.todayPosts - before.todayPosts, 1, 'use Beijing date boundary and exclude deleted posts')
  assert.equal(after.postCount - before.postCount, 2)
  assert.ok(!Object.hasOwn(after, 'orderCount') && !Object.hasOwn(after, 'pendingRiders'), 'retired ordering statistics are absent')
  console.log('Admin dashboard permission/submissions/Beijing date/retired ordering stats passed: 5 checks')
}
main().finally(async () => {
  for (const row of owned) await db.collection(row.collection).doc(row.id).remove()
  await cloud.__getPool().end()
}).catch(error => { console.error(error); process.exitCode = 1 })
