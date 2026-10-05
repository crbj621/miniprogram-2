'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = path.resolve(__dirname, '..')
const scopes = ['login', 'portal', 'portalSection', 'running', 'runRank', 'pairRank', 'food', 'foodLogin', 'canteen', 'forum', 'english', 'englishRank', 'gifts', 'wardrobe']
const serialize = value => JSON.stringify(value)

function load(file, globals = {}) {
  const module = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'miniprogram/utils', file + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
  }).outputText
  vm.runInNewContext(source, { module, exports: module.exports, ...globals }, { filename: file + '.ts' })
  return module.exports
}
function copies(random = () => 0) { return load('page-copy', { Math: Object.assign(Object.create(Math), { random }) }) }
function mount(definition) {
  const page = { ...definition, data: { ...definition.data } }
  page.setData = function(patch) { Object.assign(this.data, patch) }
  return page
}
function checkCopy(copy, scope) {
  assert.equal(typeof copy.title, 'string'); assert.ok(copy.title.trim(), scope + ': nonempty title')
  assert.equal(typeof copy.subtitle, 'string'); assert.ok(copy.subtitle.trim(), scope + ': nonempty subtitle')
  assert.equal(typeof copy.greeting, 'string')
  if (scope === 'portal') assert.ok(copy.greeting.trim(), 'portal: nonempty greeting')
}

function checkBanks() {
  for (const scope of scopes) {
    let tick = 0
    const { getPageCopy } = copies(() => tick++ % 97 / 97)
    const seen = new Set()
    let previous
    for (let i = 0; i < 291; i++) {
      const copy = getPageCopy(scope), text = serialize(copy)
      checkCopy(copy, scope)
      assert.notEqual(text, previous, scope + ': consecutive visits must differ')
      seen.add(text); previous = text
    }
    assert.ok(seen.size >= 6, scope + ': at least six available copy groups')
    for (const random of [() => 0, () => 0.999999999]) {
      const fixed = copies(random)
      let previous
      for (let i = 0; i < 20; i++) {
        const text = serialize(fixed.getPageCopy(scope))
        assert.notEqual(text, previous, scope + ': repeated random values cannot repeat or hang')
        previous = text
      }
    }
  }
  for (const scope of scopes.slice(1)) {
    const interleaved = copies(), isolated = copies()
    for (let i = 0; i < 5; i++) {
      interleaved.getPageCopy('login')
      assert.equal(serialize(interleaved.getPageCopy(scope)), serialize(isolated.getPageCopy(scope)), scope + ': history is independent of another scope')
    }
  }
  let tick = 0
  const isolatedReturns = copies(() => tick++ % 97 / 97)
  const original = isolatedReturns.getPageCopy('portal'), expected = serialize(original)
  original.title = original.subtitle = original.greeting = 'mutated by a caller'
  const later = Array.from({ length: 291 }, () => serialize(isolatedReturns.getPageCopy('portal')))
  assert.ok(later.includes(expected), 'mutating a returned copy cannot change its bank')
  assert.ok(later.every(value => !value.includes('mutated by a caller')))
}

async function checkLifecycle() {
  let picks = 0
  const { withPageCopy } = copies(() => { picks++; return 0 })
  const options = { id: 'same-options-object' }, marker = {}, nested = { value: 7 }
  let originalThis, originalOptions, shows = 0
  const definition = {
    data: { counter: 5, nested },
    onLoad(value) { originalThis = this; originalOptions = value; checkCopy(this.data.pageCopy, 'portal'); return marker },
    onShow() { shows++; return this.data.counter },
    increment() { this.setData({ counter: this.data.counter + 1 }) }
  }
  const wrapped = withPageCopy('portal', definition), other = withPageCopy('portal', definition)
  assert.equal(picks, 0, 'registration supplies defaults without consuming a visit')
  assert.equal(definition.data.pageCopy, undefined, 'original definition is not mutated')
  assert.notEqual(wrapped.data, definition.data)
  assert.equal(wrapped.data.nested, nested, 'existing page data is preserved')
  assert.equal(wrapped.increment, definition.increment)
  assert.equal(wrapped.onShow, definition.onShow, 'onShow is not replaced by copy selection')
  assert.equal(serialize(wrapped.data.pageCopy), serialize(other.data.pageCopy), 'same scope has the same initial group')
  assert.notEqual(wrapped.data.pageCopy, other.data.pageCopy, 'default copy objects are independent')
  wrapped.data.pageCopy.title = 'one page changed its default'
  assert.notEqual(other.data.pageCopy.title, wrapped.data.pageCopy.title)
  const page = mount(wrapped)
  assert.equal(page.onLoad(options), marker, 'sync return value is preserved')
  assert.equal(originalThis, page); assert.equal(originalOptions, options)
  assert.equal(picks, 1)
  const first = serialize(page.data.pageCopy)
  assert.equal(page.onShow(), 5); page.increment(); assert.equal(page.onShow(), 6)
  assert.equal(shows, 2); assert.equal(picks, 1)
  assert.equal(serialize(page.data.pageCopy), first, 'onShow and setData keep the entry copy')
  const nextVisit = mount(other)
  nextVisit.onLoad(options)
  assert.notEqual(serialize(nextVisit.data.pageCopy), first, 'a new entry selects a different group')
  assert.equal(page.data.counter, 6); assert.equal(nextVisit.data.counter, 5)
  const pending = Promise.resolve(marker)
  const asyncPage = mount(withPageCopy('english', { data: {}, onLoad(value) { assert.equal(value, options); assert.equal(this, asyncPage); return pending } }))
  assert.equal(asyncPage.onLoad(options), pending, 'the exact Promise returned by onLoad is preserved')
  assert.equal(await pending, marker)
  const failed = new Error('business load failed')
  const failingPage = mount(withPageCopy('food', { data: {}, onLoad() { throw failed } }))
  assert.throws(() => failingPage.onLoad(options), error => error === failed, 'business errors are not swallowed')
  const noLoad = mount(withPageCopy('canteen', { data: { counter: 3 } }))
  assert.equal(noLoad.onLoad(), undefined); assert.equal(noLoad.data.counter, 3)
  checkCopy(noLoad.data.pageCopy, 'canteen')
}

function checkPublicSharing() {
  let selections = 0, businessLoads = 0, businessShows = 0, refreshStops = 0
  const { withPageCopy } = copies(() => { selections++; return 0 })
  const { withSharing } = load('page-share', { wx: { showShareMenu() {}, stopPullDownRefresh() { refreshStops++ } } })
  const definition = withSharing(withPageCopy('portal', {
    data: { counter: 2 },
    onLoad() { businessLoads++; return 'loaded' },
    onShow() { businessShows++ }
  }))
  const opened = mount(definition)
  opened.route = 'pages/portal/portal'
  const defaultCopy = serialize(opened.data.pageCopy)
  opened.onLoad({ sharePublic: '1', entry: encodeURIComponent('/pages/portal/portal') })
  for (const lifecycle of ['onShow', 'onReady', 'onHide', 'onUnload', 'onReachBottom', 'onPullDownRefresh', 'onPageScroll']) opened[lifecycle]()
  assert.equal(opened.data.__sharePublic, true)
  assert.equal(selections, 0, 'Timeline public card does not select a copy')
  assert.equal(businessLoads, 0); assert.equal(businessShows, 0)
  assert.equal(refreshStops, 1)
  assert.equal(serialize(opened.data.pageCopy), defaultCopy)
  const regular = mount(definition)
  regular.route = 'pages/portal/portal'
  assert.equal(regular.onLoad({}), 'loaded')
  regular.onShow(); regular.setData({ counter: 3 }); regular.onShow()
  assert.equal(selections, 1); assert.equal(businessLoads, 1); assert.equal(businessShows, 2)
}

function checkPageEntries() {
  for (const route of ['pages/portal/portal', 'pages/rank/rank']) {
    let selections = 0, definition, businessCalls = 0
    const copy = copies(() => { selections++; return 0 })
    const wx = { showShareMenu() {}, stopPullDownRefresh() {} }
    const sharing = load('page-share', { wx })
    const imports = {
      'page-copy': copy, 'page-share': sharing, 'portal-daily': load('portal-daily'),
      'companion-data': { getCompanionAppearance: () => ({}), companionImageUrl: value => value },
      'campus-theme': { getSavedCampusTheme: () => ({ style: '' }) },
      'api-client': { api: {} }, 'public-modules': {}
    }
    const file = path.join(root, 'miniprogram', route + '.ts')
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText
    vm.runInNewContext(source, {
      exports: {}, Page: value => { definition = value }, wx,
      getApp: () => ({ isLoggedIn: () => false, getUserInfo: () => null }),
      require: ref => { const value = imports[ref.split('/').pop()]; assert.ok(value, route + ': known dependency ' + ref); return value }
    }, { filename: file })
    assert.equal(selections, 0, route + ': registration does not select any copy')
    const instance = () => {
      const page = mount(definition)
      page.route = route
      for (const name of ['loadModules', 'loadCompanion', 'loadServerHealth', 'showAnnouncementIfNeeded', 'getRankList']) page[name] = () => { businessCalls++; return Promise.resolve(true) }
      return page
    }
    const page = instance()
    page.onLoad({})
    const copiesAtEntry = serialize([page.data.pageCopy, page.data.sectionCopy, page.data.moduleCopy, page.data.pairCopy])
    const entrySelections = selections
    assert.equal(entrySelections, route.includes('/portal/') ? 8 : 2, route + ': all copy slots select on entry')
    page.onShow(); page.setData({ unrelated: 1 }); page.onShow()
    assert.equal(selections, entrySelections, route + ': shows do not reselect copy slots')
    assert.equal(serialize([page.data.pageCopy, page.data.sectionCopy, page.data.moduleCopy, page.data.pairCopy]), copiesAtEntry)
    const publicPage = instance(), callsBeforePublic = businessCalls
    publicPage.onLoad({ sharePublic: '1', entry: encodeURIComponent('/' + route) }); publicPage.onShow()
    assert.equal(selections, entrySelections, route + ': public entry skips every copy slot')
    assert.equal(businessCalls, callsBeforePublic, route + ': public entry skips private loaders')
  }
}

async function main() {
  checkBanks(); await checkLifecycle(); checkPublicSharing(); checkPageEntries()
  console.log('随机文案14范围、独立历史、连续去重、对象隔离、生命周期/返回值、首页/榜单多文案与朋友圈公开卡：通过')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
