'use strict'

const crypto = require('node:crypto')
const { chinaDate } = require('./run-records')
const sessions = new Map()

function createSession(openid, key, now = Date.now()) {
  for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id)
  if (sessions.size >= 10000) sessions.delete(sessions.keys().next().value)
  const id = crypto.randomBytes(24).toString('hex')
  sessions.set(id, { openid, key, expires: now + 2 * 3600000 })
  return id
}

function decode(auth, payload, appid, now = Date.now()) {
  const session = sessions.get(auth.wxSessionId)
  if (!session || session.openid !== auth.openid || session.expires < now) throw new Error('请重新点击同步，刷新微信会话')
  const decodeBase64 = (value, maxLength) => {
    if (typeof value !== 'string' || value.length > maxLength || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('微信运动数据格式无效')
    return Buffer.from(value, 'base64')
  }
  const key = decodeBase64(session.key, 32), iv = decodeBase64(payload.iv, 32)
  const encrypted = decodeBase64(payload.encryptedData, 20000)
  if (key.length !== 16 || iv.length !== 16 || encrypted.length % 16 !== 0) throw new Error('微信运动数据格式无效')
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv)
  const result = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'))
  const timestamp = result.watermark && Number(result.watermark.timestamp) * 1000
  if (!result.watermark || result.watermark.appid !== appid || !Number.isFinite(timestamp) ||
      timestamp > now + 300000 || timestamp < now - 15 * 60000) throw new Error('微信运动凭证过期或不匹配，请重新同步')
  if (!Array.isArray(result.stepInfoList) || !result.stepInfoList.length || result.stepInfoList.length > 31) throw new Error('微信运动日数据无效')
  const seen = new Set()
  const days = result.stepInfoList.map(row => {
    const time = Number(row.timestamp) * 1000, steps = Number(row.step)
    if (!Number.isFinite(time) || time > now + 300000 || time < now - 31 * 86400000 ||
        !Number.isInteger(steps) || steps < 0 || steps > 200000) throw new Error('微信运动步数或日期异常')
    const date = chinaDate(time)
    if (seen.has(date)) throw new Error('微信运动日期重复')
    seen.add(date)
    return { date, steps, source: 'wechat', sourceTimestamp: timestamp }
  }).sort((a, b) => a.date.localeCompare(b.date))
  return { days, timestamp }
}

async function sync(cloud, auth, payload) {
  const now = Date.now()
  const result = decode(auth, payload, process.env.WECHAT_APP_ID, now)
  const db = cloud.database()
  await db.runTransaction(async () => {
    for (const day of result.days) {
      const id = crypto.createHash('sha256').update(auth.openid + ':' + day.date).digest('hex')
      const existing = (await db.collection('wechat_steps').doc(id).get()).data
      if (existing && existing.sourceTimestamp > result.timestamp) continue
      await db.collection('wechat_steps').doc(id).set({ data: { ...day, openid: auth.openid, syncedAt: now } })
    }
    return { success: true }
  }, { lock: 'steps:' + crypto.createHash('sha256').update(auth.openid).digest('hex').slice(0, 32) })
  // 返回已保存的最新快照，避免旧请求覆盖页面上的新数据。
  const [rows] = await cloud.__getPool().query(`SELECT document_data FROM app_documents
    WHERE collection_name = 'wechat_steps' AND doc_openid = ? ORDER BY record_date DESC LIMIT 31`, [auth.openid])
  const stored = rows.map(row => typeof row.document_data === 'string' ? JSON.parse(row.document_data) : row.document_data)
  const today = stored.find(day => day.date === chinaDate(now))
  return { today: today ? today.steps : null, date: chinaDate(now), syncedAt: today ? today.syncedAt : now,
    days: stored.map(({ date, steps }) => ({ date, steps })) }
}

module.exports = { createSession, decode, sync }
