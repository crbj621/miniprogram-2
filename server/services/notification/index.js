// 云函数入口文件
const cloud = require('campus-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, toOpenid, type, content, relatedId } = event

  switch (action) {
    case 'sendNotification':
      return await sendNotification(openid, toOpenid, type, content, relatedId)
    case 'getNotifications':
      return await getNotifications(openid)
    case 'markAsRead':
      return await markAsRead(openid, relatedId)
    default:
      return {
        success: false,
        errMsg: 'Unknown action'
      }
  }
}

async function sendNotification(fromOpenid, toOpenid, type, content, relatedId) {
  try {
    await db.collection('notifications').add({
      data: {
        fromOpenid: fromOpenid,
        toOpenid: toOpenid,
        type: type, // friend_request, run_achievement, team_invite
        content: content,
        relatedId: relatedId,
        read: false,
        createTime: db.serverDate()
      }
    })
    
    return { success: true }
  } catch (e) {
    console.error('发送通知失败：', e)
    return { success: false, errMsg: e.message }
  }
}

async function getNotifications(openid) {
  try {
    const res = await db.collection('notifications')
      .where({ toOpenid: openid })
      .orderBy('createTime', 'desc')
      .get()
    
    return res.data
  } catch (e) {
    console.error('获取通知失败：', e)
    return []
  }
}

async function markAsRead(openid, notificationId) {
  try {
    await db.collection('notifications')
      .where({
        _id: notificationId,
        toOpenid: openid
      })
      .update({
        data: { read: true }
      })
    
    return { success: true }
  } catch (e) {
    console.error('标记已读失败：', e)
    return { success: false, errMsg: e.message }
  }
}
