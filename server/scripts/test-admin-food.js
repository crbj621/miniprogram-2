const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const cloud = require('campus-server-sdk'), db = cloud.database()
const admin = require('../services/globalAdmin'), food = require('../services/food_manager')
const prefix = 'admin-food-test-' + crypto.randomBytes(6).toString('hex')
const owner = prefix + '-student', shopId = prefix + '-shop', dishId = prefix + '-dish', orderId = prefix + '-order'
const owned = []
const call = (service, openid, event) => cloud.__runWithContext({ openid }, () => service.main(event))
async function put(collection, id, data) { owned.push({ collection, id }); await db.collection(collection).doc(id).create({ data }) }
async function main() {
  assert.equal((await call(food, owner, { action: 'adminManageDish', data: {} })).success, false)
  await put('global_admin', prefix, { loginOpenid: prefix, role: 'admin', status: 'active' })
  await put('food_shop', shopId, { name: prefix, auditStatus: 'approved', isOpen: true })
  await put('food_dish', dishId, { shopId, name: '库存测试', price: 10, stock: 6, sales: 4, isAvailable: true })
  await put('food_order', orderId, { _openid: owner, shopId, type: 'pickup', status: 'pending', inventoryReserved: true,
    items: [{ _id: dishId, name: '库存测试', count: 4 }], couponId: prefix + '-coupon', userNickName: '同学', phone: '123', createTime: new Date() })
  await put('user_coupons', prefix + '-coupon', { _openid: owner, used: true, orderId })
  const update = (id, status) => call(admin, prefix, { action: 'updateFoodOrder', data: { id, status } })
  assert.notEqual((await update(orderId, 'completed')).code, 0, 'cannot jump pending to completed')
  assert.equal((await update(orderId, 'cancelled')).code, 0)
  assert.equal((await db.collection('food_dish').doc(dishId).get()).data.stock, 10)
  assert.equal((await db.collection('user_coupons').doc(prefix + '-coupon').get()).data.used, false)
  assert.notEqual((await update(orderId, 'cancelled')).code, 0)
  assert.equal((await db.collection('food_dish').doc(dishId).get()).data.stock, 10, 'retry cancellation cannot restore twice')
  const pickup = prefix + '-pickup'
  await put('food_order', pickup, { _openid: owner, shopId, type: 'pickup', status: 'pending' })
  for (const state of ['processing', 'ready', 'completed']) assert.equal((await update(pickup, state)).code, 0)
  await put('food_order', prefix + '-delivery', { _openid: owner, shopId, type: 'delivery', status: 'ready' })
  assert.notEqual((await update(prefix + '-delivery', 'completed')).code, 0, 'delivery completion belongs to rider workflow')
  const add = await call(food, prefix, { action: 'adminManageDish', data: { type: 'add', dishData: { shopId, name: prefix, price: 12, stock: 0, isAvailable: true } } })
  assert.equal(add.success, true)
  const list = await call(admin, prefix, { action: 'getShopDishes', data: { shopId } })
  const added = list.data.dishes.find(row => row.name === prefix)
  assert.equal(added.stock, 0, 'zero stock is preserved')
  const changed = await call(food, prefix, { action: 'adminManageDish', data: { type: 'update', dishData: { _id: added._id, shopId, stock: 3 } } })
  assert.equal(changed.success, true)
  const student = await call(food, owner, { action: 'getShopDetail', data: { shopId } })
  assert.equal(student.success, true)
  assert.ok(student.menu.flatMap(category => category.items).some(row => row._id === added._id && row.stock === 3), 'administrator changes are visible to student checkout')
  console.log('Admin food canonical dishes/order states/cancellation stock/coupon/retry/permissions passed: 14 assertions')
}
main().finally(async () => {
  for (const collection of ['food_dish', 'food_shop_logs', 'global_admin_log']) {
    const rows = (await db.collection(collection).get()).data
    for (const row of rows.filter(row => row.shopId === shopId || row.adminOpenid === prefix || row.openid === prefix || String(row.description || row.detail || '').includes(prefix))) await db.collection(collection).doc(row._id).remove()
  }
  for (const row of owned) await db.collection(row.collection).doc(row.id).remove()
  await cloud.__getPool().end()
}).catch(error => { console.error(error); process.exitCode = 1 })
