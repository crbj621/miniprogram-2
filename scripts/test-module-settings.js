const assert = require('node:assert/strict')
const Module = require('node:module')
const documents = new Map([
  ['global_settings', [{ _id: 'settings', appName: '校园服务', contactEmail: 'keep@example.com', modules: { run: false, food: true, rider: { enabled: true }, canteen: { enabled: true }, forum: { enabled: false } } }]],
  ['global_admin', [
    { _id: 'super', loginOpenid: 'super', role: 'super', status: 'active' },
    { _id: 'normal', loginOpenid: 'normal', role: 'normal', status: 'active' },
    { _id: 'disabled', loginOpenid: 'disabled', role: 'super', status: 'disabled' }
  ]]
])
let openid = 'super'
function rows(name) { if (!documents.has(name)) documents.set(name, []); return documents.get(name) }
function query(name, filter = {}) {
  return {
    where: next => query(name, next), limit() { return this },
    async get() { return { data: rows(name).filter(row => Object.entries(filter).every(([key, value]) => value && value.neq ? row[key] !== value.neq : row[key] === value)) } },
    async add({ data }) { const _id = 'id-' + rows(name).length; rows(name).push({ ...data, _id }); return { _id } },
    doc(id) { return {
      async update({ data }) {
        const row = rows(name).find(row => row._id === id)
        for (const [field, value] of Object.entries(data)) {
          const keys = field.split('.'); let target = row
          for (const key of keys.slice(0, -1)) { if (!target[key] || typeof target[key] !== 'object') target[key] = {}; target = target[key] }
          target[keys.at(-1)] = value
        }
      }
    } }
  }
}
const cloud = { init() {}, getWXContext: () => ({ OPENID: openid }), database: () => ({
  command: { neq: value => ({ neq: value }) }, collection: query, serverDate: () => 'now'
}) }
const original = Module._load
Module._load = function(name, ...args) { return name === 'campus-server-sdk' ? cloud : original.call(this, name, ...args) }
const service = require('../server/services/globalAdmin')
Module._load = original
async function call(action, data) { return service.main({ action, data }) }

async function main() {
  const legacy = await call('getPublicModules')
  assert.equal(legacy.data.modules.food, false, '旧点餐标记固定关闭')
  assert.equal(legacy.data.modules.rider, false, '旧骑手标记固定关闭')
  assert.equal(legacy.data.modules.running, false, '旧 run 键必须兼容为 running')
  const list = await call('getModuleList')
  assert.deepEqual(list.data.list.map(row => row.key).sort(), ['running', 'canteen', 'forum', 'english', 'gifts'].sort())
  const changed = await call('updateGlobalSettings', { modules: { running: { enabled: true }, canteen: { enabled: true }, forum: { enabled: false }, english: { enabled: false }, gifts: { enabled: false } } })
  assert.equal(changed.code, 0)
  assert.deepEqual((await call('getPublicModules')).data.modules, { running: true, food: false, canteen: true, forum: false, rider: false, english: false, gifts: false })
  assert.equal(rows('global_settings')[0].contactEmail, 'keep@example.com', '只改模块时保留其他设置')
  assert.equal((await call('updateModuleStatus', { module: 'english', enabled: true })).code, 0)
  assert.equal((await call('getPublicModules')).data.modules.english, true)
  assert.equal((await call('getPublicModules')).data.modules.food, false)
  assert.notEqual((await call('updateModuleStatus', { module: 'food', enabled: true })).code, 0)
  assert.notEqual((await call('updateModuleStatus', { module: 'rider', enabled: true })).code, 0)
  const before = JSON.stringify(rows('global_settings'))
  for (const data of [{ module: 'missing', enabled: true }, { module: 'english', enabled: 'false' }]) {
    assert.notEqual((await call('updateModuleStatus', data)).code, 0)
  }
  assert.notEqual((await call('updateGlobalSettings', { modules: { english: { enabled: 'false' } } })).code, 0)
  assert.equal(JSON.stringify(rows('global_settings')), before, '无效输入不能写入数据库')
  for (const identity of ['normal', 'disabled']) {
    openid = identity
    assert.notEqual((await call('updateModuleStatus', { module: 'food', enabled: true })).code, 0)
    assert.notEqual((await call('updateGlobalSettings', { modules: { food: false } })).code, 0)
  }
  console.log('模块格式兼容、五项开关及旧版关闭标记、部分保存与权限：通过')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
