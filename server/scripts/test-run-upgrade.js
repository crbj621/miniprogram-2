'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const cloud = require('campus-server-sdk')
const db = cloud.database()
const save = require('../services/saveRunData')
const stats = require('../services/getUserRunStats')
const rank = require('../services/getRankList')
const { chinaDate, leaders, teamDistances } = require('../src/run-records')
const weRun = require('../src/we-run')
const prefix = 'upgrade-' + crypto.randomBytes(6).toString('hex')
const own = prefix + '-own', other = prefix + '-other'
const call = (service, openid, event) => cloud.__runWithContext({ openid }, () => service.main(event))
const owned = []
async function main() {
  await cloud.__ensureSchema()
  await cloud.__ensureSchema() // 重复启动不重复建索引。
  const now = Date.now(), yesterday = now - 86400000
  for (const [openid, distance] of [[own, 1000], [other, 800]]) {
    const result = await call(save, openid, { runId: prefix + '-' + openid, distance, duration: 400, endedAt: yesterday, lapTimes: openid === own ? [400] : [] })
    assert.equal(result.success, true)
    owned.push(['runRecords', result._id])
    const duplicate = await call(save, openid, { runId: prefix + '-' + openid, distance, duration: 400 })
    assert.equal(duplicate._id, result._id)
    assert.equal(duplicate.duplicate, true)
  }
  const estimated = await call(save, own, { runId: prefix + '-estimated', distance: 500, duration: 300,
    algorithmVersion: 2, gpsDistance: 0, estimatedDistance: 500 })
  assert.equal(estimated.success, true); owned.push(['runRecords', estimated._id])
  for (const event of [{ distance: 1000, duration: 0 }, { distance: 10000, duration: 10 }]) {
    assert.equal((await call(save, own, event)).success, false)
  }
  for (const [id, data] of [['bogus', { distance: 99999, duration: 1 }], ['zero-duration', { distance: 123, duration: 0 }]]) {
    const key = prefix + '-' + id
    await db.collection('runRecords').doc(key).set({ data: { ...data, openid: own, date: chinaDate(now), teamId: prefix + '-team' } })
    owned.push(['runRecords', key])
  }
  const result = await call(stats, own, {})
  assert.equal(result.totalRuns, 2)
  assert.equal(result.totalDistance, 1500, '个人统计包含估算记录，排除明显不合理的历史成绩')
  assert.equal(result.averagePace, 700 * 1000 / 1500 / 60)
  const first = await call(stats, own, { action: 'history', limit: 2 })
  const second = await call(stats, own, { action: 'history', limit: 2, offset: 2 })
  assert.equal(first.hasMore, true); assert.equal(second.hasMore, false)
  assert.equal(first.data.length + second.data.length, 4)
  assert.equal(new Set([...first.data, ...second.data].map(row => row._id)).size, 4)
  assert.ok([...first.data, ...second.data].every(row => row.openid === own), '只能取得当前登录人的历史')
  const yesterdayRows = await leaders(cloud.__getPool(), 'daily', chinaDate(yesterday), chinaDate(yesterday))
  assert.equal(yesterdayRows.find(row => row.openid === own).distance, 1000)
  const all = (await call(rank, own, { type: 'all' })).data
  assert.equal(all.find(row => row.openid === own).distance, 1000, '估距与异常历史成绩不进入榜单')
  assert.equal((await teamDistances(cloud.__getPool())).some(row => row.teamId === prefix + '-team'), false)
  const [[plan]] = await cloud.__getPool().query(`EXPLAIN SELECT document_id FROM app_documents FORCE INDEX(idx_document_owner)
    WHERE collection_name='runRecords' AND doc_openid=? AND record_date=?`, [own, chinaDate(now)])
  assert.equal(plan.key, 'idx_document_owner')

  const key = crypto.randomBytes(16), iv = crypto.randomBytes(16)
  const auth = { openid: own, wxSessionId: weRun.createSession(own, key.toString('base64')) }
  const payload = (steps, stamp) => {
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv)
    return { iv: iv.toString('base64'), encryptedData: Buffer.concat([cipher.update(JSON.stringify({
      watermark: { appid: process.env.WECHAT_APP_ID, timestamp: stamp },
      stepInfoList: [{ timestamp: Math.floor(now / 1000), step: steps }] })), cipher.final()]).toString('base64') }
  }
  const stamp = Math.floor(now / 1000)
  assert.equal((await weRun.sync(cloud, auth, payload(2000, stamp))).today, 2000)
  assert.equal((await weRun.sync(cloud, auth, payload(3000, stamp + 1))).today, 3000)
  assert.equal((await weRun.sync(cloud, auth, payload(2000, stamp))).today, 3000, '旧请求不能覆盖最新日步数')
  const days = (await db.collection('wechat_steps').where({ openid: own }).get()).data
  assert.equal(days.length, 1, '重复同步只保留一条用户日记录')
  assert.equal((await call(stats, own, {})).totalDistance, 1500, '日步数不改变跑步距离')
  console.log('跑步升级真实 SQL/服务回归通过：日期、幂等、质量、统计、分页、隔离、索引和微信日步数')
}
main().finally(async () => {
  for (const collection of ['runRecords', 'wechat_steps']) {
    const rows = (await db.collection(collection).get()).data
    for (const row of rows) if ([own, other].includes(row.openid)) await db.collection(collection).doc(row._id).remove()
  }
  await cloud.__getPool().end()
}).catch(error => { console.error(error); process.exitCode = 1 })
