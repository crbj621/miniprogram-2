const cloud = require('campus-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { keyword, searchType } = event
  
  if (!keyword || keyword.trim() === '') return []
  
  try {
    let query = {}
    
    if (searchType === 'id') {
      query = { userId: keyword.toUpperCase() }
    } else {
      query = {
        nickName: db.RegExp({
          regexp: keyword.trim(),
          options: 'i'
        })
      }
    }
    
    const res = await db.collection('users').where(query).limit(20).get()
    
    const results = res.data.map(user => ({
      _id: user._id,
      openid: user.openid,
      userId: user.userId || '---',
      nickName: user.nickName || '用户',
      avatarUrl: user.avatarUrl || ''
    }))
    
    const friendRes = await db.collection('friends')
      .where({
        $or: [
          { fromOpenid: openid, status: 'accepted' },
          { toOpenid: openid, status: 'accepted' }
        ]
      })
      .get()
    
    const friendOpenids = new Set()
    friendRes.data.forEach(f => {
      if (f.fromOpenid === openid) friendOpenids.add(f.toOpenid)
      if (f.toOpenid === openid) friendOpenids.add(f.fromOpenid)
    })
    
    return results.map(user => ({
      ...user,
      isFriend: friendOpenids.has(user.openid)
    }))
  } catch (e) {
    console.error('搜索用户失败：', e)
    return []
  }
}
