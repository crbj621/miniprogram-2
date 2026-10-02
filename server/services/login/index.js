const cloud = require('campus-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const appid = wxContext.APPID
  const unionid = wxContext.UNIONID

  return {
    openid: openid,
    appid: appid,
    unionid: unionid
  }
}
