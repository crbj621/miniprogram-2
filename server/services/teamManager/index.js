const cloud = require('campus-server-sdk')
const { eligible } = require('../../src/run-records')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const TEAM_LIMIT = 3
const INVITE_CODE_TTL = 10 * 60 * 1000
const COUPLE_INVITE_TTL = 5 * 60 * 1000
const TEAM_REWARD_VALUE = 0.5
const TEAM_REWARD_VALID_DAYS = 3
const TEAM_REWARD_MIN_DISTANCE = 500

exports.main = async (event = {}) => {
  // One database lock covers membership, invite-code allocation, finish and rewards.
  const reads = ['getMyTeamEvents', 'getTeamInfo', 'getUserInfo', 'getTeamRealtimeData']
  if (reads.includes(event.action)) return dispatch(event)
  try { return await db.runTransaction(() => dispatch(event), { lock: 'teams' }) }
  catch (error) { return { success: false, errMsg: error.message || '组队服务异常' } }
}

async function dispatch(event) {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const {
    action,
    teamName,
    teamId,
    members,
    teamType,
    data,
    inviteCode
  } = event || {}

  if (!openid) {
    return { success: false, errMsg: '登录状态无效，请重新进入小程序' }
  }

  try {
    switch (action) {
      case 'create':
        return await createTeam(openid, teamName, members, teamType)
      case 'inviteCouple':
        return await inviteCouple(openid, members)
      case 'acceptCouple':
        return await acceptCouple(openid, teamId)
      case 'cancelTeam':
        return await cancelTeam(openid, teamId)
      case 'joinTeam':
        return await joinTeam(openid, inviteCode)
      case 'leaveTeam':
        return await leaveTeam(openid, teamId)
      case 'getMyTeam':
        return await getMyTeam(openid)
      case 'getMyTeamEvents':
        return await getMyTeamEvents(openid)
      case 'getTeamInfo':
        return await getTeamInfo(openid, teamId)
      case 'getUserInfo':
        return await getUserInfo(event.memberOpenid)
      case 'syncRealtime':
        return await syncRealtimeData(openid, teamId, data)
      case 'getTeamRealtimeData':
        return await getTeamRealtimeData(openid, teamId)
      case 'markRunning':
        return await markRunning(openid, teamId)
      case 'finishTeamRun':
        return await finishTeamRun(openid, teamId)
      case 'refreshCode':
        return await refreshInviteCode(openid, teamId)
      default:
        return { success: false, errMsg: '不支持的组队操作：' + (action || '空') }
    }
  } catch (error) {
    console.error('teamManager error:', action, error)
    return { success: false, errMsg: error.message || '组队服务异常' }
  }
}

function normalizeMembers(leaderOpenid, members) {
  const source = Array.isArray(members) ? members : []
  return Array.from(new Set(source.filter(function(item) {
    return item && item !== leaderOpenid
  }))).slice(0, TEAM_LIMIT - 1)
}

function isTeamMember(team, openid) {
  return !!team && (
    team.leaderOpenid === openid ||
    (team.status === 'pending' && team.invitedMember === openid) ||
    (Array.isArray(team.members) && team.members.indexOf(openid) !== -1)
  )
}

async function awardTeamCoupons(team, memberOpenids) {
  for (let i = 0; i < memberOpenids.length; i++) {
    const memberOpenid = memberOpenids[i]
    const couponId = 'team_reward_' + crypto.createHash('sha256')
      .update(String(team._id) + ':' + String(memberOpenid))
      .digest('hex')
      .slice(0, 32)
    const existing = await db.collection('user_coupons').doc(couponId).get()
    if (existing && existing.data) continue
    await db.collection('user_coupons').doc(couponId).create({
      data: {
        _openid: memberOpenid,
        name: '组队跑完成奖励券',
        value: TEAM_REWARD_VALUE,
        source: 'team_run',
        teamId: team._id,
        used: false,
        expireTime: new Date(Date.now() + TEAM_REWARD_VALID_DAYS * 24 * 60 * 60 * 1000),
        createTime: db.serverDate()
      }
    })
  }
}

function getCreateTimeValue(team) {
  if (!team || !team.createTime) return 0
  if (team.createTime instanceof Date) return team.createTime.getTime()
  if (typeof team.createTime.toDate === 'function') return team.createTime.toDate().getTime()
  const value = new Date(team.createTime).getTime()
  return Number.isNaN(value) ? 0 : value
}

async function getOpenTeamsForUser(openid) {
  const results = await Promise.all([
    db.collection('teams').where({ leaderOpenid: openid }).get(),
    db.collection('teams').where({ members: openid }).get(),
    db.collection('teams').where({ invitedMember: openid }).get()
  ])

  const map = {}
  results.forEach(function(result) {
    ;(result.data || []).forEach(function(team) {
      map[team._id] = team
    })
  })

  return Object.keys(map).map(function(id) {
    return map[id]
  }).filter(function(team) {
    return !team.status || team.status === 'active' || (team.status === 'pending' && team.inviteExpire > Date.now())
  }).sort(function(a, b) {
    return getCreateTimeValue(b) - getCreateTimeValue(a)
  })
}

async function getMyTeamEvents(openid) {
  const results = await Promise.all([
    db.collection('teams').where({ leaderOpenid: openid }).orderBy('createTime', 'desc').limit(20).get(),
    db.collection('teams').where({ members: openid }).orderBy('createTime', 'desc').limit(20).get(),
    db.collection('teams').where({ invitedMember: openid }).orderBy('createTime', 'desc').limit(20).get(),
    db.collection('teams').where({ involvedUsers: openid }).orderBy('createTime', 'desc').limit(20).get()
  ])

  const map = {}
  results.forEach(function(result) {
    ;(result.data || []).forEach(function(team) {
      if (team && team._id && (isTeamMember(team, openid) || (team.involvedUsers || []).includes(openid))) {
        map[team._id] = team
      }
    })
  })

  const allowedStatuses = ['pending', 'active', 'finished', 'rejected', 'cancelled']
  const teams = Object.keys(map).map(function(id) {
    return map[id]
  }).filter(function(team) {
    return (!team.status || allowedStatuses.indexOf(team.status) !== -1) && !(team.status === 'pending' && team.inviteExpire <= Date.now())
  }).sort(function(a, b) {
    return getCreateTimeValue(b) - getCreateTimeValue(a)
  }).slice(0, 5)

  return { success: true, data: teams }
}

async function ensureUsersAvailable(openids, ignoredTeamId) {
  for (let i = 0; i < openids.length; i++) {
    const teams = await getOpenTeamsForUser(openids[i])
    const conflict = teams.find(function(team) {
      return team._id !== ignoredTeamId
    })
    if (conflict) {
      return { success: false, errMsg: '有成员已在其他队伍或邀请中' }
    }
  }
  return { success: true }
}

async function generateUniqueInviteCode() {
  for (let i = 0; i < 20; i++) {
    const code = Math.floor(100 + Math.random() * 900).toString()
    const existing = await db.collection('teams').where({
      inviteCode: code,
      inviteCodeExpire: _.gt(Date.now()),
      status: 'active'
    }).limit(1).get()
    if (!existing.data.length) return code
  }
  throw new Error('邀请码生成繁忙，请稍后重试')
}

async function buildRealtimeData(openids) {
  const result = {}
  if (!openids.length) return result

  const users = await db.collection('users').where({
    openid: _.in(openids)
  }).get()
  const userMap = {}
  ;(users.data || []).forEach(function(user) {
    userMap[user.openid] = user
  })

  openids.forEach(function(id) {
    const user = userMap[id] || {}
    result[id] = {
      distance: 0,
      pace: 0,
      duration: 0,
      steps: 0,
      nickName: user.nickName || '队员',
      avatarUrl: user.avatarUrl || ''
    }
  })
  return result
}

async function createTeam(leaderOpenid, teamName, members, teamType) {
  if ((Array.isArray(members) && members.length) || (teamType && teamType !== 'team')) {
    return { success: false, errMsg: '队员需通过邀请码加入；双人搭档请发送邀请' }
  }
  const memberList = normalizeMembers(leaderOpenid, members)
  const allUsers = [leaderOpenid].concat(memberList)
  const available = await ensureUsersAvailable(allUsers)
  if (!available.success) return available

  const inviteCode = await generateUniqueInviteCode()
  const expireTime = Date.now() + INVITE_CODE_TTL
  const realtimeData = await buildRealtimeData(allUsers)

  const teamData = {
    leaderOpenid: leaderOpenid,
    members: memberList,
    memberCount: allUsers.length,
    involvedUsers: allUsers,
    teamName: String(teamName || '我的跑团').trim().slice(0, 20) || '我的跑团',
    teamType: teamType || 'team',
    status: 'active',
    createTime: db.serverDate(),
    updateTime: db.serverDate(),
    inviteCode: inviteCode,
    inviteCodeExpire: expireTime,
    runningMembers: [],
    runParticipants: [],
    realtimeData: realtimeData
  }

  const res = await db.collection('teams').add({ data: teamData })
  return {
    success: true,
    _id: res._id,
    teamId: res._id,
    status: 'active',
    teamName: teamData.teamName,
    teamType: teamData.teamType,
    members: memberList,
    inviteCode: inviteCode,
    inviteCodeExpire: expireTime
  }
}

async function inviteCouple(leaderOpenid, members) {
  const memberList = normalizeMembers(leaderOpenid, members)
  if (memberList.length !== 1) {
    return { success: false, errMsg: '情侣邀请只能选择一位好友' }
  }

  const invitedMember = memberList[0]
  const available = await ensureUsersAvailable([leaderOpenid, invitedMember])
  if (!available.success) return available

  const inviteExpire = Date.now() + COUPLE_INVITE_TTL
  const res = await db.collection('teams').add({
    data: {
      leaderOpenid: leaderOpenid,
      invitedMember: invitedMember,
      members: [],
      memberCount: 1,
      involvedUsers: [leaderOpenid, invitedMember],
      teamName: '情侣跑团',
      teamType: 'couple',
      status: 'pending',
      inviteExpire: inviteExpire,
      createTime: db.serverDate(),
      updateTime: db.serverDate(),
      runningMembers: [],
      runParticipants: [],
      realtimeData: await buildRealtimeData([leaderOpenid, invitedMember])
    }
  })

  return {
    success: true,
    _id: res._id,
    teamId: res._id,
    status: 'pending',
    teamType: 'couple',
    invitedMember: invitedMember,
    inviteExpire: inviteExpire
  }
}

async function acceptCouple(openid, teamId) {
  const team = await requireTeam(teamId)
  if (team.status !== 'pending') {
    return { success: false, errMsg: '邀请已处理或已失效' }
  }
  if (team.invitedMember !== openid) {
    return { success: false, errMsg: '只有被邀请人可以接受邀请' }
  }
  if (!team.inviteExpire || team.inviteExpire < Date.now()) {
    await db.collection('teams').doc(teamId).update({
      data: { status: 'cancelled', updateTime: db.serverDate() }
    })
    return { success: false, errMsg: '邀请已过期' }
  }

  const available = await ensureUsersAvailable([openid], teamId)
  if (!available.success) return available

  const transition = await db.collection('teams').where({
    _id: teamId,
    status: 'pending',
    invitedMember: openid
  }).update({
    data: {
      members: [openid],
      memberCount: 2,
      involvedUsers: [team.leaderOpenid, openid],
      status: 'active',
      updateTime: db.serverDate()
    }
  })
  if (!transition.stats || transition.stats.updated !== 1) {
    return { success: false, errMsg: '邀请状态已变化，请刷新后重试' }
  }
  return { success: true, teamId: teamId, status: 'active' }
}

async function cancelTeam(openid, teamId) {
  const team = await requireTeam(teamId)
  if (team.leaderOpenid !== openid) {
    return { success: false, errMsg: '只有队长可以取消或解散队伍' }
  }
  if (team.status !== 'pending' && team.status !== 'active') {
    return { success: false, errMsg: '队伍已结束' }
  }

  await db.collection('teams').doc(teamId).update({
    data: {
      status: 'cancelled',
      runningMembers: [],
      updateTime: db.serverDate()
    }
  })
  return { success: true, msg: team.status === 'pending' ? '邀请已取消' : '队伍已解散' }
}

async function joinTeam(openid, inviteCode) {
  const code = String(inviteCode || '').trim()
  if (!/^\d{3}$/.test(code)) {
    return { success: false, errMsg: '请输入3位邀请码' }
  }

  const res = await db.collection('teams').where({
    inviteCode: code,
    inviteCodeExpire: _.gt(Date.now()),
    status: 'active'
  }).limit(1).get()

  if (!res.data.length) {
    return { success: false, errMsg: '邀请码无效或已过期' }
  }

  const selectedTeam = res.data[0]
  {
    const team = await requireTeam(selectedTeam._id)
    if (team.status !== 'active' || !team.inviteCodeExpire || team.inviteCodeExpire <= Date.now()) {
      return { success: false, errMsg: '邀请码无效或已过期' }
    }
    if (isTeamMember(team, openid)) {
      return { success: false, errMsg: '您已在该队伍中' }
    }
    if ((team.runParticipants || []).length) return { success: false, errMsg: '队伍已开跑，请下一次再加入' }
    if ((team.memberCount || ((team.members || []).length + 1)) >= TEAM_LIMIT) {
      return { success: false, errMsg: '该队伍已满员（最多3人）' }
    }

    const available = await ensureUsersAvailable([openid], team._id)
    if (!available.success) return available
    const userData = await buildRealtimeData([openid])
    const updateData = {
      members: _.addToSet(openid),
      involvedUsers: _.addToSet(openid),
      memberCount: _.inc(1),
      updateTime: db.serverDate()
    }
    updateData['realtimeData.' + openid] = userData[openid]

    const transition = await db.collection('teams').where({
      _id: team._id,
      status: 'active',
      memberCount: _.lt(TEAM_LIMIT)
    }).update({ data: updateData })
    if (!transition.stats || transition.stats.updated !== 1) {
      return { success: false, errMsg: '队伍人数刚刚发生变化，请刷新后重试' }
    }
    return { success: true, teamId: team._id }
  }
}

async function leaveTeam(openid, teamId) {
  const team = await requireTeam(teamId)
  if (!isTeamMember(team, openid)) {
    return { success: false, errMsg: '您不在该队伍中' }
  }

  if (team.status === 'pending') {
    if (team.invitedMember === openid) {
      await db.collection('teams').doc(teamId).update({
        data: { status: 'rejected', updateTime: db.serverDate() }
      })
      return { success: true, msg: '已拒绝邀请' }
    }
    return await cancelTeam(openid, teamId)
  }
  if (team.status !== 'active') return { success: false, errMsg: '队伍已结束' }
  if ((team.runningMembers || []).includes(openid)) return { success: false, errMsg: '请先结束本次跑步再退出' }

  if (team.leaderOpenid === openid) {
    return await cancelTeam(openid, teamId)
  }

  const members = (team.members || []).filter(function(id) {
    return id !== openid
  })
  const involvedUsers = Array.from(new Set((team.involvedUsers || []).concat(openid)))
  const realtimeData = team.realtimeData || {}
  delete realtimeData[openid]

  await db.collection('teams').doc(teamId).update({
    data: {
      members: members,
      involvedUsers: involvedUsers,
      memberCount: members.length + 1,
      runningMembers: _.pull(openid),
      realtimeData: realtimeData,
      updateTime: db.serverDate()
    }
  })
  return { success: true, msg: '已退出队伍' }
}

async function getMyTeam(openid) {
  const teams = await getOpenTeamsForUser(openid)
  let team = null

  for (let i = 0; i < teams.length; i++) {
    const item = teams[i]
    if (item.status === 'pending' && item.inviteExpire && item.inviteExpire < Date.now()) {
      await db.collection('teams').doc(item._id).update({
        data: { status: 'cancelled', updateTime: db.serverDate() }
      })
      continue
    }
    team = item
    break
  }

  if (!team) return { success: true, data: null }

  if (!team.status) {
    team.status = 'active'
    team.teamName = team.teamName || '我的跑团'
    team.memberCount = (team.members || []).length + 1
    team.involvedUsers = [team.leaderOpenid].concat(team.members || [])
    await db.collection('teams').doc(team._id).update({
      data: {
        status: team.status,
        teamName: team.teamName,
        memberCount: team.memberCount,
        involvedUsers: team.involvedUsers,
        runningMembers: team.runningMembers || [],
        updateTime: db.serverDate()
      }
    })
  }

  const memberOpenids = [team.leaderOpenid].concat(team.members || [])
  if (team.invitedMember && memberOpenids.indexOf(team.invitedMember) === -1) {
    memberOpenids.push(team.invitedMember)
  }
  const userRes = memberOpenids.length ? await db.collection('users').where({
    openid: _.in(memberOpenids)
  }).get() : { data: [] }
  const userMap = {}
  ;(userRes.data || []).forEach(function(user) {
    userMap[user.openid] = {
      openid: user.openid,
      nickName: user.nickName || '队员',
      avatarUrl: user.avatarUrl || ''
    }
  })

  team.memberDetails = memberOpenids.map(function(id) {
    return userMap[id] || {
      openid: id,
      nickName: '队员' + String(id).slice(-4),
      avatarUrl: ''
    }
  })
  return { success: true, data: team }
}

async function requireTeam(teamId) {
  if (!teamId) throw new Error('缺少队伍ID')
  const res = await db.collection('teams').doc(teamId).get()
  if (!res.data) throw new Error('队伍不存在')
  return res.data
}

async function getTeamInfo(openid, teamId) {
  const team = await requireTeam(teamId)
  if (!isTeamMember(team, openid)) {
    return { success: false, errMsg: '无权查看该队伍' }
  }
  return { success: true, data: team }
}

async function getUserInfo(memberOpenid) {
  if (!memberOpenid) return { success: false, errMsg: '缺少用户标识' }
  const res = await db.collection('users').where({ openid: memberOpenid }).limit(1).get()
  const user = res.data[0]
  if (!user) {
    return { success: true, data: { openid: memberOpenid, nickName: '队员', avatarUrl: '' } }
  }
  return {
    success: true,
    data: {
      openid: user.openid,
      nickName: user.nickName || '队员',
      avatarUrl: user.avatarUrl || ''
    }
  }
}

async function syncRealtimeData(openid, teamId, data) {
  const team = await requireTeam(teamId)
  if (team.status !== 'active' || !isTeamMember(team, openid)) {
    return { success: false, errMsg: '当前不在有效队伍中' }
  }

  const safeData = data || {}
  const safeNumber = function(value, min, max) {
    const number = Number(value || 0)
    if (!Number.isFinite(number)) return min
    return Math.max(min, Math.min(max, number))
  }
  const updateData = {}
  updateData['realtimeData.' + openid] = {
    distance: safeNumber(safeData.distance, 0, 100000),
    pace: safeNumber(safeData.pace, 0, 180),
    duration: safeNumber(safeData.duration, 0, 24 * 60 * 60),
    steps: Math.floor(safeNumber(safeData.steps, 0, 200000)),
    latitude: safeNumber(safeData.latitude, -90, 90),
    longitude: safeNumber(safeData.longitude, -180, 180),
    timestamp: safeData.timestamp || Date.now(),
    nickName: safeData.nickName || '',
    avatarUrl: safeData.avatarUrl || ''
  }
  updateData.updateTime = db.serverDate()
  await db.collection('teams').doc(teamId).update({ data: updateData })
  return { success: true }
}

async function getTeamRealtimeData(openid, teamId) {
  const team = await requireTeam(teamId)
  if (!isTeamMember(team, openid)) {
    return { success: false, errMsg: '无权查看队伍实时数据' }
  }
  return { success: true, data: team.realtimeData || {} }
}

async function markRunning(openid, teamId) {
  const team = await requireTeam(teamId)
  if (team.status !== 'active' || !isTeamMember(team, openid)) {
    return { success: false, errMsg: '当前不在有效队伍中' }
  }
  await db.collection('teams').doc(teamId).update({
    data: {
      runningMembers: _.addToSet(openid),
      runParticipants: _.addToSet(openid),
      updateTime: db.serverDate()
    }
  })
  return { success: true }
}

async function finishTeamRun(openid, teamId) {
  const team = await requireTeam(teamId)
  if (!isTeamMember(team, openid)) {
    return { success: false, errMsg: '您不在该队伍中' }
  }
  if (team.status === 'finished') return { success: true, teamFinished: true, alreadyFinished: true }
  if (team.status !== 'active') return { success: false, errMsg: '队伍已取消或已失效' }

  const updateData = {
    runningMembers: _.pull(openid),
    updateTime: db.serverDate()
  }
  await db.collection('teams').doc(teamId).update({ data: updateData })

  const refreshed = await requireTeam(teamId)
  const expectedMembers = Array.from(new Set([
    refreshed.leaderOpenid
  ].concat(Array.isArray(refreshed.members) ? refreshed.members : []).filter(Boolean)))
  const participants = Array.isArray(refreshed.runParticipants)
    ? refreshed.runParticipants
    : [openid]
  const remaining = Array.isArray(refreshed.runningMembers) ? refreshed.runningMembers : []
  const everyoneParticipated = expectedMembers.length >= 2 && expectedMembers.every(function(memberOpenid) {
    return participants.indexOf(memberOpenid) !== -1
  })
  // Reward uses committed team run records, never a volatile realtime snapshot.
  const savedRuns = await db.collection('runRecords').where({ teamId }).get()
  savedRuns.data = savedRuns.data.filter(eligible)
  const distances = new Map()
  savedRuns.data.forEach(row => distances.set(row.openid, (distances.get(row.openid) || 0) + Number(row.distance || 0)))
  const everyoneQualified = expectedMembers.every(function(memberOpenid) {
    return (distances.get(memberOpenid) || 0) >= TEAM_REWARD_MIN_DISTANCE
  })

  if (everyoneParticipated && everyoneQualified && remaining.length === 0) {
    if (refreshed.status === 'active') {
      await db.collection('teams').where({
        _id: teamId,
        status: 'active'
      }).update({
        data: {
          status: 'finished',
          finishTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      })
    }
    await awardTeamCoupons(refreshed, expectedMembers)
    return {
      success: true,
      teamFinished: true,
      rewardValue: TEAM_REWARD_VALUE,
      rewardValidDays: TEAM_REWARD_VALID_DAYS,
      minDistance: TEAM_REWARD_MIN_DISTANCE
    }
  }
  return {
    success: true,
    teamFinished: false,
    rewardPending: everyoneParticipated && remaining.length === 0 && !everyoneQualified,
    minDistance: TEAM_REWARD_MIN_DISTANCE
  }
}

async function refreshInviteCode(openid, teamId) {
  const team = await requireTeam(teamId)
  if (team.leaderOpenid !== openid) {
    return { success: false, errMsg: '只有队长可以刷新邀请码' }
  }
  if (team.status !== 'active') {
    return { success: false, errMsg: '队伍当前不可邀请成员' }
  }

  const newCode = await generateUniqueInviteCode()
  const newExpire = Date.now() + INVITE_CODE_TTL
  await db.collection('teams').doc(teamId).update({
    data: {
      inviteCode: newCode,
      inviteCodeExpire: newExpire,
      updateTime: db.serverDate()
    }
  })
  return {
    success: true,
    inviteCode: newCode,
    inviteCodeExpire: newExpire
  }
}
