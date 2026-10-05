'use strict'

// 可编辑画布的数据，不接受 HTML、脚本或任意 CSS。
function normalizeLayout(input, openid) {
  if (!input) return null
  if (!Number.isFinite(input.height) || input.height < 500 || input.height > 1600 || !Array.isArray(input.elements) || input.elements.length > 12) throw Error('画布高度需500至1600，最多12个元素')
  const ids = new Set()
  return { height: input.height, elements: input.elements.map(row => {
    if (!/^[a-z0-9-]{1,40}$/.test(row.id) || ids.has(row.id)) throw Error('画布元素编号不正确')
    ids.add(row.id)
    if (!['title', 'recipient', 'message', 'sender', 'text', 'sticker', 'image'].includes(row.type)) throw Error('不支持这个画布元素')
    for (const key of ['x', 'y', 'width', 'fontSize']) if (!Number.isFinite(row[key])) throw Error('画布坐标不正确')
    if (row.x < 0 || row.y < 0 || row.width < 10 || row.width > 100 || row.x + row.width > 100 || row.y > 95 || row.fontSize < 12 || row.fontSize > 48 || !/^#[a-f0-9]{6}$/i.test(row.color)) throw Error('画布位置、尺寸或颜色不正确')
    const value = String(row.value || '')
    if (value.length > 300) throw Error('单个补充文本最多300字')
    if (row.type === 'image') {
      const base = String(process.env.PUBLIC_BASE_URL || 'https://www.crbuj.icu/campus-api').replace(/\/$/, '')
      const folder = require('node:crypto').createHash('sha256').update(openid || '').digest('hex')
      const prefix = base + '/uploads/gift-sites/' + folder + '/'
      if (!value.startsWith(prefix) || !/^\d+-[a-f0-9]{12}\.(png|jpe?g|webp)$/i.test(value.slice(prefix.length))) throw Error('请使用本人在小程序上传的图片')
    }
    return { id: row.id, type: row.type, x: row.x, y: row.y, width: row.width, fontSize: row.fontSize, color: row.color, value }
  }) }
}
module.exports = { normalizeLayout }
