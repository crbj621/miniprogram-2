const cloud = require('campus-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  const action = event && event.action
  if (!openid) {
    return { success: false, message: '登录状态无效' }
  }

  try {
    switch (action) {
      case 'getCoupons':
        return await getCoupons(openid)
      case 'claimNewUserCoupon':
        return await claimNewUserCoupon(openid)
      case 'useCoupon':
        return { success: false, message: '优惠券会在提交订单时自动核销' }
      default:
        return { success: false, message: '不支持的优惠券操作：' + (action || '空') }
    }
  } catch (error) {
    console.error('coupon_manager error:', action, error)
    return { success: false, message: error.message || '优惠券服务异常' }
  }
}

async function getCoupons(openid) {
  const result = await db.collection('user_coupons')
    .where({ _openid: openid })
    .orderBy('createTime', 'desc')
    .limit(100)
    .get()
  const list = result.data || []
  const claimedNewUser = list.some(function(item) {
    return item.source === 'new_user'
  })
  return {
    success: true,
    data: list,
    claimedNewUser: claimedNewUser
  }
}

async function claimNewUserCoupon(openid) {
  const existing = await db.collection('user_coupons').where({
    _openid: openid,
    source: 'new_user'
  }).limit(1).get()
  if (existing.data.length) {
    return { success: false, message: '新用户专享券已经领取过了' }
  }

  const coupon = {
    _openid: openid,
    name: '新用户专享券',
    value: 1,
    source: 'new_user',
    used: false,
    expireTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createTime: db.serverDate()
  }
  const couponId = 'new_user_' + crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)
  try {
    await db.collection('user_coupons').doc(couponId).create({ data: coupon })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return { success: false, message: '新用户专享券已经领取过了' }
    throw error
  }
  return {
    success: true,
    message: '领取成功',
    data: Object.assign({ _id: couponId }, coupon)
  }
}

async function useCoupon(openid, couponId) {
  if (!couponId || String(couponId).indexOf('mock_') === 0) {
    return { success: false, message: '优惠券不存在' }
  }

  const result = await db.collection('user_coupons').doc(couponId).get()
  const coupon = result.data
  if (!coupon || coupon._openid !== openid) {
    return { success: false, message: '无权使用该优惠券' }
  }
  if (coupon.used) {
    return { success: false, message: '优惠券已经使用' }
  }
  if (coupon.expireTime && new Date(coupon.expireTime).getTime() <= Date.now()) {
    return { success: false, message: '优惠券已过期' }
  }

  const updateResult = await db.collection('user_coupons').where({
    _id: couponId,
    _openid: openid,
    used: false
  }).update({
    data: {
      used: true,
      usedTime: db.serverDate()
    }
  })
  if (!updateResult.stats || updateResult.stats.updated !== 1) {
    return { success: false, message: '优惠券状态已变化，请刷新后重试' }
  }
  return { success: true, message: '优惠券已使用' }
}
