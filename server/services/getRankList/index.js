const cloud = require('campus-server-sdk')
const { leaders: queryLeaders, teamDistances } = require('../../src/run-records')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const type = (event && (event.type || event.tab)) || 'daily'
  if (!['daily', 'monthly', 'god', 'couple', 'all'].includes(type)) return { code: -1, message: '未知榜单类型', data: [] }

  try {
    let data
    if (type === 'couple') {
      data = await getCoupleRank()
    } else {
      data = await getRunRank(type)
    }
    return { code: 0, data: data }
  } catch (error) {
    console.error('getRankList error:', type, error)
    return {
      code: -1,
      message: error.message || '排行榜加载失败',
      data: []
    }
  }
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function getChinaDateParts(date) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const result = {}
  parts.forEach(function(part) {
    if (part.type !== 'literal') result[part.type] = part.value
  })
  return result
}

function getTodayString() {
  const parts = getChinaDateParts(new Date())
  return parts.year + '-' + parts.month + '-' + parts.day
}

function getMonthRange() {
  const parts = getChinaDateParts(new Date())
  const year = Number(parts.year)
  const month = Number(parts.month)
  const endDay = new Date(year, month, 0).getDate()
  return {
    start: year + '-' + pad(month) + '-01',
    end: year + '-' + pad(month) + '-' + pad(endDay)
  }
}

function getRankTitle(distance) {
  if (distance >= 10000) return '王者'
  if (distance >= 5000) return '宗师'
  if (distance >= 3000) return '钻石'
  if (distance >= 1000) return '白银'
  return '新秀'
}

async function getRunRank(type) {
  const range = type === 'daily' ? { start: getTodayString(), end: getTodayString() } : type === 'monthly' ? getMonthRange() : {}
  const records = await queryLeaders(cloud.__getPool(), type, range.start, range.end)
  if (type === 'god') {
    const leaders = records.sort((a, b) => Number(b.distance) - Number(a.distance) || String(a._id).localeCompare(String(b._id))).slice(0, 10)
    const userMap = await getUserMap(leaders.map(record => record.openid))
    return leaders.map(function(record) {
      const user = userMap[record.openid] || {}
      return {
        _id: record._id,
        openid: record.openid,
        nickName: user.nickName || record.nickName || '神秘人',
        avatarUrl: user.avatarUrl || record.avatarUrl || '',
        distance: Math.round(Number(record.distance || 0)),
        date: record.date || '',
        rankTitle: getRankTitle(Number(record.distance || 0))
      }
    })
  }

  const leaders = records
  const userMap = await getUserMap(leaders.map(row => row.openid))
  return leaders.map(function(item) {
    const openid = item.openid
    const user = userMap[openid] || {}
    item.nickName = user.nickName || item.nickName || '神秘人'
    item.avatarUrl = user.avatarUrl || item.avatarUrl || ''
    item.distance = Math.round(item.distance)
    item.rankTitle = getRankTitle(item.distance)
    return item
  })
}

async function getCoupleRank() {
  const results = await Promise.all([
    db.collection('teams').where({
      teamType: 'couple',
      status: _.in(['active', 'finished'])
    }).orderBy('createTime', 'desc').get(),
    teamDistances(cloud.__getPool())
  ])

  const teams = results[0].data || []
  const records = results[1] || []
  const uniqueTeams = []
  const seenPairs = new Map()
  const teamPairs = new Map()
  teams.forEach(function(team) {
    const memberOpenids = Array.from(new Set(
      [team.leaderOpenid].concat(team.members || []).filter(Boolean)
    ))
    if (memberOpenids.length < 2) return
    const pair = memberOpenids.slice(0, 2)
    const key = pair.slice().sort().join('|')
    teamPairs.set(team._id, { key, members: pair })
    if (seenPairs.has(key)) return
    const item = { team, members: pair, distance: 0 }
    seenPairs.set(key, item)
    uniqueTeams.push(item)
  })
  records.forEach(record => {
    const pair = teamPairs.get(record.teamId)
    const distance = Number(record.distance)
    if (!pair || !pair.members.includes(record.openid) || !Number.isFinite(distance) || distance <= 0) return
    seenPairs.get(pair.key).distance += distance
  })

  const allOpenids = []
  uniqueTeams.forEach(function(item) {
    allOpenids.push.apply(allOpenids, item.members)
  })
  const userMap = await getUserMap(allOpenids)

  return uniqueTeams.map(function(item) {
    const firstId = item.members[0]
    const secondId = item.members[1]
    const first = userMap[firstId] || {}
    const second = userMap[secondId] || {}
    const distance = Math.round(item.distance)
    return {
      _id: item.team._id,
      openid: item.team._id,
      teamId: item.team._id,
      memberOpenids: item.members,
      teamName: item.team.teamName || '情侣跑团',
      name1: first.nickName || '队员A',
      name2: second.nickName || '队员B',
      avatar1: first.avatarUrl || '',
      avatar2: second.avatarUrl || '',
      distance: distance
    }
  }).filter(row => row.distance > 0).sort(function(a, b) {
    return b.distance - a.distance || a.teamId.localeCompare(b.teamId)
  }).slice(0, 100)
}

async function getUserMap(openids) {
  const ids = Array.from(new Set((openids || []).filter(Boolean)))
  const userMap = {}

  if (ids.length) {
    const result = await db.collection('users').where({ openid: _.in(ids) }).get()
    ;(result.data || []).forEach(user => {
      userMap[user.openid] = { nickName: user.nickName || '神秘人', avatarUrl: user.avatarUrl || '' }
    })
  }

  const fileIds = []
  Object.keys(userMap).forEach(function(openid) {
    const url = userMap[openid].avatarUrl
    if (url && url.indexOf('cloud://') === 0) fileIds.push(url)
  })

  for (let i = 0; i < fileIds.length; i += 50) {
    const fileList = fileIds.slice(i, i + 50)
    try {
      const result = await cloud.getTempFileURL({ fileList: fileList })
      ;(result.fileList || []).forEach(function(item) {
        if (!item.tempFileURL) return
        Object.keys(userMap).forEach(function(openid) {
          if (userMap[openid].avatarUrl === item.fileID) {
            userMap[openid].avatarUrl = item.tempFileURL
          }
        })
      })
    } catch (error) {
      console.error('avatar temp url error:', error)
    }
  }

  return userMap
}
