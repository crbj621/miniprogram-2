'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const express = require('express')
const content = require('./english-content')

// Only known vocabulary and catalog URLs are accepted; never proxy a client URL.
function installEnglishMedia(app, { uploadRoot, rateLimit }) {
  const cacheRoot = path.join(uploadRoot, 'english-cache')
  const pending = new Map()

  async function cachedFile(url, kind, limit) {
    const key = crypto.createHash('sha256').update(url).digest('hex')
    for (const extension of kind === 'pdf' ? ['pdf'] : ['mp3', 'm4a']) {
      const file = path.join(cacheRoot, key + '.' + extension)
      try { await fs.access(file); return { file, mime: extension === 'pdf' ? 'application/pdf' : extension === 'm4a' ? 'audio/mp4' : 'audio/mpeg' } } catch (_) {}
    }
    if (pending.has(key)) return pending.get(key)
    const task = (async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(45000), redirect: 'error' })
      if (!response.ok) throw new Error('资料来源暂时不可用（' + response.status + '）')
      if (Number(response.headers.get('content-length') || 0) > limit) throw new Error('资料文件过大')
      const chunks = []
      let length = 0
      for await (const chunk of response.body) {
        length += chunk.length
        if (length > limit) { await response.body.cancel().catch(() => {}); throw new Error('资料文件过大') }
        chunks.push(chunk)
      }
      const bytes = Buffer.concat(chunks)
      const pdf = bytes.subarray(0, 5).toString() === '%PDF-'
      const mp4 = bytes.subarray(4, 8).toString() === 'ftyp'
      const mp3 = bytes.subarray(0, 3).toString() === 'ID3' || bytes.length > 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
      if (kind === 'pdf' ? !pdf : !mp4 && !mp3) throw new Error('来源返回的文件格式不正确')
      const extension = kind === 'pdf' ? 'pdf' : mp4 ? 'm4a' : 'mp3'
      const file = path.join(cacheRoot, key + '.' + extension)
      await fs.mkdir(cacheRoot, { recursive: true })
      const temporary = file + '.' + crypto.randomUUID() + '.tmp'
      try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, file) }
      finally { await fs.rm(temporary, { force: true }) }
      return { file, mime: extension === 'pdf' ? 'application/pdf' : extension === 'm4a' ? 'audio/mp4' : 'audio/mpeg' }
    })()
    pending.set(key, task)
    try { return await task } finally { pending.delete(key) }
  }

  const send = kind => async (request, response) => {
    try {
      let url
      if (kind === 'word') {
        const word = String(request.query.word || '').trim()
        if (!/^[A-Za-z][A-Za-z '\-]{0,59}$/.test(word) || !content.content().words.some(item => item.lemma.toLowerCase() === word.toLowerCase())) {
          return response.status(400).json({ success: false, msg: '词库中没有这个单词' })
        }
        url = new URL('https://dict.youdao.com/dictvoice')
        url.searchParams.set('audio', word)
        url.searchParams.set('type', request.query.type === '2' ? '2' : '1')
        url = url.href
      } else {
        const paper = content.pastExams().find(item => item.id === request.query.paperId) || content.content().papers.find(item => item.id === request.query.paperId)
        const resourceType = String(request.query.type || '')
        if (!paper || !['paper', 'answer', 'audio'].includes(resourceType)) {
          return response.status(404).json({ success: false, msg: '这份资料没有可下载的文件' })
        }
        url = paper[resourceType + 'Url'] || (paper.resources || []).find(resource => resource.type === resourceType)?.url
        const verified = url && new URL(url)
        if (!verified || verified.protocol !== 'https:' || verified.username || verified.password || !['raw.githubusercontent.com', 'daxueui-cos.koocdn.com'].includes(verified.hostname)) return response.status(404).json({ success: false, msg: '资料来源尚未核验' })
      }
      const audio = kind === 'word' || request.query.type === 'audio'
      const cached = await cachedFile(url, audio ? 'audio' : 'pdf', (kind === 'word' ? 2 : audio ? 40 : 30) * 1024 * 1024)
      response.setHeader('Cache-Control', 'public, max-age=86400')
      response.type(cached.mime)
      if (!audio) response.setHeader('Content-Disposition', 'inline; filename="' + String(request.query.paperId).replace(/[^a-z0-9-]/gi, '') + '-' + request.query.type + '.pdf"')
      response.sendFile(cached.file)
    } catch (error) {
      response.status(502).json({ success: false, msg: error.message || '资料读取失败，请稍后重试' })
    }
  }
  app.get('/api/english/audio', rateLimit('english-audio', 120, 60000), send('word'))
  app.get('/api/english/resource', rateLimit('english-resource', 30, 60000), send('resource'))
  app.use('/english-assets', express.static(path.join(__dirname, '../public/english'), { dotfiles: 'deny', maxAge: '1h', fallthrough: false }))
}

module.exports = { installEnglishMedia }
