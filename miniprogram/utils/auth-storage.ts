export function clearIdentityCache(): void {
  const keys = [
    'userInfo', 'openid', 'userId', 'skipAuth', 'food_openid', 'food_user_info',
    'food_skip_login', 'food_shop_id', 'shop_info', 'riderInfo', 'rider_info',
    'current_order', 'isAdmin', 'adminInfo'
  ]
  keys.forEach(key => wx.removeStorageSync(key))
}
