const cloud = require('campus-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { friendOpenid } = event
  
  if (!openid || !friendOpenid) {
    return { success: false, errMsg: '参数错误' }
  }
  
  if (openid === friendOpenid) {
    return { success: false, errMsg: '不能添加自己为好友' }
  }
  
  try {
    const existingFriend = await db.collection('friends')
      .where({
        $or: [
          { fromOpenid: openid, toOpenid: friendOpenid },
          { fromOpenid: friendOpenid, toOpenid: openid }
        ]
      })
      .get()
    
    if (existingFriend.data.length > 0) {
      const existing = existingFriend.data[0]
      if (existing.status === 'accepted') {
        return { success: false, errMsg: '已经是好友了' }
      } else if (existing.status === 'pending') {
        if (existing.fromOpenid === openid) {
          return { success: false, errMsg: '好友请求已发送，等待对方确认' }
        } else {
          await db.collection('friends')
            .doc(existing._id)
            .update({
              data: { status: 'accepted' }
            })
          return { success: true, errMsg: '已接受好友请求' }
        }
      }
    }
    
    await db.collection('friends').add({
      data: {
        fromOpenid: openid,
        toOpenid: friendOpenid,
        status: 'accepted',
        createTime: db.serverDate()
      }
    })
    
    return { success: true, errMsg: '添加好友成功' }
  } catch (e) {
    console.error('添加好友失败：', e)
    return { success: false, errMsg: e.message }
  }
}
