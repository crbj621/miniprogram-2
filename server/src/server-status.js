'use strict'

const os = require('node:os')
const fs = require('node:fs/promises')
const http = require('node:http')
const https = require('node:https')
const { execFile } = require('node:child_process')
const { normalizeModules } = require('./module-policy')
const targets = { google: 'https://www.google.com/', youtube: 'https://www.youtube.com/' }
const websitePaths = ['/www/wwwroot/crbuj.icu', '/www/wwwroot/galaxy-heart', '/opt/campus-api', '/www/campus-data']

function cpuTotals(cpus) {
  if (!Array.isArray(cpus) || !cpus.length) return null
  let total = 0, idle = 0
  for (const cpu of cpus) {
    if (!cpu || !cpu.times) return null
    for (const name of ['user', 'nice', 'sys', 'idle', 'irq']) {
      const value = cpu.times[name]
      if (!Number.isFinite(value) || value < 0) return null
      total += value
    }
    idle += cpu.times.idle
  }
  return Number.isFinite(total) ? { total, idle } : null
}

function cpuUsage(previous, current) {
  const before = cpuTotals(previous), after = cpuTotals(current)
  if (!before || !after || previous.length !== current.length) return null
  const total = after.total - before.total, idle = after.idle - before.idle
  if (total <= 0 || idle < 0 || idle > total) return null
  return Math.round((total - idle) / total * 1000) / 10
}

function memoryUsage(totalBytes, availableBytes) {
  const unknown = { totalBytes: null, availableBytes: null, usedBytes: null, usagePercent: null }
  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(availableBytes) || availableBytes < 0 || availableBytes > totalBytes) return unknown
  return { totalBytes, availableBytes, usedBytes: totalBytes - availableBytes, usagePercent: Math.round((totalBytes - availableBytes) / totalBytes * 1000) / 10 }
}

function diskUsage(stats) {
  const unknown = { totalBytes: null, usedBytes: null, availableBytes: null, usagePercent: null }
  if (!stats || !['blocks', 'bfree', 'bavail', 'bsize'].every(key => Number.isFinite(stats[key]) && stats[key] >= 0) || !stats.bsize || !stats.blocks || stats.bfree > stats.blocks || stats.bavail > stats.bfree) return unknown
  const totalBytes = stats.blocks * stats.bsize, usedBytes = (stats.blocks - stats.bfree) * stats.bsize, availableBytes = stats.bavail * stats.bsize
  if (![totalBytes, usedBytes, availableBytes].every(Number.isSafeInteger)) return unknown
  return { totalBytes, usedBytes, availableBytes, usagePercent: Math.round(usedBytes / totalBytes * 1000) / 10 }
}

function websiteStorageBytes(output) {
  if (typeof output !== 'string') return null
  const lines = output.trim().split('\n'), seen = new Set()
  let total = 0
  for (const line of lines) {
    const match = line.match(/^(\d+)\s+(.+)$/)
    if (!match || !websitePaths.includes(match[2]) || seen.has(match[2])) return null
    const bytes = Number(match[1]); if (!Number.isSafeInteger(bytes)) return null
    seen.add(match[2]); total += bytes
  }
  return seen.size === websitePaths.length && Number.isSafeInteger(total) ? total : null
}

function probeEndpoint(url, options = {}) {
  return new Promise(resolve => {
    const started = performance.now(), client = new URL(url).protocol === 'http:' ? http : https
    let finished = false
    const finish = (state, httpStatus = null) => {
      if (finished) return
      finished = true
      resolve({ state, httpStatus, latencyMs: Math.round(performance.now() - started) })
    }
    const request = client.request(url, { method: 'HEAD', agent: options.agent, signal: options.signal }, response => {
      const status = response.statusCode
      finish(status >= 200 && status < 400 ? 'reachable' : [403, 429].includes(status) ? 'restricted' : 'unreachable', status)
      response.resume()
    })
    request.once('error', () => finish('unreachable'))
    request.end()
  })
}

function createServerStatus(dependencies = {}) {
  const host = dependencies.os || os, readFile = dependencies.readFile || fs.readFile, now = dependencies.now || Date.now
  const statfs = dependencies.statfs || fs.statfs, execute = dependencies.execFile || execFile
  const interval = dependencies.setInterval || setInterval, clear = dependencies.clearInterval || clearInterval
  const getPool = dependencies.getPool, probe = dependencies.probe || probeEndpoint
  const createAgent = dependencies.createAgent || (options => new https.Agent(options))
  const proxyUrl = dependencies.proxyUrl === undefined ? process.env.SERVER_STATUS_PROXY_URL || '' : dependencies.proxyUrl
  if (proxyUrl) {
    const proxy = new URL(proxyUrl)
    if (!['http:', 'https:'].includes(proxy.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(proxy.hostname)) throw Error('服务器状态代理必须使用本机 HTTP 代理')
  }
  const directAgent = createAgent({ keepAlive: true, maxSockets: 2, maxFreeSockets: 2, proxyEnv: {} })
  const proxyAgent = proxyUrl ? createAgent({ keepAlive: true, maxSockets: 2, maxFreeSockets: 2, proxyEnv: { HTTPS_PROXY: proxyUrl, NO_PROXY: '' } }) : null
  const controller = new AbortController(), route = proxyAgent ? 'proxy' : 'direct'
  let closed = false, previousCpus = null, hostJob = null, databaseJob = null, networkJob = null, storageJob = null, storageChild = null, databaseChecked = null
  let sampledAt = null, cpu = { usagePercent: null }, memory = memoryUsage(null, null), uptimeSeconds = null, bootedAt = null
  let disk = diskUsage(null), websiteStorage = { usedBytes: null, checkedAt: null }
  let database = 'unknown', giftSites = { activeCount: null, publicCount: null, checkedAt: null }
  let external = Object.fromEntries(Object.keys(targets).map(name => [name, { state: 'unconfirmed', checkedAt: null, route }]))
  const stamp = () => new Date(now()).toISOString()

  function sampleHost() {
    if (closed || hostJob) return hostJob
    hostJob = (async () => {
      let current = null, usagePercent = null, nextMemory = memoryUsage(null, null), nextDisk = diskUsage(null), uptime = null
      try { current = host.cpus(); usagePercent = cpuUsage(previousCpus, current) } catch (_) {}
      previousCpus = current
      try { const value = host.uptime(); if (Number.isFinite(value) && value >= 0) uptime = value } catch (_) {}
      try {
        if (host.platform() === 'linux') {
          const content = await readFile('/proc/meminfo', 'utf8'), total = content.match(/^MemTotal:\s+(\d+)\s+kB\s*$/m), available = content.match(/^MemAvailable:\s+(\d+)\s+kB\s*$/m)
          if (total && available) nextMemory = memoryUsage(Number(total[1]) * 1024, Number(available[1]) * 1024)
        } else nextMemory = memoryUsage(host.totalmem(), host.freemem())
      } catch (_) {}
      try { nextDisk = diskUsage(await statfs('/')) } catch (_) {}
      if (closed) return
      sampledAt = stamp(); cpu = { usagePercent }; memory = nextMemory; disk = nextDisk; uptimeSeconds = uptime
      bootedAt = uptime === null ? null : new Date(now() - uptime * 1000).toISOString()
    })().finally(() => { hostJob = null })
    return hostJob
  }

  function refreshDatabase() {
    if (closed || databaseJob || databaseChecked !== null && now() - databaseChecked < 30000) return databaseJob
    databaseJob = (async () => {
      try {
        const pool = getPool()
        const [settings] = await pool.query({ sql: "SELECT JSON_EXTRACT(document_data, '$.modules') AS modules FROM app_documents WHERE collection_name = ? ORDER BY document_id LIMIT 1", timeout: 5000 }, ['global_settings'])
        if (closed) return
        if (!settings.length) throw Error('模块配置尚未读取')
        let modules = settings[0].modules
        if (Buffer.isBuffer(modules)) modules = modules.toString('utf8')
        if (typeof modules === 'string') modules = JSON.parse(modules)
        if (!modules || typeof modules !== 'object' || Array.isArray(modules)) throw Error('模块配置尚未读取')
        let activeCount = 0, publicCount = 0
        if (normalizeModules(modules).gifts.enabled) {
          const [counts] = await pool.query({ sql: "SELECT COUNT(*) AS active_count, COALESCE(SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(document_data, '$.listed')) = 'true' THEN 1 ELSE 0 END), 0) AS public_count FROM app_documents WHERE collection_name = ? AND JSON_UNQUOTE(JSON_EXTRACT(document_data, '$.status')) = 'published' AND JSON_UNQUOTE(JSON_EXTRACT(document_data, '$.expiresAt')) > ?", timeout: 5000 }, ['gift_sites', stamp()])
          if (closed) return
          activeCount = Number(counts[0] && counts[0].active_count); publicCount = Number(counts[0] && counts[0].public_count)
          if (![activeCount, publicCount].every(value => Number.isSafeInteger(value) && value >= 0) || publicCount > activeCount) throw Error('站点统计读取失败')
        }
        if (!closed) { database = 'ok'; giftSites = { activeCount, publicCount, checkedAt: stamp() } }
      } catch (_) {
        if (!closed) { database = 'error'; giftSites = { activeCount: null, publicCount: null, checkedAt: stamp() } }
      } finally { databaseChecked = now() }
    })().finally(() => { databaseJob = null })
    return databaseJob
  }

  function refreshNetwork() {
    if (closed || networkJob) return networkJob
    networkJob = Promise.all(Object.entries(targets).map(async ([name, url]) => {
      const check = async (path, agent) => {
        let result
        try { result = await probe(url, { route: path, agent, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) }) }
        catch (_) { result = { state: 'unreachable', httpStatus: null, latencyMs: null } }
        return { ...result, checkedAt: stamp(), route: path }
      }
      const [direct, proxied] = await Promise.all([check('direct', directAgent), proxyAgent ? check('proxy', proxyAgent) : Promise.resolve(null)])
      return [name, proxied ? { ...proxied, directState: direct.state, directCheckedAt: direct.checkedAt } : direct]
    })).then(results => { if (!closed) external = Object.fromEntries(results) }).finally(() => { networkJob = null })
    return networkJob
  }

  function refreshStorage() {
    if (closed || storageJob) return storageJob
    const files = new Promise((resolve, reject) => {
      storageChild = execute('du', ['-s', '-B1', '--', ...websitePaths], { timeout: 10000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => {
        storageChild = null
        const bytes = error ? null : websiteStorageBytes(stdout)
        if (bytes === null) reject(Error('网站文件占用读取失败'))
        else resolve(bytes)
      })
    })
    const databaseBytes = (async () => {
      const [rows] = await getPool().query({ sql: 'SELECT COALESCE(SUM(data_length + index_length), 0) AS storage_bytes FROM information_schema.tables WHERE table_schema = DATABASE()', timeout: 5000 }, [])
      const value = Number(rows[0] && rows[0].storage_bytes)
      if (!Number.isSafeInteger(value) || value < 0) throw Error('业务数据库占用读取失败')
      return value
    })()
    storageJob = Promise.allSettled([files, databaseBytes]).then(results => {
      if (closed) return
      const sum = results.every(result => result.status === 'fulfilled') ? results.reduce((total, result) => total + result.value, 0) : null
      websiteStorage = { usedBytes: Number.isSafeInteger(sum) ? sum : null, checkedAt: stamp() }
    }).finally(() => { storageJob = null })
    return storageJob
  }

  const ready = Promise.all([sampleHost(), refreshDatabase()])
  refreshNetwork(); refreshStorage()
  const hostTimer = interval(sampleHost, 5000), networkTimer = interval(refreshNetwork, 3600000), storageTimer = interval(refreshStorage, 300000)
  if (hostTimer.unref) hostTimer.unref()
  if (networkTimer.unref) networkTimer.unref()
  if (storageTimer.unref) storageTimer.unref()
  return {
    ready,
    snapshot() {
      if (!closed) refreshDatabase()
      return JSON.parse(JSON.stringify({ status: database === 'ok' ? 'ok' : database === 'error' ? 'error' : 'unknown', database, sampledAt, cpu, memory, disk, websiteStorage, uptimeSeconds, bootedAt, giftSites, external }))
    },
    close() {
      if (closed) return
      closed = true; clear(hostTimer); clear(networkTimer); clear(storageTimer); controller.abort(); directAgent.destroy(); if (proxyAgent) proxyAgent.destroy(); if (storageChild) storageChild.kill()
    }
  }
}

module.exports = { createServerStatus, cpuUsage, memoryUsage, diskUsage, websiteStorageBytes, probeEndpoint }
