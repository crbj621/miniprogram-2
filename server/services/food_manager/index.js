const cloud = require('campus-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

const ADMIN_ACTIONS = [
  'initDatabase', 'adminLogin', 'getAdminStats', 'getRankList', 'clearRankRecords',
  'getShopAuditList', 'auditShop', 'getShopManageList', 'adminUpdateShopStatus',
  'adminUpdateShopInfo', 'adminResetShopPassword', 'adminUpdateShopAccount',
  'getShopLogs', 'initTestData', 'adminUpdateOrderStatus', 'adminManageDish'
]

const orderLocks = new Set()

async function withOrderLock(openid, callback) {
  if (orderLocks.has(openid)) {
    return { success: false, msg: '订单正在提交，请勿重复操作' }
  }
  orderLocks.add(openid)
  try {
    return await callback()
  } finally {
    orderLocks.delete(openid)
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const digest = crypto.scryptSync(String(password), salt, 32).toString('hex')
  return 'scrypt$' + salt + '$' + digest
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function verifyPassword(password, merchant) {
  const storedHash = String((merchant && merchant.passwordHash) || '')
  if (storedHash.indexOf('scrypt$') === 0) {
    const parts = storedHash.split('$')
    if (parts.length !== 3) return false
    const digest = crypto.scryptSync(String(password), parts[1], 32).toString('hex')
    return safeEqual(digest, parts[2])
  }
  return !!merchant && safeEqual(password, merchant.password || '')
}

async function upgradeMerchantPassword(merchant, password) {
  if (!merchant || merchant.passwordHash) return
  await db.collection('food_shop_user').doc(merchant._id).update({
    data: {
      passwordHash: hashPassword(password),
      password: _.remove(),
      updateTime: db.serverDate()
    }
  })
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const appid = wxContext.APPID
  
  const { action, data = {} } = event

  try {
    if (ADMIN_ACTIONS.indexOf(action) !== -1) {
      const adminRes = await db.collection('global_admin').where({
        loginOpenid: openid,
        status: _.neq('disabled')
      }).limit(1).get()
      if (!adminRes.data.length) {
        return { success: false, msg: '无管理员权限' }
      }
    }

    switch (action) {
      case 'getOpenId':
        return { success: true, openid: openid, appid: appid }
      case 'initDatabase':
        return await initDatabase()
      case 'createOrder':
        return await withOrderLock(openid, function() {
          return db.runTransaction(() => createOrder(openid, data))
        })
      case 'getCheckoutBenefits':
        return await getCheckoutBenefits(openid)
      case 'getUserOrders':
        return await getUserOrders(openid, data)
      case 'getOrderDetail':
        return await getOrderDetail(openid, data)
      case 'getShopList':
        return await getShopList(data)
      case 'getShopDetail':
        return await getShopDetail(openid, data)
      case 'shopLogin':
        return await shopLogin(openid, data)
      case 'getShopOrders':
        return await getShopOrders(openid, data)
      case 'updateOrderStatus':
        return await db.runTransaction(() => updateOrderStatus(openid, data))
      case 'adminUpdateOrderStatus':
        return await db.runTransaction(() => updateOrderStatus(openid, data, true))
      case 'adminManageDish':
        return await db.runTransaction(() => manageDish(openid, data, true))
      case 'manageDish':
        return await manageDish(openid, data)
      case 'updateShopInfo':
        return await updateShopInfo(openid, data)
      case 'updateShopLogo':
        return await updateShopLogo(openid, data)
      case 'updateFeaturedDishes':
        return await updateFeaturedDishes(openid, data)
      case 'checkMerchantStatus':
        return await checkMerchantStatus(openid)
      case 'registerMerchant':
        return await registerMerchant(openid, data)
      case 'resetPassword':
        return await resetPassword(openid, data)
      case 'changePassword':
        return await changePassword(openid, data)
      case 'adminLogin':
        return await adminLogin(data)
      case 'getAdminStats':
        return await getAdminStats()
      case 'getRankList':
        return await getRankList(data)
      case 'clearRankRecords':
        return await clearRankRecords(data)
      case 'getShopAuditList':
        return await getShopAuditList(data)
      case 'auditShop':
        return await auditShop(data)
      case 'getShopManageList':
        return await getShopManageList(data)
      case 'adminUpdateShopStatus':
        return await adminUpdateShopStatus(data)
      case 'adminUpdateShopInfo':
        return await adminUpdateShopInfo(data)
      case 'adminResetShopPassword':
        return await adminResetShopPassword(data)
      case 'adminUpdateShopAccount':
        return await adminUpdateShopAccount(data)
      case 'getShopLogs':
        return await getShopLogs(data)
      case 'getShopDishes':
        return await getShopDishes(openid, data)
      case 'shopAutoLogin':
        return await shopAutoLogin(openid)
      case 'initTestData':
        return await initTestData(openid)
      case 'registerRider':
      case 'checkRiderStatus':
      case 'getPendingDeliveryOrders':
      case 'riderAcceptOrder':
      case 'riderCompleteDelivery':
      case 'getRiderOrders':
      case 'getRiderStats':
      case 'getRiderAuditList':
      case 'auditRider':
        return { success: false, msg: '骑手功能已迁移，请刷新小程序后重试' }
      default:
        return { success: false, msg: 'Unknown action: ' + action }
    }
  } catch (error) {
    console.error('Cloud function error:', error)
    return { success: false, msg: error.message || '服务异常', error: error.toString() }
  }
}

async function initDatabase() {
  const collections = ['food_shop', 'food_shop_user', 'food_dish', 'food_order', 'food_shop_logs']
  const results = []
  
  for (const name of collections) {
    try {
      await db.createCollection(name)
      results.push({ name, status: 'created' })
    } catch (err) {
      if (err.message && err.message.includes('already exists')) {
        results.push({ name, status: 'exists' })
      } else {
        results.push({ name, status: 'error', msg: err.message })
      }
    }
  }
  
  return { success: true, msg: '数据库初始化完成', results }
}

function formatTime(value) {
  if (!value) return ''
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return y + '-' + m + '-' + d + ' ' + hh + ':' + mm
}

async function getMerchantByOpenid(openid) {
  const res = await db.collection('food_shop_user').where({ bindOpenid: openid }).limit(1).get()
  if (!res.data.length) return null
  return res.data[0]
}

async function requireMerchant(openid, requestedShopId) {
  const merchant = await getMerchantByOpenid(openid)
  if (!merchant) {
    return { error: { success: false, msg: '请先登录商家账号' } }
  }
  if (merchant.approved === false) {
    return { error: { success: false, msg: '商家账号尚未审核通过' } }
  }
  if (requestedShopId && requestedShopId !== merchant.shopId) {
    return { error: { success: false, msg: '无权限管理该店铺' } }
  }

  const shopResult = await db.collection('food_shop').doc(merchant.shopId).get().catch(function() {
    return null
  })
  if (!shopResult || !shopResult.data || shopResult.data.auditStatus !== 'approved') {
    return { error: { success: false, msg: '店铺未通过审核或已停用' } }
  }
  return { merchant: merchant, shop: shopResult.data, shopId: merchant.shopId }
}

function moneyToCents(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.round(number * 100))
}

function centsToMoney(value) {
  return Math.round(Math.max(0, Number(value || 0))) / 100
}

function getChinaDateKey() {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const values = {}
  parts.forEach(function(part) {
    if (part.type !== 'literal') values[part.type] = part.value
  })
  return values.year + '-' + values.month + '-' + values.day
}

async function getRunBenefit(openid) {
  const orderDate = getChinaDateKey()
  const runsResult = await db.collection('runRecords')
    .where({ openid: openid, date: orderDate })
    .limit(1000)
    .get()
    .catch(function() { return { data: [] } })

  const todayDistance = (runsResult.data || []).reduce(function(total, record) {
    const distance = Number(record.distance || 0)
    return total + (Number.isFinite(distance) && distance > 0 ? distance : 0)
  }, 0)
  const earnedCents = Math.min(100, Math.floor(todayDistance / 1000) * 10)

  const ordersResult = await db.collection('food_order')
    .where({ _openid: openid, orderDate: orderDate })
    .limit(1000)
    .get()
    .catch(function() { return { data: [] } })
  const usedCents = (ordersResult.data || []).reduce(function(total, order) {
    if (order.status === 'cancelled') return total
    return total + moneyToCents(order.runDiscountAmount)
  }, 0)

  return {
    orderDate: orderDate,
    todayDistance: Math.round(todayDistance),
    earnedCents: earnedCents,
    usedCents: usedCents,
    availableCents: Math.max(0, earnedCents - usedCents)
  }
}

async function getValidCoupons(openid) {
  const result = await db.collection('user_coupons')
    .where({ _openid: openid, used: false })
    .orderBy('createTime', 'desc')
    .limit(100)
    .get()
    .catch(function() { return { data: [] } })
  const now = Date.now()
  return (result.data || []).filter(function(coupon) {
    if (!coupon.expireTime) return true
    const expiry = typeof coupon.expireTime.toDate === 'function'
      ? coupon.expireTime.toDate()
      : new Date(coupon.expireTime)
    return expiry.getTime() > now
  }).sort(function(left, right) {
    return moneyToCents(right.value) - moneyToCents(left.value)
  })
}

async function getCheckoutBenefits(openid) {
  if (!openid) return { success: false, msg: '请先登录' }
  const results = await Promise.all([
    getRunBenefit(openid),
    getValidCoupons(openid)
  ])
  const runBenefit = results[0]
  return {
    success: true,
    runDiscount: centsToMoney(runBenefit.availableCents),
    todayDistance: runBenefit.todayDistance,
    runRule: '今日每跑1公里抵0.1元，每日最多1元',
    coupons: results[1]
  }
}

async function writeLog(shopId, type, description, operatorName) {
  operatorName = operatorName || '系统'
  try {
    await db.collection('food_shop_logs').add({
      data: {
        shopId: shopId,
        type: type,
        description: description,
        operatorName: operatorName,
        createTime: db.serverDate()
      }
    })
  } catch (err) {
    console.error('writeLog error:', err)
  }
}

async function createOrder(openid, data) {
  const shopId = String(data.shopId || '')
  const items = Array.isArray(data.items) ? data.items : []
  const type = data.type === 'delivery' ? 'delivery' : 'pickup'
  const address = String(data.address || '').trim().slice(0, 200)
  const remark = String(data.remark || '').trim().slice(0, 200)
  const phone = String(data.phone || '').trim()
  const pickupTime = String(data.pickupTime || '').trim().slice(0, 40)
  
  if (!openid) return { success: false, msg: '请先登录' }
  if (!shopId) return { success: false, msg: '店铺信息异常' }
  if (!Array.isArray(items) || items.length === 0) return { success: false, msg: '请先选择菜品' }
  if (!/^1[3-9]\d{9}$/.test(phone)) return { success: false, msg: '请填写正确的11位手机号' }
  if (type === 'delivery' && !address) return { success: false, msg: '请填写配送地址' }
  if (type === 'pickup' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime)) {
    return { success: false, msg: '请选择正确的取餐时间' }
  }

  const userResult = await db.collection('users').where({ openid: openid }).limit(1).get()
    .catch(function() { return { data: [] } })
  const user = userResult.data[0] || {}
  const userNickName = String(user.nickName || '校园用户').trim().slice(0, 30)
  const userAvatarUrl = String(user.avatarUrl || '').trim().slice(0, 1000)

  const shopResult = await db.collection('food_shop').doc(shopId).get().catch(function() { return null })
  if (!shopResult || !shopResult.data) return { success: false, msg: '店铺不存在' }
  const shop = shopResult.data
  if (shop.auditStatus !== 'approved' || shop.status !== 'open') {
    return { success: false, msg: '店铺当前未营业' }
  }
  if (type === 'delivery' && shop.supportDelivery === false) {
    return { success: false, msg: '该店铺暂不支持配送' }
  }

  const requestedCounts = {}
  items.forEach(function(item) {
    const dishId = String(item && item._id || '')
    const count = Math.floor(Number(item && item.count || 0))
    if (dishId && count > 0) requestedCounts[dishId] = (requestedCounts[dishId] || 0) + count
  })
  const dishIds = Object.keys(requestedCounts)
  if (!dishIds.length || dishIds.length > 50) return { success: false, msg: '菜品数据异常' }

  const safeItems = []
  let subtotalCents = 0
  for (let i = 0; i < dishIds.length; i++) {
    const dishId = dishIds[i]
    const count = requestedCounts[dishId]
    if (count > 99) return { success: false, msg: '单个菜品数量不能超过99份' }
    const dishResult = await db.collection('food_dish').doc(dishId).get().catch(function() { return null })
    const dish = dishResult && dishResult.data
    if (!dish || dish.shopId !== shopId || dish.isAvailable === false) {
      return { success: false, msg: '部分菜品已下架，请返回刷新' }
    }
    const stock = Number(dish.stock === undefined ? 999 : dish.stock)
    if (!Number.isFinite(stock) || stock < count) {
      return { success: false, msg: dish.name + '库存不足' }
    }
    const priceCents = moneyToCents(dish.price)
    if (priceCents <= 0) return { success: false, msg: dish.name + '价格异常' }
    subtotalCents += priceCents * count
    safeItems.push({
      _id: dish._id,
      name: String(dish.name || '').slice(0, 80),
      image: String(dish.image || '').slice(0, 1000),
      price: centsToMoney(priceCents),
      count: count
    })
  }

  const minPriceCents = moneyToCents(shop.minPrice)
  if (subtotalCents < minPriceCents) {
    return { success: false, msg: '未达到起送金额，请返回重新选购' }
  }

  const deliveryFeeCents = type === 'delivery' ? moneyToCents(shop.deliveryFee) : 0
  const runBenefit = await getRunBenefit(openid)
  const requestedRunDiscount = data.useRunDiscount === false ? 0 : runBenefit.availableCents
  const runDiscountCents = Math.min(requestedRunDiscount, subtotalCents + deliveryFeeCents)

  let coupon = null
  let couponDiscountCents = 0
  const couponId = data.couponId ? String(data.couponId) : ''
  if (couponId) {
    const couponResult = await db.collection('user_coupons').doc(couponId).get().catch(function() { return null })
    coupon = couponResult && couponResult.data
    if (!coupon || coupon._openid !== openid || coupon.used) {
      return { success: false, msg: '优惠券不可用，请刷新后重试' }
    }
    if (coupon.expireTime) {
      const expiry = typeof coupon.expireTime.toDate === 'function'
        ? coupon.expireTime.toDate()
        : new Date(coupon.expireTime)
      if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
        return { success: false, msg: '优惠券已过期或数据异常' }
      }
    }
    couponDiscountCents = Math.min(
      moneyToCents(coupon.value),
      Math.max(0, subtotalCents + deliveryFeeCents - runDiscountCents)
    )
  }

  const totalCents = Math.max(
    0,
    subtotalCents + deliveryFeeCents - runDiscountCents - couponDiscountCents
  )
  const pickupCode = Math.floor(100000 + Math.random() * 900000).toString()
  
  const res = await db.collection('food_order').add({
    data: {
      _openid: openid,
      shopId: shopId,
      items: safeItems,
      subtotal: centsToMoney(subtotalCents),
      deliveryFee: centsToMoney(deliveryFeeCents),
      runDiscountAmount: centsToMoney(runDiscountCents),
      couponDiscount: centsToMoney(couponDiscountCents),
      couponId: couponId || '',
      couponName: coupon ? String(coupon.name || '优惠券').slice(0, 80) : '',
      totalPrice: centsToMoney(totalCents),
      orderDate: runBenefit.orderDate,
      type: type,
      address: type === 'delivery' ? address : '',
      pickupCode: type === 'pickup' ? pickupCode : '',
      pickupTime: type === 'pickup' ? pickupTime : '',
      phone: phone,
      status: 'pending',
      remark: remark,
      userNickName: userNickName,
      userAvatarUrl: userAvatarUrl,
      inventoryReserved: true,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  })

    if (couponId) {
      const couponUpdate = await db.collection('user_coupons').where({
        _id: couponId,
        _openid: openid,
        used: false
      }).update({
        data: {
          used: true,
          usedTime: db.serverDate(),
          orderId: res._id
        }
      })
      if (!couponUpdate.stats || couponUpdate.stats.updated !== 1) {
        throw new Error('优惠券已被使用，请刷新后重试')
      }
    }

    for (let j = 0; j < safeItems.length; j++) {
      const item = safeItems[j]
      const stockUpdate = await db.collection('food_dish').where({
        _id: item._id,
        shopId: shopId,
        isAvailable: true,
        stock: _.gte(item.count)
      }).update({
        data: {
          stock: _.inc(-item.count),
          sales: _.inc(item.count),
          updateTime: db.serverDate()
        }
      })
      if (!stockUpdate.stats || stockUpdate.stats.updated !== 1) {
        throw new Error(item.name + '库存刚刚发生变化，请重新下单')
      }
    }

  await writeLog(shopId, '新订单', '收到新订单，等待接单')
  
  return {
    success: true,
    orderId: res._id,
    pickupCode: pickupCode,
    price: {
      subtotal: centsToMoney(subtotalCents),
      deliveryFee: centsToMoney(deliveryFeeCents),
      runDiscount: centsToMoney(runDiscountCents),
      couponDiscount: centsToMoney(couponDiscountCents),
      total: centsToMoney(totalCents)
    }
  }
}

async function attachShopInfo(orders) {
  const ids = Array.from(new Set(orders.map(order => order.shopId).filter(Boolean)))
  const result = ids.length ? await db.collection('food_shop').where({ _id: _.in(ids) }).get() : { data: [] }
  const shops = new Map(result.data.map(shop => [shop._id, shop]))
  return orders.map(order => {
    const shop = shops.get(order.shopId) || {}
    return { ...order, shopName: shop.name || '未知店铺', shopLogo: shop.logo || '',
      createTimeText: formatTime(order.createTime), updateTimeText: formatTime(order.updateTime) }
  })
}

async function restoreCancelledOrder(order) {
  const items = Array.isArray(order.items) ? order.items : []
  // 旧订单创建时没有扣库存，只有新流程明确预占过库存才允许回补。
  if (order.inventoryReserved === true) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item._id || Number(item.count || 0) <= 0) continue
      await db.collection('food_dish').doc(item._id).update({
        data: {
          stock: _.inc(Number(item.count)),
          sales: _.inc(-Number(item.count)),
          updateTime: db.serverDate()
        }
      })
    }
  }

  if (order.couponId) {
    await db.collection('user_coupons').where({
      _id: order.couponId,
      _openid: order._openid,
      orderId: order._id,
      used: true
    }).update({
      data: {
        used: false,
        usedTime: _.remove(),
        orderId: _.remove()
      }
    })
  }
}

async function getUserOrders(openid, data) {
  const allowedStatuses = ['all', 'pending', 'processing', 'ready', 'completed', 'cancelled']
  const status = allowedStatuses.indexOf(data.status) !== -1 ? data.status : 'all'
  const query = { _openid: openid }
  if (status !== 'all') query.status = status

  const res = await db.collection('food_order')
    .where(query)
    .orderBy('createTime', 'desc')
    .get()

  const list = await attachShopInfo(res.data || [])
  return { success: true, list: list }
}

async function getOrderDetail(openid, data) {
  const orderId = data.orderId
  if (!orderId) return { success: false, msg: '订单参数缺失' }
  
  const res = await db.collection('food_order').doc(orderId).get().catch(function() { return null })
  if (!res || !res.data) return { success: false, msg: '订单不存在' }
  if (res.data._openid !== openid) return { success: false, msg: '无权限查看该订单' }
  
  const list = await attachShopInfo([res.data])
  return { success: true, detail: list[0] }
}

async function getShopList(data) {
  const keyword = String(data.keyword || '').trim().slice(0, 40)
  const status = ['open', 'closed'].indexOf(data.status) !== -1 ? data.status : ''
  const page = Math.max(1, Number(data.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(data.pageSize || 10)))
  
  const query = { auditStatus: 'approved', status: _.neq('pending') }
  if (keyword) {
    query.name = db.RegExp({
      regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      options: 'i'
    })
  }
  if (status) query.status = status

  const res = await db.collection('food_shop')
    .where(query)
    .limit(1000)
    .get()

  const nowParts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(new Date())
  const monthValues = {}
  nowParts.forEach(function(part) {
    if (part.type !== 'literal') monthValues[part.type] = Number(part.value)
  })
  const monthStart = new Date(Date.UTC(monthValues.year, monthValues.month - 1, 1) - 8 * 60 * 60 * 1000)
  const shops = res.data || []
  const monthlyOrders = await db.collection('food_order').where({
    status: 'completed',
    createTime: _.gte(monthStart)
  }).limit(1000).get().catch(function() { return { data: [] } })
  const salesByShop = {}
  ;(monthlyOrders.data || []).forEach(function(order) {
    if (order.shopId) salesByShop[order.shopId] = (salesByShop[order.shopId] || 0) + 1
  })
  shops.forEach(function(shop) {
    shop.monthlySales = salesByShop[shop._id] || 0
  })
  shops.sort(function(left, right) {
    const salesDiff = Number(right.monthlySales || 0) - Number(left.monthlySales || 0)
    if (salesDiff !== 0) return salesDiff
    return Number(right.rating || 0) - Number(left.rating || 0)
  })
  shops.forEach(function(shop, index) {
    shop.campusRank = index + 1
  })

  const start = (page - 1) * pageSize
  return {
    success: true,
    list: shops.slice(start, start + pageSize).map(toPublicShop),
    total: shops.length
  }
}

function toPublicShop(shop) {
  const result = { ...shop }
  delete result.licenseImage
  delete result.rejectReason
  return result
}

async function getShopDetail(openid, data) {
  const shopId = data.shopId
  if (!shopId) return { success: false, msg: '店铺参数缺失' }

  const shop = await db.collection('food_shop').doc(shopId).get().catch(function() { return null })
  if (!shop || !shop.data) return { success: false, msg: '店铺不存在' }
  const merchant = await getMerchantByOpenid(openid)
  const isOwner = !!(merchant && merchant.shopId === shopId)
  if (!isOwner && shop.data.auditStatus !== 'approved') {
    return { success: false, msg: '店铺暂不可访问' }
  }

  const dishes = await db.collection('food_dish')
    .where({ shopId: shopId, isAvailable: true })
    .orderBy('category', 'asc')
    .orderBy('name', 'asc')
    .get()

  const categories = {}
  const dishList = dishes.data || []
  for (let i = 0; i < dishList.length; i++) {
    const dish = dishList[i]
    const key = dish.category || '默认分类'
    if (!categories[key]) categories[key] = []
    categories[key].push(dish)
  }

  const menu = Object.keys(categories).map(function(name) { 
    return { name: name, items: categories[name] } 
  })
  
  const shopInfo = toPublicShop(shop.data)
  if (!isOwner) delete shopInfo.auditStatus
  return { success: true, shop: shopInfo, menu: menu }
}

async function shopLogin(openid, data) {
  const username = String(data.username || '').trim()
  const password = String(data.password || '')
  if (!username || !password) return { success: false, msg: '请输入账号密码' }

  const res = await db.collection('food_shop_user').where({ username: username }).limit(1).get()
  if (!res.data.length || !verifyPassword(password, res.data[0])) {
    return { success: false, msg: '用户名或密码错误' }
  }

  const merchant = res.data[0]
  if (merchant.approved === false) return { success: false, msg: '商家账号未审核通过' }
  if (merchant.bindOpenid && merchant.bindOpenid !== openid) return { success: false, msg: '账号已在其他微信登录' }

  const shopResult = await db.collection('food_shop').doc(merchant.shopId).get().catch(function() { return null })
  if (!shopResult || !shopResult.data || shopResult.data.auditStatus !== 'approved') {
    return { success: false, msg: '店铺未通过审核或已停用' }
  }

  await upgradeMerchantPassword(merchant, password)
  await db.collection('food_shop_user').doc(merchant._id).update({
    data: {
      bindOpenid: openid,
      lastLoginAt: db.serverDate()
    }
  })

  return { success: true, shopId: merchant.shopId }
}

async function getShopOrders(openid, data) {
  const auth = await requireMerchant(openid, data.shopId)
  if (auth.error) return auth.error
  const shopId = auth.shopId

  const allowedStatuses = ['all', 'pending', 'processing', 'ready', 'completed', 'cancelled']
  const status = allowedStatuses.indexOf(data.status) !== -1 ? data.status : 'all'

  const res = await db.collection('food_order')
    .where({ shopId: shopId })
    .orderBy('createTime', 'desc')
    .limit(1000)
    .get()

  const allOrders = res.data || []
  const stats = { pending: 0, processing: 0, ready: 0, todaySales: 0 }
  const today = getChinaDateKey()
  allOrders.forEach(function(order) {
    if (order.status === 'pending') stats.pending += 1
    if (order.status === 'processing') stats.processing += 1
    if (order.status === 'ready') stats.ready += 1
    const orderDate = order.orderDate || formatTime(order.createTime).slice(0, 10)
    if (order.status === 'completed' && orderDate === today) {
      stats.todaySales += Number(order.totalPrice || 0)
    }
  })

  const selected = status === 'all'
    ? allOrders
    : allOrders.filter(function(order) { return order.status === status })
  const list = selected.map(function(item) {
    const safeItem = {
      ...item,
      createTimeText: formatTime(item.createTime),
      updateTimeText: formatTime(item.updateTime)
    }
    delete safeItem._openid
    return safeItem
  })

  stats.todaySales = centsToMoney(moneyToCents(stats.todaySales))
  return { success: true, list: list, stats: stats }
}

async function updateOrderStatus(openid, data, asAdmin = false) {
  const orderId = data.orderId
  const status = data.status
  const rejectReason = data.rejectReason || ''
  
  if (!orderId || !status) return { success: false, msg: '参数缺失' }

  const orderRes = await db.collection('food_order').doc(orderId).get().catch(function() { return null })
  if (!orderRes || !orderRes.data) return { success: false, msg: '订单不存在' }
  const order = orderRes.data

  const merchantAuth = await requireMerchant(openid, order.shopId)
  const isMerchant = !merchantAuth.error

  if (isMerchant || asAdmin) {
    const allowMap = {
      pending: ['processing', 'cancelled'],
      processing: ['ready', 'cancelled'],
      ready: order.type === 'pickup' ? ['completed'] : []
    }
    const currentAllow = allowMap[order.status] || []
    if (currentAllow.indexOf(status) === -1) return { success: false, msg: '订单状态流转不合法: ' + order.status + ' -> ' + status }

    const updateData = {
      status: status,
      updateTime: db.serverDate()
    }
    if (status === 'cancelled' && rejectReason) updateData.rejectReason = rejectReason
    if (status === 'ready') updateData.readyTime = db.serverDate()
    if (status === 'completed') updateData.completedTime = db.serverDate()

    const transition = await db.collection('food_order').where({
      _id: orderId,
      status: order.status
    }).update({ data: updateData })
    if (!transition.stats || transition.stats.updated !== 1) {
      return { success: false, msg: '订单状态已变化，请刷新后重试' }
    }
    if (status === 'cancelled') await restoreCancelledOrder(order)
    
    const statusText = { processing: '已接单', ready: '已出餐', completed: '已完成', cancelled: '已取消' }
    await writeLog(order.shopId, '订单更新', '订单状态变更为: ' + (statusText[status] || status))
    
    return { success: true }
  }

  if (order._openid === openid) {
    if (status !== 'cancelled') return { success: false, msg: '用户仅支持取消订单' }
    if (order.status !== 'pending') return { success: false, msg: '仅待接单可取消' }
    const transition = await db.collection('food_order').where({
      _id: orderId,
      _openid: openid,
      status: 'pending'
    }).update({
      data: {
        status: 'cancelled',
        cancelBy: 'user',
        updateTime: db.serverDate()
      }
    })
    if (!transition.stats || transition.stats.updated !== 1) {
      return { success: false, msg: '订单状态已变化，请刷新后重试' }
    }
    await restoreCancelledOrder(order)
    return { success: true }
  }

  return { success: false, msg: '无权限操作该订单' }
}

async function manageDish(openid, data, asAdmin = false) {
  const type = data.type
  const dishData = data.dishData || {}
  
  if (['add', 'update', 'delete'].indexOf(type) === -1) return { success: false, msg: '操作类型不支持' }

  const auth = asAdmin ? await adminShop(dishData.shopId) : await requireMerchant(openid, dishData.shopId)
  if (auth.error) return auth.error
  const shopId = auth.shopId

  if (type === 'add') {
    const name = String(dishData.name || '').trim().slice(0, 80)
    const priceCents = moneyToCents(dishData.price)
    const stock = Math.floor(Number(dishData.stock === undefined ? 999 : dishData.stock))
    if (!name) return { success: false, msg: '请输入菜品名称' }
    if (priceCents <= 0) return { success: false, msg: '菜品价格必须大于0' }
    if (!Number.isFinite(stock) || stock < 0 || stock > 99999) {
      return { success: false, msg: '库存数量不正确' }
    }
    const payload = {
      name: name,
      price: centsToMoney(priceCents),
      category: String(dishData.category || '默认分类').trim().slice(0, 30) || '默认分类',
      image: String(dishData.image || '').trim().slice(0, 1000),
      description: String(dishData.description || '').trim().slice(0, 500),
      stock: stock,
      sales: 0,
      isAvailable: dishData.isAvailable !== false,
      shopId: shopId,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
    await db.collection('food_dish').add({ data: payload })
    await writeLog(shopId, '菜品管理', '添加菜品: ' + payload.name)
    return { success: true }
  }

  if (!dishData._id) return { success: false, msg: '菜品参数缺失' }
  const current = await db.collection('food_dish').doc(dishData._id).get().catch(function() { return null })
  if (!current || !current.data) return { success: false, msg: '菜品不存在' }
  if (current.data.shopId !== shopId) return { success: false, msg: '无权限操作该菜品' }

  if (type === 'delete') {
    await db.collection('food_dish').doc(dishData._id).remove()
    await writeLog(shopId, '菜品管理', '删除菜品: ' + current.data.name)
    return { success: true }
  }

  const nextName = String(dishData.name !== undefined ? dishData.name : current.data.name).trim().slice(0, 80)
  const nextPriceCents = moneyToCents(dishData.price !== undefined ? dishData.price : current.data.price)
  const nextStock = Math.floor(Number(dishData.stock !== undefined ? dishData.stock : current.data.stock))
  if (!nextName) return { success: false, msg: '请输入菜品名称' }
  if (nextPriceCents <= 0) return { success: false, msg: '菜品价格必须大于0' }
  if (!Number.isFinite(nextStock) || nextStock < 0 || nextStock > 99999) {
    return { success: false, msg: '库存数量不正确' }
  }
  const payload = {
    name: nextName,
    price: centsToMoney(nextPriceCents),
    category: String(dishData.category !== undefined ? dishData.category : current.data.category).trim().slice(0, 30) || '默认分类',
    image: String(dishData.image !== undefined ? dishData.image : (current.data.image || '')).trim().slice(0, 1000),
    description: String(dishData.description !== undefined ? dishData.description : (current.data.description || '')).trim().slice(0, 500),
    stock: nextStock,
    isAvailable: dishData.isAvailable !== undefined ? dishData.isAvailable : current.data.isAvailable,
    updateTime: db.serverDate()
  }
  await db.collection('food_dish').doc(dishData._id).update({ data: payload })
  await writeLog(shopId, '菜品管理', '更新菜品: ' + payload.name)
  return { success: true }
}

async function updateShopInfo(openid, data) {
  const auth = await requireMerchant(openid, data.shopId)
  if (auth.error) return auth.error
  const shopId = auth.shopId

  const shopData = data.shopData || {}
  const payload = {
    updateTime: db.serverDate()
  }
  
  if (shopData.name !== undefined) {
    payload.name = String(shopData.name || '').trim().slice(0, 60)
    if (!payload.name) return { success: false, msg: '店铺名称不能为空' }
  }
  if (shopData.status !== undefined) payload.status = shopData.status === 'closed' ? 'closed' : 'open'
  if (shopData.notice !== undefined) payload.notice = String(shopData.notice || '').trim().slice(0, 500)
  if (shopData.minPrice !== undefined) payload.minPrice = centsToMoney(moneyToCents(shopData.minPrice))
  if (shopData.deliveryFee !== undefined) payload.deliveryFee = centsToMoney(moneyToCents(shopData.deliveryFee))
  if (shopData.supportDelivery !== undefined) payload.supportDelivery = shopData.supportDelivery
  if (shopData.openTime !== undefined) payload.openTime = shopData.openTime
  if (shopData.closeTime !== undefined) payload.closeTime = shopData.closeTime
  if (shopData.pickupWindow !== undefined) payload.pickupWindow = shopData.pickupWindow

  await db.collection('food_shop').doc(shopId).update({ data: payload })
  await writeLog(shopId, '店铺设置', '更新店铺信息')
  return { success: true }
}

async function updateShopLogo(openid, data) {
  const auth = await requireMerchant(openid, data.shopId)
  if (auth.error) return auth.error
  const shopId = auth.shopId
  
  const logo = String(data.logo || '').trim().slice(0, 1000)
  if (!logo) return { success: false, msg: '请提供头像' }
  
  await db.collection('food_shop').doc(shopId).update({
    data: {
      logo: logo,
      updateTime: db.serverDate()
    }
  })
  
  await writeLog(shopId, '店铺设置', '更新店铺头像')
  return { success: true }
}

async function updateFeaturedDishes(openid, data) {
  const auth = await requireMerchant(openid, data.shopId)
  if (auth.error) return auth.error
  const shopId = auth.shopId
  
  const source = Array.isArray(data.featuredDishes) ? data.featuredDishes : []
  const ids = Array.from(new Set(source.map(function(item) {
    return String((item && item._id) || item || '')
  }).filter(Boolean)))
  if (ids.length > 2) {
    return { success: false, msg: '最多只能设置2个推荐菜品' }
  }
  let featuredDishes = []
  if (ids.length) {
    const dishes = await db.collection('food_dish').where({
      _id: _.in(ids),
      shopId: shopId
    }).get()
    if (dishes.data.length !== ids.length) {
      return { success: false, msg: '推荐菜品数据异常' }
    }
    const dishMap = {}
    dishes.data.forEach(function(dish) { dishMap[dish._id] = dish })
    featuredDishes = ids.map(function(id) {
      const dish = dishMap[id]
      return {
        _id: dish._id,
        name: dish.name,
        image: dish.image || '',
        price: dish.price
      }
    })
  }
  
  await db.collection('food_shop').doc(shopId).update({
    data: {
      featuredDishes: featuredDishes,
      updateTime: db.serverDate()
    }
  })
  
  await writeLog(shopId, '店铺设置', '更新推荐菜品')
  return { success: true }
}

async function checkMerchantStatus(openid) {
  const user = await getMerchantByOpenid(openid)
  if (!user) return { success: true, isMerchant: false }
  
  const shop = await db.collection('food_shop').doc(user.shopId).get().catch(function() { return null })
  if (!shop || !shop.data) return { success: true, isMerchant: false }

  return { 
    success: true, 
    isMerchant: true, 
    shopId: user.shopId, 
    shopStatus: shop.data.status 
  }
}

async function registerMerchant(openid, data) {
  const name = String(data.name || '').trim().slice(0, 60)
  const contact = String(data.contact || '').trim().slice(0, 30)
  const phone = String(data.phone || '').trim()
  const coverImage = String(data.coverImage || '').trim().slice(0, 1000)
  const licenseImage = String(data.licenseImage || '').trim().slice(0, 1000)
  const username = String(data.username || '').trim()
  const password = String(data.password || '')
  const supportDelivery = data.supportDelivery !== false
  
  if (!name) return { success: false, msg: '请输入店铺名称' }
  if (!contact) return { success: false, msg: '请输入联系人' }
  if (!/^1[3-9]\d{9}$/.test(phone)) return { success: false, msg: '请输入正确的11位手机号' }
  if (!coverImage || !licenseImage) return { success: false, msg: '请上传门店封面和营业执照' }
  if (!/^[A-Za-z0-9_]{4,32}$/.test(username)) {
    return { success: false, msg: '账号需为4-32位字母、数字或下划线' }
  }
  if (password.length < 8 || password.length > 128) {
    return { success: false, msg: '密码需为8-128位' }
  }

  const existingUsername = await db.collection('food_shop_user').where({ username: username }).limit(1).get()
  if (existingUsername.data.length > 0) {
    return { success: false, msg: '该账号已被使用' }
  }
  
  const existingUser = await db.collection('food_shop_user').where({ bindOpenid: openid }).get()
  if (existingUser.data.length > 0) {
    return { success: false, msg: '您已提交过申请或已是商家' }
  }

  const shopRes = await db.collection('food_shop').add({
    data: {
      name: name,
      contact: contact,
      phone: phone,
      logo: coverImage || '',
      licenseImage: licenseImage || '',
      status: 'pending',
      auditStatus: 'pending',
      rating: 5.0,
      monthlySales: 0,
      minPrice: 0,
      deliveryFee: 0,
      supportDelivery: supportDelivery,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  })

  const userData = {
    bindOpenid: openid,
    shopId: shopRes._id,
    role: 'admin',
    createTime: db.serverDate()
  }
  
  userData.username = username
  userData.passwordHash = hashPassword(password)
  userData.approved = false

  await db.collection('food_shop_user').add({ data: userData })

  return { success: true, msg: '申请已提交，请等待审核' }
}

async function resetPassword(openid, data) {
  const phone = data.phone
  const username = data.username
  const newPassword = data.newPassword
  
  if (!username) return { success: false, msg: '请输入账号' }
  if (!phone) return { success: false, msg: '请输入注册手机号' }
  if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
    return { success: false, msg: '新密码需为8-128位' }
  }
  
  const shopUser = await db.collection('food_shop_user').where({ 
    username: username
  }).limit(1).get()
  
  if (!shopUser.data.length) {
    return { success: false, msg: '账号不存在' }
  }
  
  const user = shopUser.data[0]
  if (!user.bindOpenid || user.bindOpenid !== openid) {
    return { success: false, msg: '请使用该商家已绑定的微信账号重置密码' }
  }
  const shop = await db.collection('food_shop').doc(user.shopId).get().catch(function() { return null })
  
  if (!shop || !shop.data || shop.data.phone !== phone) {
    return { success: false, msg: '手机号与账号不匹配' }
  }
  
  await db.collection('food_shop_user').doc(user._id).update({
    data: {
      passwordHash: hashPassword(newPassword),
      password: _.remove(),
      updateTime: db.serverDate()
    }
  })
  
  return { success: true, msg: '密码重置成功' }
}

async function changePassword(openid, data) {
  const oldPassword = data.oldPassword
  const newPassword = data.newPassword
  
  if (!oldPassword || !newPassword) return { success: false, msg: '请输入密码' }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return { success: false, msg: '新密码需为8-128位' }
  }
  
  const merchant = await getMerchantByOpenid(openid)
  if (!merchant) return { success: false, msg: '请先登录' }
  
  if (!verifyPassword(oldPassword, merchant)) {
    return { success: false, msg: '原密码错误' }
  }
  
  await db.collection('food_shop_user').doc(merchant._id).update({
    data: {
      passwordHash: hashPassword(newPassword),
      password: _.remove(),
      updateTime: db.serverDate()
    }
  })
  
  return { success: true, msg: '密码修改成功' }
}

async function adminLogin(data) {
  return { success: false, msg: '旧管理员入口已停用，请使用 globalAdmin 登录' }
}

async function getAdminStats() {
  const pendingShopsRes = await db.collection('food_shop').where({ auditStatus: 'pending' }).count().catch(function() { return { total: 0 } })
  const totalShopsRes = await db.collection('food_shop').where({ auditStatus: 'approved' }).count().catch(function() { return { total: 0 } })
  const totalOrdersRes = await db.collection('food_order').count().catch(function() { return { total: 0 } })
  const rankRecordsRes = await db.collection('run_stats').count().catch(function() { return { total: 0 } })

  return {
    success: true,
    stats: {
      pendingShops: pendingShopsRes.total,
      totalShops: totalShopsRes.total,
      totalOrders: totalOrdersRes.total,
      rankRecords: rankRecordsRes.total
    }
  }
}

async function getRankList(data) {
  const keyword = data.keyword || ''
  const query = {}
  if (keyword) {
    query.nickName = db.RegExp({
      regexp: String(keyword).slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      options: 'i'
    })
  }

  const res = await db.collection('run_stats')
    .where(query)
    .orderBy('totalDistance', 'desc')
    .limit(100)
    .get()

  const list = res.data.map(function(item) {
    return {
      ...item,
      updateTimeText: formatTime(item.updateTime)
    }
  })

  return { success: true, list: list }
}

async function clearRankRecords(data) {
  const ids = data.ids
  if (!ids || ids.length === 0) {
    return { success: false, msg: '请选择要删除的记录' }
  }

  for (let i = 0; i < ids.length; i++) {
    await db.collection('run_stats').doc(ids[i]).remove()
  }

  await db.collection('admin_logs').add({
    data: {
      action: 'clearRankRecords',
      description: '删除了 ' + ids.length + ' 条排行榜记录',
      createTime: db.serverDate()
    }
  })

  return { success: true }
}

async function getShopAuditList(data) {
  const status = data.status || 'pending'
  const date = data.date || ''
  const name = data.name || ''
  
  const query = {}
  if (status && status !== 'all') {
    query.auditStatus = status
  }
  if (name) {
    query.name = db.RegExp({ regexp: name, options: 'i' })
  }

  const res = await db.collection('food_shop')
    .where(query)
    .orderBy('createTime', 'desc')
    .limit(50)
    .get()

  const list = res.data.map(function(item) {
    return {
      ...item,
      createTimeText: formatTime(item.createTime)
    }
  })

  return { success: true, list: list }
}

async function auditShop(data) {
  const shopId = data.shopId
  const status = data.status
  const reason = String(data.reason || '').trim().slice(0, 200)
  
  if (!shopId || ['approved', 'rejected'].indexOf(status) === -1) {
    return { success: false, msg: '审核参数不正确' }
  }
  if (status === 'rejected' && !reason) return { success: false, msg: '请填写拒绝原因' }

  const updateData = {
    auditStatus: status,
    status: status === 'approved' ? 'open' : 'closed',
    updateTime: db.serverDate()
  }
  
  if (status === 'rejected') {
    updateData.rejectReason = reason
  }

  await db.collection('food_shop').doc(shopId).update({ data: updateData })

  let temporaryPassword = ''
  if (status === 'approved') {
    const shopUser = await db.collection('food_shop_user').where({ shopId: shopId }).limit(1).get()
    
    if (shopUser.data.length > 0) {
      const currentUser = shopUser.data[0]
      const accountUpdate = {
        approved: true,
        updateTime: db.serverDate()
      }
      if (!currentUser.username) accountUpdate.username = 'shop_' + Date.now().toString().slice(-6)
      if (!currentUser.passwordHash && !currentUser.password) {
        temporaryPassword = crypto.randomBytes(6).toString('hex')
        accountUpdate.passwordHash = hashPassword(temporaryPassword)
      }
      await db.collection('food_shop_user').doc(shopUser.data[0]._id).update({
        data: accountUpdate
      })
    }
  }

  await writeLog(shopId, '审核', status === 'approved' ? '商家入驻审核通过' : '商家入驻审核拒绝: ' + reason, '管理员')

  return { success: true, temporaryPassword: temporaryPassword }
}

async function getShopManageList(data) {
  const keyword = data.keyword || ''
  const query = { auditStatus: 'approved' }
  if (keyword) {
    query.name = db.RegExp({
      regexp: String(keyword).slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      options: 'i'
    })
  }

  const res = await db.collection('food_shop')
    .where(query)
    .orderBy('createTime', 'desc')
    .get()

  const list = res.data.map(function(item) {
    return {
      ...item,
      createTimeText: formatTime(item.createTime)
    }
  })

  return { success: true, list: list }
}

async function adminUpdateShopStatus(data) {
  const shopId = data.shopId
  const status = data.status
  if (!shopId || !status) return { success: false, msg: '参数缺失' }

  await db.collection('food_shop').doc(shopId).update({
    data: {
      status: status,
      updateTime: db.serverDate()
    }
  })

  await writeLog(shopId, '状态变更', '商家状态变更为: ' + (status === 'open' ? '营业中' : '已关闭'), '管理员')

  return { success: true }
}

async function adminUpdateShopInfo(data) {
  const shopId = data.shopId
  const shopData = data.shopData
  if (!shopId) return { success: false, msg: '参数缺失' }

  const payload = {
    name: shopData.name,
    contact: shopData.contact,
    phone: shopData.phone,
    minPrice: Number(shopData.minPrice || 0),
    deliveryFee: Number(shopData.deliveryFee || 0),
    updateTime: db.serverDate()
  }

  await db.collection('food_shop').doc(shopId).update({ data: payload })
  await writeLog(shopId, '信息编辑', '管理员编辑了商家信息', '管理员')

  return { success: true }
}

async function adminResetShopPassword(data) {
  const shopId = data.shopId
  if (!shopId) return { success: false, msg: '参数缺失' }

  const shopUser = await db.collection('food_shop_user').where({ shopId: shopId }).limit(1).get()
  if (shopUser.data.length === 0) {
    return { success: false, msg: '商家账号不存在' }
  }

  const temporaryPassword = crypto.randomBytes(6).toString('hex')
  await db.collection('food_shop_user').doc(shopUser.data[0]._id).update({
    data: {
      passwordHash: hashPassword(temporaryPassword),
      password: _.remove(),
      updateTime: db.serverDate()
    }
  })

  await writeLog(shopId, '密码重置', '管理员重置了商家登录密码', '管理员')

  return { success: true, temporaryPassword: temporaryPassword }
}

async function adminUpdateShopAccount(data) {
  const shopId = data.shopId
  const username = data.username
  const password = data.password
  if (!shopId) return { success: false, msg: '参数缺失' }

  const shopUser = await db.collection('food_shop_user').where({ shopId: shopId }).limit(1).get()
  if (shopUser.data.length === 0) {
    return { success: false, msg: '商家账号不存在' }
  }

  const updateData = { updateTime: db.serverDate() }
  if (username) updateData.username = username
  if (password) {
    updateData.passwordHash = hashPassword(password)
    updateData.password = _.remove()
  }

  await db.collection('food_shop_user').doc(shopUser.data[0]._id).update({
    data: updateData
  })

  await writeLog(shopId, '账号修改', '管理员修改了商家账号信息', '管理员')

  return { success: true, username: username || shopUser.data[0].username }
}

async function getShopLogs(data) {
  const shopId = data.shopId
  if (!shopId) return { success: false, msg: '参数缺失' }

  const res = await db.collection('food_shop_logs')
    .where({ shopId: shopId })
    .orderBy('createTime', 'desc')
    .limit(100)
    .get()

  const list = res.data.map(function(item) {
    return {
      ...item,
      createTimeText: formatTime(item.createTime)
    }
  })

  return { success: true, list: list }
}

async function adminShop(shopId) {
  if (!shopId || !(await db.collection('food_shop').doc(shopId).get()).data) return { error: { success: false, msg: '请先选择存在的店铺' } }
  return { shopId }
}

async function getShopDishes(openid, data) {
  const auth = await requireMerchant(openid, data.shopId)
  if (auth.error) return auth.error
  const shopId = auth.shopId

  const res = await db.collection('food_dish')
    .where({ shopId: shopId })
    .orderBy('createTime', 'desc')
    .get()

  const dishes = res.data.map(function(item) {
    return {
      ...item,
      createTimeText: formatTime(item.createTime)
    }
  })

  return { success: true, dishes: dishes }
}

async function shopAutoLogin(openid) {
  const merchant = await getMerchantByOpenid(openid)
  if (!merchant) {
    return { success: false, msg: '您还不是商家，请先申请入驻' }
  }

  const shop = await db.collection('food_shop').doc(merchant.shopId).get().catch(function() { return null })
  if (!shop || !shop.data) {
    return { success: false, msg: '店铺不存在' }
  }

  if (shop.data.auditStatus !== 'approved') {
    return { success: false, msg: '店铺审核中或未通过', auditStatus: shop.data.auditStatus }
  }

  return {
    success: true,
    shopId: merchant.shopId,
    shopInfo: shop.data
  }
}

async function initTestData(openid) {
  const shopCount = await db.collection('food_shop').count().catch(function() { return { total: 0 } })
  const shopIndex = shopCount.total + 1
  
  const shopNames = ['美味食堂', '香喷喷餐厅', '好味道快餐', '鲜香阁', '食为天']
  const nameIndex = (shopIndex - 1) % shopNames.length
  const shopName = shopNames[nameIndex] + (shopIndex > 5 ? String(shopIndex) : '')
  
  const shopRes = await db.collection('food_shop').add({
    data: {
      name: shopName,
      contact: '测试商家',
      phone: '1380013' + String(shopIndex).padStart(4, '0'),
      logo: '',
      banners: [],
      status: 'open',
      auditStatus: 'approved',
      rating: (4 + Math.random()).toFixed(1),
      monthlySales: Math.floor(Math.random() * 500),
      minPrice: 10 + Math.floor(Math.random() * 10),
      deliveryFee: 2 + Math.floor(Math.random() * 3),
      notice: '欢迎光临' + shopName + '！',
      signatureDishes: [],
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  })

  const shopId = shopRes._id
  const username = 'shop_' + Date.now().toString().slice(-6)
  const password = crypto.randomBytes(6).toString('hex')

  await db.collection('food_shop_user').add({
    data: {
      bindOpenid: '',
      shopId: shopId,
      username: username,
      passwordHash: hashPassword(password),
      role: 'admin',
      approved: true,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  })

  const dishes = [
    { name: '红烧肉', price: 28, category: '热销', description: '精选五花肉，入口即化', stock: 50 },
    { name: '宫保鸡丁', price: 22, category: '热销', description: '经典川菜，香辣可口', stock: 50 },
    { name: '鱼香肉丝', price: 20, category: '热销', description: '酸甜适中，下饭神器', stock: 50 },
    { name: '番茄炒蛋', price: 15, category: '家常菜', description: '简单美味，营养健康', stock: 50 },
    { name: '青椒肉丝', price: 18, category: '家常菜', description: '清爽下饭', stock: 50 },
    { name: '麻婆豆腐', price: 16, category: '家常菜', description: '麻辣鲜香', stock: 50 },
    { name: '可乐鸡翅', price: 25, category: '新品', description: '甜香入味，老少皆宜', stock: 30 },
    { name: '酸辣土豆丝', price: 12, category: '素菜', description: '酸辣爽口', stock: 50 },
    { name: '米饭', price: 2, category: '主食', description: '东北大米', stock: 200 },
    { name: '可乐', price: 5, category: '饮品', description: '冰镇可乐', stock: 100 }
  ]

  for (let i = 0; i < dishes.length; i++) {
    const dish = dishes[i]
    await db.collection('food_dish').add({
      data: {
        name: dish.name,
        price: dish.price,
        category: dish.category,
        description: dish.description,
        stock: dish.stock,
        shopId: shopId,
        image: '',
        isAvailable: true,
        sales: Math.floor(Math.random() * 100),
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
  }

  return { 
    success: true, 
    msg: '测试商家创建成功',
    shopId: shopId,
    shopName: shopName,
    loginInfo: {
      username: username,
      password: password
    }
  }
}

async function registerRider(openid, data) {
  const { name, phone, studentId, idCardImage, vehicleType } = data

  if (!name || !phone || !studentId) {
    return { success: false, msg: '请填写完整信息' }
  }

  const existRes = await db.collection('food_rider').where({ openid: openid }).count()
  if (existRes.total > 0) {
    return { success: false, msg: '您已提交过骑手申请' }
  }

  await db.collection('food_rider').add({
    data: {
      openid: openid,
      name: name,
      phone: phone,
      studentId: studentId,
      idCardImage: idCardImage || '',
      vehicleType: vehicleType || 'bicycle',
      status: 'pending',
      isOnline: false,
      totalOrders: 0,
      totalIncome: 0,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  })

  return { success: true, msg: '申请已提交' }
}

async function checkRiderStatus(openid) {
  const res = await db.collection('food_rider').where({ openid: openid }).get()

  if (res.data.length === 0) {
    return { success: true, riderStatus: 'none', riderInfo: null }
  }

  const rider = res.data[0]
  return {
    success: true,
    riderStatus: rider.status,
    riderInfo: {
      name: rider.name,
      phone: rider.phone,
      vehicleType: rider.vehicleType,
      isOnline: rider.isOnline
    }
  }
}

async function getPendingDeliveryOrders(openid) {
  const riderRes = await db.collection('food_rider').where({ openid: openid, status: 'approved' }).get()
  if (riderRes.data.length === 0) {
    return { success: false, msg: '您不是已审核的骑手' }
  }

  const res = await db.collection('food_order').where({
    type: 'delivery',
    status: 'ready',
    deliveryStatus: _.neq('completed')
  }).orderBy('createTime', 'asc').limit(20).get()

  return { success: true, list: res.data }
}

async function riderAcceptOrder(openid, data) {
  const { orderId } = data

  const riderRes = await db.collection('food_rider').where({ openid: openid, status: 'approved' }).get()
  if (riderRes.data.length === 0) {
    return { success: false, msg: '您不是已审核的骑手' }
  }

  const rider = riderRes.data[0]

  const orderRes = await db.collection('food_order').doc(orderId).get()
  if (!orderRes.data) {
    return { success: false, msg: '订单不存在' }
  }

  if (orderRes.data.riderOpenid) {
    return { success: false, msg: '该订单已被其他骑手接单' }
  }

  await db.collection('food_order').doc(orderId).update({
    data: {
      riderOpenid: openid,
      riderName: rider.name,
      riderPhone: rider.phone,
      deliveryStatus: 'picking',
      acceptTime: db.serverDate()
    }
  })

  return { success: true, msg: '接单成功' }
}

async function riderCompleteDelivery(openid, data) {
  const { orderId } = data

  const orderRes = await db.collection('food_order').doc(orderId).get()
  if (!orderRes.data || orderRes.data.riderOpenid !== openid) {
    return { success: false, msg: '无权操作此订单' }
  }

  await db.collection('food_order').doc(orderId).update({
    data: {
      status: 'completed',
      deliveryStatus: 'completed',
      completeTime: db.serverDate()
    }
  })

  const deliveryFee = orderRes.data.deliveryFee || 2
  await db.collection('food_rider').where({ openid: openid }).update({
    data: {
      totalOrders: _.inc(1),
      totalIncome: _.inc(deliveryFee),
      updateTime: db.serverDate()
    }
  })

  return { success: true, msg: '已确认送达' }
}

async function getRiderOrders(openid, data) {
  const status = data.status || 'all'
  const riderRes = await db.collection('food_rider').where({ openid: openid, status: 'approved' }).get()
  if (riderRes.data.length === 0) {
    return { success: false, msg: '您不是已审核的骑手' }
  }

  let query = { riderOpenid: openid }
  if (status !== 'all') {
    query.deliveryStatus = status
  }

  const res = await db.collection('food_order').where(query).orderBy('createTime', 'desc').limit(50).get()
  return { success: true, list: res.data }
}

async function getRiderStats(openid) {
  const res = await db.collection('food_rider').where({ openid: openid }).get()
  if (res.data.length === 0) {
    return { success: false, msg: '骑手信息不存在' }
  }

  const rider = res.data[0]
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const todayOrdersRes = await db.collection('food_order').where({
    riderOpenid: openid,
    deliveryStatus: 'completed',
    completeTime: _.gte(today)
  }).get()

  let todayIncome = 0
  todayOrdersRes.data.forEach(function(order) {
    todayIncome += (order.deliveryFee || 2)
  })

  return {
    success: true,
    stats: {
      todayOrders: todayOrdersRes.data.length,
      todayIncome: todayIncome,
      totalOrders: rider.totalOrders || 0,
      totalIncome: rider.totalIncome || 0
    }
  }
}

async function getRiderAuditList(data) {
  const status = data.status || 'pending'
  const res = await db.collection('food_rider').where({ status: status }).orderBy('createTime', 'desc').limit(50).get()
  return { success: true, list: res.data }
}

async function auditRider(data) {
  const { riderId, status, reason } = data
  if (!riderId || !status) {
    return { success: false, msg: '参数不完整' }
  }

  const updateData = {
    status: status,
    updateTime: db.serverDate()
  }
  if (reason) {
    updateData.rejectReason = reason
  }

  await db.collection('food_rider').doc(riderId).update({ data: updateData })
  return { success: true, msg: status === 'approved' ? '已通过' : '已拒绝' }
}
