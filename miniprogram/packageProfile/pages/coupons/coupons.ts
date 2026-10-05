import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
// pages/profile/coupons/coupons.ts
Page(withSharing({
  data: {
    totalValue: '0.00',
    coupons: [] as any[],
    userCoupons: [] as any[],
    claimedNewUser: false, // 默认没领取，以便首次加载可能直接展示
    showNewUserCoupon: true // 默认展示新手券区域
  },

  onShow() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageProfile/pages/coupons/coupons')
      })
      return
    }
    this.setData({ totalValue: '0.00', coupons: [], userCoupons: [] });
    // 同时发请求，分别获取里程抵扣和专享券，合并计算总额
    Promise.all([
      this.fetchCouponsPromise(),
      this.fetchUserCouponsPromise()
    ]).then(([runDiscount, userCouponsTotal]: any[]) => {
      const total = runDiscount + userCouponsTotal;
      this.setData({
        totalValue: total.toFixed(2)
      });
    });
  },

  fetchUserCouponsPromise() {
    return new Promise((resolve) => {
      api.call({
        name: 'coupon_manager',
        data: { action: 'getCoupons' },
        success: (res: any) => {
          if (res.result && res.result.success) {
            let totalUserCouponValue = 0;
            const now = Date.now();
            const userCoupons = res.result.data.map((c: any) => {
              const expireDate = new Date(c.expireTime);
              const expired = expireDate.getTime() <= now;
              if (!c.used && !expired) {
                totalUserCouponValue += Number(c.value || 0);
              }
              return {
                ...c,
                expired,
                expireTimeFormatted: `${expireDate.getFullYear()}-${(expireDate.getMonth() + 1).toString().padStart(2, '0')}-${expireDate.getDate().toString().padStart(2, '0')} ${expireDate.getHours().toString().padStart(2, '0')}:${expireDate.getMinutes().toString().padStart(2, '0')}`
              };
            });
            this.setData({
              userCoupons: userCoupons,
              claimedNewUser: res.result.claimedNewUser,
              showNewUserCoupon: !res.result.claimedNewUser
            });
            resolve(totalUserCouponValue);
          } else {
            this.setData({ showNewUserCoupon: true });
            resolve(0);
          }
        },
        fail: (err) => {
          console.error('Failed to fetch user coupons:', err);
          this.setData({ showNewUserCoupon: true });
          resolve(0);
        }
      });
    });
  },

  fetchCouponsPromise() {
    return new Promise((resolve) => {
      api.call({
        name: 'food_manager',
        data: { action: 'getCheckoutBenefits', data: {} },
        success: (res: any) => {
          if (res.result && res.result.success) {
            const totalDiscount = Number(res.result.runDiscount || 0);
            const coupons = totalDiscount > 0 ? [{
              value: totalDiscount.toFixed(2),
              name: '今日跑步抵扣',
              desc: res.result.runRule || '今日每跑1公里抵0.1元，每日最多1元'
            }] : [];
            this.setData({ coupons });
            resolve(totalDiscount);
          } else {
            resolve(0);
          }
        },
        fail: () => {
          resolve(0);
        }
      });
    });
  },

  fetchUserCoupons() {
    this.fetchUserCouponsPromise();
  },

  fetchCoupons() {
    this.fetchCouponsPromise();
  },

  async claimNewUserCoupon() {
    wx.showLoading({ title: '领取中...' });
    try {
      const res = await api.call({
        name: 'coupon_manager',
        data: { action: 'claimNewUserCoupon' }
      }) as any;
      wx.hideLoading();
      if (res.result && res.result.success) {
        wx.showToast({ title: '领取成功', icon: 'success' });
        this.onShow();
      } else {
        wx.showToast({
          title: (res.result && res.result.message) ? res.result.message : '领取失败',
          icon: 'none'
        });
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: '领取失败', icon: 'none' });
    }
  },

  goOrder() {
    wx.reLaunch({
      url: '/packageFood/pages/index/index'
    });
  },

  goRun() {
    wx.reLaunch({
      url: '/pages/index/index'
    });
  }
}));
