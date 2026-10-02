const cloud = require('campus-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) {
    return event.action === 'add'
      ? { success: false, errMsg: '登录状态失效，请重新进入小程序' }
      : []
  }

  try {
    switch (event.action || 'list') {
      case 'list':
        return await listFriends(openid)
      case 'search':
        return await searchUsers(openid, event.keyword)
      case 'add':
        return await addFriend(openid, event.friendOpenid)
      default:
        return []
    }
  } catch (error) {
    console.error('好友操作失败：', error)
    return event.action === 'add'
      ? { success: false, errMsg: error.message || '添加失败' }
      : []
  }
}

async function getAcceptedRelations(openid) {
  const result = await db.collection('friends')
    .where({
      $or: [
        { fromOpenid: openid, status: 'accepted' },
        { toOpenid: openid, status: 'accepted' }
      ]
    })
    .get()
  return result.data
}

async function listFriends(openid) {
  const relations = await getAcceptedRelations(openid)
  const friendOpenids = Array.from(new Set(relations.map((item) =>
    item.fromOpenid === openid ? item.toOpenid : item.fromOpenid
  ).filter(Boolean)))

  if (!friendOpenids.length) return []

  const users = await db.collection('users')
    .where({ openid: db.command.in(friendOpenids) })
    .get()
  const userMap = {}
  users.data.forEach((user) => {
    userMap[user.openid] = user
  })

  return friendOpenids.map((friendOpenid) => {
    const user = userMap[friendOpenid] || {}
    return {
      openid: friendOpenid,
      userId: user.userId || '',
      nickName: user.nickName || '用户',
      avatarUrl: user.avatarUrl || ''
    }
  })
}

async function searchUsers(openid, keyword) {
  const value = String(keyword || '').trim()
  if (!value) return []

  const searchById = /^[A-Z0-9]{6}$/i.test(value)
  const query = searchById
    ? { userId: value.toUpperCase() }
    : { nickName: db.RegExp({ regexp: escapeRegExp(value), options: 'i' }) }

  const [userResult, relations] = await Promise.all([
    db.collection('users').where(query).limit(20).get(),
    getAcceptedRelations(openid)
  ])
  const friendOpenids = new Set(relations.map((item) =>
    item.fromOpenid === openid ? item.toOpenid : item.fromOpenid
  ))

  return userResult.data
    .filter((user) => user.openid && user.openid !== openid)
    .map((user) => ({
      _id: user._id,
      openid: user.openid,
      userId: user.userId || '',
      nickName: user.nickName || '用户',
      avatarUrl: user.avatarUrl || '',
      isFriend: friendOpenids.has(user.openid)
    }))
}

async function addFriend(openid, friendOpenid) {
  const targetOpenid = String(friendOpenid || '').trim()
  if (!targetOpenid) return { success: false, errMsg: '好友信息无效' }
  if (targetOpenid === openid) return { success: false, errMsg: '不能添加自己' }

  const userResult = await db.collection('users').where({ openid: targetOpenid }).limit(1).get()
  if (!userResult.data.length) {
    return { success: false, errMsg: '该用户不存在' }
  }

  const existingResult = await db.collection('friends')
    .where({
      $or: [
        { fromOpenid: openid, toOpenid: targetOpenid },
        { fromOpenid: targetOpenid, toOpenid: openid }
      ]
    })
    .limit(1)
    .get()

  if (existingResult.data.length) {
    const relation = existingResult.data[0]
    if (relation.status === 'accepted') {
      return { success: false, errMsg: '已经是好友了' }
    }
    await db.collection('friends').doc(relation._id).update({
      data: { status: 'accepted', updateTime: db.serverDate() }
    })
    return { success: true, errMsg: '添加好友成功' }
  }

  await db.collection('friends').add({
    data: {
      fromOpenid: openid,
      toOpenid: targetOpenid,
      status: 'accepted',
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  })
  return { success: true, errMsg: '添加好友成功' }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
