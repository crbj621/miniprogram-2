const { api } = require('../../utils/api-client')
var syncUserInfoToForum = function() {
  return new Promise(function(resolve, reject) {
    var app = getApp()
    var openid = app.getOpenIdSync()
    var userInfo = app.getUserInfo()
    
    if (!openid) {
      console.log('用户未登录，跳过动态信息同步')
      resolve(false)
      return
    }
    
    var nickName = ''
    var avatarUrl = ''
    
    if (userInfo) {
      nickName = userInfo.nickName || ''
      avatarUrl = userInfo.avatarUrl || ''
    }
    
    api.call({
      name: 'forum',
      data: {
        action: 'syncUserInfo',
        data: {
          nickname: nickName,
          avatar: avatarUrl
        }
      },
      success: function(res) {
        if (res.result && res.result.success) {
          console.log('动态用户信息同步成功')
          resolve(true)
        } else {
          console.log('动态用户信息同步失败:', res.result)
          resolve(false)
        }
      },
      fail: function(err) {
        console.error('动态用户信息同步失败:', err)
        resolve(false)
      }
    })
  })
}

var cachedUserInfo = null

var getForumUserInfo = function() {
  return new Promise(function(resolve, reject) {
    var app = getApp()
    var openid = app.getOpenIdSync()
    
    if (!openid) {
      resolve(null)
      return
    }
    
    if (cachedUserInfo) {
      resolve(cachedUserInfo)
      return
    }
    
    api.call({
      name: 'forum',
      data: {
        action: 'getUserInfo',
        data: {}
      },
      success: function(res) {
        if (res.result && res.result.success) {
          cachedUserInfo = res.result.user
          resolve(res.result.user)
        } else {
          resolve(null)
        }
      },
      fail: function(err) {
        console.error('获取动态用户信息失败:', err)
        resolve(null)
      }
    })
  })
}

var clearForumUserCache = function() {
  cachedUserInfo = null
}

var checkLoginAndSync = function() {
  return new Promise(function(resolve, reject) {
    var app = getApp()
    var isLoggedIn = app.isLoggedIn()
    var userInfo = app.getUserInfo()
    
    if (!isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(function() {
        wx.reLaunch({ url: '/pages/login/login?forceLogin=true' })
      }, 1000)
      resolve(false)
      return
    }
    
    if (!userInfo || !userInfo.nickName) {
      wx.showToast({ title: '请先完善个人信息', icon: 'none' })
      setTimeout(function() {
        wx.reLaunch({ url: '/pages/login/login?forceLogin=true' })
      }, 1000)
      resolve(false)
      return
    }
    
    syncUserInfoToForum().then(function(success) {
      resolve(success)
    })
  })
}

module.exports = {
  syncUserInfoToForum: syncUserInfoToForum,
  getForumUserInfo: getForumUserInfo,
  clearForumUserCache: clearForumUserCache,
  checkLoginAndSync: checkLoginAndSync
}
