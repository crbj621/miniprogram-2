export function clearIdentityCache(): void {
  const keys = [
    'userInfo', 'openid', 'userId', 'skipAuth', 'food_openid', 'food_user_info',
    // 清理已移除点餐的旧缓存，不恢复对应业务。
    'food_skip_login', 'food_shop_id', 'shop_info', 'riderInfo', 'rider_info',
    'current_order', 'isAdmin', 'adminInfo'
  ]
  keys.forEach(key => wx.removeStorageSync(key))
}
