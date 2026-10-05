'use strict'
// Real MariaDB services: independent fixtures, no production settings changes.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const path = require('node:path')
const cloud = require('campus-server-sdk')
const db = cloud.database()
const team = require('../services/teamManager')
const save = require('../services/saveRunData')
const rank = require('../services/getRankList')
const prefix = 'run-test-' + crypto.randomBytes(6).toString('hex')
const a = prefix + '-a', b = prefix + '-b', c = prefix + '-c'
const owned = new Set()
let checks = 0
async function fixture(name, id, data) {
  owned.add(name + ':' + id)
  await db.collection(name).doc(id).set({ data })
}
async function call(service, openid, data) {
  return cloud.__runWithContext({ openid }, () => service.main(data))
}
function check(value, message) { assert.ok(value, message); checks++ }
function worker(service, openid, data) {
  const code = `const c=require('campus-server-sdk');c.__runWithContext({openid:process.argv[2]},()=>require(process.argv[1]).main(JSON.parse(process.argv[3]))).then(r=>console.log(JSON.stringify(r))).finally(()=>c.__getPool().end()).catch(e=>{console.error(e);process.exitCode=1})`
  return new Promise((resolve, reject) => execFile(process.execPath, ['-e', code, path.resolve(__dirname, '../services/' + service), openid, JSON.stringify(data)], { timeout: 30000 }, (error, stdout) => {
    if (error) reject(error)
    else resolve(JSON.parse(stdout.trim().split('\n').pop()))
  }))
}
async function main() {
  await cloud.__ensureSchema()
  for (const id of [a, b, c]) await fixture('users', id, { openid: id, nickName: id })
  for (let i = 0; i < 25; i++) await fixture('teams', prefix + '-old-' + i, {
    leaderOpenid: a, members: [], status: 'finished', createTime: new Date(2020, 0, i + 1)
  })
  const activeId = prefix + '-zz-active'
  await fixture('teams', activeId, {
    leaderOpenid: a, members: [b], involvedUsers: [a, b, c], memberCount: 2,
    teamType: 'couple', status: 'active', createTime: new Date(),
    runningMembers: [], runParticipants: [], realtimeData: {},
    inviteCode: '999', inviteCodeExpire: Date.now() + 600000
  })
  check((await call(team, a, { action: 'getMyTeam' })).data?._id === activeId, '25 old teams must not hide current team')
  check(!(await call(team, c, { action: 'markRunning', teamId: activeId })).success, 'historical participant is not an active member')
  check(!(await call(team, c, { action: 'create', members: [prefix + '-unconsenting'] })).success, 'cannot add members without consent')
  for (const id of [a, b]) check((await call(team, id, { action: 'markRunning', teamId: activeId })).success, 'member starts')
  for (const id of [a, b]) await call(team, id, { action: 'syncRealtime', teamId: activeId, data: { distance: 900 } })
  await call(team, a, { action: 'finishTeamRun', teamId: activeId })
  check(!(await call(team, b, { action: 'finishTeamRun', teamId: activeId })).teamFinished, 'realtime only must not finish team')
  // Old solo distance must never leak into a pair score.
  await fixture('runRecords', prefix + '-solo', { openid: a, distance: 99999, date: '2020-01-01' })
  const payload = { runId: prefix + '-idempotent', teamId: activeId, distance: 600, duration: 300 }
  const duplicate = await Promise.all(Array.from({ length: 4 }, () => call(save, a, payload)))
  check(duplicate.every(row => row.success), 'concurrent retry succeeds idempotently')
  const records = await db.collection('runRecords').where({ openid: a, clientRunId: payload.runId }).get()
  check(records.data.length === 1, 'concurrent retry creates one record')
  for (const row of records.data) owned.add('runRecords:' + row._id)
  const savedB = await call(save, b, { runId: prefix + '-b-run', teamId: activeId, distance: 700, duration: 350 })
  check(savedB.success, 'second member saved')
  owned.add('runRecords:' + savedB._id)
  const pair = (await call(rank, a, { type: 'couple' })).data.find(row => row.teamId === activeId)
  check(pair?.distance === 1300, 'pair ranks only this team recorded distance')
  const finished = await Promise.all([a, b].map(id => call(team, id, { action: 'finishTeamRun', teamId: activeId })))
  check(finished.every(row => row.success), 'concurrent finish succeeds')
  check((await db.collection('teams').doc(activeId).get()).data.status === 'finished', 'team completion remains committed')
  check(!finished.some(row => row.rewardValue || row.rewardValidDays), 'no retired ordering coupon reward')
  const cancelledId = prefix + '-cancelled'
  await fixture('teams', cancelledId, { leaderOpenid: a, members: [b], status: 'cancelled', runParticipants: [a, b], runningMembers: [], realtimeData: { [a]: { distance: 1000 }, [b]: { distance: 1000 } } })
  check(!(await call(team, a, { action: 'finishTeamRun', teamId: cancelledId })).success, 'cancelled team cannot finish')
  await db.collection('teams').doc(activeId).update({ data: { status: 'finished' } })
  const concurrent = await Promise.all(Array.from({ length: 2 }, () => call(team, c, { action: 'create', teamName: prefix })))
  concurrent.filter(row => row.success).forEach(row => owned.add('teams:' + row.teamId))
  check(concurrent.filter(row => row.success).length === 1, 'one user cannot create two open teams concurrently')
  const existingTeam = concurrent.find(row => row.success).teamId
  await db.collection('teams').doc(existingTeam).update({ data: { status: 'cancelled' } })
  const processes = await Promise.all([worker('teamManager', c, { action: 'create', teamName: prefix }), worker('teamManager', c, { action: 'create', teamName: prefix })])
  processes.filter(row => row.success).forEach(row => owned.add('teams:' + row.teamId))
  check(processes.filter(row => row.success).length === 1, 'database lock also serializes independent Node processes')
  const rollbackId = prefix + '-rollback'
  owned.add('runRecords:' + rollbackId)
  await db.runTransaction(async () => {
    await db.collection('runRecords').doc(rollbackId).create({ data: { openid: a, distance: 1 } })
    return { success: false }
  }, { lock: 'regression:' + prefix })
  check(!(await db.collection('runRecords').doc(rollbackId).get()).data, 'business failure rolls back created records')
  await assert.rejects(db.runTransaction(async () => {
    await db.collection('runRecords').doc(rollbackId).create({ data: { openid: a, distance: 1 } })
    throw new Error('rollback probe')
  }, { lock: 'regression:' + prefix }))
  check(!(await db.collection('runRecords').doc(rollbackId).get()).data, 'exception rolls back and releases lock')
  check((await call(rank, a, { type: 'invalid' })).code !== 0, 'unknown rank type rejected')
  console.log('Running real database regression passed: ' + checks + ' checks')
}
main().finally(async () => {
  // Include generated rows even when an assertion fails early.
  for (const name of ['teams', 'runRecords']) {
    const rows = (await db.collection(name).get()).data
    rows.filter(row => String(row._id).startsWith(prefix) || [a, b, c].includes(row.openid || row.leaderOpenid || row._openid) || String(row.teamId || '').startsWith(prefix))
      .forEach(row => owned.add(name + ':' + row._id))
  }
  for (const key of owned) { const i = key.indexOf(':'); await db.collection(key.slice(0, i)).doc(key.slice(i + 1)).remove() }
  await cloud.__getPool().end()
}).catch(error => { console.error(error); process.exitCode = 1 })
