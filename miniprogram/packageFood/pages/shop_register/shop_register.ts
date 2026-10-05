import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    form: {
      name: '',
      contact: '',
      phone: '',
      username: '',
      password: '',
      confirmPassword: '',
      coverImage: '',
      licenseImage: '',
      supportDelivery: true
    },
    uploadingCover: false,
    uploadingLicense: false,
    submitting: false
  },

  onLoad() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageFood/pages/shop_register/shop_register')
      })
    }
  },

  onInputChange(e: any) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onDeliveryChange(e: any) {
    this.setData({ 'form.supportDelivery': e.detail.value })
  },

  chooseCoverImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        this.setData({ uploadingCover: true })

        try {
          const cloudPath = 'shops/cover_' + Date.now() + '.jpg'
          const uploadRes = await api.uploadFile({
            cloudPath: cloudPath,
            filePath: tempFilePath
          })
          this.setData({
            'form.coverImage': uploadRes.fileID,
            uploadingCover: false
          })
          wx.showToast({ title: '上传成功', icon: 'success' })
        } catch (err) {
          this.setData({ uploadingCover: false })
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  },

  chooseLicenseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        this.setData({ uploadingLicense: true })

        try {
          const cloudPath = 'shops/license_' + Date.now() + '.jpg'
          const uploadRes = await api.uploadFile({
            cloudPath: cloudPath,
            filePath: tempFilePath
          })
          this.setData({
            'form.licenseImage': uploadRes.fileID,
            uploadingLicense: false
          })
          wx.showToast({ title: '上传成功', icon: 'success' })
        } catch (err) {
          this.setData({ uploadingLicense: false })
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  },

  previewImage(e: any) {
    const url = e.currentTarget.dataset.url
    if (url) {
      wx.previewImage({
        current: url,
        urls: [url]
      })
    }
  },

  async submitRegister() {
    const { form, submitting } = this.data
    
    if (submitting) return
    
    if (!form.name) {
      wx.showToast({ title: '请输入店铺名称', icon: 'none' })
      return
    }
    if (!form.contact) {
      wx.showToast({ title: '请输入联系人', icon: 'none' })
      return
    }
    if (!form.phone) {
      wx.showToast({ title: '请输入联系电话', icon: 'none' })
      return
    }
    if (!form.username || form.username.length < 4) {
      wx.showToast({ title: '账号至少4位字符', icon: 'none' })
      return
    }
    if (!/^[A-Za-z0-9_]{4,32}$/.test(form.username)) {
      wx.showToast({ title: '账号需为4-32位字母、数字或下划线', icon: 'none' })
      return
    }
    if (!form.password || form.password.length < 8) {
      wx.showToast({ title: '密码至少8位字符', icon: 'none' })
      return
    }
    if (form.password !== form.confirmPassword) {
      wx.showToast({ title: '两次密码不一致', icon: 'none' })
      return
    }
    if (!form.coverImage) {
      wx.showToast({ title: '请上传门店封面图', icon: 'none' })
      return
    }
    if (!form.licenseImage) {
      wx.showToast({ title: '请上传营业执照', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    try {
      const res = await api.call({
        name: 'food_manager',
        data: {
          action: 'registerMerchant',
          data: {
            name: form.name,
            contact: form.contact,
            phone: form.phone,
            username: form.username,
            password: form.password,
            coverImage: form.coverImage,
            licenseImage: form.licenseImage,
            supportDelivery: form.supportDelivery
          }
        }
      }) as any

      this.setData({ submitting: false })

      if (res.result.success) {
        wx.showModal({
          title: '提交成功',
          content: '您的入驻申请已提交，请等待管理员审核。审核通过后使用账号 ' + form.username + ' 登录商家后台。',
          showCancel: false,
          success: () => {
            wx.navigateBack()
          }
        })
      } else {
        wx.showToast({ title: res.result.msg || '提交失败', icon: 'none' })
      }
    } catch (err) {
      this.setData({ submitting: false })
      wx.showToast({ title: '提交失败', icon: 'none' })
    }
  }
}))
