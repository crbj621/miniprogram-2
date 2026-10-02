'use strict'
const assert = require('node:assert/strict')

async function main() {
  const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3100'
  const redirected = await fetch(base + '/admin', { redirect: 'manual' })
  assert.equal(redirected.status, 301)
  assert.equal(redirected.headers.get('location'), process.env.PUBLIC_BASE_URL.replace(/\/+$/, '') + '/admin/')
  const page = await fetch(base + '/admin/', { redirect: 'manual' })
  assert.equal(page.status, 200, '带斜杠的后台地址不能循环重定向')
  const csp = page.headers.get('content-security-policy')
  assert.ok(csp.includes("script-src 'self' 'unsafe-inline'"))
  assert.ok(csp.includes("script-src-attr 'unsafe-inline'"), '已有按钮 onclick 需要兼容')
  const html = await page.text()
  assert.ok(!html.includes('cloudbase-js-sdk'))
  const config = await fetch(base + '/admin/js/config.js')
  assert.equal(config.status, 200)
  console.log('后台页面、脚本、按钮策略与路径重定向：通过')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
