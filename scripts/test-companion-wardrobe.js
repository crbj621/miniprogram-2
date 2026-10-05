'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { wardrobeHeat, buildWardrobeRanking } = require('../server/services/english_learning/companion-ranking')
const catalog = require('../server/data/english/shop.json')
const root = path.resolve(__dirname, '..')

function checkHeat() {
  const profile = { openid: 'one', character: 'girl', owned: ['girl_peach_hanfu', 'accessory_star', 'shoes_cloud', 'theme_sakura', 'food_apple'], equipped: { outfit: 'girl_peach_hanfu', accessory: 'accessory_star', shoes: 'shoes_cloud', themes: { portal: 'theme_sakura', english: 'theme_sakura' } }, heat: 999999 }
  assert.equal(wardrobeHeat(profile, catalog).heat, 183, 'server catalog values determine heat; themes are deduplicated and forged client heat is ignored')
  const noOutfit = { ...profile, equipped: { ...profile.equipped, outfit: '' } }
  assert.equal(wardrobeHeat(noOutfit, catalog).heat, 63, 'removing an outfit immediately lowers heat')
  const forged = { ...profile, owned: ['girl_peach_hanfu'], equipped: { outfit: 'boy_magic', accessory: 'girl_peach_hanfu', shoes: 'food_apple', themes: {} } }
  assert.equal(wardrobeHeat(forged, catalog).heat, 0, 'unowned, incompatible and wrong-slot items cannot increase heat')
  assert.equal(wardrobeHeat({ ...profile, character: 'boy' }, catalog).heat, 63, 'gender-specific clothing is excluded after a character switch')
  const disabledCatalog = { items: catalog.items.map(item => item.id === 'girl_peach_hanfu' ? { ...item, enabled: false } : item) }
  assert.equal(wardrobeHeat(profile, disabledCatalog).heat, 63, 'disabled goods do not create ranking points')
  const tied = { ...profile, openid: 'two' }
  const third = { ...noOutfit, openid: 'three' }
  const noHeat = { openid: 'visitor', owned: [], equipped: {} }
  const ranking = buildWardrobeRanking([third, tied, noHeat, profile], catalog, [{ openid: 'one', nickName: '同学甲' }], 'one')
  assert.deepEqual(ranking.items.map(item => [item.openid, item.rank, item.heat]), [['one', 1, 183], ['two', 1, 183], ['three', 3, 63]], 'competition ranks preserve ties and stable order')
  assert.equal(ranking.myRank, 1)
  assert.equal(ranking.myHeat, 183)
  assert.equal(ranking.total, 3)
  assert.equal(ranking.items[0].nickName, '同学甲')
  assert.equal(buildWardrobeRanking([noHeat], catalog, [], 'visitor').myRank, null, 'an empty ranking has no invented participants')
}

function loadTs(file, globals, imports = {}) {
  const module = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText
  vm.runInNewContext(source, { module, exports: module.exports, console, require: ref => ref.endsWith('/page-share') ? { withSharing: value => value } : ref.endsWith('/page-copy') ? { withPageCopy: (_scope, value) => value } : imports[ref] || {}, ...globals })
  return module.exports
}

function checkAppearance() {
  const appearance = loadTs('miniprogram/components/campus-companion/companion-data.ts', {}, { '../../config/api': { API_BASE_URL: 'https://www.crbuj.icu/campus-api' } })
  const data = { character: 'girl', catalog: catalog.items, assets: catalog.assets, equipped: { outfit: 'girl_peach_hanfu' } }
  let result = appearance.getCompanionAppearance(data)
  assert.equal(result.image, catalog.assets.girl, 'layer clothes preserve the original base character image')
  assert.match(result.outfit, /girl-peach-hanfu\.png$/)
  result = appearance.getCompanionAppearance({ ...data, character: 'boy', equipped: { outfit: 'boy_campus' } })
  assert.match(result.image, /boy-campus\.png$/)
  assert.equal(result.outfit, '', 'existing full character outfits keep their original rendering')
  const layerItems = catalog.items.filter(item => item.renderMode === 'layer')
  assert.equal(layerItems.length, 6)
  assert.equal(layerItems.filter(item => item.character === 'girl').length, 3)
  assert.equal(layerItems.filter(item => item.character === 'boy').length, 3)
  for (const item of layerItems) {
    const filename = item.image.split('/').pop(), png = fs.readFileSync(path.join(root, 'server/public/english/companions', filename))
    assert.equal(png.readUInt32BE(16), 1024)
    assert.equal(png.readUInt32BE(20), 1536, 'every garment uses the same coordinate space')
    assert.match(fs.readFileSync(path.join(root, 'server/public/english/companions', filename.replace('.png', '.svg')), 'utf8'), /<path /, 'new clothes contain actual vector garments, not a color filter')
  }
}

function checkMotion() {
  let definition
  const timers = new Map(), events = []
  let serial = 0
  loadTs('miniprogram/components/campus-companion/campus-companion.ts', {
    Component: value => { definition = value },
    setTimeout: callback => { timers.set(++serial, callback); return serial },
    clearTimeout: handle => timers.delete(handle)
  })
  const component = Object.assign({ data: structuredClone(definition.data), properties: { image: catalog.assets.girl, outfit: '', interactive: true, feeding: false }, setData(value) { Object.assign(this.data, value) }, triggerEvent(name, value) { events.push({ name, value }) } }, definition.methods)
  definition.lifetimes.attached.call(component)
  component.interact()
  assert.equal(component.data.motion, 'wobble')
  assert.equal(timers.size, 1)
  component.interact()
  assert.equal(events.length, 1, 'double taps cannot multiply timers or dialogue')
  const stale = [...timers.values()][0]
  definition.pageLifetimes.hide.call(component)
  assert.equal(timers.size, 0, 'hidden pages release interaction timers')
  stale()
  assert.equal(component.data.dialogue, '')
  assert.equal(component.data.paused, true)
  definition.pageLifetimes.show.call(component)
  component.properties.outfit = 'different-clothes.png'
  component.interact()
  assert.equal(component.data.motion, 'hop', 'the same motion sequence works after clothes change')
  definition.observers.feeding.call(component, true)
  assert.equal(timers.size, 0)
  assert.equal(component.data.dialogue, '', 'feeding has priority over tap dialogue')
  component.properties.feeding = true
  component.interact()
  assert.equal(timers.size, 0)
  component.properties.feeding = false
  component.interact()
  definition.lifetimes.detached.call(component)
  assert.equal(timers.size, 0, 'destroyed components release timers')
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/components/campus-companion/campus-companion.wxml'), 'utf8')
  assert.match(wxml, /class="companion-layer companion-outfit"/)
  assert.match(wxml, /catchtap="interact"/, 'tapping the character interacts without bubbling into navigation')
  const portal = fs.readFileSync(path.join(root, 'miniprogram/pages/portal/portal.wxml'), 'utf8')
  assert.ok(portal.indexOf('class="welcome-companion"') < portal.indexOf('class="user-avatar '), 'the companion is placed left of the homepage avatar')
}

checkHeat()
checkAppearance()
checkMotion()
console.log('Companion wardrobe checks passed: server heat, owned equipment, stable ties, 6 garment layers, shared motion and timer lifecycle.')
