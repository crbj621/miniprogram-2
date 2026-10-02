'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const cloud = require('campus-server-sdk')
const db = cloud.database()
const admin = require('../services/globalAdmin')
const rank = require('../services/getRankList')
const openid = 'demo-test-' + crypto.randomBytes(6).toString('hex')
const ids = ['campus_demo_run_1', 'campus_demo_run_2', 'campus_demo_run_3', 'campus_demo_run_4']
const snapshots = []
const keep = process.argv.includes('--keep')
let keepSucceeded = false
const call = action => cloud.__runWithContext({ openid }, () => admin.main({ action }))
async function main() {
  for (const name of ['users', 'runRecords', 'teams']) {
    for (const id of name === 'teams' ? ['campus_demo_pair'] : ids) {
      const row = (await db.collection(name).doc(id).get()).data
      if (row && !row.isDemo) throw new Error('真实数据占用了示例编号，停止检查')
      snapshots.push({ name, id, row })
    }
  }
  await db.collection('global_admin').doc(openid).set({ data: { loginOpenid: openid, role: 'admin', status: 'active' } })
  assert.notEqual((await call('seedRunDemo')).code, 0, 'normal administrator cannot seed')
  await db.collection('global_admin').doc(openid).update({ data: { role: 'super' } })
  assert.equal((await call('seedRunDemo')).code, 0)
  assert.equal((await call('seedRunDemo')).code, 0, 'idempotent seed')
  const runs = (await db.collection('runRecords').get()).data.filter(row => ids.includes(row._id))
  assert.equal(runs.length, 4)
  const pair = await cloud.__runWithContext({ openid }, () => rank.main({ type: 'couple' }))
  assert.equal(pair.data.find(row => row.teamId === 'campus_demo_pair')?.distance, 5600)
  assert.equal((await call('clearRunDemo')).code, 0)
  assert.equal((await db.collection('runRecords').get()).data.filter(row => ids.includes(row._id)).length, 0)
  if (keep) assert.equal((await call('seedRunDemo')).code, 0)
  keepSucceeded = keep
  console.log('Demo scores permission/idempotency/pair/cleanup passed; keep=' + keep)
}
main().finally(async () => {
  if (!keepSucceeded) for (const item of snapshots) {
    if (item.row) await db.collection(item.name).doc(item.id).set({ data: item.row })
    else await db.collection(item.name).doc(item.id).remove()
  }
  await db.collection('global_admin').doc(openid).remove()
  await cloud.__getPool().end()
}).catch(error => { console.error(error); process.exitCode = 1 })
