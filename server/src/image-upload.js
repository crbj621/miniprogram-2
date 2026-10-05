'use strict'

const crypto = require('node:crypto')

const namespaces = new Set([
  'avatars', 'forum', 'canteen-submissions', 'canteen-reviews',
  'delivery', 'food-dishes', 'shops', 'dishes', 'admin', 'regression'
])
const formats = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

async function validateImage(file) {
  const { fileTypeFromBuffer } = await import('file-type')
  let image
  try { image = await fileTypeFromBuffer(file.buffer) } catch (_) {}
  if (!image || !formats.has(image.mime)) throw new Error('文件内容不是支持的 JPG、PNG、WebP 或 GIF 图片')
  return image
}

function imagePath(openid, requestedPath, extension) {
  const requested = String(requestedPath || '').split('/')[0]
  const namespace = namespaces.has(requested) ? requested : 'uploads'
  const owner = crypto.createHash('sha256').update(openid).digest('hex')
  return [namespace, owner, Date.now() + '-' + crypto.randomBytes(12).toString('hex') + '.' + extension].join('/')
}

module.exports = { validateImage, imagePath }
