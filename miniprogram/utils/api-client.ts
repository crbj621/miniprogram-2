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

export const api = { call: callFunction, uploadFile, downloadFile, watchTeams, syncWeRun }
