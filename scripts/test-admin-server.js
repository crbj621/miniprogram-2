const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const requests = []
const context = {
  window: { location: { origin: 'https://www.crbuj.icu', pathname: '/campus-api/admin/index.html' } },
  localStorage: { getItem: () => 'test-token', removeItem() {} },
  FormData, console,
  fetch: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) })
    return { ok: true, json: async () => ({ stats: { updated: 1 } }) }
  }
}
vm.createContext(context)
vm.runInContext(fs.readFileSync('admin-web/js/config.js', 'utf8'), context)
vm.runInContext(fs.readFileSync('admin-web/js/auth.js', 'utf8'), context)

async function main() {
  context.initServer()
  await context.db.collection('forum_post').doc('post').update({ status: 'hidden', content: '测试内容' })
  assert.equal(requests[0].url, 'https://www.crbuj.icu/campus-api/api/admin/database')
  assert.deepEqual(requests[0].body.data, { status: 'hidden', content: '测试内容' })
  await context.db.collection('forum_announcement').add({ name: '测试公告' })
  assert.deepEqual(requests[1].body.data, { name: '测试公告' })
  assert.equal(context.cloudbase, undefined)
  console.log('后台子路径和数据库写入内容：通过')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
