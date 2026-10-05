import { API_BASE_URL, API_CACHE_VERSION } from '../config/api'

const TOKEN_KEY = 'selfhost_token'
const OPENID_KEY = 'openid'
const POLL_INTERVAL_MS = 2500

let loginPromise: Promise<string> | null = null
let sessionVersion = 0

export function clearServerSession(): void {
  sessionVersion += 1
  loginPromise = null
  wx.removeStorageSync(TOKEN_KEY)
}

function apiUrl(path: string): string {
  return API_BASE_URL.replace(/\/+$/, '') + path
}

function connectionError(error: any): Error {
  const detail = String(error && (error.errMsg || error.message) || '')
  if (/domain list|合法域名/.test(detail)) return new Error('请在微信后台配置服务器合法域名 www.crbuj.icu')
  return new Error('无法连接校园服务器，请检查网络或联系管理员' + (detail ? '：' + detail : ''))
}

function parseResponseData(value: any): any {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (error) {
    return value
  }
}

function loginToServer(forceRefresh?: boolean): Promise<string> {
  if (forceRefresh) {
    wx.removeStorageSync(TOKEN_KEY)
  }

  const cachedToken = wx.getStorageSync(TOKEN_KEY)
  if (cachedToken) return Promise.resolve(String(cachedToken))
  if (loginPromise) return loginPromise
  const requestSessionVersion = sessionVersion

  const pendingLogin = new Promise<string>((resolve, reject) => {
    wx.login({
      success(loginResult) {
        if (!loginResult.code) {
          reject(new Error('微信登录未返回有效凭证'))
          return
        }

        wx.request({
          url: apiUrl('/api/auth/wechat'),
          method: 'POST',
          timeout: 15000,
          data: { code: loginResult.code },
          success(response: any) {
            const body = parseResponseData(response.data)
            if (requestSessionVersion !== sessionVersion) {
              reject(new Error('登录已取消'))
              return
            }
            if (
              response.statusCode < 200 ||
              response.statusCode >= 300 ||
              !body ||
              body.code !== 0 ||
              !body.data ||
              !body.data.token
            ) {
              reject(new Error((body && body.message) || '服务器登录失败'))
              return
            }

            wx.setStorageSync(TOKEN_KEY, body.data.token)
            if (body.data.openid) wx.setStorageSync(OPENID_KEY, body.data.openid)
            resolve(body.data.token)
          },
          fail(error) {
            reject(connectionError(error))
          }
        })
      },
      fail(error) {
        reject(connectionError(error))
      }
    })
  })

  let activeLogin: Promise<string>
  activeLogin = pendingLogin.then(token => {
    if (loginPromise === activeLogin) loginPromise = null
    return token
  }).catch(error => {
    if (loginPromise === activeLogin) loginPromise = null
    throw error
  })

  loginPromise = activeLogin
  return activeLogin
}

function invokeFunction(name: string, data: any, retried?: boolean): Promise<any> {
  const requestSessionVersion = sessionVersion
  const publicModules = name === 'globalAdmin' && data && data.action === 'getPublicModules'
  const session = publicModules ? Promise.resolve('') : loginToServer(Boolean(retried))
  return session.then(token => new Promise((resolve, reject) => {
    wx.request({
      url: apiUrl(publicModules ? '/api/public/modules' : '/api/functions/' + encodeURIComponent(name)),
      timeout: 15000,
      method: publicModules ? 'GET' : 'POST',
      data: publicModules ? undefined : data || {},
      header: token ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : {},
      success(response: any) {
        const body = parseResponseData(response.data)
        if (!publicModules && requestSessionVersion !== sessionVersion) {
          reject(new Error('请求已取消'))
          return
        }
        if (response.statusCode === 401 && !retried && !publicModules) {
          wx.removeStorageSync(TOKEN_KEY)
          invokeFunction(name, data, true).then(resolve).catch(reject)
          return
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error((body && (body.errMsg || body.message)) || '服务器请求失败'))
          return
        }
        resolve({
          result: body,
          requestID: response.header && (
            response.header['X-Request-Id'] ||
            response.header['x-request-id']
          )
        })
      },
      fail(error) {
        reject(connectionError(error))
      }
    })
  }))
}

function withCallbacks(promise: Promise<any>, options: any): Promise<any> {
  return promise.then(result => {
    if (typeof options.success === 'function') options.success(result)
    if (typeof options.complete === 'function') options.complete(result)
    return result
  }).catch(error => {
    if (typeof options.fail === 'function') options.fail(error)
    if (typeof options.complete === 'function') options.complete(error)
    throw error
  })
}

function callFunction(options: any): Promise<any> {
  const settings = options || {}
  return withCallbacks(
    invokeFunction(String(settings.name || ''), settings.data || {}),
    settings
  )
}

function uploadFile(options: any): Promise<any> {
  const settings = options || {}
  const request = loginToServer().then(token => new Promise((resolve, reject) => {
    wx.uploadFile({
      url: apiUrl('/api/files/upload'),
      filePath: settings.filePath,
      name: 'file',
      formData: { cloudPath: settings.cloudPath || '' },
      header: { Authorization: 'Bearer ' + token },
      success(response: any) {
        const body = parseResponseData(response.data)
        if (response.statusCode < 200 || response.statusCode >= 300 || !body || !body.fileID) {
          reject(new Error((body && body.message) || '文件上传失败'))
          return
        }
        resolve({ fileID: body.fileID, statusCode: response.statusCode })
      },
      fail(error) {
        reject(connectionError(error))
      }
    })
  }))
  return withCallbacks(request, settings)
}

function downloadFile(options: any): Promise<any> {
  const settings = options || {}
  const request = new Promise((resolve, reject) => {
    wx.downloadFile({
      url: settings.fileID,
      success(response: any) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response)
          return
        }
        reject(new Error('文件下载失败'))
      },
      fail(error) {
        reject(connectionError(error))
      }
    })
  })
  return withCallbacks(request, settings)
}

function watchTeams(options: any): any {
  const settings = options || {}
  let closed = false
  let timer: number | null = null
  let lastSignature = ''
  let reportedError = false

  const poll = () => {
    if (closed) return
    invokeFunction('teamManager', { action: 'getMyTeamEvents' }).then(response => {
      if (closed) return
      const result = response && response.result
      if (!result || result.success === false) {
        throw new Error((result && result.errMsg) || '组队状态同步失败')
      }
      const docs = Array.isArray(result.data) ? result.data : []
      const signature = JSON.stringify(docs.map((team: any) => [
        team._id,
        team.status,
        team.updateTime,
        team.memberCount,
        team.runningMembers,
        team.realtimeData
      ]))
      if (signature !== lastSignature) {
        lastSignature = signature
        if (typeof settings.onChange === 'function') settings.onChange({ docs })
      }
      reportedError = false
    }).catch(error => {
      if (!reportedError && typeof settings.onError === 'function') {
        settings.onError(error)
      }
      reportedError = true
    }).then(() => {
      if (!closed) timer = setTimeout(poll, POLL_INTERVAL_MS) as any
    })
  }

  poll()
  return {
    close() {
      closed = true
      if (timer !== null) clearTimeout(timer)
    }
  }
}

export function initializeServerClient(): void {
  const backend = API_CACHE_VERSION + ':' + API_BASE_URL
  if (wx.getStorageSync('server_backend') !== backend) {
    clearServerSession()
    const saved: { key: string; value: any }[] = []
    const keys = wx.getStorageInfoSync().keys
    keys.filter(key => /^(pending_runs_|active_run_)/.test(key)).forEach(key => {
      saved.push({ key, value: wx.getStorageSync(key) })
    })
    wx.clearStorageSync()
    saved.forEach(item => wx.setStorageSync(item.key, item.value))
    wx.setStorageSync('server_backend', backend)
  }
}

function syncWeRun(): Promise<any> {
  const version = sessionVersion
  return new Promise<void>((resolve, reject) => {
    wx.authorize({ scope: 'scope.werun', success: () => resolve(),
      fail: () => reject(new Error('微信运动未授权，请在小程序设置中允许微信运动')) })
  }).then(() => loginToServer(true)).then(token => new Promise((resolve, reject) => {
    wx.getWeRunData({
      success: data => {
        wx.request({ url: apiUrl('/api/we-run'), method: 'POST', timeout: 15000,
          header: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          data: { encryptedData: data.encryptedData, iv: data.iv },
          success: (response: any) => {
            const body = parseResponseData(response.data)
            if (version !== sessionVersion) { reject(new Error('请求已取消')); return }
            if (response.statusCode !== 200 || body.code !== 0) { reject(new Error(body.message || '同步失败')); return }
            resolve(body.data)
          }, fail: error => reject(connectionError(error)) })
      }, fail: () => reject(new Error('获取微信运动失败，请确认手机已开启微信运动')) })
  }))
}

function getPublic(path: string): Promise<any> {
  return publicRequest(path, 'GET')
}
function publicRequest(path: string, method: 'GET' | 'POST', data?: any): Promise<any> {
  const giftRequest = /^\/api\/gifts\/[a-f0-9]{24}(\/messages)?$/.test(path)
  if (method === 'POST' && !/^\/api\/gifts\/[a-f0-9]{24}\/messages$/.test(path)) return Promise.reject(new Error('公开写入路径无效'))
  const cookieKey = 'gift_visitor_cookie:' + API_BASE_URL, cookie = giftRequest ? wx.getStorageSync(cookieKey) : ''
  return new Promise((resolve, reject) => {
    wx.request({ url: apiUrl(path), timeout: 15000, method, data, header: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, success(response: any) {
      if (giftRequest) {
        const headers = response.header || {}, values = [].concat(response.cookies || [], headers['Set-Cookie'] || headers['set-cookie'] || []).join(';')
        const found = values.match(/gift_visitor=[a-f0-9]{32}\.[a-f0-9]{64}/)
        if (found) wx.setStorageSync(cookieKey, found[0])
      }
      const body = parseResponseData(response.data)
      if (response.statusCode !== 200) { const error: any = new Error(body && (body.message || body.msg) || '内容已到期或暂不可用'); error.statusCode = response.statusCode; error.responseData = body; reject(error); return }
      resolve(body)
    }, fail: error => reject(connectionError(error)) })
  })
}
export interface ServerHealth {
  state: 'online' | 'error' | 'unconfirmed'
  database: 'ok' | 'error' | 'unconfirmed'
  elapsedMs: number | null
  checkedAt: number
}

async function getHealth(): Promise<ServerHealth> {
  const startedAt = Date.now()
  let body: any, statusCode = 200
  try {
    // Each check reads the current health response instead of a cached GET.
    body = await getPublic('/health?_=' + startedAt)
  } catch (error) {
    if (!error.statusCode) return { state: 'unconfirmed', database: 'unconfirmed', elapsedMs: null, checkedAt: Date.now() }
    statusCode = error.statusCode
    body = error.responseData
  }
  const database = body && body.database === 'ok' ? 'ok' : body && body.database === 'error' ? 'error' : 'unconfirmed'
  const failed = statusCode !== 200 || body && (body.status === 'error' || body.status === 'degraded' || body.degraded === true || database === 'error')
  const state = failed ? 'error' : body && body.status === 'ok' && database === 'ok' ? 'online' : 'unconfirmed'
  return { state, database, elapsedMs: Math.max(0, Date.now() - startedAt), checkedAt: Date.now() }
}

export interface ServerExternalStatus {
  state: 'reachable' | 'unreachable' | 'restricted' | 'unconfirmed'
  checkedAt: number | null
  route: 'direct' | 'proxy' | null
}
export interface ServerStatus extends ServerHealth {
  sampledAt: number | null
  cpuUsagePercent: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  memoryUsagePercent: number | null
  diskTotalBytes: number | null
  diskUsedBytes: number | null
  diskAvailableBytes: number | null
  diskUsagePercent: number | null
  websiteStorageUsedBytes: number | null
  websiteStorageCheckedAt: number | null
  uptimeSeconds: number | null
  bootedAt: number | null
  giftActiveCount: number | null
  giftPublicCount: number | null
  external: { google: ServerExternalStatus; youtube: ServerExternalStatus }
}

function statusNumber(value: any, maximum = Infinity): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum ? value : null
}
function statusTime(value: any): number | null {
  const time = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(time) ? time : null
}
function externalStatus(value: any): ServerExternalStatus {
  const state = value && ['reachable', 'unreachable', 'restricted'].includes(value.state) ? value.state : 'unconfirmed'
  return { state, checkedAt: statusTime(value && value.checkedAt), route: value && (value.route === 'direct' || value.route === 'proxy') ? value.route : null }
}
async function getServerStatus(): Promise<ServerStatus> {
  const startedAt = Date.now()
  let body: any, statusCode = 0
  try { body = await getPublic('/api/public/server-status?_=' + startedAt); statusCode = 200 }
  catch (error) { statusCode = error.statusCode || 0; body = error.responseData }
  body = body && typeof body === 'object' ? body : {}
  const database = body.database === 'ok' ? 'ok' : body.database === 'error' ? 'error' : 'unconfirmed'
  const failed = statusCode !== 0 && statusCode !== 200 || body.status === 'error' || database === 'error'
  const state = failed ? 'error' : statusCode === 200 && body.status === 'ok' && database === 'ok' ? 'online' : 'unconfirmed'
  const checkedAt = Date.now(), memory = body.memory || {}, disk = body.disk || {}, website = body.websiteStorage || {}, gifts = body.giftSites || {}
  const diskTotalBytes = statusNumber(disk.totalBytes) || null, storageTime = statusTime(website.checkedAt)
  const websiteStorageCheckedAt = storageTime !== null && storageTime <= checkedAt ? storageTime : null
  return {
    state, database, elapsedMs: statusCode ? Math.max(0, checkedAt - startedAt) : null, checkedAt,
    sampledAt: statusTime(body.sampledAt), cpuUsagePercent: statusNumber(body.cpu && body.cpu.usagePercent, 100),
    memoryUsedBytes: statusNumber(memory.usedBytes), memoryTotalBytes: statusNumber(memory.totalBytes) || null,
    memoryUsagePercent: statusNumber(memory.usagePercent, 100), uptimeSeconds: statusNumber(body.uptimeSeconds), bootedAt: statusTime(body.bootedAt),
    diskTotalBytes, diskUsedBytes: statusNumber(disk.usedBytes, diskTotalBytes || Infinity), diskAvailableBytes: statusNumber(disk.availableBytes, diskTotalBytes || Infinity), diskUsagePercent: statusNumber(disk.usagePercent, 100),
    websiteStorageUsedBytes: websiteStorageCheckedAt === null ? null : statusNumber(website.usedBytes), websiteStorageCheckedAt,
    giftActiveCount: Number.isInteger(gifts.activeCount) ? statusNumber(gifts.activeCount) : null,
    giftPublicCount: Number.isInteger(gifts.publicCount) ? statusNumber(gifts.publicCount) : null,
    external: { google: externalStatus(body.external && body.external.google), youtube: externalStatus(body.external && body.external.youtube) }
  }
}

export const api = { call: callFunction, uploadFile, downloadFile, watchTeams, syncWeRun, getPublic, getHealth, getServerStatus, postPublic: (path: string, data: any) => publicRequest(path, 'POST', data) }
