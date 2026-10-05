import { api } from './api-client'
import { API_BASE_URL } from '../config/api'

export async function callEnglish(action: string, data: any = {}): Promise<any> {
  const response = await api.call({ name: 'english_learning', data: { action, ...data } }) as any
  const result = response && response.result
  if (!result || result.success !== true) throw new Error(result && result.msg || '英语学习服务暂不可用')
  return result.data
}

export function englishRequestId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
}

export function openEnglishDocument(url: string): Promise<void> {
  return api.downloadFile({ fileID: englishResourceUrl(url) }).then((file: any) => new Promise<void>((resolve, reject) => {
    wx.openDocument({ filePath: file.tempFilePath, showMenu: true,
      success: () => resolve(), fail: error => reject(new Error(error.errMsg || '资料打开失败')) })
  }))
}

export function englishResourceUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : API_BASE_URL.replace(/\/+$/, '') + '/' + String(url || '').replace(/^\/+/, '')
}
