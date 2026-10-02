'use strict'

async function main() {
  if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET) throw new Error('微信配置缺失')
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token')
  url.searchParams.set('grant_type', 'client_credential')
  url.searchParams.set('appid', process.env.WECHAT_APP_ID)
  url.searchParams.set('secret', process.env.WECHAT_APP_SECRET)
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  const data = await response.json()
  console.log(JSON.stringify({ wechatCredentialsValid: Boolean(data.access_token), errorCode: data.errcode || 0 }))
  if (!data.access_token) process.exitCode = 1
}
main().catch(() => { console.error('微信凭证验证请求失败'); process.exitCode = 1 })
