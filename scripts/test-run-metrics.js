const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { pageFrom } = require('./test-run-interactions')
const { normalizeRun, eligible } = require('../server/src/run-records')
const weRun = require('../server/src/we-run')
const crypto = require('node:crypto')

const moduleValue = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('miniprogram/utils/run-metrics.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
}).outputText, { exports: moduleValue.exports })
const { StepDetector } = moduleValue.exports
const file = 'miniprogram/pages/index/index.ts'

async function main() {
  const distanceAt = accuracy => {
    const context = pageFrom(file)
    context.page.data.isRunning = true
    context.page.setupLocationListener()
    context.gps(34, 115, accuracy)
    context.gps(34.00018, 115, accuracy, 2.5, 20)
    return context.page.data.totalMeter
  }
  assert.ok(Math.abs(distanceAt(10) - distanceAt(65)) < 0.01, '同路段不因精度权重丢失一半距离')
  const still = pageFrom(file)
  still.page.data.isRunning = true; still.page.setupLocationListener()
  still.gps(34, 115, 10, 0)
  for (let i = 1; i <= 10; i++) still.gps(34 + i * 0.0001, 115, 10, 0)
  assert.equal(still.page.data.totalMeter, 0, '静止设备缓慢漂移不累计')
  for (let i = 1; i <= 10; i++) still.gps(34 + i * 0.00008, 115, 20, 0, 12)
  assert.equal(still.page.data.totalMeter, 0, '甩手机步数不能绕过 GPS 静止检查')
  const gap = pageFrom(file)
  gap.page.data.isRunning = true; gap.page.setupLocationListener()
  gap.gps(34, 115); gap.gps(34.001, 115, 10, 2.5, 20, 30)
  assert.equal(gap.page.data.totalMeter, 0, '长间隔不以直线补齐未知轨迹')
  gap.page.data.indoorMode = true
  gap.page.registerStep(Date.now(), 1.2, 1)
  const estimated = gap.page.data.totalMeter
  assert.equal(estimated, 0, '室内传感器峰值不能直接换算成米数')
  gap.page.data.indoorMode = false
  gap.gps(34.002, 115)
  assert.equal(gap.page.data.totalMeter, estimated, '无定位后的定位恢复重新建立锚点')
  assert.equal(gap.page.data.steps, 21, '展示真实传感器累计，不由距离反算')
  const counted = scale => {
    const detector = new StepDetector()
    let steps = 0
    for (let i = 0; i < 400; i++) if (detector.sample(scale * (1 + .22 * Math.sin(i * Math.PI / 5)), i * 50)) steps++
    return steps
  }
  assert.equal(counted(1), counted(9.8), '不同传感器单位得到一致计步')
  assert.ok(counted(1) > 30 && counted(1) <= 40)
  const detector = new StepDetector()
  for (let i = 0; i < 300; i++) assert.equal(detector.sample(1 + .01 * Math.sin(i), i * 50), false)

  let record
  const final = pageFrom(file, async request => { record = request.data; return { result: { success: true } } })
  await final.page.startRun(); final.advance(100)
  final.page.data.totalMeter = 150; final.page.data.gpsDistance = 150
  await final.page.executeStopRun(100, true)
  assert.equal(record.distance, 150, '确认结束按最新值保存，不使用弹框前捕获的旧值')
  assert.equal(record.duration, 100, '最终时长由时钟结算，不受 UI 定时器延迟影响')
  const changed = pageFrom(file, async () => { throw new Error('不能用另一个人的会话上传') })
  await changed.page.startRun(); changed.advance(60)
  changed.page.data.totalMeter = 100; changed.page.data.gpsDistance = 100
  changed.storage.set('openid', 'another-student')
  await changed.page.executeStopRun(100, true)
  assert.equal(changed.storage.get('pending_runs_student')[0].openid, 'student', '换账号时运动留在原账号队列')
  assert.equal(changed.storage.has('active_run_student'), false)
  const recovery = pageFrom(file)
  await recovery.page.startRun(); recovery.advance(120); recovery.page.data.totalMeter = 100
  recovery.page.saveRunningState(); recovery.advance(600)
  recovery.page.data.isLoggedIn = true; recovery.page.restoreRunningState()
  assert.equal(recovery.page.data.isPaused, true)
  assert.equal(recovery.page.data.duration, 120, '恢复不累计程序关闭期间时间')
  recovery.page.pauseRun(); recovery.advance(60); recovery.page.updateRunClock()
  assert.equal(recovery.page.data.duration, 180)
  recovery.page.pauseRun(); recovery.advance(60); recovery.page.updateRunClock()
  assert.equal(recovery.page.data.duration, 180, '暂停时间不进入成绩')
  const historyRequests = []
  const history = pageFrom('miniprogram/packageProfile/pages/history/history.ts', request =>
    new Promise(resolve => historyRequests.push({ request, resolve })))
  const first = history.page.loadRunHistory(), second = history.page.loadRunHistory()
  historyRequests[1].resolve({ result: { success: true, data: [{ _id: 'new', distance: 120 }], hasMore: false } })
  await second
  historyRequests[0].resolve({ result: { success: true, data: [{ _id: 'old', distance: 100 }], hasMore: false } })
  await first
  assert.equal(history.page.data.runList[0]._id, 'new', '旧历史请求不能覆盖最新刷新')
  history.storage.set('openid', 'another-student')
  const failed = history.page.loadRunHistory()
  historyRequests[2].resolve({ result: { success: false, errMsg: '服务暂不可用' } })
  await failed
  assert.equal(history.page.data.runList.length, 0, '账号切换后失败不能显示上一个人的历史')
  assert.equal(history.page.data.error, '服务暂不可用')
  // 实际定位启动函数：恢复权限后应退出室内估距，旧运动的回调不得关闭新运动。
  const permission = pageFrom(file)
  const queued = []
  permission.wx.startLocationUpdateBackground = options => queued.push(options)
  permission.wx.stopLocationUpdate = () => { throw new Error('旧回调不能停止当前运动') }
  permission.page.data.isRunning = true; permission.page.data.runId = 'new'; permission.page.data.indoorMode = true
  const definition = fs.readFileSync(file, 'utf8')
  const begin = definition.indexOf('  initLocation(runId:')
  const finish = definition.indexOf('  setupLocationListener()', begin)
  let methods
  vm.runInNewContext(ts.transpileModule('const methods = {' + definition.slice(begin, finish) + '}; exports.methods = methods', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
  }).outputText, { exports: { set methods(value) { methods = value } }, wx: permission.wx })
  methods.initLocation.call(permission.page, 'new')
  queued[0].success()
  assert.equal(permission.page.data.indoorMode, false)
  permission.page.data.runId = 'old'; methods.initLocation.call(permission.page, 'old')
  permission.page.data.runId = 'next'; queued[1].success()

  const now = Date.UTC(2026, 9, 2, 2), endedAt = now - 86400000
  const run = normalizeRun({ distance: 1000, duration: 300, endedAt }, now)
  assert.equal(run.date, '2026-10-01', '离线重传记入运动当天')
  assert.equal(eligible(run), true)
  assert.throws(() => normalizeRun({ distance: 1000, duration: 0 }, now))
  assert.throws(() => normalizeRun({ distance: 10000, duration: 10 }, now))
  assert.throws(() => normalizeRun({ distance: 1000, duration: 300, lapTimes: [301] }, now))
  const indoor = normalizeRun({ distance: 500, duration: 600, algorithmVersion: 2,
    gpsDistance: 0, estimatedDistance: 500 }, now)
  assert.equal(eligible(indoor), false, '估距可以保存，但不进入竞争榜单和奖励')
  assert.throws(() => normalizeRun({ distance: 500, duration: 600, algorithmVersion: 2,
    gpsDistance: 100, estimatedDistance: 1 }, now))

  const key = crypto.randomBytes(16), iv = crypto.randomBytes(16), appid = 'test-app'
  const auth = { openid: 'student', wxSessionId: weRun.createSession('student', key.toString('base64'), now) }
  const encrypt = value => {
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv)
    return { iv: iv.toString('base64'), encryptedData: Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]).toString('base64') }
  }
  const payload = { watermark: { appid, timestamp: now / 1000 }, stepInfoList: [{ timestamp: now / 1000, step: 2345 }] }
  assert.equal(weRun.decode(auth, encrypt(payload), appid, now).days[0].steps, 2345)
  assert.throws(() => weRun.decode({ ...auth, openid: 'other' }, encrypt(payload), appid, now))
  assert.throws(() => weRun.decode(auth, encrypt(payload), 'wrong-app', now))
  assert.throws(() => weRun.decode(auth, encrypt(payload), appid, now + 16 * 60000))
  assert.throws(() => weRun.decode(auth, encrypt({ ...payload, stepInfoList: [...payload.stepInfoList, ...payload.stepInfoList] }), appid, now))
  console.log('跑步距离、计步、断点恢复、结束时钟、成绩校验及微信运动凭证模拟：通过')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
