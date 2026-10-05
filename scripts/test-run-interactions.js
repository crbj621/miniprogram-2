const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const path = require('node:path')

function pageFrom(file, call = async () => ({ result: { success: true } }), downloadFile = async () => ({ tempFilePath: 'wxfile://companion.png' }), claimRewards = async () => ({})) {
  let page, location, time = Date.UTC(2026, 9, 2)
  const storage = new Map([['openid', 'student']])
  const app = { globalData: {}, isLoggedIn: () => true, getGlobalOpenId: () => 'student' }
  const navigation = []
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    showToast() {}, showModal() {}, showLoading() {}, hideLoading() {}, stopLocationUpdate() {}, setKeepScreenOn() {},
    getLocation() {}, getMenuButtonBoundingClientRect: () => ({ bottom: 50 }),
    navigateTo: options => navigation.push(options.url),
    getSetting() {}, offLocationChange() {}, onLocationChange: callback => { location = callback }
  }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
  }).outputText
  class Clock extends Date { static now() { return time } }
  const load = ref => {
    if (ref.endsWith('/page-share')) return { withSharing: value => value }
    if (ref.endsWith('/page-copy')) return { withPageCopy: (_scope, value) => value }
    if (!ref.endsWith('/run-metrics') && !ref.endsWith('/companion-data')) return {
      api: { call, downloadFile }, callEnglish: claimRewards,
      getSavedCampusTheme: () => ({ style: '' }), API_BASE_URL: 'https://www.crbuj.icu/campus-api'
    }
    const module = { exports: {} }
    const utility = ts.transpileModule(fs.readFileSync(path.resolve(path.dirname(file), ref + '.ts'), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
    }).outputText
    vm.runInNewContext(utility, { module, exports: module.exports, require: load })
    return module.exports
  }
  vm.runInNewContext(code, { exports: {}, require: load,
    Page: value => { page = value }, getApp: () => app, wx, Date: Clock, console,
    setInterval: () => 1, clearInterval() {}, setTimeout() {}, clearTimeout() {} })
  page.setData = patch => Object.assign(page.data, patch)
  for (const name of ['startTimer', 'initSensorsOnStart', 'initLocation', 'pauseSensors', 'resumeSensors', 'stopSensors']) page[name] = () => {}
  return { page, storage, wx, navigation, advance: seconds => { time += seconds * 1000 }, gps: (latitude, longitude, accuracy = 10, speed = 2.5, stepDelta = 0, seconds = 5) => {
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

  let rewardAttempts = 0
  const rewardFailure = pageFrom(file, async () => ({ result: { success: true } }), undefined, async action => {
    assert.equal(action, 'claimCampusRewards'); rewardAttempts += 1; throw new Error('reward service unavailable')
  })
  assert.equal(await rewardFailure.page.uploadRunRecord({ openid: 'student', runId: 'reward-failure', distance: 600 }), true)
  assert.equal(rewardAttempts, 1, 'successful run triggers one nonblocking reward claim')
  assert.equal(rewardFailure.storage.get('pending_runs_student').length, 0, 'reward failure cannot requeue saved run')
  assert.equal(rewardFailure.page.data.pendingUploadError, '')

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
  turn.gps(34.0001, 115, 10, 2.5, 20, 5)
  turn.gps(34.0002, 115, 10, 2.5, 20, 5)
  turn.gps(34.0001, 115, 10, 2.5, 20, 5)
  turn.gps(34, 115, 10, 2.5, 20, 5)
  assert.ok(turn.page.data.totalMeter > 40, 'a sustained GPS trace through a real turnaround is retained')
  const shakingSpike = pageFrom(file)
  shakingSpike.page.data.isRunning = true; shakingSpike.page.setupLocationListener()
  shakingSpike.gps(34, 115)
  shakingSpike.gps(34.0002, 115, 10, 2.5, 20, 10)
  shakingSpike.gps(34, 115, 10, 2.5, 20, 10)
  assert.equal(shakingSpike.page.data.totalMeter, 0, 'sensor peaks alone cannot certify an isolated GPS spike')

  const asset = name => 'https://www.crbuj.icu/campus-api/english-assets/companions/' + name + '.png'
  let appearance = { character: 'boy', assets: { boy: asset('boy-base'), girl: asset('girl-base') },
    catalog: [{ id: 'boy_sport', character: 'boy', image: asset('boy-sport') }], equipped: { outfit: 'boy_sport' } }
  const downloads = []
  const map = pageFrom(file, async request => {
    assert.equal(request.name, 'english_learning'); assert.equal(request.data.action, 'wardrobe')
    return { result: { success: true, data: appearance } }
  }, async options => { downloads.push(options.fileID); return { tempFilePath: 'wxfile://' + options.fileID.split('/').pop() } })
  map.page.mapVisible = true
  const teammate = { id: 23, latitude: 34.5, longitude: 115.5, iconPath: '/images/tab-run.png' }
  map.page.data.markers = [teammate]
  assert.equal(await map.page.loadMapCompanion(), true)
  assert.equal(map.page.data.markers.find(row => row.id === 1).iconPath, 'wxfile://boy-sport.png', 'equipped whole outfit becomes map marker')
  assert.equal(map.page.data.markers.find(row => row.id === 23), teammate, 'other map markers remain unchanged')
  await map.page.loadMapCompanion()
  assert.equal(downloads.length, 1, 'local map image cache prevents repeated download')
  appearance = { ...appearance, character: 'girl' }
  await map.page.loadMapCompanion()
  assert.equal(map.page.data.markers.find(row => row.id === 1).iconPath, 'wxfile://girl-base.png', 'incompatible outfit falls back to selected character')
  const locations = []
  map.wx.getLocation = options => locations.push(options)
  map.page.getCurrentLocation(false)
  locations[0].success({ latitude: 34.8, longitude: 115.9, accuracy: 10 })
  assert.equal(map.page.data.markers.find(row => row.id === 1).latitude, 34.8)
  map.page.getCurrentLocation(false)
  map.page.data.isRunning = true; map.page.data.pathSegments = [[]]
  map.page.setupLocationListener()
  map.gps(34.8, 115.9)
  map.gps(34.8002, 115.9, 10, 2.5, 20, 10)
  const latestLatitude = map.page.data.latitude
  locations[1].success({ latitude: 33, longitude: 114, accuracy: 10 })
  assert.equal(map.page.data.latitude, latestLatitude, 'late one-shot location cannot overwrite accepted GPS')
  assert.equal(map.page.data.markers.find(row => row.id === 1).latitude, latestLatitude, 'character marker follows accepted GPS')
  assert.equal(map.page.data.markers.find(row => row.id === 23), teammate)
  map.page.clearRunningState(true)
  assert.equal(map.page.data.markers.length, 2, 'ending run keeps personal and unrelated map markers')
  map.page.openMapWardrobe({ detail: { markerId: 23 } })
  map.page.openMapWardrobe({ detail: { markerId: 1 } })
  assert.deepEqual(map.navigation, ['/packageProfile/pages/wardrobe/wardrobe'])

  const responses = []
  const racing = pageFrom(file, () => new Promise(resolve => responses.push(resolve)))
  racing.page.mapVisible = true
  const older = racing.page.loadMapCompanion(), newer = racing.page.loadMapCompanion()
  responses[1]({ result: { success: true, data: appearance } }); await newer
  responses[0]({ result: { success: true, data: { ...appearance, character: 'boy' } } })
  assert.equal(await older, false, 'older wardrobe response is ignored')
  assert.equal(racing.page.data.markers.find(row => row.id === 1).iconPath, 'wxfile://companion.png')

  for (const leave of ['hide', 'unload', 'account']) {
    let completeDownload
    const pending = pageFrom(file, async () => ({ result: { success: true, data: appearance } }), () => new Promise(resolve => { completeDownload = resolve }))
    pending.page.mapVisible = true
    const loading = pending.page.loadMapCompanion()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(typeof completeDownload, 'function')
    if (leave === 'hide') pending.page.onHide()
    else if (leave === 'unload') pending.page.onUnload()
    else pending.storage.set('openid', 'another-student')
    completeDownload({ tempFilePath: 'wxfile://late.png' })
    assert.equal(await loading, false, leave + ' prevents late character update')
    assert.equal(pending.page.data.markers.find(row => row.id === 1).iconPath, '/images/map-location-dot.png')
  }
  const failedMap = pageFrom(file, async () => ({ result: { success: true, data: appearance } }), async () => { throw new Error('offline') })
  failedMap.page.mapVisible = true
  assert.equal(await failedMap.page.loadMapCompanion(), false)
  assert.equal(failedMap.page.data.markers.find(row => row.id === 1).width, 16, 'download failure retains visible local location dot')
  const restored = pageFrom(file)
  restored.storage.set('active_run_student', { version: 2, runId: 'resume-marker', duration: 120, totalMeter: 80,
    latitude: 34.9, longitude: 115.9, startedAt: Date.UTC(2026, 9, 2), signalGaps: 0 })
  restored.page.onLoad()
  assert.equal(restored.page.data.markers.find(row => row.id === 1).latitude, 34.9, 'initial marker uses restored run coordinates')
  const restoredFixes = []
  restored.wx.getLocation = options => restoredFixes.push(options)
  restored.page.mapVisible = true; restored.page.getCurrentLocation(false)
  restored.page.onHide()
  restoredFixes[0].success({ latitude: 33, longitude: 114 })
  assert.equal(restored.page.data.latitude, 34.9, 'hidden page ignores late one-shot location')

  const waiting = []
  const ranking = pageFrom('miniprogram/pages/rank/rank.ts', req => new Promise(resolve => waiting.push({ req, resolve }))).page
  ranking.getRankList()
  ranking.switchTab({ currentTarget: { dataset: { tab: 'monthly' } } })
  waiting[1].req.success({ result: { code: 0, data: [{ _id: 'new' }] } }); waiting[1].req.complete(); waiting[1].resolve()
  waiting[0].req.success({ result: { code: 0, data: [{ _id: 'old' }] } }); waiting[0].req.complete(); waiting[0].resolve()
  assert.equal(ranking.data.rankList[0]._id, 'new', 'late old tab response cannot overwrite current rank')
  console.log('跑步拖动、运动状态、离线重试、GPS 漂移、伙伴地图标记和榜单请求顺序：通过')
}
module.exports = { pageFrom }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
