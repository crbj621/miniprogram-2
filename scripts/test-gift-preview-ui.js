const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const catalogSource = require('../server/data/gifts/catalog.json')
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))
const id = 'a'.repeat(24)
const site = fields => ({ id, url: 'https://p-' + id + '.crbuj.icu/', preview: true, templateId: 'birthday', background: 'peach', effects: [], title: '生日快乐', recipient: '小雨', message: '愿每天开心', expiresAt: '2030-10-04T00:02:00Z', ...fields })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
let checks = 0
function equal(actual, expected, label) { assert.deepEqual(clone(actual), clone(expected), label); checks++ }
function ok(value, label) { assert.ok(value, label); checks++ }

function harness(pageName, request, publicApi = {}) {
  const timers = new Map(), intervals = new Map(), changes = [], calls = [], storage = new Map(), nextTicks = []
  let timerId = 0, requestId = 0, page
  const wx = { nextTick: callback => nextTicks.push(callback), createVideoContext: id => ({ play: () => calls.push({ kind: 'video', action: 'play', id }), pause: () => calls.push({ kind: 'video', action: 'pause', id }), stop: () => calls.push({ kind: 'video', action: 'stop', id }) }), showToast: options => calls.push({ kind: 'toast', ...options }), showModal: options => calls.push({ kind: 'modal', ...options }), pageScrollTo: options => calls.push({ kind: 'scroll', ...options }), getStorageSync: key => storage.get(key) || '', setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), navigateTo() {}, navigateBack() {}, stopPullDownRefresh() {} }
  function load(file) {
    const module = { exports: {} }, code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, wx, Date, Math, JSON, Promise, Set, console,
      setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId }, clearTimeout: value => timers.delete(value),
      setInterval: (callback, delay) => { intervals.set(++timerId, { callback, delay }); return timerId }, clearInterval: value => intervals.delete(value),
      require: ref => ref.endsWith('/page-share') ? { withSharing: value => value } : ref.endsWith('/gifts-api') ? { callGifts: request, giftRequestId: () => 'gift-ui-' + ++requestId } : ref.endsWith('/api-client') ? { api: publicApi } : ref.endsWith('/config/api') ? { API_BASE_URL: 'https://www.crbuj.icu/campus-api' } : load(path.resolve(path.dirname(file), ref + '.ts')),
      Page: value => { module.exports = value } })
    return module.exports
  }
  page = load(path.resolve(__dirname, '../miniprogram/packageGifts/pages/' + pageName + '/' + pageName + '.ts'))
  page.setData = (values, callback) => {
    assert.equal(page.disposed, undefined, 'unloaded page must not receive a late setData')
    changes.push(clone(values))
    for (const [key, value] of Object.entries(values)) { const parts = key.split('.'); let target = page.data; for (const part of parts.slice(0, -1)) target = target[part]; target[parts.at(-1)] = value }
    if (callback) callback()
  }
  page.createSelectorQuery = () => { const query = { select: () => query, boundingClientRect: callback => { callback({ width: 280 }); return query }, exec() {} }; return query }
  return { page, timers, intervals, changes, calls, storage, flushNextTicks: () => { while (nextTicks.length) nextTicks.shift()() }, unload: () => { page.onUnload(); page.disposed = true } }
}

async function readyEditor(request, trialAvailable = false) {
  const catalog = { ...clone(catalogSource), trialAvailable, coins: 200, sites: [] }
  const value = harness('editor', (action, data) => action === 'catalog' ? Promise.resolve(catalog) : request(action, data))
  value.page.onShow(); await value.page.load(); value.page.input({ currentTarget: { dataset: { field: 'recipient' } }, detail: { value: '小雨' } })
  value.flushNextTicks()
  return value
}

async function pricingAndCanvas() {
  const value = await readyEditor(async () => ({}), true), { page } = value
  equal([page.data.layout, page.data.advancedOpen], [null, false], 'beginner starts with automatic layout and collapsed advanced settings')
  page.toggleLayout(); value.flushNextTicks()
  equal(page.data.layout.elements.length, 4, 'explicit free layout retains the editable four-field canvas')
  equal(page.data.canvasElements[1].text, '给 小雨', 'name changes update the visible canvas')
  equal(page.data.background, catalogSource.templates[0].previewBackground, 'first experience includes the curated premium background')
  ok(page.data.dynamicBackgrounds.every(row => row.posterUrl.startsWith('https://www.crbuj.icu/campus-api/gift-assets/') && fs.existsSync(path.resolve(__dirname, '../server/public/gifts', row.poster))), 'all dynamic choice thumbnails are real server assets')
  page.chooseBackground({ currentTarget: { dataset: { id: 'meteors' } } }); page.setData({ effects: ['fireworks'], domainLabel: 'xiaoyu' }); page.quote()
  equal(page.data.backgroundPoster, 'https://www.crbuj.icu/campus-api/gift-assets/backgrounds/grassland-night-native.jpg', 'background choice synchronizes the native scenery preview')
  equal(page.data.price, 0, 'first two-hour experience has no effect, background or domain charge')
  page.setData({ background: 'peach', effects: [], domainLabel: '' })
  page.quote(); equal(page.data.backgroundPoster, '', 'static backgrounds clear the previous scenic preview')
  for (const [durationId, amount] of [['3d', 0], ['7d', 5], ['15d', 10], ['1m', 15]]) {
    page.chooseDuration({ currentTarget: { dataset: { id: durationId } } }); equal(page.data.price, amount, durationId + ' base price')
  }
  page.setData({ background: 'meteors', effects: ['fireworks'], domainLabel: 'xiaoyu' }); page.quote()
  equal(page.data.price, 15 + catalogSource.customDomainPrice + catalogSource.backgrounds.find(row => row.id === 'meteors').price + catalogSource.effects.find(row => row.id === 'fireworks').price, 'premium effects and custom domain remain charged on paid duration')
  page.setData({ id, purchasedEffects: ['fireworks'], purchasedBackgrounds: ['meteors'] }); page.quote()
  equal(page.data.price, 0, 'editing preserves purchased effects and does not buy duration/domain again')
  equal(page.data.listed, false, 'new website defaults to unlisted')
  const trial = await readyEditor(async () => ({}), true), nextTemplate = catalogSource.templates.find(row => row.previewBackground !== catalogSource.templates[0].previewBackground)
  trial.page.chooseTemplate({ currentTarget: { dataset: { id: nextTemplate.id } } })
  equal([trial.page.data.background, trial.page.data.effects], [nextTemplate.previewBackground, nextTemplate.previewEffects], 'new template carries its untouched curated trial media')
  trial.page.setData({ background: 'mint', effects: [] }); trial.page.chooseTemplate({ currentTarget: { dataset: { id: catalogSource.templates[0].id } } })
  equal([trial.page.data.background, trial.page.data.effects], ['mint', []], 'template switch preserves manually selected background and effects')
  trial.unload()
}

async function editorSteps() {
  const step = value => ({ currentTarget: { dataset: { step: value } } })
  for (const [options, expected] of [[{}, 1], [{ template: 'love' }, 2], [{ id }, 2]]) {
    const entry = harness('editor', async () => ({})); let loads = 0
    entry.page.load = () => { loads++ }; entry.page.onLoad(options)
    equal([entry.page.data.editorStep, loads], [expected, 1], 'entry route starts at the correct step: ' + JSON.stringify(options))
  }
  const requests = [], value = await readyEditor(async (action, data) => {
    requests.push({ action, data: clone(data) }); return { site: site(data), coins: 200 }
  }), { page } = value
  await page.goToStep(step(2))
  equal(requests.length, 0, 'moving to writing does not create a preview or spend coins')
  page.setData({ recipient: '  ', advancedOpen: true })
  await page.goToStep(step(3))
  equal([page.data.editorStep, requests.length], [2, 0], 'missing recipient stays on the form without a server request')
  page.input({ currentTarget: { dataset: { field: 'recipient' } }, detail: { value: '小雨' } })
  page.chooseBackground({ currentTarget: { dataset: { id: 'video-stars' } } }); value.flushNextTicks()
  const playerId = page.data.videoPlayers[0].id
  page.onBackgroundVideoPlay({ currentTarget: { dataset: { player: playerId, src: page.data.backgroundVideoUrl } } })
  page.toggleBackgroundVideo()
  await page.goToStep(step(3))
  equal(requests.map(row => row.action), ['preview'], 'third step automatically creates only a free preview')
  equal([page.data.editorStep, page.data.advancedOpen, page.data.catalog.coins], [3, false, 200], 'preview step collapses settings and leaves the wallet intact')
  equal([page.data.videoPlayers[0].id, page.data.videoState], [playerId, 'paused'], 'step switching preserves the unified player and user pause')
  ok(!('durationId' in requests[0].data) && requests[0].data.layout === null, 'default preview uses automatic layout without paid parameters')
  page.toggleAdvanced(); page.setData({ domainLabel: 'xiaoyu', sender: '好朋友' }); page.quote()
  equal(page.data.priceBreakdown.reduce((sum, row) => sum + row.price, 0), page.data.price, 'displayed cost breakdown adds up to the existing total')
  await page.goToStep(step(2)); page.toggleAdvanced(); page.toggleLayout(); value.flushNextTicks()
  page.addElement({ currentTarget: { dataset: { type: 'text' } } }); value.flushNextTicks()
  const content = clone({ recipient: page.data.recipient, sender: page.data.sender, layout: page.data.layout, background: page.data.background, effects: page.data.effects, domainLabel: page.data.domainLabel })
  page.toggleAdvanced(); await page.goToStep(step(3)); await page.goToStep(step(2))
  equal({ recipient: page.data.recipient, sender: page.data.sender, layout: page.data.layout, background: page.data.background, effects: page.data.effects, domainLabel: page.data.domainLabel }, content, 'back/next and collapsed settings preserve the complete draft and custom canvas')
  page.onSceneImageError({ currentTarget: { dataset: { background: 'meteors' } } })
  equal(page.data.backgroundPosterError, false, 'late error from a previous image cannot damage the current video preview')
  page.chooseBackground({ currentTarget: { dataset: { id: 'meteors' } } }); page.onSceneImageError({ currentTarget: { dataset: { background: 'meteors' } } })
  equal(page.data.backgroundPosterError, true, 'failed selected image exposes its fallback')
  page.retrySceneImage(); equal(page.data.backgroundPosterError, false, 'image retry remounts the selected image without changing the draft')
  const birthday = catalogSource.templates.find(row => row.id === 'birthday'), other = catalogSource.templates.find(row => row.id !== 'birthday')
  page.setData({ title: birthday.defaultTitle, message: birthday.defaultMessage })
  page.chooseTemplate({ currentTarget: { dataset: { id: other.id } } })
  equal([page.data.title, page.data.message, page.data.templateName], [other.defaultTitle, other.defaultMessage, other.name], 'changing template replaces untouched starter copy')
  page.setData({ title: '我自己写的标题', message: '这段话不能丢' })
  page.chooseTemplate({ currentTarget: { dataset: { id: birthday.id } } })
  equal([page.data.title, page.data.message, page.data.sender], ['我自己写的标题', '这段话不能丢', '好朋友'], 'changing template preserves personalized copy and signature')
  for (const field of ['saving', 'uploading']) {
    page.setData({ [field]: true }); await page.goToStep(step(3))
    equal(page.data.editorStep, 2, field + ' prevents leaving the active form')
    page.setData({ [field]: false })
  }
  page.setData({ id }); await page.goToStep(step(1)); equal(page.data.editorStep, 2, 'existing website cannot change its server-fixed template')
  value.unload()

  const savedLayout = { height: 800, elements: [{ id: 'custom', type: 'text', value: '保留我的排版', x: 10, y: 30, width: 75, fontSize: 20, color: '#906489' }] }
  const existing = harness('editor', async () => ({ ...clone(catalogSource), coins: 30, trialAvailable: false, sites: [site({ layout: savedLayout, purchasedEffects: ['fireworks'], purchasedBackgrounds: ['video-stars'] })] }))
  existing.page.onShow(); existing.page.onLoad({ id }); await settle(); existing.flushNextTicks()
  equal(existing.page.data.layout, savedLayout, 'editing an existing website never replaces its saved layout with the new automatic default')
  existing.unload()

  let fail = true; const failedRequests = []
  const retry = await readyEditor(async (action, data) => { failedRequests.push(action); if (fail) throw Error('连接暂时失败'); return { site: site(data) } })
  await retry.page.goToStep(step(3))
  equal([retry.page.data.editorStep, retry.page.data.previewError, retry.page.data.catalog.coins], [3, '连接暂时失败', 200], 'failed preview remains visible and does not charge coins')
  fail = false; await retry.page.previewWebsite(); await retry.page.submit()
  equal(retry.calls.filter(row => row.kind === 'modal').length, 1, 'publication still requires an explicit cost confirmation')
  ok(failedRequests.every(action => action === 'preview'), 'preview, retry and an unconfirmed publish cannot create a formal website')
  retry.unload()
}

async function nativeVideoLifecycle() {
  const value = await readyEditor(async () => ({})), { page, calls, changes } = value
  const choose = id => page.chooseBackground({ currentTarget: { dataset: { id } } })
  const event = () => ({ currentTarget: { dataset: { player: page.data.videoPlayers[0].id, src: page.data.videoPlayers[0].src } }, detail: { currentTime: 1.25 } })
  equal(page.data.videoPlayers, [], 'static default never mounts a native video')
  choose('video-fire'); const fire = event()
  equal(page.data.backgroundVideoUrl, 'https://www.crbuj.icu/campus-api/gift-assets/videos/video-fire-wide.mp4', 'compact native card uses the existing shared landscape MP4')
  equal(page.data.backgroundVideoPoster, 'https://www.crbuj.icu/campus-api/gift-assets/backgrounds/video-fire-wide.jpg', 'native video uses the matching original cover')
  equal([page.data.videoPlayers.length, page.data.videoState, page.data.videoAutoplay], [1, 'loading', true], 'dynamic choice mounts one autoplay player without claiming it has played')
  page.toggleBackgroundVideo(); equal(calls.filter(row => row.kind === 'video').length, 0, 'play waits until the asynchronous native mount creates a context')
  value.flushNextTicks(); equal(calls.at(-1).action, 'play', 'clicking play while automatic playback is pending really calls the mounted native player')
  page.onBackgroundVideoPlay(fire); page.onBackgroundVideoTime(fire)
  equal([page.data.videoState, page.data.videoCurrentTime], ['playing', 1.25], 'native playback and time events provide actual playback state')
  page.onBackgroundVideoWaiting(fire); equal(page.data.videoState, 'loading', 'buffering exposes its loading state')
  page.onBackgroundVideoTime(fire); equal(page.data.videoState, 'loading', 'a repeated timestamp does not falsely claim buffering has ended')
  page.onBackgroundVideoTime({ ...fire, detail: { currentTime: 2.5 } }); equal(page.data.videoState, 'playing', 'advancing playback restores playing after buffering without requiring another play event')
  page.input({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '继续播放' } }); page.quote()
  equal(page.data.videoPlayers[0].id, fire.currentTarget.dataset.player, 'typing or quoting does not restart an unchanged background')
  page.toggleBackgroundVideo(); equal([calls.at(-1).action, page.data.videoAutoplay, page.data.videoState], ['pause', false, 'paused'], 'explicit pause reaches the native context')
  page.onBackgroundVideoTime({ ...fire, detail: { currentTime: 2.75 } }); equal(page.data.videoState, 'paused', 'a delayed final progress event cannot undo the user pause')
  page.onHide(); equal([calls.at(-1).action, page.data.videoPlayers.length], ['stop', 0], 'hiding stops the decoder and removes the native source node')
  const hiddenChanges = changes.length; page.onBackgroundVideoPlay(fire); page.onBackgroundVideoError(fire)
  equal(changes.length, hiddenChanges, 'hidden page ignores delayed native events')
  page.onShow(); const returned = event()
  equal([page.data.videoAutoplay, page.data.videoState], [false, 'paused'], 'returning preserves a manual pause')
  ok(returned.currentTarget.dataset.player !== fire.currentTarget.dataset.player, 'returning creates a new native node identity')
  page.toggleBackgroundVideo(); value.flushNextTicks(); page.onBackgroundVideoPlay(returned); choose('meteors')
  equal([page.data.backgroundVideoUrl, page.data.videoPlayers.length, calls.at(-1).action], ['', 0, 'stop'], 'choosing a static landscape releases the former video')
  const staticChanges = changes.length; page.onBackgroundVideoTime(returned); page.onBackgroundVideoError(returned)
  equal(changes.length, staticChanges, 'late old video events cannot change a static background')
  choose('video-fire'); const old = event(); choose('video-stars'); const stars = event()
  equal(page.data.backgroundVideoUrl, 'https://www.crbuj.icu/campus-api/gift-assets/videos/video-stars-wide.mp4', 'second dynamic choice switches to its actual shared MP4')
  const switchedChanges = changes.length; page.onBackgroundVideoError(old)
  equal(changes.length, switchedChanges, 'an old source error cannot replace the new source with its poster')
  const beforeMount = calls.length; value.flushNextTicks()
  equal(calls.slice(beforeMount).map(row => row.id), [stars.currentTarget.dataset.player], 'a pending mount from the former source cannot start after a switch')
  page.onBackgroundVideoError(stars)
  equal([page.data.videoState, page.data.videoPlayers.length, calls.at(-1).action], ['error', 0, 'stop'], 'playback error releases resources and shows an explicit failure state')
  ok(page.data.videoError.includes('重试') && page.data.backgroundVideoPoster.endsWith('video-stars-wide.jpg'), 'failed playback keeps the real cover and an actionable retry message')
  page.onBackgroundPosterError({ currentTarget: { dataset: { source: page.data.backgroundVideoUrl } } })
  equal(page.data.backgroundVideoPosterError, true, 'cover failure is visible instead of being called a playing video')
  page.toggleBackgroundVideo(); const retried = event()
  equal([page.data.videoState, page.data.videoError, page.data.backgroundVideoPosterError], ['loading', '', false], 'retry resets error and cover failure state')
  ok(retried.currentTarget.dataset.player !== stars.currentTarget.dataset.player, 'retry remounts the same source with a fresh identity')
  const retryChanges = changes.length; page.onBackgroundVideoPlay(stars)
  equal(changes.length, retryChanges, 'a late event from the failed attempt cannot mark the retry as playing')
  const beforeRetry = calls.length; value.flushNextTicks()
  equal(calls.slice(beforeRetry).map(row => [row.action, row.id]), [['play', retried.currentTarget.dataset.player]], 'retry explicitly plays the replacement native context after its asynchronous mount')
  value.unload(); const unloadedChanges = changes.length
  page.onBackgroundVideoPlay(retried); page.onBackgroundVideoError(retried); page.toggleBackgroundVideo(); page.retryBackgroundVideo()
  equal([changes.length, calls.at(-1).action], [unloadedChanges, 'stop'], 'destroyed player stops resources and never receives delayed state changes')

  const background = catalogSource.backgrounds.find(row => row.id === 'video-fire')
  let next = site({ background: background.id, backgroundVideo: background.video, backgroundPoster: background.poster })
  const view = harness('view', async () => ({}), { getPublic: async () => ({ success: true, data: next }) })
  view.page.setData({ id }); view.page.onShow(); await view.page.load()
  view.flushNextTicks()
  equal(view.page.data.backgroundVideoUrl, page.data.backgroundVideoUrl.replace('video-stars', 'video-fire'), 'public view consumes catalog video presentation fields from the server')
  const publicNode = view.page.data.videoPlayers[0].id; await view.page.load(true)
  equal(view.page.data.videoPlayers[0].id, publicNode, 'quiet content synchronization does not restart an unchanged native video')
  next = site({ background: 'peach' }); await view.page.load(true)
  equal([view.page.data.backgroundVideoUrl, view.page.data.videoPlayers.length, view.calls.at(-1).action], ['', 0, 'stop'], 'public preview switching to static content releases native video')
  view.unload()

  const paused = await readyEditor(async () => ({})); paused.page.chooseBackground({ currentTarget: { dataset: { id: 'video-fire' } } })
  const pausedEvent = { currentTarget: { dataset: { player: paused.page.data.videoPlayers[0].id, src: paused.page.data.videoPlayers[0].src } }, detail: {} }
  paused.page.onBackgroundVideoPlay(pausedEvent); paused.page.toggleBackgroundVideo(); paused.flushNextTicks()
  equal(paused.calls.filter(row => row.kind === 'video').map(row => row.action), ['pause'], 'pausing before nextTick prevents the pending mount from playing and pauses native autoplay')
  equal([paused.page.data.videoState, paused.page.data.videoAutoplay], ['paused', false], 'the delayed mount preserves the latest pause intent')
  paused.unload()
  for (const departure of ['hide', 'unload', 'static']) {
    const leaving = await readyEditor(async () => ({})); leaving.page.chooseBackground({ currentTarget: { dataset: { id: 'video-fire' } } })
    if (departure === 'hide') leaving.page.onHide()
    else if (departure === 'unload') leaving.unload()
    else leaving.page.chooseBackground({ currentTarget: { dataset: { id: 'peach' } } })
    const before = leaving.changes.length; leaving.flushNextTicks()
    equal([leaving.calls.filter(row => row.kind === 'video').length, leaving.changes.length], [0, before], departure + ' before nextTick cancels native context creation and any late playback')
  }
}

function sharedHandlerVerification() {
  const { localSpreadHandlers } = require('./verify-project')
  const read = source => localSpreadHandlers(__filename, ts.createSourceFile(__filename, source, ts.ScriptTarget.Latest, true))
  const reference = "'../miniprogram/packageGifts/utils/video'"
  const handlers = read('import { backgroundVideoPlayer as native, backgroundVideoData } from ' + reference + '; Page(withSharing({ ...native, data: { ...backgroundVideoData } }))')
  ok(handlers.has('toggleBackgroundVideo') && handlers.has('onBackgroundVideoError'), 'structure verifier resolves the specifically imported Page spread including named aliases')
  equal(handlers.has('videoVisible'), false, 'shared state properties are never counted as callable handlers')
  equal(handlers.has('missingVideoHandler'), false, 'a missing WXML handler remains missing')
  equal(read('import { backgroundVideoPlayer } from ' + reference + '; Page({ data: {} })').size, 0, 'an import without Page spread cannot invent a handler')
  equal(read('import { backgroundVideoPlayer } from ' + reference + '; Page({ data: { ...backgroundVideoPlayer } })').size, 0, 'a nested data spread cannot invent a Page handler')
  equal(read('import { backgroundVideoData } from ' + reference + '; Page({ ...backgroundVideoData })').size, 0, 'an unrelated exported data object cannot satisfy handler checks')
}

async function serialPreview() {
  const pending = [], captured = []
  const value = await readyEditor((action, data) => { equal(action, 'preview', 'preview requests use the free action'); captured.push(clone(data)); const hold = deferred(); pending.push(hold); return hold.promise })
  const { page } = value; page.previewWanted = true; page.previewDirty = true
  const first = page.syncPreview()
  page.input({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '最后一次编辑' } })
  const final = page.syncPreview(); equal(pending.length, 1, 'only one preview write runs at a time')
  pending[0].resolve({ site: site(captured[0]) }); await settle()
  equal(pending.length, 2, 'last edit queues a second write after the first returns')
  equal(captured[1].title, '最后一次编辑', 'second request carries the last title')
  pending[1].resolve({ site: site(captured[1]) }); await Promise.all([first, final])
  equal(page.data.preview.title, '最后一次编辑', 'visible preview ends on the last write')
  ok(captured.every(row => row.listed === false && !('durationId' in row) && !('requestId' in row)), 'preview carries only content, never paid publishing parameters')
}

async function renewalAndPublish() {
  const renewal = deferred(), preview = deferred(), publishing = deferred(), actions = []
  const value = await readyEditor((action, data) => { actions.push({ action, data: clone(data) }); return action === 'renewPreview' ? renewal.promise : action === 'preview' ? preview.promise : publishing.promise })
  const { page } = value; page.previewWanted = true; page.lastPreviewId = id; page.setData({ preview: site() })
  const renew = page.renewPreview(); page.input({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '续期中的新标题' } })
  const publish = page.publish(); equal(actions.map(row => row.action), ['renewPreview'], 'publishing waits for the existing renewal')
  renewal.resolve({ site: site() }); await settle()
  equal(actions.map(row => row.action), ['renewPreview', 'preview'], 'publishing flushes content after renewal, before create')
  equal(actions[1].data.title, '续期中的新标题', 'preview after renewal includes the last write')
  preview.resolve({ site: site(actions[1].data) }); await settle()
  equal(actions.map(row => row.action), ['renewPreview', 'preview', 'create'], 'create runs after preview synchronization completes')
  equal(actions[2].data.previewId, id, 'create consumes the synchronized temporary preview')
  page.queuePreview(); await page.renewPreview()
  equal(actions.length, 3, 'saving blocks new preview writes and heartbeat renewals')
  publishing.resolve({ site: { ...site(actions[2].data), preview: false }, coins: 200 }); await Promise.all([renew, publish])
  equal(page.data.preview, null, 'formal publishing clears the temporary preview')
  equal(page.lastPreviewId, '', 'published page cannot later release the consumed temporary preview')
  equal(value.timers.size + value.intervals.size, 0, 'published page has no preview heartbeat or debounce left')
}

async function departure() {
  const pending = deferred(), actions = []
  const value = await readyEditor((action, data) => { actions.push({ action, data: clone(data) }); return action === 'preview' ? pending.promise : Promise.resolve({}) })
  const { page } = value; page.previewWanted = true; page.previewDirty = true
  const sync = page.syncPreview(); value.unload(); const count = value.changes.length
  pending.resolve({ site: site() }); await sync; await settle()
  equal(value.changes.length, count, 'preview arriving after unload never writes to the destroyed page')
  equal(actions.map(row => row.action), ['preview', 'releasePreview'], 'late-created preview is released after the write finishes')
  equal(actions[1].data.id, id, 'release refers to the actual late preview')
  equal(value.timers.size + value.intervals.size, 0, 'leaving stops all preview timers')
  const hiddenActions = [], hidden = await readyEditor(async (action) => { hiddenActions.push(action); return { site: site() } }); hidden.page.previewWanted = true; hidden.page.lastPreviewId = id; hidden.page.setData({ preview: site() }); hidden.page.onHide(); hidden.page.onShow(); await settle()
  equal(hidden.page.previewVisible, true, 'returning to editor resumes preview lifecycle')
  equal(hiddenActions, [], 'immediate return cancels the pending departure release')
  ok([...hidden.intervals.values()].some(row => row.delay === 45000), 'active editor renews every 45 seconds')
  let fail = true
  const retry = await readyEditor(async () => { if (fail) throw new Error('预览连接失败'); return { site: site() } }); await retry.page.previewWebsite()
  equal(retry.page.data.error, '预览连接失败', 'first preview failure is visible even before a preview URL exists')
  fail = false; await retry.page.previewWebsite(); equal(retry.page.data.error, '', 'successful retry clears the prior connection error')
}

async function viewLifecycleAndMessages() {
  const notes = deferred(), post = deferred(), requests = [], gets = [], holdLoad = deferred()
  let nextLoad = Promise.resolve({ success: true, data: site({ background: 'meteors', backgroundPoster: 'backgrounds/grassland-night.webp', layout: { height: 700, elements: [{ id: 'title', type: 'title', x: 8, y: 5, width: 84, fontSize: 28, color: '#906489', value: '' }] } }) })
  const value = harness('view', async () => ({}), { getPublic: ref => { gets.push(ref); return ref.endsWith('/messages') ? notes.promise : nextLoad }, postPublic: (ref, data) => { requests.push({ ref, data }); return post.promise } })
  const { page } = value; page.setData({ id }); await page.load(); page.onShow()
  equal(page.data.canvasElements.length, 1, 'view renders the received layout')
  equal(page.data.backgroundPoster, 'https://www.crbuj.icu/campus-api/gift-assets/backgrounds/grassland-night.webp', 'public scene artwork comes from the server presentation data')
  nextLoad = holdLoad.promise; const quiet = page.load(true); equal(page.data.loading, false, 'automatic preview refresh does not flash the loading UI')
  page.load(true); equal(gets.length, 2, 'quiet refresh prevents overlapping requests')
  holdLoad.resolve({ success: true, data: site({ layout: null }) }); await quiet
  equal(page.data.canvasElements, [], 'switching to automatic layout clears stale custom elements')
  equal(page.data.backgroundPoster, '', 'quiet updates to static scenery clear the old fixed backdrop')
  const loadingNotes = page.loadMessages(); page.setData({ messageName: '小李', messageText: '生日快乐', anonymous: true }); const sending = page.sendMessage()
  equal(requests[0].data.anonymous, true, 'birthday template accepts explicit anonymous wishes')
  page.setData({ messageText: '下一份祝福的草稿' }); post.resolve({ success: true, data: [{ id: 'n1', name: '匿名朋友', message: '生日快乐' }] }); await sending
  equal(page.data.messageText, '下一份祝福的草稿', 'message result never erases a new draft entered during posting')
  equal(page.data.messages[0].name, '匿名朋友', 'anonymous server result appears in the birthday guestbook')
  const expired = new Error('临时预览已回收'); expired.statusCode = 410; nextLoad = Promise.reject(expired); await page.load(true)
  equal([page.data.site, page.data.url, page.data.messages.length, page.data.canvasElements.length, page.data.canvasPadding, page.data.expiresText, page.data.opened], [null, '', 0, 0, 0, '', false], '410 clears expired site and guestbook content completely')
  notes.resolve({ success: true, data: [{ id: 'late', name: '迟到', message: '旧结果' }] }); await loadingNotes
  equal(page.data.messages, [], 'guestbook response cannot revive expired content')
  equal(value.intervals.size, 0, 'expired preview stops polling')
  const late = deferred(), unloaded = harness('view', async () => ({}), { getPublic: () => late.promise }); unloaded.page.setData({ id }); const load = unloaded.page.load(); unloaded.unload(); const count = unloaded.changes.length
  late.resolve({ success: true, data: site() }); await load; equal(unloaded.changes.length, count, 'view load arriving after unload does not mutate the page')
  const latePost = deferred(), lateMessages = deferred(), removed = harness('view', async () => ({}), { getPublic: () => lateMessages.promise, postPublic: () => latePost.promise })
  removed.page.setData({ id, site: site(), messageText: '异步留言' }); const read = removed.page.loadMessages(), send = removed.page.sendMessage(); removed.unload(); const before = removed.changes.length
  lateMessages.resolve({ success: true, data: [] }); latePost.resolve({ success: true, data: [] }); await Promise.all([read, send])
  equal(removed.changes.length, before, 'guestbook read and post arriving after unload never mutate the page')
}

async function galleryRefresh() {
  const more = deferred(); let generation = 0
  const value = harness('index', (action) => action === 'gallery' ? more.promise : Promise.resolve({ coins: 0, sites: [], gallery: { sites: [{ id: 'generation-' + ++generation }], hasMore: true } }))
  const { page } = value; await page.load(); const pending = page.moreGallery(); await page.load()
  more.resolve({ sites: [{ id: 'old-page-two' }], hasMore: false }); await pending
  equal(page.data.gallery.map(row => row.id), ['generation-2'], 'late pagination from old gallery cannot mix into a refreshed gallery')
  equal(page.data.galleryPage, 1, 'refresh keeps its first page despite stale pagination')
  equal(page.data.galleryHasMore, true, 'stale response cannot remove fresh pagination availability')
  equal(page.data.galleryLoading, false, 'pagination latch is released after stale response')
  const old = deferred(), fresh = deferred(), pendingCatalog = []
  const returned = harness('index', () => { const hold = pendingCatalog.length ? fresh : old; pendingCatalog.push(hold); return hold.promise })
  const initial = returned.page.load(), refresh = returned.page.onShow()
  equal(pendingCatalog.length, 2, 'returning from editor requests fresh catalog even while the old request is loading')
  fresh.resolve({ sites: [{ id: 'newly-published' }], gallery: { sites: [], hasMore: false } }); await refresh
  old.resolve({ sites: [], gallery: { sites: [{ id: 'outdated' }], hasMore: true } }); await initial
  equal(returned.page.data.sites.map(row => row.id), ['newly-published'], 'late old catalog cannot erase the just-published website')
  equal(returned.page.data.gallery, [], 'late old catalog cannot overwrite the fresh public gallery')
  equal(returned.page.data.loading, false, 'fresh catalog releases its loading state')
}

async function publicCookieJar() {
  const storage = new Map(), requests = [], cookie = 'gift_visitor=' + 'b'.repeat(32) + '.' + 'c'.repeat(64)
  const module = { exports: {} }, file = path.resolve(__dirname, '../miniprogram/utils/api-client.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, Promise, Error, console,
    require: () => ({ API_BASE_URL: 'https://www.crbuj.icu/campus-api', API_CACHE_VERSION: 'test' }),
    wx: { getStorageSync: key => storage.get(key) || '', setStorageSync: (key, value) => storage.set(key, value), request: options => { requests.push(options); options.success({ statusCode: 200, data: '{"success":true,"data":[]}', cookies: requests.length === 1 ? [cookie + '; HttpOnly; Path=/'] : [], header: {} }) } } })
  const api = module.exports.api; await api.getPublic('/api/gifts/' + id); await api.postPublic('/api/gifts/' + id + '/messages', { message: '来自同一位朋友', anonymous: true }); await api.getPublic('/api/public/modules')
  equal(requests[0].header.Cookie, undefined, 'first visit starts without an invented visitor identity')
  equal(requests[1].header.Cookie, cookie, 'signed visitor cookie persists from GET to anonymous POST')
  equal(requests[1].data.anonymous, true, 'anonymous flag reaches public request intact')
  equal(requests[2].header.Cookie, undefined, 'gift visitor cookie is not attached to unrelated API endpoints')
  await assert.rejects(api.postPublic('/api/functions/globalAdmin', {}), /公开写入路径无效/); checks++
  equal(requests.length, 3, 'non-gift public write is rejected before any HTTP request')
}

async function adminGrantConfirmation() {
  const first = deferred(), second = deferred(), grants = []
  const value = harness('admin', (action, data) => {
    if (action === 'adminList') return Promise.resolve({ sites: [], admin: { role: 'super' } })
    grants.push(clone(data)); return grants.length === 1 ? first.promise : second.promise
  }, { call: async () => ({ result: { code: 0, data: { list: [{ _id: 'student-123456', nickName: '小雨' }] } } }) })
  const { page } = value; await page.load(); await page.searchUsers(); page.chooseUser({ currentTarget: { dataset: { id: 'student-123456' } } })
  for (const amount of ['0', '-1', '1.5', '1000001']) { page.setData({ amount }); page.grant() }
  equal(value.calls.filter(row => row.kind === 'modal').length, 0, 'invalid grant amounts cannot reach confirmation')
  page.setData({ amount: '7', reason: '活动奖励', isSuper: false }); page.grant()
  equal(value.calls.filter(row => row.kind === 'modal').length, 0, 'non-super administrator cannot initiate coin granting')
  page.setData({ isSuper: true }); page.grant(); const confirm = value.calls.find(row => row.kind === 'modal')
  ok(confirm.content.includes('小雨') && confirm.content.includes('123456') && confirm.content.includes('7金币') && confirm.content.includes('活动奖励'), 'confirmation names recipient, identifier, amount and reason')
  equal(grants.length, 0, 'no coins are sent before confirmation')
  confirm.success({ confirm: true }); await settle()
  equal(grants.length, 1, 'confirmed grant sends exactly one request')
  page.grantInput({ currentTarget: { dataset: { field: 'amount' } }, detail: { value: '100' } }); page.grant()
  equal(page.data.amount, '7', 'an in-flight grant freezes editable amount')
  equal(value.calls.filter(row => row.kind === 'modal').length, 1, 'repeated clicks during a grant do not open another confirmation')
  first.reject(new Error('网络暂时中断')); await settle(); page.grant(); value.calls.filter(row => row.kind === 'modal').at(-1).success({ confirm: true }); await settle()
  equal(grants[1].requestId, grants[0].requestId, 'retry after ambiguous transport failure reuses the idempotency key')
  equal([grants[1].userId, grants[1].amount, grants[1].reason], ['student-123456', 7, '活动奖励'], 'retry retains the exact confirmed grant fields')
  second.resolve({ name: '小雨', amount: 7, coins: 107 }); await settle()
  ok(page.data.grantResult.includes('107'), 'successful grant displays authoritative server balance')
  equal(page.grantRequestId, '', 'success clears the consumed idempotency key')
}

async function run() {
  sharedHandlerVerification(); await pricingAndCanvas(); await editorSteps(); await nativeVideoLifecycle(); await serialPreview(); await renewalAndPublish(); await departure(); await viewLifecycleAndMessages(); await galleryRefresh(); await publicCookieJar(); await adminGrantConfirmation()
  console.log('Gift preview UI: ' + checks + ' assertions passed (native video source/control/retry/departure, serial last-write, renewal/publish order, destroyed pages, quiet expiry, anonymous cookie, pricing and refreshed gallery)')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
