const cloud = require('campus-server-sdk')
const { history, stats } = require('../../src/run-records')

exports.main = async (event = {}) => {
  try {
    const openid = cloud.getWXContext().OPENID
    if (!openid) return { success: false, errMsg: '登录状态无效' }
    if (event.action === 'history') {
      const offset = Math.min(1000000, Math.max(0, Math.floor(Number(event.offset) || 0)))
      const limit = Math.min(50, Math.max(1, Math.floor(Number(event.limit) || 20)))
      return { success: true, ...await history(cloud.__getPool(), openid, offset, limit) }
    }
    return { success: true, ...await stats(cloud.__getPool(), openid) }
  } catch (error) {
    console.error('获取用户跑步数据失败：', error.message)
    return { success: false, errMsg: '运动数据加载失败，请重试' }
  }
}
