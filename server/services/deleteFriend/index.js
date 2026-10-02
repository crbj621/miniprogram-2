const cloud = require('campus-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const openid = cloud.getWXContext().OPENID
  const { friendOpenid } = event
  
  if (!openid || !friendOpenid) {
    return { success: false, errMsg: '参数错误' }
  }
  
  try {
    const res = await db.collection('friends')
      .where({
        $or: [
          { fromOpenid: openid, toOpenid: friendOpenid },
          { fromOpenid: friendOpenid, toOpenid: openid }
        ]
      })
      .get()
    
    if (res.data.length === 0) {
      return { success: false, errMsg: '好友关系不存在' }
    }
    
    for (const item of res.data) {
      await db.collection('friends').doc(item._id).remove()
    }
    
    return { success: true, errMsg: '删除成功' }
  } catch (e) {
    console.error('删除好友失败：', e)
    return { success: false, errMsg: e.message }
  }
}
