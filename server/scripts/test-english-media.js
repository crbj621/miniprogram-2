'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const express = require('express')
const { installEnglishMedia } = require('../src/english-media')
const source = require('../src/english-content')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'campus-english-media-test-'))
  const app = express()
  installEnglishMedia(app, { uploadRoot: root, rateLimit: () => (req, res, next) => next() })
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)) })
  const address = 'http://127.0.0.1:' + server.address().port
  const fetchOriginal = global.fetch
  let calls = 0
  const pdf = source.pastExams().find(paper => paper.kind === 'pdf')
  const audio = source.pastExams().find(paper => /\.m4a$/i.test(paper.audioUrl || ''))
  const invalidPdf = source.pastExams().find(paper => paper.kind === 'pdf' && paper.paperUrl !== pdf.paperUrl)
  global.fetch = async (url, options) => {
    const value = new URL(url)
    if (!['dict.youdao.com', 'raw.githubusercontent.com'].includes(value.hostname)) return fetchOriginal(url, options)
    calls++
    await new Promise(resolve => setTimeout(resolve, 5))
    if (url === invalidPdf.paperUrl) return new Response('<html>Unavailable</html>', { headers: { 'content-type': 'text/html' } })
    const bytes = value.hostname === 'dict.youdao.com' ? Buffer.from('ID3-test-audio') : url === audio.audioUrl ? Buffer.from([0,0,0,24,102,116,121,112,77,52,65,32]) : Buffer.from('%PDF-1.4\n%%EOF')
    return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })
  }
  const get = url => fetchOriginal(address + url)
  try {
    assert.equal((await get('/api/english/audio?word=not-in-the-dictionary-123')).status, 400)
    assert.equal(calls, 0, '不接受任意代理URL或未知词')
    const responses = await Promise.all([get('/api/english/audio?word=abandon'), get('/api/english/audio?word=abandon')])
    assert.equal(calls, 1, '并发相同发音仅获取一次')
    assert.ok(responses.every(response => response.status === 200 && response.headers.get('content-type').startsWith('audio/mpeg')))
    assert.ok((await get('/api/english/resource?paperId=' + audio.id + '&type=audio')).headers.get('content-type').startsWith('audio/mp4'), 'M4A保持真实类型，不伪装MP3')
    const document = await get('/api/english/resource?paperId=' + pdf.id + '&type=paper')
    assert.equal(document.status, 200); assert.ok(document.headers.get('content-type').startsWith('application/pdf'))
    assert.equal((await get('/api/english/resource?paperId=' + invalidPdf.id + '&type=paper')).status, 502, 'HTML来源不能伪装PDF')
    assert.equal((await get('/api/english/resource?paperId=unknown&type=paper&url=http://127.0.0.1')).status, 404)
    assert.equal((await get('/english-assets/companions/girl-base.png')).status, 200)
    console.log('英语资料路由通过：来源白名单、并发缓存、文件格式、MP3/M4A、静态人物图片')
  } finally {
    global.fetch = fetchOriginal
    await new Promise(resolve => server.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('campus-english-media-test-'))
    await fs.rm(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
