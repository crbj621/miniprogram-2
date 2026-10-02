const cloud = require('campus-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const orderLocks = new Set()
const registrationLocks = new Set()

async function withOrderLock(orderId, callback) {
  if (orderLocks.has(orderId)) {
    return { code: -1, message: '订单正在处理，请稍后刷新' }
  }
  orderLocks.add(orderId)
  try {
    return await callback()
  } finally {
    orderLocks.delete(orderId)
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = event && event.action
  const data = (event && event.data) || {}

  if (!openid) {
    return { code: -1, message: '登录状态无效' }
  }

  try {
    switch (action) {
      case 'getProfile':
        return await getProfile(openid)
      case 'register':
        return await register(openid, data)
      case 'listAvailableOrders':
        return await listAvailableOrders(openid)
      case 'acceptOrder':
        return await withOrderLock(String(data.orderId || ''), function() {
          return db.runTransaction(() => acceptOrder(openid, data))
        })
      case 'listMyOrders':
        return await listMyOrders(openid, data)
      case 'updateDeliveryStatus':
        return await withOrderLock(String(data.orderId || ''), function() {
          return db.runTransaction(() => updateDeliveryStatus(openid, data))
        })
      default:
        return { code: -1, message: '不支持的骑手操作：' + (action || '空') }
    }
  } catch (error) {
    console.error('rider error:', action, error)
    return { code: -1, message: error.message || '骑手服务异常' }
  }
}

function publicRider(rider) {
  return {
    _id: rider._id,
    realName: rider.realName || rider.name || '',
    phone: rider.phone || '',
    studentId: rider.studentId || '',
    status: rider.status || 'pending',
    rejectReason: rider.rejectReason || '',
    totalOrders: rider.totalOrders || 0,
    totalIncome: rider.totalIncome || 0
  }
}

async function findRider(openid) {
  const result = await db.collection('food_rider').where({ openid: openid }).limit(1).get()
  return result.data[0] || null
}

async function requireApprovedRider(openid) {
  const rider = await findRider(openid)
  if (!rider) {
    return { error: { code: -1, message: '请先注册骑手' } }
  }
  if (rider.status !== 'approved') {
    const statusText = rider.status === 'rejected' ? '骑手申请未通过' : '骑手申请审核中'
    return { error: { code: -1, message: statusText } }
  }
  return { rider: rider }
}

async function getProfile(openid) {
  const rider = await findRider(openid)
  return {
    code: 0,
    data: {
      registered: !!rider,
      rider: rider ? publicRider(rider) : null
    }
  }
}

async function register(openid, data) {
  const realName = String(data.realName || data.name || '').trim()
  const phone = String(data.phone || '').trim()
  const studentId = String(data.studentId || '').trim()
  if (!realName || !phone || !studentId) {
    return { code: -1, message: '请完整填写姓名、手机号和学号' }
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return { code: -1, message: '请输入正确的11位手机号' }
  }
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(studentId)) {
    return { code: -1, message: '学号应为4至32位字母、数字、横线或下划线' }
  }

  const lockKeys = [openid, 'student:' + studentId.toLowerCase()]
  if (lockKeys.some(function(key) { return registrationLocks.has(key) })) {
    return { code: -1, message: '资料正在提交，请勿重复操作' }
  }
  lockKeys.forEach(function(key) { registrationLocks.add(key) })

  try {
    const existing = await findRider(openid)
    if (existing && existing.status !== 'rejected') {
      return {
        code: 0,
        message: existing.status === 'approved' ? '骑手账号已审核通过' : '骑手申请正在审核中',
        data: { rider: publicRider(existing) }
      }
    }

    const sameStudent = await db.collection('food_rider').where({ studentId: studentId }).limit(10).get()
    const occupied = (sameStudent.data || []).some(function(rider) {
      return rider.openid !== openid
    })
    if (occupied) {
      return { code: -1, message: '该学号已经注册过骑手' }
    }

    if (existing && existing.status === 'rejected') {
      await db.collection('food_rider').doc(existing._id).update({
        data: {
          realName: realName,
          name: realName,
          phone: phone,
          studentId: studentId,
          status: 'pending',
          rejectReason: _.remove(),
          auditTime: _.remove(),
          updateTime: db.serverDate()
        }
      })
      existing.realName = realName
      existing.name = realName
      existing.phone = phone
      existing.studentId = studentId
      existing.status = 'pending'
      existing.rejectReason = ''
      return {
        code: 0,
        message: '资料已重新提交，请等待管理员审核',
        data: { rider: publicRider(existing) }
      }
    }

    const riderData = {
      openid: openid,
      realName: realName,
      name: realName,
      phone: phone,
      studentId: studentId,
      status: 'pending',
      isOnline: false,
      totalOrders: 0,
      totalIncome: 0,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
    const result = await db.collection('food_rider').add({ data: riderData })
    riderData._id = result._id
    return {
      code: 0,
      message: '申请已提交，请等待管理员审核',
      data: { rider: publicRider(riderData) }
    }
  } finally {
    lockKeys.forEach(function(key) { registrationLocks.delete(key) })
  }
}

function formatTime(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  const pad = function(number) {
    return String(number).padStart(2, '0')
  }
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

async function attachOrderInfo(orders) {
  const shopIds = Array.from(new Set(orders.map(function(order) {
    return order.shopId
  }).filter(Boolean)))
  const shopMap = {}
  for (let i = 0; i < shopIds.length; i += 20) {
    const result = await db.collection('food_shop').where({
      _id: _.in(shopIds.slice(i, i + 20))
    }).get()
    ;(result.data || []).forEach(function(shop) {
      shopMap[shop._id] = shop
    })
  }

  return orders.map(function(order) {
    const shop = shopMap[order.shopId] || {}
    order.shopName = shop.name || '未知店铺'
    order.createTimeText = formatTime(order.createTime)
    return order
  })
}

async function listAvailableOrders(openid) {
  const auth = await requireApprovedRider(openid)
  if (auth.error) return auth.error

  const result = await db.collection('food_order').where({
    type: 'delivery',
    status: 'ready'
  }).orderBy('createTime', 'asc').limit(100).get()
  const list = (result.data || []).filter(function(order) {
    return !order.riderOpenid
  })
  return { code: 0, data: { list: await attachOrderInfo(list) } }
}

async function acceptOrder(openid, data) {
  const auth = await requireApprovedRider(openid)
  if (auth.error) return auth.error
  const orderId = data.orderId
  if (!orderId) return { code: -1, message: '订单参数缺失' }

  const result = await db.collection('food_order').doc(orderId).get()
  const order = result.data
  if (!order) return { code: -1, message: '订单不存在' }
  if (order.type !== 'delivery' || order.status !== 'ready') {
    return { code: -1, message: '该订单当前不可接单' }
  }
  if (order.riderOpenid) {
    return { code: -1, message: '该订单已被其他骑手接走' }
  }

  let claimResult = await db.collection('food_order').where({
    _id: orderId,
    type: 'delivery',
    status: 'ready',
    riderOpenid: _.exists(false)
  }).update({
    data: {
      riderOpenid: openid,
      riderName: auth.rider.realName || auth.rider.name,
      riderPhone: auth.rider.phone,
      deliveryStatus: 'accepted',
      acceptTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  })
  if (!claimResult.stats || claimResult.stats.updated !== 1) {
    claimResult = await db.collection('food_order').where({
      _id: orderId,
      type: 'delivery',
      status: 'ready',
      riderOpenid: ''
    }).update({
      data: {
        riderOpenid: openid,
        riderName: auth.rider.realName || auth.rider.name,
        riderPhone: auth.rider.phone,
        deliveryStatus: 'accepted',
        acceptTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
  }
  if (!claimResult.stats || claimResult.stats.updated !== 1) {
    return { code: -1, message: '该订单已被其他骑手接走' }
  }
  return { code: 0, message: '接单成功' }
}

async function listMyOrders(openid, data) {
  const auth = await requireApprovedRider(openid)
  if (auth.error) return auth.error
  const status = data.status || 'all'
  const query = { riderOpenid: openid }
  if (status !== 'all') query.deliveryStatus = status

  const result = await db.collection('food_order')
    .where(query)
    .orderBy('createTime', 'desc')
    .limit(100)
    .get()
  return { code: 0, data: { list: await attachOrderInfo(result.data || []) } }
}

async function updateDeliveryStatus(openid, data) {
  const auth = await requireApprovedRider(openid)
  if (auth.error) return auth.error

  const orderId = data.orderId
  const next = data.deliveryStatus
  const allowed = {
    accepted: 'picking',
    picking: 'delivering',
    delivering: 'delivered'
  }
  if (!orderId || !next) return { code: -1, message: '参数缺失' }

  const result = await db.collection('food_order').doc(orderId).get()
  const order = result.data
  if (!order || order.riderOpenid !== openid) {
    return { code: -1, message: '无权操作此订单' }
  }
  const current = order.deliveryStatus || 'accepted'
  if (allowed[current] !== next) {
    return { code: -1, message: '订单配送状态已变化，请刷新后重试' }
  }
  if (next === 'delivered' && !data.photoFileId) {
    return { code: -1, message: '送达时必须上传照片凭证' }
  }

  const updateData = {
    deliveryStatus: next,
    updateTime: db.serverDate()
  }
  if (next === 'picking') updateData.pickTime = db.serverDate()
  if (next === 'delivering') updateData.deliveryTime = db.serverDate()
  if (next === 'delivered') {
    updateData.status = 'completed'
    updateData.deliveryPhoto = data.photoFileId
    updateData.completeTime = db.serverDate()
  }

  const transition = await db.collection('food_order').where({
    _id: orderId,
    riderOpenid: openid,
    deliveryStatus: current
  }).update({ data: updateData })
  if (!transition.stats || transition.stats.updated !== 1) {
    return { code: -1, message: '订单配送状态已变化，请刷新后重试' }
  }
  if (next === 'delivered') {
    await db.collection('food_rider').doc(auth.rider._id).update({
      data: {
        totalOrders: _.inc(1),
        totalIncome: _.inc(Number(order.deliveryFee == null ? 2 : order.deliveryFee)),
        updateTime: db.serverDate()
      }
    })
  }
  return { code: 0, message: '配送状态已更新' }
}
