import { api } from '../../utils/api-client'
Page({
  data: {
    isLoading: false,
    userInfo: {
      avatarUrl: '',
      nickName: ''
    },
    tempAvatarPath: '',
    slogan: '山野万里，浪漫不止朝夕',
    sloganStyle: '',
    redirectUrl: '/pages/portal/portal'
  },

  onLoad(options: any) {
    this.setData({ redirectUrl: this.resolveRedirect(options && options.redirect) })
    this.initRandomSlogan()
    this.checkLogin(options)
  },

  resolveRedirect(value: any) {
    if (!value) return '/pages/portal/portal'
    try {
      const decoded = decodeURIComponent(String(value))
      return decoded.indexOf('/') === 0 && decoded.indexOf('//') !== 0
        ? decoded
        : '/pages/portal/portal'
    } catch (error) {
      return '/pages/portal/portal'
    }
  },

  enterAfterLogin() {
    wx.reLaunch({ url: this.data.redirectUrl || '/pages/portal/portal' })
  },

  initRandomSlogan() {
    // 随机渐变色库
    const gradients = [
      'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)', // 浪漫粉
      'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)', // 紫粉
      'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)', // 蜜桃紫
      'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)', // 薰衣草
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', // 活力蓝
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'  // 晚霞
    ]
    const randomGradient = gradients[Math.floor(Math.random() * gradients.length)]
    this.setData({ 
      sloganStyle: `background: ${randomGradient}; -webkit-background-clip: text; color: transparent;` 
    })

    // 备用语录库，当接口请求失败时使用
    const fallbackSlogans = [
      '山野万里，浪漫不止朝夕',
      '星光不问赶路人，时光不负有心人',
      '在这里，用脚步丈量商幼的每一寸土地',
      '愿你历尽千帆，归来仍是少年'
    ]

    // 登录页不依赖第三方接口，避免域名白名单或网络波动拖慢首屏。
    this.useFallbackSlogan(fallbackSlogans)
  },

  useFallbackSlogan(slogans: string[]) {
    const randomIndex = Math.floor(Math.random() * slogans.length)
    this.setData({ slogan: slogans[randomIndex] })
  },

  checkLogin(options: any = {}) {
    const app = getApp()
    
    if (options.forceLogin === 'true') {
      console.log('强制登录模式，不检查登录状态')
      return
    }
    
    if (app.isLoggedIn()) {
      console.log('已登录，跳转到首页')
      this.enterAfterLogin()
    }
  },

  onChooseAvatar(e: any) {
    const avatarUrl = e.detail.avatarUrl
    console.log('选择的头像路径:', avatarUrl)
    this.setData({
      'userInfo.avatarUrl': avatarUrl,
      tempAvatarPath: avatarUrl
    })
  },

  onNicknameInput(e: any) {
    this.setData({
      'userInfo.nickName': e.detail.value
    })
  },

  onNicknameBlur(e: any) {
    this.setData({
      'userInfo.nickName': e.detail.value
    })
  },

  async doLogin() {
    const { userInfo, tempAvatarPath } = this.data
    
    if (!userInfo.nickName) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }
    
    this.setData({ isLoading: true })
    wx.showLoading({ title: '登录中...', mask: true })
    
    try {
      let avatarUrl = userInfo.avatarUrl || ''
      
      if (tempAvatarPath) {
        const isTempPath = tempAvatarPath.indexOf('wxfile://') === 0 || 
                          tempAvatarPath.indexOf('http://tmp') === 0 ||
                          tempAvatarPath.indexOf('https://tmp') === 0 ||
                          tempAvatarPath.indexOf('/tmp/') !== -1
        
        if (isTempPath || tempAvatarPath.indexOf('cloud://') !== 0) {
          wx.showLoading({ title: '上传头像...', mask: true })
          const cloudPath = 'avatars/' + Date.now() + '-' + Math.random().toString(36).substr(2, 9) + '.jpg'
          console.log('开始上传头像到云存储:', cloudPath)
          
          const uploadRes = await api.uploadFile({
            cloudPath: cloudPath,
            filePath: tempAvatarPath
          })
          
          if (uploadRes.fileID) {
            avatarUrl = uploadRes.fileID
            console.log('头像上传成功:', avatarUrl)
          } else {
            console.error('头像上传失败，fileID为空')
          }
        }
      }
      
      const app = getApp()
      const result = await app.doLogin({
        nickName: userInfo.nickName,
        avatarUrl: avatarUrl
      })
      
      wx.hideLoading()
      
      console.log('登录结果:', result)
      
      if (result.success) {
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => {
          this.enterAfterLogin()
        }, 1000)
      } else {
        wx.showToast({ title: result.message || '登录失败', icon: 'none' })
        this.setData({ isLoading: false })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('登录失败:', err)
      wx.showToast({ title: '登录失败', icon: 'none' })
      this.setData({ isLoading: false })
    }
  },

  skipLogin() {
    const app = getApp()
    const openid = app.getOpenIdSync()
    
    if (openid) {
      wx.setStorageSync('openid', openid)
    }
    
    wx.setStorageSync('skipAuth', true)
    wx.showToast({ title: '已跳过登录', icon: 'success' })
    setTimeout(() => {
      this.enterAfterLogin()
    }, 500)
  }
})
