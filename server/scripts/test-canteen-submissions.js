'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const cloud = require('campus-server-sdk')
const db = cloud.database()
const service = require('../services/canteen_reviews')
const prefix = 'submission-test-' + crypto.randomBytes(6).toString('hex')
const student = prefix + '-student', admin = prefix + '-admin'
const owned = new Set()
let checks = 0
function check(value, message) { assert.ok(value, message); checks++ }
async function call(openid, action, data = {}) {
  return cloud.__runWithContext({ openid }, () => service.main({ action, ...data }))
}
async function main() {
  await db.collection('users').doc(student).set({ data: { openid: student, nickName: prefix } })
  await db.collection('users').doc(prefix + '-other').set({ data: { openid: prefix + '-other', nickName: prefix } })
  await db.collection('global_admin').doc(admin).set({ data: { loginOpenid: admin, status: 'active', role: 'admin' } })
  const form = { clientId: prefix, stallName: prefix, location: '测试档口', dishName: prefix, description: '临时投稿回归，测试后清理', price: 8 }
  const submitted = await Promise.all([call(student, 'submit', form), call(student, 'submit', form)])
  submitted.forEach(row => { if (row.id) owned.add('canteen_submissions:' + row.id) })
  check(submitted.every(row => row.success) && submitted[0].id === submitted[1].id, 'concurrent submit is idempotent')
  const id = submitted[0].id
  check(!(await call(student, 'moderateSubmission', { id, status: 'approved' })).success, 'student cannot moderate')
  check(!(await call(prefix + '-other', 'mySubmissions')).submissions.some(row => row._id === id), 'private submission history')
  check((await call(student, 'list')).dishes.some(row => row.submissionId === id), 'new submission is automatically public')
  const reviews = await Promise.all([call(admin, 'moderateSubmission', { id, status: 'approved' }), call(admin, 'moderateSubmission', { id, status: 'approved' })])
  check(reviews.every(row => row.success), 'concurrent moderation succeeds once')
  const dishes = (await db.collection('canteen_dishes').where({ submissionId: id }).get()).data
  const stalls = (await db.collection('canteen_stalls').where({ submissionId: id }).get()).data
  check(dishes.length === 1 && stalls.length === 1, 'one dish and one stall are published')
  check((await call(student, 'list')).dishes.find(row => row._id === dishes[0]._id)?.count === 0, 'submission never fabricates a score')
  console.log('Canteen submissions real database regression passed: ' + checks + ' checks')
}
main().finally(async () => {
  for (const name of ['canteen_submissions', 'canteen_stalls', 'canteen_dishes']) {
    const rows = (await db.collection(name).get()).data
    rows.filter(row => row.openid === student || row.name === prefix || owned.has('canteen_submissions:' + row.submissionId))
      .forEach(row => owned.add(name + ':' + row._id))
  }
  for (const key of owned) { const i = key.indexOf(':'); await db.collection(key.slice(0, i)).doc(key.slice(i + 1)).remove() }
  await db.collection('users').doc(student).remove()
  await db.collection('users').doc(prefix + '-other').remove()
  await db.collection('global_admin').doc(admin).remove()
  await cloud.__getPool().end()
}).catch(error => { console.error(error); process.exitCode = 1 })
