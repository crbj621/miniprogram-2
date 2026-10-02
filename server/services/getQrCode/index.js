const cloud = require('campus-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { userId } = event
  
  if (!userId) {
    return { success: false, errMsg: '缺少用户ID' }
  }
  
  try {
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene: userId,
      page: 'pages/index/index',
      width: 280,
      auto_color: false,
      line_color: { r: 0, g: 136, b: 255 },
      is_hyaline: false
    })
    
    if (result.errCode === 0) {
      const uploadResult = await cloud.uploadFile({
        cloudPath: `qrcodes/${userId}_${Date.now()}.png`,
        fileContent: result.buffer
      })
      
      return {
        success: true,
        fileID: uploadResult.fileID
      }
    } else {
      return { success: false, errMsg: '生成二维码失败' }
    }
  } catch (e) {
    console.error('生成二维码失败：', e)
    return { success: false, errMsg: e.message }
  }
}
