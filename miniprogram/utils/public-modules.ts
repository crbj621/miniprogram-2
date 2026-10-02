import { api } from './api-client'
export async function getPublicModules() {
  const res = await api.call({ name: 'globalAdmin', data: { action: 'getPublicModules' } }) as any
  const result = res.result
  if (!result || result.code !== 0) throw new Error(result && result.message || '模块配置读取失败')
  const modules = result.data && result.data.modules
  if (!modules || ['running', 'food', 'canteen', 'forum', 'rider'].some(key => typeof modules[key] !== 'boolean')) {
    throw new Error('模块配置返回格式不正确')
  }
  return modules
}
