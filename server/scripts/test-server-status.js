'use strict'

const assert = require('node:assert/strict')
const http = require('node:http')
const https = require('node:https')
const { once } = require('node:events')
const { createServerStatus, cpuUsage, memoryUsage, diskUsage, websiteStorageBytes, probeEndpoint } = require('../src/server-status')
let checks = 0
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
const ok = (value, label) => { assert.ok(value, label); checks++ }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
const cpus = (user, idle) => [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }, { times: { user, nice: 0, sys: 0, idle, irq: 0 } }]
const duOutput = '1024\t/www/wwwroot/crbuj.icu\n2048\t/www/wwwroot/galaxy-heart\n4096\t/opt/campus-api\n8192\t/www/campus-data\n'

function fixture(extra = {}) {
  const timers = new Map(), queries = [], probes = [], agents = [], processes = []
  let clock = Date.parse('2031-10-01T00:00:00.000Z'), cores = cpus(100, 300), content = 'MemTotal: 2048 kB\nMemAvailable: 1536 kB\nMemFree: 128 kB\n', failing = false, modules = { gifts: { enabled: true } }, timerId = 0
  const pool = { query: async (options, params) => {
    queries.push({ options, params })
    equal(options.timeout, 5000, 'each status SQL query has a five-second timeout')
    if (failing) throw Error('Injected SQL failure')
    if (options.sql.includes('information_schema.tables')) { equal(params, [], 'database allocation is scoped to the existing current connection'); assert.match(options.sql, /table_schema = DATABASE\(\)/); checks++; return [[{ storage_bytes: '10240' }]] }
    if (params[0] === 'global_settings') return [[{ modules: JSON.stringify(modules) }]]
    equal(params, ['gift_sites', new Date(clock).toISOString()], 'count queries use only the formal collection and current expiry boundary')
    assert.match(options.sql, /JSON_UNQUOTE\(JSON_EXTRACT\(document_data, '\$\.status'\)\) = 'published'/); checks++
    assert.match(options.sql, /JSON_UNQUOTE\(JSON_EXTRACT\(document_data, '\$\.expiresAt'\)\) > \?/); checks++
    assert.match(options.sql, /JSON_UNQUOTE\(JSON_EXTRACT\(document_data, '\$\.listed'\)\) = 'true'/); checks++
    ok(!/SELECT\s+\*|SELECT\s+document_data|\.url|\.message|\.openid/.test(options.sql), 'aggregate reads no private site URL, owner or message')
    // Two active formal sites (one listed), plus expired, blocked and temporary rows.
    // The SQL predicates above are required before this aggregate can be returned.
    return [[{ active_count: '2', public_count: '1' }]]
  } }
  const dependencies = {
    getPool: () => pool, now: () => clock, proxyUrl: '',
    os: { cpus: () => cores, uptime: () => 172800, platform: () => 'linux', totalmem: () => 2048 * 1024, freemem: () => 128 * 1024 },
    readFile: async () => content,
    statfs: async root => { equal(root, '/', 'disk sampling reads the fixed host root filesystem'); return { blocks: 100, bfree: 25, bavail: 20, bsize: 1024 } },
    execFile: (command, args, options, callback) => { const child = { command, args, options, killed: false, kill() { this.killed = true } }; processes.push(child); queueMicrotask(() => callback(null, duOutput)); return child },
    setInterval: (callback, delay) => { const handle = { id: ++timerId, callback, delay, unref() { this.unreferenced = true } }; timers.set(handle.id, handle); return handle },
    clearInterval: handle => timers.delete(handle.id),
    createAgent: options => { const agent = { options, destroyed: false, destroy() { this.destroyed = true } }; agents.push(agent); return agent },
    probe: async (url, options) => { probes.push({ url, options }); return { state: 'reachable', latencyMs: 12, httpStatus: 200 } },
    ...extra
  }
  const service = createServerStatus(dependencies)
  return { service, timers, queries, probes, agents, processes, pool, tick: delay => [...timers.values()].find(row => row.delay === delay).callback(), advance: amount => { clock += amount }, cores: value => { cores = value }, memory: value => { content = value }, fail: value => { failing = value }, modules: value => { modules = value } }
}

async function metricSampling() {
  equal(cpuUsage(null, cpus(100, 300)), null, 'CPU usage is unknown until two samples exist')
  equal(cpuUsage(cpus(100, 300), cpus(150, 450)), 25, 'CPU uses aggregate time differences across both cores')
  for (const bad of [[], cpus(NaN, 1), cpus(Infinity, 1), cpus(-1, 1), [{ times: { user: 1 } }]]) equal(cpuUsage(cpus(100, 300), bad), null, 'invalid CPU counters remain unknown')
  equal(cpuUsage(cpus(100, 300), cpus(100, 300)), null, 'zero sampling interval is unknown rather than NaN')
  equal(cpuUsage(cpus(100, 300), cpus(50, 100)), null, 'counter resets are unknown')
  equal(memoryUsage(2048, 1536), { totalBytes: 2048, availableBytes: 1536, usedBytes: 512, usagePercent: 25 }, 'memory uses available rather than only completely free RAM')
  for (const [total, available] of [[0, 0], [NaN, 3], [1, Infinity], [10, -1], [10, 11]]) equal(memoryUsage(total, available).usagePercent, null, 'invalid memory input never becomes a percentage')
  const value = fixture(); const initial = value.service.snapshot()
  equal([initial.cpu.usagePercent, initial.external.google.state], [null, 'unconfirmed'], 'first snapshot is synchronous and does not wait for host or network samples')
  await value.service.ready; await settle(); const first = value.service.snapshot()
  equal([first.cpu.usagePercent, first.memory.usagePercent, first.memory.usedBytes, first.uptimeSeconds], [null, 25, 512 * 1024, 172800], 'first host sample has truthful CPU, available RAM and host uptime')
  equal(Object.hasOwn(first, 'sites'), false, 'status exposes no existing website names or URLs')
  equal(first.bootedAt, '2031-09-29T00:00:00.000Z', 'boot time is derived from host uptime, independent of process start')
  equal([...value.timers.values()].map(row => [row.delay, row.unreferenced]), [[5000, true], [3600000, true], [300000, true]], 'host, hourly external and five-minute storage sampling have unreferenced timers')
  value.advance(5000); value.cores(cpus(150, 450)); await value.tick(5000)
  equal(value.service.snapshot().cpu.usagePercent, 25, 'five-second samples produce current host utilization')
  value.memory('MemTotal: 2048 kB\nMemFree: 1024 kB\n'); await value.tick(5000)
  equal(value.service.snapshot().memory.usagePercent, null, 'missing Linux MemAvailable cannot masquerade as free-memory usage')
  value.service.close(); value.service.close()
  equal([value.timers.size, value.agents.every(agent => agent.destroyed)], [0, true], 'close is idempotent and frees intervals and agents')
}

async function databaseCaching() {
  const value = fixture(); await value.service.ready
  equal(value.service.snapshot().giftSites.activeCount, 2, 'only published, unexpired formal sites count as active')
  equal(value.service.snapshot().giftSites.publicCount, 1, 'public count adds the explicit listed predicate')
  const queries = value.queries.length
  for (let count = 0; count < 40; count++) value.service.snapshot()
  equal(value.queries.length, queries, 'many visitors share the thirty-second aggregate cache')
  value.advance(30000); value.modules({ gifts: false }); value.service.snapshot(); await settle()
  equal(value.service.snapshot().giftSites.activeCount, 0, 'boolean module-off setting hides all active counts')
  equal(value.queries.length, queries + 1, 'module-off reads only configuration and skips site aggregation')
  value.advance(30000); value.modules({ gifts: { enabled: true } }); value.fail(true); value.service.snapshot(); await settle()
  const failed = value.service.snapshot()
  equal([failed.database, failed.status, failed.giftSites.activeCount, failed.giftSites.publicCount], ['error', 'error', null, null], 'SQL failure clears prior numbers to unknown rather than renewing stale successful data')
  const failedQueries = value.queries.length; for (let count = 0; count < 20; count++) value.service.snapshot()
  equal(value.queries.length, failedQueries, 'SQL failures are cached and cannot create a retry storm')
  value.service.close()

  const pending = deferred(); let queriesCount = 0
  const delayed = fixture({ getPool: () => ({ query: async (options, params) => { if (options.sql.includes('information_schema.tables')) return [[{ storage_bytes: 0 }]]; queriesCount++; return params[0] === 'global_settings' ? pending.promise : [[{ active_count: 0, public_count: 0 }]] } }) })
  for (let count = 0; count < 20; count++) delayed.service.snapshot()
  equal(queriesCount, 1, 'concurrent cold reads share one configuration query')
  delayed.service.close(); const before = delayed.service.snapshot(); pending.resolve([[{ modules: { gifts: { enabled: true } } }]]); await delayed.service.ready
  equal([queriesCount, delayed.service.snapshot()], [1, before], 'a configuration result after close cannot start another query or revive the snapshot')
  const bad = fixture({ getPool: () => ({ query: async () => [[{ modules: '{broken' }]] }) }); await bad.service.ready
  equal(bad.service.snapshot().giftSites.activeCount, null, 'invalid module configuration is unknown and never assumed disabled')
  bad.service.close()
  for (const modules of [undefined, null, [], true, 0, 'null']) {
    const invalid = fixture({ getPool: () => ({ query: async () => [[{ modules }]] }) }); await invalid.service.ready
    equal([invalid.service.snapshot().database, invalid.service.snapshot().giftSites.activeCount], ['error', null], 'missing or nonobject modules remain unknown instead of fabricating module-off counts')
    invalid.service.close()
  }
}

async function hourlyNetwork() {
  const held = [], calls = [], initialGlobal = https.globalAgent
  const value = fixture({ proxyUrl: 'http://127.0.0.1:7890', probe: (url, options) => { const hold = deferred(); held.push(hold); calls.push({ url, options }); return hold.promise } })
  await value.service.ready
  equal(calls.length, 4, 'startup makes exactly two fixed targets times direct and rule-proxy checks')
  equal(new Set(calls.map(row => row.url)), new Set(['https://www.google.com/', 'https://www.youtube.com/']), 'no visitor-provided URL is probed')
  equal(value.agents.map(agent => agent.options.proxyEnv), [{}, { HTTPS_PROXY: 'http://127.0.0.1:7890', NO_PROXY: '' }], 'direct and proxy routes use separate explicitly configured agents')
  equal(https.globalAgent, initialGlobal, 'status probing does not replace the global HTTPS agent')
  for (let index = 0; index < held.length; index++) held[index].resolve({ state: calls[index].options.route === 'proxy' ? 'reachable' : 'unreachable', latencyMs: 10, httpStatus: calls[index].options.route === 'proxy' ? 200 : null })
  await settle()
  equal([value.service.snapshot().external.google.state, value.service.snapshot().external.google.route, value.service.snapshot().external.google.directState], ['reachable', 'proxy', 'unreachable'], 'main state follows the configured rule proxy and preserves the separate direct result')
  value.advance(3600000)
  for (let count = 0; count < 40; count++) value.service.snapshot()
  equal(calls.length, 4, 'GET and manual refresh never trigger probes, even at an expired hourly boundary')
  const refresh = value.tick(3600000); value.tick(3600000)
  equal(calls.length, 8, 'overlapping hourly ticks share a single probe batch')
  for (let index = 4; index < held.length; index++) held[index].reject(Error('Injected network failure'))
  await refresh
  equal(value.service.snapshot().external.youtube.state, 'unreachable', 'failed hourly probe replaces the prior success with a checked failure')
  const checked = value.service.snapshot().external.youtube.checkedAt
  for (let count = 0; count < 40; count++) value.service.snapshot()
  equal([calls.length, value.service.snapshot().external.youtube.checkedAt], [8, checked], 'failure has the same shared hourly lifetime as success')
  const closing = value.tick(3600000); value.service.close(); const before = value.service.snapshot()
  ok(calls.slice(8).every(row => row.options.signal.aborted), 'close aborts in-flight external requests')
  for (let index = 8; index < held.length; index++) held[index].resolve({ state: 'reachable', httpStatus: 200, latencyMs: 10 })
  await closing
  equal(value.service.snapshot(), before, 'late probe success after close cannot mutate public status')
  equal([value.timers.size, value.agents.length, value.agents.every(agent => agent.destroyed)], [0, 2, true], 'close releases both route agents and both timers')
}

async function diskAndWebsiteStorage() {
  equal(diskUsage({ blocks: 100, bfree: 25, bavail: 20, bsize: 1024 }), { totalBytes: 102400, usedBytes: 76800, availableBytes: 20480, usagePercent: 75 }, 'disk distinguishes allocated blocks, all free blocks and user-available blocks')
  for (const stats of [null, { blocks: 0, bfree: 0, bavail: 0, bsize: 1024 }, { blocks: 100, bfree: 101, bavail: 20, bsize: 1024 }, { blocks: 100, bfree: 25, bavail: 30, bsize: 1024 }, { blocks: NaN, bfree: 25, bavail: 20, bsize: 1024 }, { blocks: 100, bfree: 25, bavail: 20, bsize: 0 }]) equal(diskUsage(stats).usagePercent, null, 'invalid statfs data is unknown rather than a false disk percentage')
  equal(websiteStorageBytes(duOutput), 15360, 'website storage sums allocated byte totals from all four fixed paths')
  for (const output of ['', '1\t/www/wwwroot/crbuj.icu\n', duOutput + '1\t/etc\n', duOutput.replace('1024', 'NaN'), duOutput.replace('/opt/campus-api', '/www/wwwroot/crbuj.icu')]) equal(websiteStorageBytes(output), null, 'partial, duplicated, nonnumeric or unexpected du output remains unknown')
  const value = fixture(); await value.service.ready; await settle()
  equal(value.service.snapshot().disk, { totalBytes: 102400, usedBytes: 76800, availableBytes: 20480, usagePercent: 75 }, 'host snapshot exposes measured root disk blocks')
  equal(value.service.snapshot().websiteStorage.usedBytes, 25600, 'startup storage sample combines website files with the current business database allocation')
  const child = value.processes[0]
  equal([child.command, child.args], ['du', ['-s', '-B1', '--', '/www/wwwroot/crbuj.icu', '/www/wwwroot/galaxy-heart', '/opt/campus-api', '/www/campus-data']], 'one du command uses audited readable roots, preserves default symlink/hardlink behavior and excludes backups and database files')
  equal([child.options.timeout, child.options.maxBuffer], [10000, 65536], 'du has a bounded execution time and output size')
  ok(!JSON.stringify(value.service.snapshot()).includes('/var/lib') && !JSON.stringify(value.service.snapshot()).includes('/opt/campus-api'), 'public snapshots never include private storage path details')
  value.advance(300000); for (let count = 0; count < 20; count++) value.service.snapshot()
  equal(value.processes.length, 1, 'GET cannot launch a storage scan, even after five minutes')
  const refresh = value.tick(300000); value.tick(300000); await refresh
  equal(value.processes.length, 2, 'overlapping five-minute ticks share one storage scan')
  await value.tick(5000); equal(value.processes.length, 2, 'five-second host refresh never rescans website trees')
  value.service.close()

  const callbacks = [], children = []
  const controlled = fixture({ execFile: (command, args, options, callback) => { callbacks.push(callback); const child = { killed: false, kill() { this.killed = true } }; children.push(child); return child } })
  await controlled.service.ready
  callbacks[0](null, duOutput); await settle()
  equal(controlled.service.snapshot().websiteStorage.usedBytes, 25600, 'completed scan stores the successful file and database allocation result')
  controlled.advance(300000); const failed = controlled.tick(300000); callbacks[1](Error('du timeout')); await failed
  equal(controlled.service.snapshot().websiteStorage.usedBytes, null, 'a failed refresh discards prior storage size rather than presenting it as current')
  const count = callbacks.length; for (let index = 0; index < 20; index++) controlled.service.snapshot()
  equal(callbacks.length, count, 'failed storage samples are shared until the next scheduled scan')
  const pending = controlled.tick(300000); controlled.service.close(); const before = controlled.service.snapshot()
  equal(children[2].killed, true, 'close kills the in-flight du subprocess')
  callbacks[2](null, duOutput); await pending
  equal(controlled.service.snapshot(), before, 'a child callback after close cannot revive storage data')
  const failingDisk = fixture({ statfs: async () => { throw Error('statfs failure') } }); await failingDisk.service.ready
  equal(failingDisk.service.snapshot().disk.usedBytes, null, 'filesystem read failure remains unknown independently of other host metrics')
  failingDisk.service.close()
}

async function realHeadRequests() {
  const methods = [], sockets = new Set(), hangClosed = deferred()
  const server = http.createServer((request, response) => {
    methods.push(request.method)
    if (request.url === '/hang') { request.socket.once('close', hangClosed.resolve); return }
    const status = Number(request.url.slice(1)); response.writeHead(status, status === 302 ? { Location: '/200' } : {}); response.end()
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    for (const [status, state] of [[200, 'reachable'], [302, 'reachable'], [403, 'restricted'], [429, 'restricted'], [500, 'unreachable']]) {
      const result = await probeEndpoint(base + '/' + status, { signal: AbortSignal.timeout(500) })
      equal([result.state, result.httpStatus], [state, status], 'real HEAD response ' + status + ' has an accurate availability state')
    }
    const result = await probeEndpoint(base + '/hang', { signal: AbortSignal.timeout(40) })
    equal([result.state, result.httpStatus], ['unreachable', null], 'real request timeout aborts the request rather than waiting indefinitely')
    let closeTimer
    try { await Promise.race([hangClosed.promise, new Promise((resolve, reject) => { closeTimer = setTimeout(() => reject(Error('aborted probe socket did not close')), 500) })]) }
    finally { clearTimeout(closeTimer) }
    ok(methods.every(method => method === 'HEAD') && methods.length === 6, 'probes are HEAD and do not follow redirect targets or download pages')
  } finally {
    const remaining = [...sockets], closes = remaining.map(socket => once(socket, 'close'))
    for (const socket of remaining) socket.destroy()
    await Promise.all(closes); await new Promise(resolve => server.close(resolve))
  }
  equal(sockets.size, 0, 'local probe fixtures leave no live sockets')
}

async function run() {
  await metricSampling(); await databaseCaching(); await hourlyNetwork(); await diskAndWebsiteStorage(); await realHeadRequests()
  console.log('Server status: ' + checks + ' assertions passed (host/disk/storage metrics, SQL/cache, hourly routes, real HEAD timeout and close)')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
