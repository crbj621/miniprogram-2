import { api } from '../../utils/api-client'
import { RunTracker, StepDetector, activeSeconds } from '../../utils/run-metrics'
let accelerometerListener: ((res: any) => void) | null = null
let gyroscopeListener: ((res: any) => void) | null = null
let compassListener: ((res: any) => void) | null = null

function detachSensorListeners() {
  if (accelerometerListener) {
    wx.offAccelerometerChange(accelerometerListener)
    accelerometerListener = null
  }
  if (gyroscopeListener) {
    wx.offGyroscopeChange(gyroscopeListener)
    gyroscopeListener = null
  }
  if (compassListener) {
    wx.offCompassChange(compassListener)
    compassListener = null
  }
}

Page({
  data: {
    totalMeter: 0,
    gpsDistance: 0,
    estimatedDistance: 0,
    signalGaps: 0,
    distanceSource: 'GPS 定位',
    sensorAvailable: false,
    weRunSteps: null as number | null,
    weRunSyncing: false,
    weRunUpdated: '',
    weRunError: '',
    isRunning: false,
    isPaused: false,
    startingRun: false,
    savingRun: false,
    pendingUploads: 0,
    pendingUploadError: '',
    teamRefreshing: false,
    sheetCollapsed: false,
    sheetDragging: false,
    sheetDragOffset: 0,
    hudTop: 64,
    lastLat: null as number | null,
    lastLng: null as number | null,
    latitude: 34.4176,
    longitude: 115.6567,
    markers: [] as any[],
    polyline: [] as any[],
    path: [] as any[],
    pathSegments: [] as any[][],
    currentSegmentIndex: 0,
    userInfo: null,
    isLoggedIn: false,
    startTime: 0,
    pauseTime: 0,
    accumulatedPauseTime: 0,
    pace: 0,
    duration: 0,
    steps: 0,
    slideOffset: 0,
    touchStartY: 0,
    formattedPace: "--'--''",
    formattedDuration: '00:00',
    showSearchModal: false,
    searchKeyword: '',
    searchResults: [],
    isSearching: false,
    hasSearched: false,
    
    stepThreshold: 10.5,
    stepBuffer: [] as number[],
    stepLastPeakTime: 0,
    stepMinPeakInterval: 200,
    stepFilteredAcceleration: 9.8,
    stepAlpha: 0.4,
    motionMode: 'unknown',
    stepFrequency: 0,
    stepCountWindow: [] as number[],
    distanceCalibration: 1.0,
    stepLength: 0.75,
    // 仅用于内部算法/调试：原始计步（加速度峰值法）
    rawSteps: 0,
    
    showTeamModal: false,
    altitude: 0,
    speed: 0,
    accuracy: 0,
    heading: 0,
    headingAccuracy: 0,
    motionState: 'stationary',
    friendsList: [],
    selectedFriends: [],
    currentTeam: null,
    isCoupleMode: false,
    hasCoupleTeam: false,
    coupleRunData: null,
    couplePartner: null,
    isGuest: false,
    
    lastGyroTime: 0,
    rotationAccumulator: 0,
    isTurning: false,
    indoorMode: false,
    sensorInitialized: false,
    lastLocationTime: 0,
    locationBuffer: [] as any[],
    maxJumpDistance: 50,
    // 定位精度阈值（米）：过小会导致大量设备无法累计距离
    minAccuracy: 50,
    isLocationStable: false,
    consecutiveGoodLocations: 0,
    runId: '',
    
    lastAccelData: { x: 0, y: 0, z: 0, magnitude: 9.8 },
    lastGyroData: { x: 0, y: 0, z: 0 },
    accelHistory: [] as number[],
    gyroHistory: [] as number[],
    stepConfidence: 0,
    lastStepConfidence: 0,
    avgStepFrequency: 0,
    realTimePace: 0,
    lapTimes: [] as number[],
    lastLapDistance: 0,
    lapDistance: 1000,
    
    // 目标计划相关
    showPlanModal: false,
    targetDistanceInput: '',
    targetDistance: 0
  },

  timer: null as any,
  locationUpdateTimer: null as any,
  locationListenerActive: false,
  locationListener: null as ((res: any) => void) | null,
  runTracker: null as RunTracker | null,
  originalStartedAt: 0,
  runOwnerOpenid: '',
  runEndedAt: 0,

  onMyAvatarError() {
    this.setData({ 'userInfo.avatarUrl': '' });
  },

  onPartnerAvatarError() {
    this.setData({ 'couplePartner.avatarUrl': '' });
  },

  onSearchAvatarError(e: any) {
    const index = e.currentTarget.dataset.index;
    if (index !== undefined) {
      this.setData({ [`searchResults[${index}].avatarUrl`]: '' });
    }
  },

  onFriendAvatarError(e: any) {
    const index = e.currentTarget.dataset.index;
    if (index !== undefined) {
      this.setData({ [`friendsList[${index}].avatarUrl`]: '' });
    }
  },

  onLoad() {
    const capsule = wx.getMenuButtonBoundingClientRect()
    this.setData({ hudTop: Math.max(64, capsule.bottom + 14) })
    this.refreshLoginStatus()
    this.restoreRunningState()
    this.setData({
      latitude: 34.4176,
      longitude: 115.6567,
      markers: [{
        id: 1,
        latitude: 34.4176,
        longitude: 115.6567,
        width: 30,
        height: 30
      }]
    })
  },

  onShow() {
    this.refreshLoginStatus()
    if (this.data.isRunning && this.runOwnerOpenid && this.runOwnerOpenid !== wx.getStorageSync('openid')) {
      if (this.teamWatcher) this.teamWatcher.close()
      this.executeStopRun(this.fusedDistanceCalculation(), true)
      return
    }
    this.setData({ pendingUploads: (wx.getStorageSync('pending_runs_' + wx.getStorageSync('openid')) || []).length })
    this.setupTeamWatcher()
    const cached = wx.getStorageSync('wechat_steps_' + wx.getStorageSync('openid'))
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
    this.setData({ weRunSteps: cached && cached.date === today ? cached.today : null,
      weRunUpdated: cached && cached.date === today ? cached.updated : '' })
  },

  async syncWeRun() {
    if (this.data.weRunSyncing) return
    if (this.data.isGuest) { this.doLogin(); return }
    const openid = wx.getStorageSync('openid')
    this.setData({ weRunSyncing: true, weRunError: '' })
    try {
      const result = await api.syncWeRun()
      if (wx.getStorageSync('openid') !== openid) return
      const updated = new Date(result.syncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      wx.setStorageSync('wechat_steps_' + openid, { ...result, updated })
      this.setData({ weRunSteps: result.today, weRunUpdated: updated })
      wx.showToast({ title: result.today === null ? '今天暂无微信运动数据' : '步数已同步到服务器', icon: 'none' })
    } catch (error: any) { this.setData({ weRunError: error.message || '同步失败，请重试' }) }
    finally { this.setData({ weRunSyncing: false }) }
  },

  openWeRunSettings() { wx.openSetting() },

  notifiedRunningTeamId: null as string | null,

  teamWatcher: null as any,

  setupTeamWatcher() {
    if (this.data.isGuest) return;
    const app = getApp();
    const openid = app.getGlobalOpenId ? app.getGlobalOpenId() : wx.getStorageSync('openid');
    if (!openid) return;

    if (this.teamWatcher) {
      this.teamWatcher.close();
    }

    this.teamWatcher = api.watchTeams({
      onChange: (snapshot: any) => {
        const teams = snapshot.docs;
        
        if (!teams || teams.length === 0) {
          if (this.data.currentTeam) {
            this.setData({ currentTeam: null, isCoupleMode: false, hasCoupleTeam: false, couplePartner: null, pendingInvite: null });
          }
          return;
        }

        // 获取时间最新的队伍
        teams.sort((a: any, b: any) => {
          const timeA = a.createTime ? new Date(a.createTime).getTime() : 0;
          const timeB = b.createTime ? new Date(b.createTime).getTime() : 0;
          return timeB - timeA;
        });

        const latestTeam = teams[0];

        if (latestTeam.status === 'cancelled') {
          if (this.data.currentTeam && (this.data.currentTeam._id === latestTeam._id || this.data.currentTeam.teamId === latestTeam._id)) {
            wx.showToast({ title: '队伍已解散/取消', icon: 'none' });
            this.setData({ currentTeam: null, isCoupleMode: false, hasCoupleTeam: false, couplePartner: null, pendingInvite: null });
          }
          if (this.data.pendingInvite && (this.data.pendingInvite._id === latestTeam._id || this.data.pendingInvite.teamId === latestTeam._id)) {
            this.setData({ pendingInvite: null });
          }
        } else if (latestTeam.status === 'rejected') {
          if (latestTeam.leaderOpenid === openid && this.data.pendingInvite && (this.data.pendingInvite._id === latestTeam._id || this.data.pendingInvite.teamId === latestTeam._id)) {
            wx.showToast({ title: '对方已拒绝邀请', icon: 'none' });
          }
          this.setData({ currentTeam: null, isCoupleMode: false, hasCoupleTeam: false, couplePartner: null, pendingInvite: null });
        } else if (latestTeam.status === 'finished') {
          if (this.data.currentTeam && (this.data.currentTeam._id === latestTeam._id || this.data.currentTeam.teamId === latestTeam._id)) {
            if (this.data.isRunning) {
              wx.showModal({
                title: '提示',
                content: '本次组队跑已完成，奖励券已经发放到每位队员的优惠券中。',
                showCancel: false,
                success: () => {
                  const fusedDistance = this.fusedDistanceCalculation();
                  this.executeStopRun(fusedDistance);
                }
              });
            } else {
              this.setData({ currentTeam: null, isCoupleMode: false, hasCoupleTeam: false, couplePartner: null, pendingInvite: null });
            }
          } else {
            // 如果是最新的队伍但已经是 finished 并且当前没在组队状态，直接清空邀请状态
            if (this.data.pendingInvite) {
              this.setData({ pendingInvite: null });
            }
          }
        } else if (latestTeam.status === 'active') {
          if (!this.data.currentTeam || this.data.currentTeam.status !== 'active' || (this.data.currentTeam._id !== latestTeam._id && this.data.currentTeam.teamId !== latestTeam._id)) {
            this.setData({ 
              currentTeam: { teamId: latestTeam._id, ...latestTeam },
              isCoupleMode: latestTeam.teamType === 'couple',
              pendingInvite: null, 
              showTeamModal: false,
              couplePartner: null // 强制重置确保 checkMyTeam 去重新抓取
            });
            this.checkMyTeam(); // 刷新详情获取伴侣头像
            wx.showToast({ title: '组队已就绪', icon: 'success' });
          } else {
            this.setData({ pendingInvite: null, showTeamModal: false });
          }

          // 检查队友是否已经开始跑步
          if (latestTeam.runningMembers && latestTeam.runningMembers.length > 0) {
            const partnerStarted = latestTeam.runningMembers.some((id: string) => id !== openid);
            if (partnerStarted && !this.data.isRunning && this.notifiedRunningTeamId !== latestTeam._id) {
              this.notifiedRunningTeamId = latestTeam._id;
              wx.showModal({
                title: '组队提示',
                content: '你的队友已经开始跑步啦！快点击开始跟上TA的步伐吧！',
                confirmText: '立即开始',
                cancelText: '稍后',
                success: (res) => {
                  if (res.confirm) {
                    this.startRun();
                  }
                }
              });
            }
          }
        } else if (latestTeam.status === 'pending') {
          if (latestTeam.invitedMember === openid && Date.now() <= latestTeam.inviteExpire) {
            if (!this.data.pendingInvite || (this.data.pendingInvite._id !== latestTeam._id && this.data.pendingInvite.teamId !== latestTeam._id)) {
              api.call({ 
                name: 'teamManager', 
                data: { action: 'getUserInfo', memberOpenid: latestTeam.leaderOpenid } 
              }).then((res: any) => {
                const inviterName = (res.result && res.result.success && res.result.data) ? res.result.data.nickName : '好友';
                this.setData({ pendingInvite: { teamId: latestTeam._id, ...latestTeam, inviterName } });
              }).catch(() => {
                this.setData({ pendingInvite: { teamId: latestTeam._id, ...latestTeam, inviterName: '好友' } });
              });
            }
          } else if (latestTeam.leaderOpenid === openid) {
            if (!this.data.currentTeam || this.data.currentTeam.status !== 'pending' || (this.data.currentTeam._id !== latestTeam._id && this.data.currentTeam.teamId !== latestTeam._id)) {
              this.setData({ 
                currentTeam: { teamId: latestTeam._id, ...latestTeam }, 
                isCoupleMode: true,
                hasCoupleTeam: false,
                pendingInvite: null,
                couplePartner: null
              });
              this.checkMyTeam(); // Fetch partner info even when pending
            }
          }
        }
      },
      onError: (err: any) => {
        console.error('team watcher error', err);
      }
    });
  },

  async manualRefreshTeam() {
    if (this.data.teamRefreshing) return
    this.setData({ teamRefreshing: true })
    const ok = await this.checkMyTeam()
    this.setupTeamWatcher()
    this.setData({ teamRefreshing: false })
    wx.showToast({ title: ok ? '状态已更新' : '刷新失败，请重试', icon: 'none' })
  },

  cancelTeam() {
    if (!this.data.currentTeam) return;
    const isPending = this.data.currentTeam.status === 'pending';
    wx.showModal({
      title: isPending ? '取消邀请' : '退出组队',
      content: isPending ? '确定要取消本次组队邀请吗？' : '确定退出当前组队吗？队长退出将解散队伍。',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' });
          api.call({
            name: 'teamManager',
            data: { action: 'leaveTeam', teamId: this.data.currentTeam.teamId || this.data.currentTeam._id },
            success: (cloudRes: any) => {
              wx.hideLoading();
              if (cloudRes.result && cloudRes.result.success) {
                this.setData({ currentTeam: null, isCoupleMode: false, hasCoupleTeam: false, couplePartner: null });
                if (this.data.isRunning) this.saveRunningState();
                wx.showToast({ title: isPending ? '已取消邀请' : '队伍已解散', icon: 'none' });
              } else {
                wx.showToast({ title: '操作失败', icon: 'none' });
              }
            },
            fail: () => {
              wx.hideLoading();
              wx.showToast({ title: '网络异常', icon: 'none' });
            }
          });
        }
      }
    });
  },

  acceptInvite() {
    const team = this.data.pendingInvite;
    if (!team) return;
    wx.showLoading({ title: '处理中...' });
    api.call({
      name: 'teamManager',
      data: { action: 'acceptCouple', teamId: team._id || team.teamId },
      success: (res: any) => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          wx.showToast({ title: '已同意，组队成功', icon: 'success' });
          this.setData({ pendingInvite: null });
          this.checkMyTeam();
        } else {
          wx.showToast({ title: (res.result && res.result.errMsg) ? res.result.errMsg : '同意失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  rejectInvite() {
    const team = this.data.pendingInvite;
    if (!team) return;
    this.setData({ pendingInvite: null });
    api.call({
      name: 'teamManager',
      data: { action: 'leaveTeam', teamId: team._id || team.teamId }
    });
  },

  checkPendingInvites() {
    // 已废弃，使用 setupTeamWatcher 替代
  },

  async checkMyTeam() {
    try {
      const response: any = await api.call({ name: 'teamManager', data: { action: 'getMyTeam' } })
      if (!response.result?.success) return false
      const team = response.result.data
      if (!team) {
        this.setData({ currentTeam: null, isCoupleMode: false, hasCoupleTeam: false, couplePartner: null })
        return true
      }
      const own = wx.getStorageSync('openid')
      const partnerId = team.teamType === 'couple' ? (team.leaderOpenid === own ? (team.members?.[0] || team.invitedMember) : team.leaderOpenid) : ''
      this.setData({ currentTeam: { teamId: team._id, ...team }, isCoupleMode: !!partnerId, hasCoupleTeam: !!partnerId,
        couplePartner: partnerId ? { openid: partnerId, nickName: '搭档', avatarUrl: '' } : null })
      if (partnerId) {
        const user: any = await api.call({ name: 'teamManager', data: { action: 'getUserInfo', memberOpenid: partnerId } })
        if (user.result?.success && this.data.currentTeam?.teamId === team._id) this.setData({ couplePartner: user.result.data })
      }
      return true
    } catch (error) { return false }
  },

  clearRunningState(keepTeam: boolean = false) {
    const app = getApp()
    if (app.globalData) {
      app.globalData.runningState = null
    }
    this.locationListenerActive = false
    if (this.locationListener) { wx.offLocationChange(this.locationListener); this.locationListener = null }
    this.runTracker = null
    wx.removeStorageSync('active_run_' + (this.runOwnerOpenid || wx.getStorageSync('openid')))
    
    const updateData: any = {
      totalMeter: 0,
      gpsDistance: 0,
      estimatedDistance: 0,
      signalGaps: 0,
      distanceSource: 'GPS 定位',
      rawSteps: 0,
      duration: 0,
      steps: 0,
      avgStepFrequency: 0,
      path: [],
      polyline: [],
      markers: [],
      lapTimes: []
    }
    
    if (!keepTeam) {
      updateData.currentTeam = null
      updateData.isCoupleMode = false
      updateData.hasCoupleTeam = false
      updateData.couplePartner = null
      updateData.pendingInvite = null
    }
    
    this.setData(updateData)
    this.lastLocation = null
    this.lastStepTime = 0
  },

  refreshLoginStatus() {
    const app = getApp()
    const isLoggedIn = app.isLoggedIn ? app.isLoggedIn() : false
    const userInfo = isLoggedIn && app.getUserInfo ? app.getUserInfo() : null
    const skipAuth = wx.getStorageSync('skipAuth')

    this.setData({
      userInfo,
      isLoggedIn,
      isGuest: !isLoggedIn || !!skipAuth
    })
  },

  getCurrentLocation() {
    wx.showLoading({ title: '定位中...', mask: true })
    
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 5000,
      altitude: true,
      success: (res) => {
        wx.hideLoading()
        this.setData({
          latitude: res.latitude,
          longitude: res.longitude,
          altitude: res.altitude || 0,
          speed: res.speed || 0,
          accuracy: res.accuracy || 0,
          markers: [{
            id: 1,
            latitude: res.latitude,
            longitude: res.longitude,
            width: 30,
            height: 30
          }]
        })
      },
      fail: (err) => {
        wx.hideLoading()
        wx.showModal({
          title: '定位失败',
          content: '无法获取您的位置，请检查定位权限设置',
          confirmText: '去设置',
          success: (modalRes) => {
            if (modalRes.confirm) {
              wx.openSetting()
            }
          }
        })
      }
    } as any)
  },

  initSensorsOnStart() {
    if (this.data.sensorInitialized) return
    
    this.setData({ sensorInitialized: true })

    wx.startAccelerometer({
      interval: 'ui',
      success: () => {
        this.setData({ sensorAvailable: true })
      },
      fail: () => this.setData({ sensorAvailable: false })
    })

    this.setupSensorListeners()
  },

  setupSensorListeners() {
    detachSensorListeners()
    const detector = new StepDetector()
    accelerometerListener = (res: any) => {
      if (!this.data.isRunning || this.data.isPaused) return
      const magnitude = Math.sqrt(res.x * res.x + res.y * res.y + res.z * res.z)
      if (detector.sample(magnitude, Date.now())) this.registerStep(Date.now(), magnitude, 1)
    }
    wx.onAccelerometerChange(accelerometerListener)
  },

  registerStep(currentTime: number, peakValue: number, confidence: number) {
    // 传感器计步独立于 GPS 距离，弱信号时才用步长估距。
    const rawSteps = (this.data.rawSteps || 0) + 1
    
    const stepCountWindow = [...this.data.stepCountWindow, currentTime]
    if (stepCountWindow.length > 20) stepCountWindow.shift()

    let avgStepFrequency = 0
    if (stepCountWindow.length >= 2) {
      const timeSpan = stepCountWindow[stepCountWindow.length - 1] - stepCountWindow[0]
      if (timeSpan > 0) {
        avgStepFrequency = ((stepCountWindow.length - 1) / (timeSpan / 1000)) * 60
      }
    }

    const motionMode = this.recognizeMotionMode(avgStepFrequency)
    const stepLength = this.calculateStepLength(motionMode, avgStepFrequency)

    this.setData({
      rawSteps: rawSteps,
      stepLastPeakTime: currentTime,
      stepPeakValue: peakValue,
      stepCountWindow: stepCountWindow,
      stepFrequency: avgStepFrequency,
      avgStepFrequency: avgStepFrequency,
      stepConfidence: confidence,
      motionMode: motionMode,
      stepLength: stepLength
    })

    if (this.data.indoorMode || this.data.accuracy > 80 ||
        (this.data.lastLocationTime ? currentTime - this.data.lastLocationTime : currentTime - this.data.startTime) > 15000) {
      const stepDist = stepLength * this.data.distanceCalibration
      const estimatedDistance = this.data.estimatedDistance + stepDist
      this.setData({ totalMeter: Math.round((this.data.gpsDistance + estimatedDistance) * 100) / 100, estimatedDistance,
        distanceSource: this.data.gpsDistance > 0 ? 'GPS + 步数估距' : '步数估距（仅个人记录）' })
      if (this.runTracker) this.runTracker.breakSegment()
      this.checkLapTime()
    }
    this.updateStepDisplay()
  },

  recognizeMotionMode(stepFrequency: number): string {
    if (stepFrequency >= 160 && stepFrequency <= 185) {
      return 'running'
    } else if (stepFrequency >= 130 && stepFrequency < 160) {
      return 'jogging'
    } else if (stepFrequency >= 100 && stepFrequency < 130) {
      return 'walking'
    } else if (stepFrequency >= 70 && stepFrequency < 100) {
      return 'slow_walking'
    }
    return this.data.motionMode || 'unknown'
  },

  calculateStepLength(motionMode: string, stepFrequency: number): number {
    let baseLength = 0.75

    switch (motionMode) {
      case 'running':
        baseLength = 1.0
        break
      case 'jogging':
        baseLength = 0.85
        break
      case 'walking':
        baseLength = 0.7
        break
      case 'slow_walking':
        baseLength = 0.5
        break
      default:
        baseLength = 0.75
    }

    if (stepFrequency > 0) {
      const frequencyFactor = Math.min(1.2, Math.max(0.8, stepFrequency / 140))
      baseLength *= frequencyFactor
    }

    return baseLength
  },

  calculatePace(): number {
    const durationMinutes = this.data.duration / 60
    const distanceKm = this.data.totalMeter / 1000
    
    if (distanceKm <= 0) return 0
    
    return durationMinutes / distanceKm
  },

  calculateRealTimePace(): number {
    const durationMinutes = this.data.duration / 60
    const distanceKm = this.data.totalMeter / 1000
    
    if (distanceKm <= 0.01) return 0
    
    return durationMinutes / distanceKm
  },

  stopSensors() {
    try {
      wx.stopAccelerometer()
      wx.stopGyroscope()
      wx.stopCompass()
      detachSensorListeners()
    } catch (e) {
      console.log('停止传感器出错:', e)
    }
    this.setData({ sensorInitialized: false })
    console.log('传感器已停止')
  },

  goToRank() {
    wx.navigateTo({ url: '/pages/rank/rank' })
  },

  goToProfile() {
    wx.redirectTo({ url: '/pages/profile/profile' })
  },

  sheetStartY: 0,
  sheetStartOffset: 0,
  sheetMaxOffset: 0,
  onReady() { this.measureSheet() },
  onResize() { this.measureSheet() },
  measureSheet() {
    wx.createSelectorQuery().select('.run-sheet').boundingClientRect().select('.sheet-grip').boundingClientRect().exec((rows: any[]) => {
      if (rows[0] && rows[1]) this.sheetMaxOffset = Math.max(0, rows[0].height - rows[1].height)
    })
  },
  toggleSheet() { this.setData({ sheetCollapsed: !this.data.sheetCollapsed, sheetDragging: false }) },
  goToPortal() { if (!this.data.isRunning) wx.redirectTo({ url: '/pages/portal/portal' }) },
  onSheetTouchStart(e: any) {
    if (!this.sheetMaxOffset || !e.touches?.length) return
    this.sheetStartY = e.touches[0].clientY
    this.sheetStartOffset = this.data.sheetCollapsed ? this.sheetMaxOffset : 0
    this.setData({ sheetDragging: true, sheetDragOffset: this.sheetStartOffset })
  },
  onSheetTouchMove(e: any) {
    if (!this.data.sheetDragging || !e.touches?.length) return
    const offset = this.sheetStartOffset + e.touches[0].clientY - this.sheetStartY
    this.setData({ sheetDragOffset: Math.max(0, Math.min(this.sheetMaxOffset, offset)) })
  },
  onSheetTouchEnd() {
    if (!this.data.sheetDragging) return
    this.setData({ sheetCollapsed: this.data.sheetDragOffset > this.sheetMaxOffset / 2, sheetDragging: false })
  },

  async startRun() {
    if (this.data.isRunning || this.data.startingRun || this.data.savingRun) return
    if (this.data.isGuest) {
      wx.showModal({
        title: '需要授权',
        content: '请先登录授权后才能开始跑步',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/login/login' })
          }
        }
      })
      return
    }

    this.setData({ startingRun: true })
    if (this.data.currentTeam && this.data.currentTeam.status === 'pending') {
      this.setData({ startingRun: false })
      wx.showToast({ title: '等待搭档接受邀请后再开跑', icon: 'none' })
      return
    }
    const team = this.data.currentTeam
    if (team && team.status === 'active') {
      try {
        const res: any = await api.call({ name: 'teamManager', data: { action: 'markRunning', teamId: team.teamId || team._id } })
        if (!res.result?.success) throw new Error(res.result?.errMsg || '队伍状态已变化')
      } catch (error: any) {
        this.setData({ startingRun: false })
        wx.showToast({ title: error.message || '组队开始失败，请重试', icon: 'none' })
        return
      }
    }
    this.clearRunningState(true)
    this.runOwnerOpenid = wx.getStorageSync('openid')

    this.setData({
      isRunning: true,
      startingRun: false,
      sheetCollapsed: true,
      sheetDragging: false,
      isPaused: false,
      totalMeter: 0,
      path: [],
      pathSegments: [[]],
      currentSegmentIndex: 0,
      polyline: [],
      startTime: Date.now(),
      accumulatedPauseTime: 0,
      pauseTime: 0,
      pace: 0,
      realTimePace: 0,
      duration: 0,
      steps: 0,
      rawSteps: 0,
      slideOffset: 0,
      formattedPace: "--'--''",
      formattedDuration: '00:00',
      stepBuffer: [],
      stepCountWindow: [],
      stepFilteredAcceleration: 9.8,
      motionMode: 'unknown',
      stepFrequency: 0,
      avgStepFrequency: 0,
      indoorMode: false,
      lastLat: null,
      lastLng: null,
      lastLocationTime: 0,
      locationBuffer: [],
      isLocationStable: false,
      consecutiveGoodLocations: 0,
      runId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
      lapTimes: [],
      lastLapDistance: 0,
      accelHistory: [],
      gyroHistory: [],
      stepConfidence: 0
    })

    this.originalStartedAt = this.data.startTime
    this.runEndedAt = 0
    this.saveRunningState()
    this.startTimer()
    this.initSensorsOnStart()
    // 尽量保持前台常亮，减少锁屏导致的定位中断/漂移（用户可自行锁屏/系统仍可能限制）
    try { wx.setKeepScreenOn({ keepScreenOn: true }) } catch (e) {}

    this.requestLocationPermission(this.data.runId)
  },

  requestLocationPermission(runId: string) {
    const alive = () => this.data.isRunning && !this.data.isPaused && this.data.runId === runId
    const start = () => { if (alive()) this.initLocation(runId) }
    const fallback = () => { if (alive()) this.handleNoLocationPermission() }
    const authorize = () => {
      wx.authorize({ scope: 'scope.userLocation', success: () => {
        if (!alive()) return
        // 等待后台授权结束，再启动定位；拒绝后台权限时仍允许前台定位。
        wx.authorize({ scope: 'scope.userLocationBackground', success: start, fail: start })
      }, fail: fallback })
    }
    wx.getSetting({ success: res => {
      if (!alive()) return
      if (res.authSetting['scope.userLocation'] !== false) { authorize(); return }
      wx.showModal({ title: '需要定位权限', content: '请允许定位以记录跑步轨迹，也可以使用仅个人记录的计步估距。',
        confirmText: '去设置', success: modal => {
          if (!alive()) return
          if (!modal.confirm) { fallback(); return }
          wx.openSetting({ success: setting => {
            if (!alive()) return
            if (setting.authSetting['scope.userLocation']) authorize()
            else fallback()
          }, fail: fallback })
        } })
    }, fail: fallback })
  },

  handleNoLocationPermission() {
    if (!this.data.isRunning || this.data.isPaused) return
    this.setData({ indoorMode: true, distanceSource: '步数估距（仅个人记录）' })
    wx.showToast({ title: '计步估距已启用，不参与排名', icon: 'none', duration: 2000 })
  },

  pauseRun() {
    if (!this.data.isRunning || this.data.savingRun) return
    this.updateRunClock()
    if (this.data.isPaused) {
      const pauseDuration = Date.now() - this.data.pauseTime
      this.setData({
        isPaused: false,
        sheetCollapsed: true,
        accumulatedPauseTime: this.data.accumulatedPauseTime + pauseDuration,
        stepCountWindow: [],
        stepLastPeakTime: 0,
        currentSegmentIndex: this.data.currentSegmentIndex + 1
      })
      
      if (!this.data.pathSegments[this.data.currentSegmentIndex]) {
        const newPathSegments = [...this.data.pathSegments]
        newPathSegments[this.data.currentSegmentIndex] = []
        this.setData({ pathSegments: newPathSegments })
      }
      
      this.requestLocationPermission(this.data.runId)
      if (!this.data.sensorInitialized) this.initSensorsOnStart()
      else this.resumeSensors()
    } else {
      this.setData({
        isPaused: true,
        sheetCollapsed: false,
        pauseTime: Date.now()
      })
      
      if (this.locationListenerActive) {
        wx.stopLocationUpdate()
        this.locationListenerActive = false
      }
      this.pauseSensors()
    }
    if (this.runTracker) this.runTracker.breakSegment()
    this.saveRunningState()
  },

  pauseSensors() {
    try {
      wx.stopAccelerometer()
      wx.stopGyroscope()
      wx.stopCompass()
    } catch (e) {
      console.log('暂停传感器出错:', e)
    }
    console.log('传感器已暂停')
  },

  resumeSensors() {
    this.setData({ sensorInitialized: false })
    this.initSensorsOnStart()
  },

  initLocation(runId: string = this.data.runId) {
    if (!this.data.isRunning || this.data.isPaused || runId !== this.data.runId) return
    wx.startLocationUpdateBackground({
      success: () => {
        if (!this.data.isRunning || this.data.isPaused) { wx.stopLocationUpdate(); return }
        if (runId !== this.data.runId) return
        this.setData({ indoorMode: false })
        this.locationListenerActive = true
        if (!this.data.isPaused) {
          wx.showToast({ title: '定位已开启', icon: 'none', duration: 1500 })
        }
        this.setupLocationListener()
      },
      fail: () => {
        if (!this.data.isRunning || this.data.isPaused || runId !== this.data.runId) return
        wx.startLocationUpdate({
          success: () => {
            if (!this.data.isRunning || this.data.isPaused) { wx.stopLocationUpdate(); return }
            if (runId !== this.data.runId) return
            this.setData({ indoorMode: false })
            this.locationListenerActive = true
            if (!this.data.isPaused) {
              wx.showToast({ title: '定位已开启', icon: 'none', duration: 1500 })
            }
            this.setupLocationListener()
          },
          fail: () => {
            this.handleNoLocationPermission()
          }
        })
      }
    })
  },

  setupLocationListener() {
    if (this.locationListener) wx.offLocationChange(this.locationListener)
    if (!this.runTracker) this.runTracker = new RunTracker((a, b) =>
      this.optimizedCalcDistance(a.latitude, a.longitude, b.latitude, b.longitude))
    this.locationListener = (res: any) => {
      if (!this.data.isRunning || this.data.isPaused || this.data.indoorMode) return
      const point = { latitude: Number(res.latitude), longitude: Number(res.longitude),
        accuracy: Number(res.accuracy), speed: Number.isFinite(res.speed) ? res.speed : -1,
        time: Date.now(), steps: this.data.rawSteps }
      const sample = this.runTracker!.sample(point)
      this.setData({ accuracy: Number.isFinite(point.accuracy) ? point.accuracy : 999,
        speed: point.speed, lastLocationTime: point.time })
      if (sample.gap) this.setData({ signalGaps: this.data.signalGaps + 1 })
      if (!sample.draw) return
      this.updateRunClock()
      const gpsDistance = Math.max(0, this.data.gpsDistance + sample.delta)
      this.setData({ gpsDistance, totalMeter: Math.round((gpsDistance + this.data.estimatedDistance) * 100) / 100,
        distanceSource: this.data.estimatedDistance > 0 ? 'GPS + 步数估距' : 'GPS 定位',
        latitude: point.latitude, longitude: point.longitude,
        markers: [{ id: 1, latitude: point.latitude, longitude: point.longitude, width: 30, height: 30 }] })
      const segments = this.data.pathSegments.map((segment: any[]) => segment.slice())
      if (!segments.length) segments.push([])
      if (sample.newSegment && segments[segments.length - 1].length) segments.push([])
      const segment = segments[segments.length - 1]
      if (sample.rollback) segment.pop()
      segment.push({ latitude: point.latitude, longitude: point.longitude })
      // 只限制地图展示点数；累计距离不受裁剪影响，也不把断段连成直线。
      while (segments.reduce((count: number, row: any[]) => count + row.length, 0) > 3000) {
        if (segments[0].length <= 1) segments.shift()
        else segments[0].shift()
      }
      this.setData({ pathSegments: segments, currentSegmentIndex: segments.length - 1,
        polyline: segments.filter((row: any[]) => row.length > 1).map((points: any[]) => ({
          points, color: '#ff78ac', width: 6, dottedLine: false })) })
      if (sample.rollback) {
        const count = Math.floor(this.data.totalMeter / this.data.lapDistance)
        this.setData({ lapTimes: this.data.lapTimes.slice(0, count), lastLapDistance: count * this.data.lapDistance })
      } else this.checkLapTime()
      this.saveRunningState()
    }
    wx.onLocationChange(this.locationListener)
  },

  checkLapTime() {
    const currentDistance = this.data.totalMeter
    const lastLap = this.data.lastLapDistance
    const lapDistance = this.data.lapDistance

    if (Math.floor(currentDistance / lapDistance) > Math.floor(lastLap / lapDistance)) {
      const lapTimes = [...this.data.lapTimes, this.data.duration]
      this.setData({ 
        lapTimes: lapTimes,
        lastLapDistance: currentDistance
      })
      console.log('完成第', lapTimes.length, '公里，用时:', this.formatDuration(this.data.duration))
    }
  },

  showPlanModal() {
    this.setData({
      showPlanModal: true,
      targetDistanceInput: this.data.targetDistance ? this.data.targetDistance.toString() : ''
    })
  },

  closePlanModal() {
    this.setData({ showPlanModal: false })
  },

  onPlanInput(e: any) {
    this.setData({ targetDistanceInput: e.detail.value })
  },

  setPlan() {
    const val = parseFloat(this.data.targetDistanceInput)
    if (isNaN(val) || val <= 0) {
      wx.showToast({ title: '请输入有效距离', icon: 'none' })
      return
    }
    this.setData({
      targetDistance: val,
      showPlanModal: false
    })
    wx.showToast({ title: '目标已设定', icon: 'success' })
  },

  stopRun() {
    const fusedDistance = this.fusedDistanceCalculation()
    if (this.data.targetDistance > 0 && fusedDistance < this.data.targetDistance * 1000) {
      wx.showModal({
        title: '目标还没完成',
        content: '现在结束也会保存本次记录。要继续跑一会儿，还是结束并保存？',
        confirmText: '结束并保存',
        cancelText: '继续跑',
        success: (res) => {
          if (res.confirm) {
            this.executeStopRun(fusedDistance)
          }
        }
      })
      return
    }
    this.executeStopRun(fusedDistance)
  },

  async executeStopRun(fusedDistance: number, silent: boolean = false) {
    if (!this.data.isRunning || this.data.savingRun) return
    this.updateRunClock()
    fusedDistance = this.fusedDistanceCalculation()
    this.runEndedAt = Date.now()
    this.saveRunningState()
    const finalSteps = this.data.steps
    const finalDuration = this.data.duration
    const finalMotionMode = this.data.motionMode
    const wasIndoorMode = this.data.indoorMode
    const finalPace = fusedDistance > 0 && finalDuration > 0
      ? (finalDuration / (fusedDistance / 1000)) / 60
      : 0

    this.setData({ isRunning: false, isPaused: false, savingRun: true, sheetCollapsed: false, sheetDragging: false })
    
    if (this.locationListenerActive) {
      wx.stopLocationUpdate()
      this.locationListenerActive = false
    }
    
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    // 结束后恢复常亮设置
    try { wx.setKeepScreenOn({ keepScreenOn: false }) } catch (e) {}
    
    this.stopSensors()
    if (this.locationListener) { wx.offLocationChange(this.locationListener); this.locationListener = null }
    
    const hasRecord = fusedDistance > 0 && finalDuration > 0
    const saved = hasRecord ? await this.saveRunData(fusedDistance) : false
    if (!hasRecord && this.data.currentTeam?.status === 'active') {
      await this.uploadRunRecord({ openid: this.runOwnerOpenid || wx.getStorageSync('openid'), runId: this.data.runId,
        teamId: this.data.currentTeam.teamId || this.data.currentTeam._id, settlementOnly: true })
    }

    this.clearRunningState()
    this.setData({ savingRun: false })

    const hours = Math.floor(finalDuration / 3600)
    const minutes = Math.floor((finalDuration % 3600) / 60)
    const seconds = finalDuration % 60
    const formattedDuration = `${hours > 0 ? hours + '小时' : ''}${minutes}分${seconds}秒`

    const formattedPace = fusedDistance > 0 ? this.formatPace(finalPace) : '--'

    const avgStepFreq = finalDuration > 0 ? Math.round(finalSteps / (finalDuration / 60)) : 0

    const modeText = finalMotionMode === 'running' ? '跑步' : 
                     finalMotionMode === 'jogging' ? '慢跑' : 
                     finalMotionMode === 'walking' ? '步行' : 
                     wasIndoorMode ? '室内运动' : '运动'

    if (!silent) {
      wx.showModal({ 
        title: '运动完成', 
        content: `距离：${fusedDistance} 米\n用时：${formattedDuration}\n配速：${formattedPace} 分钟/公里\n步数：${finalSteps} 步\n模式：${modeText}\n${saved ? '已保存到服务器' : (hasRecord ? '已暂存本机，同步未完成，请点击重试' : '距离为零或运动不足1秒，未生成记录')}`,
        showCancel: false
      })
    }
  },

  async saveRunData(fusedDistance: number) {
    const pace = fusedDistance > 0 ? this.calculatePace() : 0
    const avgStepFreq = this.data.duration > 0 ? Math.round(this.data.steps / (this.data.duration / 60)) : 0
    
    // 生成格式化的 YYYY-MM-DD
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    
    const runRecord = {
      _id: Date.now().toString(),
      runId: this.data.runId || '',
      teamId: this.data.currentTeam?.status === 'active' ? (this.data.currentTeam.teamId || this.data.currentTeam._id) : '',
      distance: fusedDistance,
      time: new Date().toLocaleString('zh-CN'),
      date: dateStr,
      openid: this.runOwnerOpenid || wx.getStorageSync('openid'),
      nickName: this.data.userInfo ? this.data.userInfo.nickName : '匿名用户',
      avatarUrl: this.data.userInfo ? this.data.userInfo.avatarUrl : '',
      pace: pace,
      duration: this.data.duration,
      steps: this.data.steps,
      stepFrequency: avgStepFreq,
      motionMode: this.data.motionMode,
      lapTimes: this.data.lapTimes,
      algorithmVersion: 2,
      startedAt: this.originalStartedAt || this.data.startTime,
      endedAt: this.runEndedAt || Date.now(),
      gpsDistance: this.data.gpsDistance,
      estimatedDistance: this.data.estimatedDistance,
      signalGaps: this.data.signalGaps,
      stepSource: this.data.sensorAvailable ? 'accelerometer' : 'unavailable'
    }

    return this.uploadRunRecord(runRecord)
  },

  async uploadRunRecord(record: any) {
    const key = 'pending_runs_' + record.openid
    const pending = wx.getStorageSync(key) || []
    if (!pending.some((row: any) => row.runId === record.runId)) pending.push(record)
    // Persist before requesting: a page close or connection loss cannot lose the record.
    wx.setStorageSync(key, pending)
    if (record.openid !== wx.getStorageSync('openid')) return false
    try {
      let res: any = record.settlementOnly ? { result: { success: true } } : await api.call({ name: 'saveRunData', data: record })
      let savedAsSolo = false
      if (res.result?.retryAsSolo) {
        savedAsSolo = true
        res = await api.call({ name: 'saveRunData', data: { ...record, teamId: '' } })
      }
      if (!res.result?.success) throw new Error(res.result?.errMsg || '记录保存失败')
      if (record.teamId && !savedAsSolo) {
        const finish: any = await api.call({ name: 'teamManager', data: { action: 'finishTeamRun', teamId: record.teamId } })
        if (!finish.result?.success) {
          const info: any = await api.call({ name: 'teamManager', data: { action: 'getTeamInfo', teamId: record.teamId } })
          if (!['cancelled', 'rejected', 'finished'].includes(info.result?.data?.status)) throw new Error('组队结算待重试')
        }
      }
      const remaining = (wx.getStorageSync(key) || []).filter((row: any) => row.runId !== record.runId)
      wx.setStorageSync(key, remaining)
      this.setData({ pendingUploads: remaining.length, pendingUploadError: '' })
      return true
    } catch (error: any) {
      this.setData({ pendingUploads: (wx.getStorageSync(key) || []).length,
        pendingUploadError: error.message || '网络异常，请重试' })
      return false
    }
  },

  async retryUploads() {
    if (this.data.savingRun || this.data.isRunning) return
    this.setData({ savingRun: true })
    const openid = wx.getStorageSync('openid')
    const records = wx.getStorageSync('pending_runs_' + openid) || []
    for (const record of records) { if (!await this.uploadRunRecord(record)) break }
    this.setData({ savingRun: false })
    wx.showToast({ title: this.data.pendingUploads ? '仍有记录未上传，请稍后重试' : '记录已同步', icon: 'none' })
  },

  lastRealtimeUpload: 0,
  uploadRealtimeData() {
    if (!this.data.isRunning) return
    if (this.runOwnerOpenid && this.runOwnerOpenid !== wx.getStorageSync('openid')) return
    
    const app = getApp()
    const openid = app.getGlobalOpenId ? app.getGlobalOpenId() : ''
    
    // 如果缓存或页面数据里没有 userInfo，我们尝试从 app.globalData 拿，尽量不上传空头像
    let finalNickName = this.data.userInfo ? this.data.userInfo.nickName : '我';
    let finalAvatarUrl = this.data.userInfo ? this.data.userInfo.avatarUrl : '';
    if (!finalAvatarUrl && app.globalData && app.globalData.userInfo) {
      finalNickName = app.globalData.userInfo.nickName || finalNickName;
      finalAvatarUrl = app.globalData.userInfo.avatarUrl || finalAvatarUrl;
    }
    
    const realtimeData = {
      openid: openid,
      distance: this.data.totalMeter,
      pace: this.calculatePace(),
      duration: this.data.duration,
      steps: this.data.steps,
      stepFrequency: this.data.avgStepFrequency,
      latitude: this.data.latitude,
      longitude: this.data.longitude,
      timestamp: Date.now(),
      nickName: finalNickName,
      avatarUrl: finalAvatarUrl
    }
    
    if (Date.now() - (this.lastRealtimeUpload || 0) >= 10000) {
      this.lastRealtimeUpload = Date.now()
      api.call({
        name: 'saveRunData',
        data: { ...realtimeData, isRealtime: true }
      })
    }
    
    if (this.data.currentTeam && (this.data.currentTeam.teamId || this.data.currentTeam._id)) {
      api.call({
        name: 'teamManager',
        data: {
          action: 'syncRealtime',
          teamId: this.data.currentTeam.teamId || this.data.currentTeam._id,
          memberOpenid: openid,
          data: realtimeData
        }
      })
    }
  },

  fetchPartnerData() {
    if (!this.data.currentTeam || (!this.data.currentTeam.teamId && !this.data.currentTeam._id)) return;
    api.call({
      name: 'teamManager',
      data: {
        action: 'getTeamRealtimeData',
        teamId: this.data.currentTeam.teamId || this.data.currentTeam._id
      },
      success: (res: any) => {
        if (res.result && res.result.success && res.result.data) {
          const partnerOpenid = this.data.couplePartner ? this.data.couplePartner.openid : null;
          if (partnerOpenid && res.result.data[partnerOpenid]) {
            const pData = res.result.data[partnerOpenid];
            this.setData({
              'couplePartner.distance': pData.distance || 0,
              'couplePartner.pace': pData.pace || 0
            });
            // 补充：如果在跑步过程中通过同步拿到了对方传上来的头像，且本地没有头像，则自动更新
            if (pData.avatarUrl && (!this.data.couplePartner.avatarUrl || this.data.couplePartner.avatarUrl.indexOf('default-avatar') !== -1)) {
              this.setData({
                'couplePartner.avatarUrl': pData.avatarUrl,
                'couplePartner.nickName': pData.nickName || this.data.couplePartner.nickName
              });
            }
          }
        }
      }
    });
  },

  async doLogin() {
    wx.navigateTo({
      url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent('/pages/index/index')
    })
  },

  formatPace(pace: number): string {
    if (!pace || pace <= 0 || !isFinite(pace)) return "--'--''"
    const minutes = Math.floor(pace)
    const seconds = Math.floor((pace - minutes) * 60)
    return `${minutes.toString().padStart(2, '0')}'${seconds.toString().padStart(2, '0')}''`
  },

  formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  },

  optimizedCalcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6378137
    const radLat1 = lat1 * Math.PI / 180
    const radLat2 = lat2 * Math.PI / 180
    const a = radLat1 - radLat2
    const b = (lng1 - lng2) * Math.PI / 180
    const s = 2 * R * Math.asin(
      Math.sqrt(
        Math.pow(Math.sin(a/2), 2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b/2), 2)
      )
    )
    return s
  },

  updateStepDisplay() {
    const steps = this.data.rawSteps || 0
    this.setData({ steps, avgStepFrequency: this.data.duration > 0 ? Math.round(steps * 60 / this.data.duration) : 0 })
  },

  fusedDistanceCalculation(): number {
    // totalMeter already selects GPS or weak-signal/indoor steps. Never estimate twice.
    return Math.round(this.data.totalMeter)
  },

  showSearch() {
    this.setData({ showSearchModal: true, searchKeyword: '', searchResults: [] })
  },
  
  closeSearch() {
    this.setData({ showSearchModal: false })
  },
  
  onSearchInput(e: any) {
    this.setData({ searchKeyword: e.detail.value })
  },
  
  searchFriends() {
    const keyword = this.data.searchKeyword.trim()
    if (!keyword) {
      wx.showToast({ title: '请输入搜索关键词', icon: 'none' })
      return
    }
    
    this.setData({ isSearching: true, searchResults: [] })
    
    api.call({
      name: 'getFriends',
      data: { action: 'search', keyword },
      success: (res: any) => {
        this.setData({ 
          searchResults: res.result || [],
          isSearching: false,
          hasSearched: true
        })
      },
      fail: () => {
        this.setData({ isSearching: false, hasSearched: true })
        wx.showToast({ title: '搜索失败', icon: 'none' })
      }
    })
  },
  
  addFriend(e: any) {
    const friendOpenid = e.currentTarget.dataset.openid
    if (e.currentTarget.dataset.isFriend) {
      wx.showToast({ title: '已经是好友了', icon: 'none' })
      return
    }
    const app = getApp()
    const currentOpenid = app.getGlobalOpenId ? app.getGlobalOpenId() : ''
    
    if (friendOpenid === currentOpenid) {
      wx.showToast({ title: '不能添加自己', icon: 'none' })
      return
    }
    
    api.call({
      name: 'getFriends',
      data: { action: 'add', friendOpenid },
      success: (res: any) => {
        const result = res.result || {}
        wx.showToast({
          title: result.success ? '添加成功' : (result.errMsg || '添加失败'),
          icon: result.success ? 'success' : 'none'
        })
        if (result.success) this.searchFriends()
      },
      fail: () => {
        wx.showToast({ title: '添加失败', icon: 'none' })
      }
    })
  },
  
  toggleMode() {
    if (this.data.isCoupleMode) {
      this.setData({ isCoupleMode: false })
      wx.showToast({ title: '已切换为单人模式', icon: 'none' })
    } else {
      if (this.data.hasCoupleTeam) {
        this.setData({ isCoupleMode: true })
        wx.showToast({ title: '已切换为情侣模式', icon: 'none' })
      } else {
        this.showTeamModal()
      }
    }
  },

  showTeamModal() {
    this.setData({ showTeamModal: true, selectedFriends: [] })
    this.loadFriendsList()
  },
  
  closeTeamModal() {
    this.setData({ showTeamModal: false, selectedFriends: [] })
  },
  
  loadFriendsList() {
    api.call({
      name: 'getFriends',
      data: { action: 'list' },
      success: (res: any) => {
        const friendsList = (res.result || []).map((friend: any) => ({
          ...friend,
          selected: false
        }))
        this.setData({ friendsList })
      },
      fail: () => {
        wx.showToast({ title: '获取好友列表失败', icon: 'none' })
      }
    })
  },
  
  toggleFriendSelection(e: any) {
    const openid = e.currentTarget.dataset.openid
    if (!openid) return
    
    const isSelected = this.data.selectedFriends.includes(openid)
    let selectedFriends = [...this.data.selectedFriends]
    if (isSelected) {
      selectedFriends = selectedFriends.filter((id: string) => id !== openid)
    } else {
      if (selectedFriends.length >= 1) {
        wx.showToast({ title: '这里每次邀请1位搭档；三人队请用邀请码加入', icon: 'none' })
        return
      }
      selectedFriends.push(openid)
    }
    const friendsList = this.data.friendsList.map((friend: any) => ({
      ...friend,
      selected: selectedFriends.includes(friend.openid)
    }))
    this.setData({
      selectedFriends,
      friendsList
    })
  },
  
  createTeam() {
    if (this.data.selectedFriends.length === 0) {
      wx.showToast({ title: '请选择好友', icon: 'none' })
      return
    }
    
    wx.showLoading({ title: '处理中...', mask: true });
    
    api.call({
      name: 'teamManager',
      data: {
        action: 'inviteCouple',
        members: this.data.selectedFriends,
        teamType: 'couple'
      },
      success: (res: any) => {
        wx.hideLoading();
        const result = res.result;
        
        if (!result.success) {
          wx.showToast({ title: result.errMsg || '组队失败', icon: 'none' });
          return;
        }

        wx.showModal({
          title: '邀请已发送',
          content: '已通知对方，限时5分钟内同意有效。对方同意后自动生效。',
          showCancel: false,
          success: () => {
            this.setData({ showTeamModal: false });
          }
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络错误，组队失败', icon: 'none' })
      }
    })
  },

  onUnload() {
    if (this.data.isRunning) {
      // 页面销毁时不能再弹确认框，直接安全结束并保存，避免定位和传感器残留。
      this.executeStopRun(this.fusedDistanceCalculation(), true)
    }
    if (this.teamWatcher) {
      this.teamWatcher.close();
    }
  },

  onHide() {
    if (this.data.isRunning) this.saveRunningState()
  },

  updateRunClock() {
    if (!this.data.startTime) return
    const duration = activeSeconds(this.data.startTime, this.data.accumulatedPauseTime,
      this.data.isPaused ? this.data.pauseTime : 0, Date.now())
    this.setData({ duration, formattedDuration: this.formatDuration(duration) })
  },

  saveRunningState() {
    if (!this.data.isRunning) return
    this.updateRunClock()
    const fields = ['runId', 'duration', 'totalMeter', 'gpsDistance', 'estimatedDistance', 'signalGaps',
      'steps', 'rawSteps', 'sensorAvailable', 'pathSegments', 'polyline', 'currentSegmentIndex',
      'motionMode', 'stepLength', 'avgStepFrequency', 'lapTimes', 'lastLapDistance', 'targetDistance',
      'currentTeam', 'isCoupleMode', 'couplePartner', 'distanceSource', 'latitude', 'longitude']
    const state: any = { version: 2, savedAt: Date.now(), startedAt: this.originalStartedAt || this.data.startTime }
    fields.forEach((name: string) => { state[name] = (this.data as any)[name] })
    wx.setStorageSync('active_run_' + (this.runOwnerOpenid || wx.getStorageSync('openid')), state)
  },

  restoreRunningState() {
    const key = 'active_run_' + wx.getStorageSync('openid')
    const state = wx.getStorageSync(key)
    if (!state || state.version !== 2 || !state.runId || !this.data.isLoggedIn) return
    // 已提交到待上传队列的结束记录不能再恢复成第二次运动。
    const pending = wx.getStorageSync('pending_runs_' + wx.getStorageSync('openid')) || []
    if (pending.some((row: any) => row.runId === state.runId)) { wx.removeStorageSync(key); return }
    const { version, savedAt, startedAt, ...values } = state
    if (!Number.isFinite(values.duration) || !Number.isFinite(values.totalMeter)) return
    this.originalStartedAt = startedAt
    this.runOwnerOpenid = wx.getStorageSync('openid')
    this.setData({ ...values, isRunning: true, isPaused: true, sheetCollapsed: false,
      startTime: Date.now() - values.duration * 1000, pauseTime: Date.now(), accumulatedPauseTime: 0,
      signalGaps: (values.signalGaps || 0) + 1, formattedDuration: this.formatDuration(values.duration) })
    this.startTimer()
    wx.showToast({ title: '已恢复未结束运动，请继续或保存', icon: 'none', duration: 2500 })
  },

  startTimer() {
    if (this.timer) {
      clearInterval(this.timer)
    }
    
    this.timer = setInterval(() => {
      if (this.data.isRunning && !this.data.isPaused) {
        const duration = Math.floor((Date.now() - this.data.startTime - this.data.accumulatedPauseTime) / 1000)
        this.setData({ duration })

        const formattedDuration = this.formatDuration(duration)
        this.setData({ formattedDuration })

        if (this.data.totalMeter > 100) {
          const pace = this.calculatePace()
          this.setData({ pace, realTimePace: pace })
          const formattedPace = this.formatPace(pace)
          this.setData({ formattedPace })
        }

        if (duration % 3 === 0) {
          this.uploadRealtimeData()
          if (this.data.isCoupleMode && this.data.couplePartner) {
            this.fetchPartnerData()
          }
        }
        if (duration % 10 === 0) {
          this.saveRunningState()
        }
      }
    }, 1000)
  }
})
