import { api } from './api-client'
export async function callGifts(action: string, data: any = {}) {
  const response = await api.call({ name: 'gift_sites', data: { action, ...data } }) as any
  if (!response.result || response.result.success !== true) throw new Error(response.result && response.result.msg || '祝福小站暂不可用')
  return response.result.data
}
export function giftRequestId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) }
