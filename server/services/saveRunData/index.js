// 云函数入口文件
const cloud = require('campus-server-sdk')
const crypto = require('node:crypto')
const { normalizeRun } = require('../../src/run-records')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
exports.main = async (event = {}, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) {
    return { success: false, errMsg: '登录状态无效' }
  }
  const { isRealtime } = event
  
  if (isRealtime === true) {
    return await saveRealtimeData(openid, event)
  } else {
    try {
      return await db.runTransaction(() => saveRunRecord(openid, event), { lock: event.teamId ? 'teams' : 'run:' + crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32) })
    } catch (error) { return { success: false, errMsg: error.message || '记录保存失败' } }
  }
}

async function saveRealtimeData(openid, data) {
  try {
    const { distance, pace, duration, steps, latitude, longitude, isCoupleMode, teamId, timestamp } = data
    const finite = function(value, min, max) {
      const number = Number(value || 0)
      if (!Number.isFinite(number)) return min
      return Math.max(min, Math.min(max, number))
    }
    
    const realtimeCollection = db.collection('realtimeData')
    
    const existing = await realtimeCollection.where({ openid }).get()
    
    const realtimeRecord = {
      openid,
      distance: finite(distance, 0, 100000),
      pace: finite(pace, 0, 180),
      duration: finite(duration, 0, 24 * 60 * 60),
      steps: Math.floor(finite(steps, 0, 200000)),
      latitude: finite(latitude, -90, 90),
      longitude: finite(longitude, -180, 180),
      isCoupleMode,
      teamId,
      timestamp,
      updateTime: db.serverDate()
    }
    
    if (existing.data.length > 0) {
      await realtimeCollection.where({ openid }).update({
        data: realtimeRecord
      })
    } else {
      await realtimeCollection.add({
        data: realtimeRecord
      })
    }
    
    return { success: true }
  } catch (error) {
    console.error('保存实时数据失败：', error)
    return { success: false, errMsg: error.message }
  }
}

async function saveRunRecord(openid, data) {
  try {
    const clientRunId = String(data.runId || data._id || '').trim().slice(0, 80)
    if (clientRunId) {
      const duplicate = await db.collection('runRecords').where({
        openid: openid,
        clientRunId: clientRunId
      }).limit(1).get()
      if (duplicate.data.length) {
        return { success: true, _id: duplicate.data[0]._id, duplicate: true }
      }
    }
    const normalized = normalizeRun(data)
    const { distance, duration } = normalized
    const teamId = String(data.teamId || '').trim().slice(0, 64)
    if (teamId) {
      const team = (await db.collection('teams').doc(teamId).get()).data
      if (!team || team.status !== 'active' || !(team.leaderOpenid === openid || (team.members || []).includes(openid))) {
        return { success: false, retryAsSolo: true, errMsg: '当前队伍已失效，请按单人记录重试保存' }
      }
      if (!(team.runParticipants || []).includes(openid)) return { success: false, errMsg: '请先开始组队跑步' }
    }

    const pace = duration > 0 ? (duration / (distance / 1000)) / 60 : 0
    const clamp = function(value, min, max) {
      const number = Number(value || 0)
      return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min
    }
    const steps = Math.floor(clamp(data.steps, 0, 200000))
    const userRes = await db.collection('users').where({ openid: openid }).limit(1).get()
    const user = userRes.data[0] || {}
    const recordId = clientRunId ? crypto.createHash('sha256').update(openid + ':' + clientRunId).digest('hex') : crypto.randomBytes(12).toString('hex')
    const result = await db.collection('runRecords').doc(recordId).create({
      data: {
        distance: distance,
        ...normalized,
        openid: openid,
        nickName: user.nickName || data.nickName || '匿名用户',
        avatarUrl: user.avatarUrl || data.avatarUrl || '',
        pace: pace,
        duration: duration,
        steps: steps,
        motionMode: ['running', 'jogging', 'walking'].indexOf(data.motionMode) !== -1
          ? data.motionMode
          : 'running',
        stepFrequency: clamp(data.stepFrequency, 0, 300),
        stepLength: clamp(data.stepLength, 0, 2),
        clientRunId: clientRunId,
        teamId,
        createTime: db.serverDate()
      }
    })
    return { success: true, _id: result._id }
  } catch (error) {
    console.error('保存跑步数据失败：', error)
    return { success: false, errMsg: error.message }
  }
}
