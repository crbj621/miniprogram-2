'use strict'

function chinaDate(time) {
  return new Date(time + 8 * 3600000).toISOString().slice(0, 10)
}

function validDistance(record) {
  const distance = Number(record.distance), duration = Number(record.duration)
  return Number.isFinite(distance) && distance > 0 && distance <= 100000 &&
    Number.isFinite(duration) && duration > 0 && duration <= 86400 && distance <= duration * 12 + 50
}

function eligible(record) {
  return validDistance(record) && record.rankEligible !== false
}

function normalizeRun(data, now = Date.now()) {
  if (!validDistance(data)) throw new Error('运动距离或时长异常，请检查记录；成绩未保存')
  const distance = Number(data.distance), duration = Number(data.duration)
  const endedAt = data.endedAt === undefined ? now : Number(data.endedAt)
  const startedAt = data.startedAt === undefined ? endedAt - duration * 1000 : Number(data.startedAt)
  if (!Number.isFinite(endedAt) || endedAt > now + 300000 || endedAt < now - 31 * 86400000 ||
      !Number.isFinite(startedAt) || startedAt > endedAt || duration * 1000 > endedAt - startedAt + 2000) {
    throw new Error('运动时间异常或超过 31 天同步期限')
  }
  const version = data.algorithmVersion === 2 ? 2 : 1
  const gpsDistance = version === 2 ? Number(data.gpsDistance) : distance
  const estimatedDistance = version === 2 ? Number(data.estimatedDistance) : 0
  if (!Number.isFinite(gpsDistance) || !Number.isFinite(estimatedDistance) || gpsDistance < 0 ||
      estimatedDistance < 0 || Math.abs(gpsDistance + estimatedDistance - distance) > 2) {
    throw new Error('定位和估算距离合计异常')
  }
  const rankEligible = estimatedDistance === 0
  const laps = Array.isArray(data.lapTimes) ? data.lapTimes : []
  if (laps.length > Math.floor(distance / 1000) || laps.some((lap, i) =>
    !Number.isFinite(lap) || lap < 0 || lap > duration || (i && lap < laps[i - 1]))) {
    throw new Error('分段计时数据异常')
  }
  return { distance, duration, algorithmVersion: version, gpsDistance, estimatedDistance, rankEligible,
    startedAt, endedAt, date: chinaDate(endedAt), time: new Date(endedAt).toISOString(),
    pace: duration * 1000 / distance / 60, lapTimes: laps,
    signalGaps: Math.max(0, Math.min(10000, Math.floor(Number(data.signalGaps) || 0))),
    stepSource: data.stepSource === 'accelerometer' ? 'accelerometer' : 'unavailable' }
}

// 聚合与分页在数据库完成，避免将所有人的原始运动记录传回 Node。
const table = 'app_documents'
const number = field => `CAST(JSON_UNQUOTE(JSON_EXTRACT(document_data, '$.${field}')) AS DECIMAL(16,4))`
const distance = number('distance'), duration = number('duration')
const validSql = `${distance} > 0 AND ${distance} <= 100000 AND ${duration} > 0 AND ${duration} <= 86400 AND ${distance} <= ${duration} * 12 + 50`
const eligibleSql = `${validSql} AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(document_data, '$.rankEligible')), 'true') <> 'false'`

async function history(pool, openid, offset, limit) {
  const [rows] = await pool.query(`SELECT document_id, document_data FROM ${table}
    WHERE collection_name = 'runRecords' AND doc_openid = ?
    ORDER BY record_date DESC, created_at DESC, document_id DESC LIMIT ? OFFSET ?`, [openid, limit + 1, offset])
  return { hasMore: rows.length > limit, data: rows.slice(0, limit).map(row => ({
    ...JSON.parse(typeof row.document_data === 'string' ? row.document_data : JSON.stringify(row.document_data)), _id: row.document_id })) }
}

async function stats(pool, openid) {
  const [rows] = await pool.query(`SELECT COUNT(*) totalRuns, COALESCE(SUM(${distance}), 0) totalDistance,
    COALESCE(SUM(${duration}), 0) totalDuration, COALESCE(MAX(${distance}), 0) bestDistance,
    COALESCE(MIN(${duration} * 1000 / ${distance} / 60), 0) bestPace
    FROM ${table} WHERE collection_name = 'runRecords' AND doc_openid = ? AND ${validSql}`, [openid])
  const result = Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]))
  result.averagePace = result.totalDistance > 0 ? result.totalDuration * 1000 / result.totalDistance / 60 : 0
  return result
}

async function leaders(pool, type, start, end) {
  const parameters = []
  let dateSql = ''
  if (start) { dateSql = ' AND record_date BETWEEN ? AND ?'; parameters.push(start, end) }
  if (type === 'god') {
    const [rows] = await pool.query(`SELECT document_id, document_data FROM ${table}
      WHERE collection_name = 'runRecords' AND ${eligibleSql} ${dateSql}
      ORDER BY ${distance} DESC, document_id ASC LIMIT 10`, parameters)
    return rows.map(row => ({ ...JSON.parse(typeof row.document_data === 'string' ? row.document_data : JSON.stringify(row.document_data)), _id: row.document_id }))
  }
  const [rows] = await pool.query(`SELECT doc_openid AS openid, SUM(${distance}) distance, COUNT(*) runCount
    FROM ${table} WHERE collection_name = 'runRecords' AND ${eligibleSql} ${dateSql}
    AND doc_openid IS NOT NULL AND doc_openid <> '' GROUP BY doc_openid
    ORDER BY distance DESC, doc_openid ASC LIMIT 100`, parameters)
  return rows.map(row => ({ ...row, _id: row.openid, distance: Number(row.distance), runCount: Number(row.runCount) }))
}

async function teamDistances(pool) {
  const team = "JSON_UNQUOTE(JSON_EXTRACT(document_data, '$.teamId'))"
  const [rows] = await pool.query(`SELECT ${team} AS teamId, doc_openid AS openid, SUM(${distance}) distance
    FROM ${table} WHERE collection_name = 'runRecords' AND ${eligibleSql} AND ${team} IS NOT NULL AND ${team} <> ''
    GROUP BY ${team}, doc_openid`)
  return rows.map(row => ({ ...row, distance: Number(row.distance) }))
}

module.exports = { normalizeRun, eligible, validDistance, chinaDate, history, stats, leaders, teamDistances }
