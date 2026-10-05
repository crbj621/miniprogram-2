export function message(error: any): string {
  return error && error.message || '操作失败，请稍后重试'
}

export function clockText(seconds: number): string {
  const count = Math.max(0, Math.floor(seconds))
  return String(Math.floor(count / 60)).padStart(2, '0') + ':' + String(count % 60).padStart(2, '0')
}

export function timeText(value: any): string {
  if (!value) return '尚未打卡'
  const date = new Date(value)
  if (isNaN(date.getTime())) return String(value)
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
}
