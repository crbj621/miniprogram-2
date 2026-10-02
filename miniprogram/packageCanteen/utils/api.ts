import { api } from '../../utils/api-client'
export async function callCanteen(action: string, data: any = {}) {
  const response = await api.call({ name: 'canteen_reviews', data: { action, ...data } }) as any
  const result = response.result || {}
  if (!result.success) throw new Error(result.msg || '食堂评价服务暂不可用')
  return result
}

export function canReview() {
  return getApp<any>().isLoggedIn()
}
