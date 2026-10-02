const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const path = require('node:path')

function pageFrom(file, call = async () => ({ result: { success: true } })) {
  let page, location, time = Date.UTC(2026, 9, 2)
  const storage = new Map([['openid', 'student']])
  const app = { globalData: {}, isLoggedIn: () => true, getGlobalOpenId: () => 'student' }
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    showToast() {}, showModal() {}, stopLocationUpdate() {}, setKeepScreenOn() {},
    getSetting() {}, offLocationChange() {}, onLocationChange: callback => { location = callback }
  }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
  }).outputText
  class Clock extends Date { static now() { return time } }
  const load = ref => {
    if (!ref.endsWith('/run-metrics')) return { api: { call } }
    const module = { exports: {} }
    const utility = ts.transpileModule(fs.readFileSync(path.resolve(path.dirname(file), ref + '.ts'), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
    }).outputText
    vm.runInNewContext(utility, { module, exports: module.exports })
    return module.exports
  }
  vm.runInNewContext(code, { exports: {}, require: load,
    Page: value => { page = value }, getApp: () => app, wx, Date: Clock, console,
    setInterval: () => 1, clearInterval() {}, setTimeout() {}, clearTimeout() {} })
  page.setData = patch => Object.assign(page.data, patch)
  for (const name of ['startTimer', 'initSensorsOnStart', 'initLocation', 'pauseSensors', 'resumeSensors', 'stopSensors']) page[name] = () => {}
  return { page, storage, wx, advance: seconds => { time += seconds * 1000 }, gps: (latitude, longitude, accuracy = 10, speed = 2.5, stepDelta = 0, seconds = 5) => {
    time += seconds * 1000; page.data.rawSteps += stepDelta
    location({ latitude, longitude, accuracy, speed })
  } }
}

async function main() {
  const file = 'miniprogram/pages/index/index.ts'
  const motion = pageFrom(file), p = motion.page
  p.sheetMaxOffset = 250
  p.onSheetTouchStart({ touches: [{ clientY: 300 }] })
  p.onSheetTouchMove({ touches: [{ clientY: 480 }] })
  p.onSheetTouchEnd()
  assert.equal(p.data.sheetCollapsed, true)
  p.onSheetTouchStart({ touches: [{ clientY: 480 }] })
  p.onSheetTouchMove({ touches: [{ clientY: 230 }] })
  p.onSheetTouchEnd()
  assert.equal(p.data.sheetCollapsed, false)
  await p.startRun()
  assert.equal(p.data.sheetCollapsed, true, 'start collapses card')
  p.pauseRun()
  assert.equal(p.data.sheetCollapsed, false, 'pause opens card')
  p.pauseRun()
  assert.equal(p.data.sheetCollapsed, true, 'resume collapses card')
  p.data.totalMeter = 600; motion.advance(300)
  await p.executeStopRun(600)
  assert.equal(p.data.sheetCollapsed, false, 'end restores card')
  assert.equal(p.data.isRunning, false)
  let zeroSettled = 0
  const zero = pageFrom(file, async req => {
    assert.equal(req.name, 'teamManager', 'zero distance never writes a bogus record')
    zeroSettled++
    return { result: { success: true } }
  })
  zero.page.data.isRunning = true; zero.page.data.runId = 'zero'; zero.page.data.currentTeam = { status: 'active', _id: 'team' }
  await zero.page.executeStopRun(0)
  assert.equal(zeroSettled, 1, 'zero distance still clears team running state')


  let online = false, settled = 0, requests = 0
  const retry = pageFrom(file, async req => {
    requests++
    if (!online) return { result: { success: false, errMsg: 'database unavailable' } }
    if (req.data.action === 'finishTeamRun') settled++
    return { result: { success: true } }
  })
  const record = { openid: 'student', runId: 'retry-same-id', teamId: 'team', distance: 600 }
  assert.equal(await retry.page.uploadRunRecord(record), false)
  assert.equal(retry.storage.get('pending_runs_student').length, 1, 'business failure remains queued')
  assert.equal(settled, 0, 'failed save never settles')
  online = true
  await retry.page.retryUploads()
  assert.equal(settled, 1, 'retry saves then settles')
  assert.equal(retry.storage.get('pending_runs_student').length, 0)
  assert.equal(requests, 3)

  const gps = pageFrom(file)
  gps.page.data.isRunning = true; gps.page.data.pathSegments = [[]]
  gps.page.setupLocationListener()
  gps.gps(34, 115)
  gps.gps(34.00001, 115, 10, 0)
  assert.equal(gps.page.data.totalMeter, 0, 'stationary jitter does not accumulate')
  gps.gps(34.0001, 115, 10, 2.5, 10)
  assert.ok(gps.page.data.totalMeter > 10, 'real movement accumulates')
  const beforeJump = gps.page.data.totalMeter
  gps.gps(35, 116)
  assert.equal(gps.page.data.totalMeter, beforeJump, 'teleport is rejected')
  gps.gps(34.001, 115, 120)
  gps.page.data.totalMeter = Math.round((gps.page.data.totalMeter + 7.5) * 100) / 100
  gps.page.data.estimatedDistance += 7.5
  const weakDistance = gps.page.data.totalMeter
  gps.gps(34.002, 115)
  assert.equal(gps.page.data.totalMeter, weakDistance, 'GPS recovery does not add the step-covered gap')
  gps.page.data.isPaused = true
  gps.gps(34.01, 115)
  assert.equal(gps.page.data.totalMeter, weakDistance, 'paused positions cannot add distance')
  gps.page.data.rawSteps = 10000
  assert.equal(gps.page.fusedDistanceCalculation(), Math.round(weakDistance), 'distance is never estimated twice')

  const drift = pageFrom(file)
  drift.page.data.isRunning = true; drift.page.data.pathSegments = [[]]
  drift.page.setupLocationListener()
  drift.gps(34, 115)
  drift.gps(34.0002, 115, 10, 2.5, 0, 10)
  drift.gps(34, 115, 10, 2.5, 0, 10)
  assert.equal(drift.page.data.totalMeter, 0, 'A-B-A noise rolls back B without adding B-C')
  const turn = pageFrom(file)
  turn.page.data.isRunning = true; turn.page.data.pathSegments = [[]]
  turn.page.setupLocationListener()
  turn.gps(34, 115)
  turn.gps(34.0002, 115, 10, 2.5, 20, 10)
  turn.gps(34, 115, 10, 2.5, 20, 10)
  assert.ok(turn.page.data.totalMeter > 40, 'a real turnaround with steps is retained')

  const waiting = []
  const ranking = pageFrom('miniprogram/pages/rank/rank.ts', req => new Promise(resolve => waiting.push({ req, resolve }))).page
  ranking.getRankList()
  ranking.switchTab({ currentTarget: { dataset: { tab: 'monthly' } } })
  waiting[1].req.success({ result: { code: 0, data: [{ _id: 'new' }] } }); waiting[1].req.complete(); waiting[1].resolve()
  waiting[0].req.success({ result: { code: 0, data: [{ _id: 'old' }] } }); waiting[0].req.complete(); waiting[0].resolve()
  assert.equal(ranking.data.rankList[0]._id, 'new', 'late old tab response cannot overwrite current rank')
  console.log('跑步拖动、运动状态、离线重试、GPS 漂移和榜单请求顺序：通过')
}
module.exports = { pageFrom }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
