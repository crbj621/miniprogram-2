const cloud = require('campus-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

function generateUserId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let userId = ''
  for (let i = 0; i < 6; i++) {
    userId += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return userId
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  const { nickName, avatarUrl } = event
  
  if (!openid) {
    return { success: false, errMsg: '获取openid失败' }
  }
  
  try {
    const existingUser = await db.collection('users').where({ openid: openid }).get()
    
    if (existingUser.data.length > 0) {
      const updateData = {
        nickName: nickName,
        avatarUrl: avatarUrl,
        updateTime: db.serverDate()
      }
      
      await db.collection('users').where({ openid: openid }).update({
        data: updateData
      })

      var forumUserRes = await db.collection('forum_user').where({ _openid: openid }).limit(1).get()
      if (forumUserRes.data.length > 0) {
        await db.collection('forum_user').doc(forumUserRes.data[0]._id).update({
          data: {
            nickname: nickName,
            avatar: avatarUrl,
            updateTime: db.serverDate()
          }
        })
      } else {
        await db.collection('forum_user').add({
          data: {
            _openid: openid,
            nickname: nickName,
            avatar: avatarUrl,
            status: 'normal',
            createTime: db.serverDate(),
            updateTime: db.serverDate()
          }
        })
      }
      
      return { 
        success: true, 
        openid: openid,
        userId: existingUser.data[0].userId,
        isNewUser: false
      }
    } else {
      let userId = generateUserId()
      let attempts = 0
      const maxAttempts = 10
      
      while (attempts < maxAttempts) {
        const existingUserId = await db.collection('users').where({ userId: userId }).get()
        if (existingUserId.data.length === 0) {
          break
        }
        userId = generateUserId()
        attempts++
      }
      
      await db.collection('users').add({
        data: {
          openid: openid,
          userId: userId,
          nickName: nickName,
          avatarUrl: avatarUrl,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      })

      await db.collection('forum_user').add({
        data: {
          _openid: openid,
          nickname: nickName,
          avatar: avatarUrl,
          status: 'normal',
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      })
      
      return { 
        success: true, 
        openid: openid,
        userId: userId,
        isNewUser: true
      }
    }
  } catch (error) {
    console.error('保存用户信息失败：', error)
    return { success: false, errMsg: error.message }
  }
}
