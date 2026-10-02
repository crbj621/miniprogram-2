const cloud = require('campus-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

exports.main = async (event, context) => {
  const { fileIDs } = event
  
  if (!fileIDs || !Array.isArray(fileIDs) || fileIDs.length === 0) {
    return { success: false, errMsg: 'fileIDs参数缺失' }
  }
  
  try {
    const result = await cloud.getTempFileURL({
      fileList: fileIDs
    })
    
    const urlMap = {}
    if (result.fileList && result.fileList.length > 0) {
      for (const item of result.fileList) {
        if (item.tempFileURL) {
          urlMap[item.fileID] = item.tempFileURL
        }
      }
    }
    
    return {
      success: true,
      urlMap: urlMap,
      fileList: result.fileList
    }
  } catch (error) {
    console.error('获取临时链接失败:', error)
    return { success: false, errMsg: error.message }
  }
}
