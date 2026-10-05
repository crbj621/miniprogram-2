export function defaultLayout() {
  return { height: 700, elements: [
    { id: 'title', type: 'title', x: 8, y: 5, width: 84, fontSize: 28, color: '#906489', value: '' },
    { id: 'recipient', type: 'recipient', x: 8, y: 17, width: 84, fontSize: 18, color: '#ad7e99', value: '' },
    { id: 'message', type: 'message', x: 8, y: 27, width: 84, fontSize: 18, color: '#715364', value: '' },
    { id: 'sender', type: 'sender', x: 42, y: 82, width: 50, fontSize: 16, color: '#b3819c', value: '' }
  ] }
}
export function elementText(row: any, site: any) {
  if (row.type === 'recipient') return '给 ' + (site.recipient || '想送给的人')
  if (['title', 'message', 'sender'].includes(row.type)) return site[row.type] || (row.type === 'sender' ? '一个在乎你的人' : '')
  return row.value || ''
}
