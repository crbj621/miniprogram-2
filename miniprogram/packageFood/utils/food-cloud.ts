import { api } from '../../utils/api-client'
type CallOptions = {
  showLoading?: boolean
  loadingTitle?: string
}

function normalizeCloudError(err: any): string {
  const msg = err && (err.errMsg || err.message) ? (err.errMsg || err.message) : ''
  if (!msg) return '网络异常，请稍后重试'
  if (msg.includes('FunctionName parameter could not be found') || msg.includes('function not found')) {
    return '点餐服务不可用，请联系管理员检查服务端部署'
  }
  if (msg.includes('environment') || msg.includes('env')) {
    return '服务配置异常，请联系管理员检查连接配置'
  }
  if (msg.includes('permission') || msg.includes('auth')) {
    return '权限不足，请重新登录或联系管理员'
  }
  return msg
}

export function callFoodFunction(action: string, data: any, options: CallOptions = {}) {
  const showLoading = options.showLoading === true
  const loadingTitle = options.loadingTitle || '加载中'
  if (showLoading) {
    wx.showLoading({ title: loadingTitle, mask: true })
  }
  return api.call({
    name: 'food_manager',
    data: { action, data: data || {} }
  }).then((res: any) => {
    if (showLoading) wx.hideLoading()
    const result = res && res.result ? res.result : {}
    if (result.success) return result
    throw new Error(result.msg || '服务返回异常')
  }).catch((err: any) => {
    if (showLoading) wx.hideLoading()
    throw new Error(normalizeCloudError(err))
  })
}
