'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = path.resolve(__dirname, '..')
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
}).outputText
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const copy = value => JSON.parse(JSON.stringify(value))
const settle = () => new Promise(resolve => setImmediate(resolve))

async function checkHealthClient() {
  let now = Date.parse('2026-10-04T09:01:00Z'), logins = 0
  const requests = [], module = { exports: {} }
  class Clock extends Date { static now() { return now } }
  vm.runInNewContext(compile('miniprogram/utils/api-client.ts'), {
    module, exports: module.exports, Date: Clock,
    wx: { getStorageSync: () => '', login: () => { logins++ }, request: options => requests.push(options) },
    require: () => ({ API_BASE_URL: 'https://example.test/campus-api', API_CACHE_VERSION: 'test' })
  })
  const api = module.exports.api
  async function respond(statusCode, data, expected) {
    const startedAt = now, pending = api.getHealth(), request = requests.at(-1)
    assert.equal(request.method, 'GET')
    assert.equal(request.url, 'https://example.test/campus-api/health?_=' + startedAt)
    assert.equal(request.header.Authorization, undefined, 'health must be public')
    now += 120
    request.success({ statusCode, data })
    const result = await pending
    assert.deepEqual(copy(result), { ...expected, elapsedMs: 120, checkedAt: now })
    assert.deepEqual(Object.keys(result).sort(), ['checkedAt', 'database', 'elapsedMs', 'state'], 'only display fields leave the client')
  }
  await respond(200, { status: 'ok', database: 'ok', functions: 22, time: 'server-time' }, { state: 'online', database: 'ok' })
  await respond(200, JSON.stringify({ status: 'ok', database: 'ok' }), { state: 'online', database: 'ok' })
  await respond(503, { status: 'error', database: 'error' }, { state: 'error', database: 'error' })
  await respond(200, { status: 'ok', database: 'error' }, { state: 'error', database: 'error' })
  await respond(200, { status: 'degraded', database: 'ok' }, { state: 'error', database: 'ok' })
  await respond(200, { status: 'ok', database: 'ok', degraded: true }, { state: 'error', database: 'ok' })
  await respond(200, { status: 'ok' }, { state: 'unconfirmed', database: 'unconfirmed' })
  await respond(200, '<html>proxy response</html>', { state: 'unconfirmed', database: 'unconfirmed' })
  await respond(204, { status: 'ok', database: 'ok' }, { state: 'error', database: 'ok' })
  await respond(502, '<html>gateway error</html>', { state: 'error', database: 'unconfirmed' })
  const unavailable = api.getHealth()
  now += 15000
  requests.at(-1).fail({ errMsg: 'request:fail timeout private-address' })
  assert.deepEqual(copy(await unavailable), { state: 'unconfirmed', database: 'unconfirmed', elapsedMs: null, checkedAt: now })
  assert.equal(logins, 0, 'health failures must not trigger login')
  const snapshot = { status: 'ok', database: 'ok', sampledAt: '2026-10-04T09:00:00Z', cpu: { usagePercent: 12.6 }, memory: { usedBytes: 1024 ** 3, totalBytes: 2 * 1024 ** 3, usagePercent: 50 }, disk: { totalBytes: 40 * 1024 ** 3, usedBytes: 10 * 1024 ** 3, availableBytes: 28 * 1024 ** 3, usagePercent: 25 }, websiteStorage: { usedBytes: 512 * 1024 ** 2, checkedAt: '2026-10-04T09:00:00Z' }, uptimeSeconds: 183840, bootedAt: '2026-10-02T05:56:00Z', sites: [{ name: '个人主页', url: 'https://example.test/' }], giftSites: { activeCount: 7, publicCount: 3 }, external: { google: { state: 'unreachable', checkedAt: '2026-10-04T08:00:00Z', route: 'direct' }, youtube: { state: 'restricted', checkedAt: '2026-10-04T08:00:00Z', route: 'proxy' } } }
  async function statusResponse(data, statusCode = 200) {
    const startedAt = now, pending = api.getServerStatus(), request = requests.at(-1)
    assert.equal(request.url, 'https://example.test/campus-api/api/public/server-status?_=' + startedAt)
    assert.equal(request.method, 'GET'); assert.equal(request.header.Authorization, undefined)
    now += 100; request.success({ statusCode, data }); return copy(await pending)
  }
  const live = await statusResponse(snapshot)
  assert.equal(Object.hasOwn(live, 'sites'), false, 'website names and URLs do not leave the status client')
  assert.equal(live.state, 'online', 'external failures do not change the campus server health')
  assert.deepEqual([live.cpuUsagePercent, live.memoryUsedBytes, live.memoryTotalBytes, live.memoryUsagePercent, live.uptimeSeconds], [12.6, 1024 ** 3, 2 * 1024 ** 3, 50, 183840])
  assert.deepEqual([live.diskTotalBytes, live.diskUsedBytes, live.diskAvailableBytes, live.diskUsagePercent, live.websiteStorageUsedBytes, live.websiteStorageCheckedAt], [40 * 1024 ** 3, 10 * 1024 ** 3, 28 * 1024 ** 3, 25, 512 * 1024 ** 2, Date.parse(snapshot.websiteStorage.checkedAt)])
  assert.equal(live.external.google.checkedAt, Date.parse(snapshot.external.google.checkedAt), 'hourly network probe time remains its actual older sample time')
  assert.equal(live.external.youtube.state, 'restricted'); assert.equal(live.external.youtube.route, 'proxy')
  const zero = await statusResponse({ ...snapshot, cpu: { usagePercent: 0 }, giftSites: { activeCount: 0, publicCount: 0 }, sites: [], uptimeSeconds: 0 })
  assert.deepEqual([zero.cpuUsagePercent, zero.giftActiveCount, zero.giftPublicCount, zero.uptimeSeconds], [0, 0, 0, 0], 'real zero measurements are preserved')
  const degraded = await statusResponse({ ...snapshot, status: 'degraded', cpu: { usagePercent: null } })
  assert.equal(degraded.state, 'unconfirmed'); assert.equal(degraded.cpuUsagePercent, null)
  const invalid = await statusResponse({ ...snapshot, sampledAt: 'invalid', cpu: { usagePercent: 101 }, memory: { usedBytes: -1, totalBytes: '2000', usagePercent: Infinity }, uptimeSeconds: -1, giftSites: { activeCount: 1.5, publicCount: '3' }, sites: [{ name: 'bad', url: 'javascript:bad' }], external: { google: { state: 'invented', checkedAt: 'bad', route: 'invented' } } })
  assert.deepEqual([invalid.sampledAt, invalid.cpuUsagePercent, invalid.memoryUsedBytes, invalid.memoryTotalBytes, invalid.memoryUsagePercent, invalid.uptimeSeconds, invalid.giftActiveCount, invalid.giftPublicCount], Array(8).fill(null), 'invalid measurements are never made into zero values')
  assert.deepEqual(invalid.external.google, { state: 'unconfirmed', checkedAt: null, route: null })
  const storageFields = value => [value.diskTotalBytes, value.diskUsedBytes, value.diskAvailableBytes, value.diskUsagePercent, value.websiteStorageUsedBytes, value.websiteStorageCheckedAt]
  const noStorage = await statusResponse({ ...snapshot, disk: undefined, websiteStorage: undefined })
  assert.deepEqual(storageFields(noStorage), Array(6).fill(null), 'missing storage data remains unknown instead of becoming an empty disk')
  const badStorage = await statusResponse({ ...snapshot, disk: { totalBytes: '40', usedBytes: -1, availableBytes: Infinity, usagePercent: 101 }, websiteStorage: { usedBytes: NaN, checkedAt: 'invalid' } })
  assert.deepEqual(storageFields(badStorage), Array(6).fill(null), 'invalid storage numbers and times are rejected')
  const exceedsDisk = await statusResponse({ ...snapshot, disk: { totalBytes: 100, usedBytes: 101, availableBytes: 102, usagePercent: 101 } })
  assert.deepEqual([exceedsDisk.diskUsedBytes, exceedsDisk.diskAvailableBytes, exceedsDisk.diskUsagePercent], [null, null, null], 'bytes cannot exceed the reported disk capacity')
  const futureStorage = await statusResponse({ ...snapshot, websiteStorage: { usedBytes: 123, checkedAt: new Date(now + 60000).toISOString() } })
  assert.deepEqual([futureStorage.websiteStorageUsedBytes, futureStorage.websiteStorageCheckedAt], [null, null], 'a future website scan cannot be displayed as a current measurement')
  const zeroStorage = await statusResponse({ ...snapshot, disk: { totalBytes: 100, usedBytes: 0, availableBytes: 100, usagePercent: 0 }, websiteStorage: { usedBytes: 0, checkedAt: snapshot.websiteStorage.checkedAt } })
  assert.deepEqual([zeroStorage.diskUsedBytes, zeroStorage.diskUsagePercent, zeroStorage.websiteStorageUsedBytes], [0, 0, 0], 'verified zero storage measurements are preserved')
  const dbFailure = await statusResponse({ ...snapshot, status: 'error', database: 'error' }, 503)
  assert.equal(dbFailure.state, 'error'); assert.equal(dbFailure.database, 'error')
  const malformed = await statusResponse('<html>gateway page</html>')
  assert.equal(malformed.state, 'unconfirmed'); assert.equal(Object.hasOwn(malformed, 'sites'), false)
  const statusUnavailable = api.getServerStatus(); requests.at(-1).fail({ errMsg: 'request:fail' })
  const unknown = copy(await statusUnavailable)
  assert.deepEqual([unknown.state, unknown.elapsedMs, unknown.cpuUsagePercent, unknown.memoryUsagePercent, unknown.giftActiveCount], ['unconfirmed', null, null, null, null])
  assert.deepEqual(unknown.external.youtube, { state: 'unconfirmed', checkedAt: null, route: null })
}

function mountPortal() {
  const module = { exports: {} }, checks = [], timers = new Map(), clipboard = []
  let stops = 0, mutations = 0, nextTimer = 0
  vm.runInNewContext(compile('miniprogram/pages/portal/portal.ts'), {
    module, exports: module.exports, console: { error() {} },
    wx: { stopPullDownRefresh: () => { stops++ }, setClipboardData: options => clipboard.push(options.data) },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id },
    clearTimeout: id => timers.delete(id),
    getApp: () => ({ isLoggedIn: () => false, getUserInfo: () => null }),
    Page: value => { module.exports = value },
    require: ref => {
      if (ref.endsWith('/page-share')) return { withSharing: value => value }
      if (ref.endsWith('/page-copy')) return { withPageCopy: (scope, value) => value, getPageCopy: () => ({}) }
      if (ref.endsWith('/api-client')) return { api: { getServerStatus() { const check = deferred(); checks.push(check); return check.promise } } }
      if (ref.endsWith('/public-modules')) return { getPublicModules: async () => ({}) }
      if (ref.endsWith('/portal-daily')) return { getPortalDaily: () => ({}) }
      if (ref.endsWith('/companion-data')) return { getCompanionAppearance: () => ({}), companionImageUrl: value => value }
      if (ref.endsWith('/campus-theme')) return { getSavedCampusTheme: () => ({}) }
      throw new Error('Unexpected import: ' + ref)
    }
  })
  const page = { ...module.exports, data: copy(module.exports.data) }
  page.setData = patch => { mutations++; Object.assign(page.data, patch) }
  page.selectComponent = () => ({ refresh: callback => callback() })
  page.loadModules = async () => true
  page.loadCompanion = async () => true
  page.showAnnouncementIfNeeded = () => {}
  return { page, checks, timers, clipboard, mutations: () => mutations, stops: () => stops, tick() { const [id, timer] = [...timers.entries()][0]; timers.delete(id); timer.callback() } }
}

async function checkPortalLifecycle() {
  const online = { state: 'online', database: 'ok', elapsedMs: 87, checkedAt: 0, sampledAt: 0, cpuUsagePercent: 12.6, memoryUsagePercent: 50, memoryUsedBytes: 1024 ** 3, memoryTotalBytes: 2 * 1024 ** 3, diskTotalBytes: 40 * 1024 ** 3, diskUsedBytes: 10 * 1024 ** 3, diskAvailableBytes: 28 * 1024 ** 3, diskUsagePercent: 25, websiteStorageUsedBytes: 512 * 1024 ** 2, websiteStorageCheckedAt: 0, uptimeSeconds: 183840, bootedAt: 0, giftActiveCount: 7, giftPublicCount: 3, external: { google: { state: 'reachable', checkedAt: 0, route: 'direct' }, youtube: { state: 'restricted', checkedAt: 0, route: 'proxy' } } }
  const failed = { ...online, state: 'error', database: 'error', elapsedMs: 120 }
  const unknown = { ...online, state: 'unconfirmed', database: 'unconfirmed', elapsedMs: null, cpuUsagePercent: null, memoryUsagePercent: null, diskTotalBytes: null, diskUsedBytes: null, diskAvailableBytes: null, diskUsagePercent: null, websiteStorageUsedBytes: null, websiteStorageCheckedAt: null, uptimeSeconds: null, giftActiveCount: null, giftPublicCount: null, external: { google: { state: 'unconfirmed', checkedAt: null, route: null }, youtube: { state: 'unconfirmed', checkedAt: null, route: null } } }
  const first = mountPortal(), { page, checks } = first
  assert.equal(page.data.serverHealth.state, 'unconfirmed')
  page.onShow()
  assert.equal(checks.length, 1, 'entering the page checks health once')
  assert.equal(page.data.serverHealth.state, 'loading')
  checks[0].resolve(online)
  await settle()
  assert.equal(page.data.serverHealth.label, '在线')
  assert.equal(page.data.serverHealth.database, '正常')
  assert.equal(page.data.serverHealth.elapsed, '87 ms')
  assert.match(page.data.serverHealth.checkedAt, /^\d{2}:\d{2}:\d{2}$/)
  assert.deepEqual([page.data.serverHealth.cpu, page.data.serverHealth.memory, page.data.serverHealth.memoryDetail, page.data.serverHealth.uptimeDetail], ['12.6%', '50.0%', '1.00 GiB / 2.00 GiB', '2天 3小时 4分钟'])
  assert.deepEqual([page.data.serverHealth.diskTotal, page.data.serverHealth.diskUsed, page.data.serverHealth.diskAvailable, page.data.serverHealth.diskUsage, page.data.serverHealth.diskProgress, page.data.serverHealth.websiteStorage], ['40.00 GiB', '10.00 GiB', '28.00 GiB', '25.0%', 25, '512 MiB'])
  assert.equal(page.data.serverHealth.youtube.label, '受限')
  assert.equal(first.timers.size, 1); assert.equal([...first.timers.values()][0].delay, 10000)
  const older = page.loadServerHealth(), joined = page.loadServerHealth()
  assert.equal(older, joined, 'concurrent manual requests share the in-flight promise')
  assert.equal(checks.length, 2); assert.equal(first.timers.size, 0)
  assert.equal(page.data.serverHealth.state, 'online', 'refresh keeps existing measurements visible')
  assert.equal(page.data.serverHealth.cpu, '12.6%'); assert.equal(page.data.serverHealth.updating, true)
  const sharedRefresh = page.refreshPage(); assert.equal(checks.length, 2, 'pull refresh shares an in-flight manual request')
  checks[1].resolve(failed); assert.equal(await older, false); assert.equal(await sharedRefresh, false)
  assert.equal(first.timers.size, 1, 'a failed request schedules one bounded retry, not a retry storm')
  const beforeHide = page.loadServerHealth()
  page.onHide()
  assert.equal(first.timers.size, 0)
  const hiddenMutations = first.mutations()
  checks[2].resolve(online); await beforeHide
  assert.equal(first.mutations(), hiddenMutations, 'hidden pages ignore late results')
  assert.equal(first.timers.size, 0, 'a hidden late request cannot restart polling')
  assert.equal(await page.loadServerHealth(), false); assert.equal(checks.length, 3, 'hidden pages do not make manual requests')
  page.onShow()
  checks[3].resolve(unknown)
  await settle()
  assert.equal(page.data.serverHealth.label, '未确认', 'show after hide starts a new check')
  assert.equal(page.data.serverHealth.database, '未确认')
  assert.equal(page.data.serverHealth.elapsed, '—')
  assert.equal(page.data.serverHealth.cpu, '—'); assert.equal(page.data.serverHealth.giftActiveCount, '—')
  assert.deepEqual([page.data.serverHealth.diskTotal, page.data.serverHealth.diskUsed, page.data.serverHealth.diskProgress, page.data.serverHealth.websiteStorage, page.data.serverHealth.websiteStorageCheckedAt], ['—', '—', null, '—', '未确认'])
  page.onShow(); page.onHide(); page.onShow()
  checks[5].resolve(failed)
  await settle()
  checks[4].resolve(online)
  await settle()
  assert.equal(page.data.serverHealth.state, 'error', 'a prior visit cannot overwrite a new visit')
  assert.equal(first.timers.size, 1, 'the old promise cannot erase the fresh request timer')
  first.tick(); assert.equal(checks.length, 7); assert.equal(first.timers.size, 0)
  page.loadServerHealth(); assert.equal(checks.length, 7, 'polling and manual actions share one request')
  checks[6].resolve(online); await settle(); assert.equal(first.timers.size, 1)
  const retry = page.loadServerHealth()
  checks[7].resolve(online); assert.equal(await retry, true)
  assert.equal(page.data.serverHealth.state, 'online', 'manual retry can recover')
  const unexpected = page.loadServerHealth()
  checks[8].reject(new Error('unexpected failure')); assert.equal(await unexpected, false)
  assert.equal(page.data.serverHealth.state, 'unconfirmed')
  const refresh = page.refreshPage()
  checks[9].resolve(online); assert.equal(await refresh, true, 'custom pull refresh includes health')
  const failedRefresh = page.refreshPage()
  checks[10].resolve(failed); assert.equal(await failedRefresh, false)
  page.onPullDownRefresh()
  assert.equal(first.stops(), 0, 'native refresh waits for health')
  checks[11].resolve(online)
  await settle()
  assert.equal(first.stops(), 1)
  page.toggleServerDetails(); assert.equal(page.data.serverDetailsExpanded, true)
  page.copyPersonalHomepage()
  assert.deepEqual(first.clipboard, ['https://www.crbuj.icu/'], 'the requested personal homepage remains a separate friend link')
  const beforeUnload = page.loadServerHealth()
  page.onUnload()
  const unloadedMutations = first.mutations()
  checks[12].resolve(online); await beforeUnload
  assert.equal(first.mutations(), unloadedMutations)
  assert.equal(first.timers.size, 0, 'unloading cancels polling permanently')
  assert.equal(checks.length, 13)
}

async function main() {
  await checkHealthClient()
  await checkPortalLifecycle()
  const markup = fs.readFileSync(path.join(root, 'miniprogram/pages/portal/portal.wxml'), 'utf8')
  assert.equal(mountPortal().page.data.serverDetailsExpanded, false, 'the whole server card starts collapsed for visitors')
  const detailedStart = markup.indexOf('<view wx:if="{{serverDetailsExpanded}}" class="server-status-expanded">')
  assert.ok(detailedStart > markup.indexOf('server-details-toggle') && detailedStart < markup.indexOf('CPU 占用'), 'all measurements are inside the expandable section')
  assert.ok(markup.indexOf('server-status-card') > markup.indexOf('logout-section'), 'status card belongs at the bottom')
  assert.match(markup, /disabled="\{\{serverHealth.updating\}\}"/)
  assert.match(markup, /请求耗时/)
  assert.match(markup, /每小时检测/); assert.match(markup, /连续守护/)
  assert.match(markup, /整机内存/); assert.match(markup, /硬盘 · 已用 \/ 总容量/); assert.match(markup, /网站占用/); assert.match(markup, /不含运维备份/)
  assert.ok(markup.indexOf('friend-links-card') > markup.indexOf('server-status-card'))
  assert.doesNotMatch(markup, /serverHealth\.sites|serverHealth\.siteCount|copyServerSite|公开网站/,'existing websites are not displayed')
  assert.doesNotMatch(markup, /\bping\b|functions|API_BASE_URL/i)
  console.log('首页服务器状态：真实主机/每小时外网样本/祝福计数/10秒可见轮询/并发合并/离页与迟到保护/公开链接回归通过')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
