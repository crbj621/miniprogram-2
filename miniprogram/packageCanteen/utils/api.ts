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

export function newCanteenId() { return Date.now() + '-' + Math.random().toString(36).slice(2, 12) }
export const mealOptions = ['早餐', '午餐＋晚餐', '全天']
export function mealSelection(index: number) { return index === 0 ? ['breakfast'] : index === 1 ? ['lunch', 'dinner'] : ['breakfast', 'lunch', 'dinner'] }
export function mealIndex(meals: any) { return Array.isArray(meals) && meals.length === 1 && meals[0] === 'breakfast' ? 0 : Array.isArray(meals) && !meals.includes('breakfast') ? 1 : 2 }
