'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const cloud = require('campus-server-sdk')
const service = require('../services/english_learning')
const db = cloud.database()
const prefix = 'english-first-' + crypto.randomBytes(6).toString('hex')
if (!/^campus_english_(test|review)_[A-Za-z0-9_]+$/.test(process.env.DB_NAME || '')) throw new Error('Requires an isolated English test database')
async function run() {
  const [connection] = await cloud.__getPool().query('SELECT DATABASE() AS name, @@SESSION.tx_isolation AS isolation, @@GLOBAL.tx_isolation AS globalIsolation')
  assert.equal(connection[0].name, process.env.DB_NAME)
  assert.equal((await db.collection('global_settings').get()).data.length, 0, 'Isolated settings must be empty')
  await db.collection('global_settings').doc(prefix).create({ data: { modules: { english: { enabled: true } } } })
  const outcomes = []
  for (const action of ['home', 'startStudy']) {
    const results = await Promise.all(['a', 'b'].map(suffix => cloud.__runWithContext({ openid: prefix + '-' + action + '-' + suffix }, () => service.main({ action, mode: 'new', level: 'CET4' }))))
    outcomes.push({ action, results: results.map(result => ({ success: result.success, msg: result.msg || '' })) })
  }
  // A separate caller with no readCommitted option retains default gap-lock behavior.
  let arrived = 0, release
  const barrier = new Promise(resolve => { release = resolve })
  const baseline = await Promise.allSettled(['a', 'b'].map(suffix => db.runTransaction(async () => {
    const document = db.collection('english_isolation_probe').doc(prefix + suffix)
    await document.get()
    if (++arrived === 2) release()
    await barrier
    await document.create({ data: { openid: prefix, probe: true } })
  }, { lock: prefix + suffix })))
  const defaultTransactionDeadlock = baseline.some(result => result.status === 'rejected' && result.reason.code === 'ER_LOCK_DEADLOCK')
  const [after] = await cloud.__getPool().query('SELECT @@SESSION.tx_isolation AS isolation, @@GLOBAL.tx_isolation AS globalIsolation')
  assert.equal(after[0].isolation, connection[0].isolation, 'Released English connections retain session default')
  assert.equal(after[0].globalIsolation, connection[0].globalIsolation, 'Global isolation configuration unchanged')
  assert.ok(defaultTransactionDeadlock, 'Default transactions still use repeatable read gap locks')
  console.log(JSON.stringify({ database: connection[0].name, isolation: after[0].isolation, globalIsolation: after[0].globalIsolation, defaultTransactionDeadlock, outcomes }))
  assert.ok(outcomes.every(outcome => outcome.results.every(result => result.success)), 'Different new accounts can initialize concurrently')
}
async function cleanup() {
  for (const collection of ['global_settings', 'english_profiles', 'english_daily', 'english_sessions', 'english_cards', 'english_isolation_probe']) {
    for (const row of (await db.collection(collection).get()).data) {
      if (String(row.openid || row._id).startsWith(prefix)) await db.collection(collection).doc(row._id).remove()
    }
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(async () => {
  try { await cleanup() } finally { await cloud.__getPool().end() }
})
