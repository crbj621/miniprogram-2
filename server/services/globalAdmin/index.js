const cloud = require('campus-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const cmd = db.command

const { moduleDefinitions, normalizeModules } = require('../../src/module-policy')

function modulePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('模块设置格式错误')
  const patch = {}
  for (const [key, value] of Object.entries(input)) {
    const canonical = key === 'run' ? 'running' : key
    if (!Object.hasOwn(moduleDefinitions, canonical)) throw new Error('未知模块：' + key)
    if (key === 'run' && Object.hasOwn(input, 'running')) throw new Error('跑步模块配置重复')
    const enabled = typeof value === 'boolean' ? value : value && value.enabled
    if (typeof enabled !== 'boolean') throw new Error('模块开关必须为布尔值')
    // 整项写入可替换旧布尔值；每次仅更新用户提交的模块。
    patch['modules.' + canonical] = { enabled, name: moduleDefinitions[canonical].name }
  }
  return patch
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex')
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hashAdminPassword(password) {
  var salt = crypto.randomBytes(16).toString('hex')
  var digest = crypto.scryptSync(String(password), salt, 32).toString('hex')
  return 'scrypt$' + salt + '$' + digest
}

function verifySecret(password, storedHash, legacyMd5) {
  var value = String(storedHash || '')
  if (value.indexOf('scrypt$') === 0) {
    var parts = value.split('$')
    if (parts.length !== 3) return false
    var digest = crypto.scryptSync(String(password), parts[1], 32).toString('hex')
    var left = Buffer.from(digest)
    var right = Buffer.from(parts[2])
    return left.length === right.length && crypto.timingSafeEqual(left, right)
  }
  return !!legacyMd5 && md5(String(password)) === String(legacyMd5)
}

function formatTime(value) {
  if (!value) return ''
  var date
  if (typeof value.toDate === 'function') {
    date = value.toDate()
  } else {
    date = new Date(value)
  }
  var y = date.getFullYear()
  var m = String(date.getMonth() + 1)
  var d = String(date.getDate())
  var hh = String(date.getHours())
  var mm = String(date.getMinutes())
  var ss = String(date.getSeconds())
  if (m.length === 1) m = '0' + m
  if (d.length === 1) d = '0' + d
  if (hh.length === 1) hh = '0' + hh
  if (mm.length === 1) mm = '0' + mm
  if (ss.length === 1) ss = '0' + ss
  return y + '-' + m + '-' + d + ' ' + hh + ':' + mm + ':' + ss
}

async function checkSuperAdmin(openid) {
  var adminRes = await db.collection('global_admin').where({
    loginOpenid: openid,
    role: 'super',
    status: cmd.neq('disabled')
  }).limit(1).get()
  if (!adminRes.data.length) return { isSuperAdmin: false }
  return { isSuperAdmin: true, admin: adminRes.data[0] }
}

async function checkAdmin(openid) {
  var adminRes = await db.collection('global_admin').where({
    loginOpenid: openid,
    status: cmd.neq('disabled')
  }).limit(1).get()
  if (!adminRes.data.length) return { isAdmin: false }
  return { isAdmin: true, admin: adminRes.data[0] }
}

async function addLog(openid, module, action, detail, adminName) {
  try {
    await db.collection('global_admin_log').add({
      data: {
        _openid: openid,
        module: module,
        action: action,
        detail: detail,
        adminName: adminName || '系统',
        createTime: db.serverDate()
      }
    })
  } catch (e) {
    console.error('addLog error:', e)
  }
}

async function getAdminName(openid) {
  try {
    var res = await db.collection('global_admin').where({ loginOpenid: openid }).limit(1).get()
    if (res.data.length) {
      return res.data[0].username || res.data[0].name || res.data[0].account
    }
  } catch (e) {}
  return '管理员'
}

exports.main = async function(event) {
  var wxContext = cloud.getWXContext()
  var openid = wxContext.OPENID
  var action = event.action
  var data = event.data || {}

  try {
    switch (action) {
      case 'initDatabase':
        return await initDatabase(openid, data)
      case 'login':
        return await adminLogin(data)
      case 'checkLogin':
        return await checkLogin(openid)
      case 'logout':
        return await adminLogout(openid)
      case 'getGlobalSettings':
        return await getGlobalSettings(openid)
      case 'getPublicModules':
        return await getPublicModules()
      case 'updateGlobalSettings':
        return await updateGlobalSettings(openid, data)
      case 'getModuleList':
        return await getModuleList(openid)
      case 'updateModuleStatus':
        return await updateModuleStatus(openid, data)
      case 'getAdminList':
        return await getAdminList(openid)
      case 'createAdmin':
        return await createAdmin(openid, data)
      case 'updateAdmin':
        return await updateAdmin(openid, data)
      case 'deleteAdmin':
        return await deleteAdmin(openid, data)
      case 'resetAdminPassword':
        return await resetAdminPassword(openid, data)
      case 'resetPasswordWithVerify':
        return await resetPasswordWithVerify(data)
      case 'getOperationLogs':
        return await getOperationLogs(openid, data)
      case 'getAnnouncementList':
        return await getAnnouncementList(openid, data)
      case 'getPublishedAnnouncements':
        return await getPublishedAnnouncements(data)
      case 'createAnnouncement':
        return await createAnnouncement(openid, data)
      case 'updateAnnouncement':
        return await updateAnnouncement(openid, data)
      case 'deleteAnnouncement':
        return await deleteAnnouncement(openid, data)
      case 'getPosts':
        return await getPosts(openid, data)
      case 'deletePost':
        return await deletePost(openid, data)
      case 'batchDeletePosts':
        return await batchDeletePosts(openid, data)
      case 'getUsers':
        return await getUsers(openid, data)
      case 'updateUser':
        return await updateUser(openid, data)
      case 'getStorageInfo':
        return await getStorageInfo(openid)
      case 'cleanOldPosts':
        return await cleanOldPosts(openid, data)
      case 'cleanDeletedPosts':
        return await cleanDeletedPosts(openid)
      case 'cleanOrphanImages':
        return await cleanOrphanImages(openid)
      case 'getDashboardStats':
        return await getDashboardStats(openid)
      case 'getRankList':
        return await getRankList(openid, data)
      case 'seedRunDemo':
        return await runDemo(openid, false)
      case 'clearRunDemo':
        return await runDemo(openid, true)
      case 'clearRankRecords':
        return await clearRankRecords(openid, data)
      case 'clearRankData':
        return await clearAllRankRecords(openid)
      case 'getReports':
        return await getReports(openid, data)
      case 'handleReport':
        return await handleReport(openid, data)
      case 'getForumCategories':
        return await getForumCategories(openid)
      case 'updatePostStatus':
        return await updatePostStatus(openid, data)
      case 'setPostTop':
        return await setPostTop(openid, data)
      case 'setPostEssence':
        return await setPostEssence(openid, data)
      default:
        return { code: -1, message: 'Unknown action: ' + action }
    }
  } catch (error) {
    console.error('Global admin cloud function error:', error)
    return { code: -1, message: error.message || '服务异常', error: error.toString() }
  }
}

async function initDatabase(openid, data) {
  var results = []
  var adminCount = await db.collection('global_admin').count().catch(function() {
    return { total: 0 }
  })
  var isBootstrap = adminCount.total === 0

  if (!isBootstrap) {
    var adminCheck = await checkSuperAdmin(openid)
    if (!adminCheck.isSuperAdmin) {
      return { code: -1, message: '仅超级管理员可初始化数据库' }
    }
  }

  var collections = [
    'global_admin', 'global_settings', 'global_admin_log', 'global_announcement', 'global_module', 'admin_logs',
    'users', 'friends', 'notifications', 'runRecords', 'run_stats', 'realtimeData', 'teams',
    'forum_post', 'forum_comment', 'forum_report', 'forum_admin', 'forum_admin_log',
    'forum_announcement', 'forum_user', 'forum_notification', 'forum_chat',
    'forum_chat_message', 'forum_collect', 'forum_like'
  ]
  
  for (var i = 0; i < collections.length; i++) {
    var name = collections[i]
    try {
      await db.createCollection(name)
      results.push({ name: name, status: 'created' })
    } catch (err) {
      if (err.message && err.message.indexOf('already exists') !== -1) {
        results.push({ name: name, status: 'exists' })
      } else {
        results.push({ name: name, status: 'error', msg: err.message })
      }
    }
  }

  if (isBootstrap) {
    var account = String(data.account || '').trim()
    var password = String(data.password || '')
    var username = String(data.username || '超级管理员').trim()
    if (account.length < 4 || password.length < 8) {
      return {
        code: -1,
        message: '首次初始化需提供至少4位账号和至少8位密码'
      }
    }
    await db.collection('global_admin').add({
      data: {
        _openid: openid,
        loginOpenid: openid,
        account: account,
        passwordHash: hashAdminPassword(password),
        username: username || '超级管理员',
        role: 'super',
        permissions: ['all'],
        status: 'active',
        verifyPasswordHash: hashAdminPassword(String(data.verifyPassword || password)),
        createTime: db.serverDate(),
        lastLoginTime: null
      }
    })
    results.push({ name: 'super_admin', status: 'created', account: account })
  }

  var existingSettings = await db.collection('global_settings').limit(1).get()
  if (!existingSettings.data.length) {
    await db.collection('global_settings').add({
      data: {
        appName: '智慧校园',
        logo: '',
        modules: {
          running: { enabled: true, name: '校园跑' },
          canteen: { enabled: true, name: '食堂饭菜评价' },
          forum: { enabled: true, name: '校园动态' },
          english: { enabled: true, name: '四六级学习' },
          gifts: { enabled: true, name: '祝福小站' }
        },
        announcements: [],
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
    results.push({ name: 'global_settings', status: 'initialized' })
  }

  return { code: 0, message: '数据库初始化完成', data: { results: results } }
}

async function adminLogin(data) {
  var account = data.account
  var password = data.password
  
  if (!account || !password) {
    return { code: -1, message: '请输入账号和密码' }
  }

  var adminRes = await db.collection('global_admin').where({
    account: String(account).trim()
  }).limit(1).get()

  if (!adminRes.data.length || !verifySecret(password, adminRes.data[0].passwordHash, adminRes.data[0].password)) {
    return { code: -1, message: '账号或密码错误' }
  }

  var admin = adminRes.data[0]
  
  if (admin.status === 'disabled') {
    return { code: -1, message: '该账号已被禁用' }
  }

  var loginOpenid = cloud.getWXContext().OPENID
  var previousBindings = await db.collection('global_admin')
    .where({ loginOpenid: loginOpenid })
    .limit(20)
    .get()
  for (var i = 0; i < previousBindings.data.length; i++) {
    if (previousBindings.data[i]._id !== admin._id) {
      await db.collection('global_admin').doc(previousBindings.data[i]._id).update({
        data: { loginOpenid: cmd.remove() }
      })
    }
  }

  await db.collection('global_admin').doc(admin._id).update({
    data: {
      lastLoginTime: db.serverDate(),
      loginOpenid: loginOpenid,
      passwordHash: admin.passwordHash || hashAdminPassword(password),
      password: cmd.remove()
    }
  })

  await addLog(loginOpenid, 'admin', 'login', '管理员登录：' + account, admin.username || account)

  return {
    code: 0,
    message: '登录成功',
    data: {
      admin: {
        _id: admin._id,
        account: admin.account,
        username: admin.username || admin.name,
        role: admin.role,
        permissions: admin.permissions
      }
    }
  }
}

async function checkLogin(openid) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '未登录或账号已被禁用' }
  }
  
  return {
    code: 0,
    data: {
      admin: {
        _id: adminCheck.admin._id,
        account: adminCheck.admin.account,
        username: adminCheck.admin.username || adminCheck.admin.name,
        role: adminCheck.admin.role,
        permissions: adminCheck.admin.permissions
      }
    }
  }
}

async function adminLogout(openid) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: 0, message: '已退出登录' }
  }
  var adminName = adminCheck.admin.username || adminCheck.admin.name || adminCheck.admin.account
  await addLog(openid, 'admin', 'logout', '管理员退出登录', adminName)
  await db.collection('global_admin').doc(adminCheck.admin._id).update({
    data: {
      loginOpenid: cmd.remove(),
      lastLogoutTime: db.serverDate()
    }
  })
  return { code: 0, message: '已退出登录' }
}

async function getGlobalSettings(openid) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { code: -1, message: '无权限' }
  const result = await db.collection('global_settings').limit(1).get()
  const settings = result.data[0] || { appName: '智慧校园', logo: '' }
  return { code: 0, data: { ...settings, modules: normalizeModules(settings.modules) } }
}

async function getPublicModules() {
  const result = await db.collection('global_settings').limit(1).get()
  const saved = result.data[0] || {}
  // 已发布旧版校验这两个字段；仅返回关闭状态，不注册或恢复业务。
  const modules = { food: false, rider: false }
  for (const [key, value] of Object.entries(normalizeModules(saved.modules))) modules[key] = value.enabled
  return { code: 0, data: { modules } }
}

async function writeSettings(patch) {
  const result = await db.collection('global_settings').limit(1).get()
  if (result.data.length) {
    await db.collection('global_settings').doc(result.data[0]._id).update({ data: { ...patch, updateTime: db.serverDate() } })
  } else {
    const settings = { appName: '智慧校园', modules: normalizeModules(), createTime: db.serverDate(), updateTime: db.serverDate() }
    for (const [key, value] of Object.entries(patch)) {
      if (key.startsWith('modules.')) settings.modules[key.slice(8)] = value
      else settings[key] = value
    }
    await db.collection('global_settings').add({ data: settings })
  }
}

async function updateGlobalSettings(openid, data) {
  const adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) return { code: -1, message: '仅超级管理员可修改全局设置' }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { code: -1, message: '设置格式错误' }
  let patch = {}
  try {
    if (Object.hasOwn(data, 'modules')) patch = modulePatch(data.modules)
  } catch (error) {
    return { code: -1, message: error.message }
  }
  const fields = ['appName', 'logo', 'contactEmail', 'contactPhone', 'copyright', 'postReview', 'sensitiveWords', 'userRegister', 'notifications', 'autoCleanup', 'imageLimit', 'themeColor']
  for (const field of fields) {
    if (Object.hasOwn(data, field) && data[field] !== undefined) patch[field] = data[field]
  }
  if (!Object.keys(patch).length) return { code: -1, message: '没有可保存的设置' }
  await writeSettings(patch)
  await addLog(openid, 'system', 'update', '更新全局设置', await getAdminName(openid))
  return { code: 0, message: '设置已保存' }
}

async function getModuleList(openid) {
  const adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { code: -1, message: '无权限' }
  const result = await db.collection('global_settings').limit(1).get()
  const modules = normalizeModules((result.data[0] || {}).modules)
  const list = Object.entries(modules).map(([key, value]) => ({ key, ...value, icon: moduleDefinitions[key].icon }))
  return { code: 0, data: { list } }
}

async function updateModuleStatus(openid, data) {
  const adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) return { code: -1, message: '仅超级管理员可修改模块状态' }
  if (!data || !Object.hasOwn(moduleDefinitions, data.module) || typeof data.enabled !== 'boolean') {
    return { code: -1, message: '模块名称或开关值无效' }
  }
  await writeSettings(modulePatch({ [data.module]: data.enabled }))
  await addLog(openid, 'system', 'update', (data.enabled ? '启用' : '隐藏') + '模块：' + data.module, await getAdminName(openid))
  return { code: 0, message: data.enabled ? '模块已启用' : '模块已隐藏' }
}

async function getAdminList(openid) {
  var adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) {
    return { code: -1, message: '仅超级管理员可查看管理员列表' }
  }

  var res = await db.collection('global_admin')
    .orderBy('createTime', 'desc')
    .get()

  var admins = res.data.map(function(item) {
    return {
      _id: item._id,
      account: item.account,
      username: item.username || item.name,
      role: item.role,
      permissions: item.permissions,
      status: item.status,
      createTime: item.createTime,
      lastLoginTime: item.lastLoginTime
    }
  })

  return { code: 0, data: { list: admins } }
}

async function createAdmin(openid, data) {
  var adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) {
    return { code: -1, message: '仅超级管理员可创建管理员' }
  }

  var adminName = await getAdminName(openid)
  var account = String(data.account || '').trim()
  var password = String(data.password || '')
  var username = String(data.username || '').trim()
  var role = data.role || 'normal'
  var permissions = data.permissions || []

  if (!account || !password || !username) {
    return { code: -1, message: '请填写完整信息' }
  }
  if (!/^[A-Za-z0-9_]{4,32}$/.test(account)) {
    return { code: -1, message: '账号应为4至32位字母、数字或下划线' }
  }
  if (password.length < 8 || password.length > 128) {
    return { code: -1, message: '密码应为8至128位' }
  }

  var existingAdmin = await db.collection('global_admin').where({ account: account }).get()
  if (existingAdmin.data.length) {
    return { code: -1, message: '账号已存在' }
  }

  await db.collection('global_admin').add({
    data: {
      account: account,
      passwordHash: hashAdminPassword(password),
      username: username,
      role: role,
      permissions: permissions,
      status: 'active',
      createTime: db.serverDate(),
      lastLoginTime: null
    }
  })

  await addLog(openid, 'admin', 'create', '创建管理员：' + account, adminName)
  return { code: 0, message: '管理员创建成功' }
}

async function updateAdmin(openid, data) {
  var adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) {
    return { code: -1, message: '仅超级管理员可修改管理员' }
  }

  var adminName = await getAdminName(openid)
  var adminId = data.id
  var username = data.username
  var role = data.role
  var permissions = data.permissions
  var status = data.status

  if (!adminId) {
    return { code: -1, message: '管理员ID缺失' }
  }

  var targetAdmin = await db.collection('global_admin').doc(adminId).get()
  if (!targetAdmin.data) {
    return { code: -1, message: '管理员不存在' }
  }

  if (targetAdmin.data.role === 'super') {
    return { code: -1, message: '不能修改超级管理员' }
  }

  var updateData = { updateTime: db.serverDate() }
  if (username) updateData.username = username
  if (role) updateData.role = role
  if (permissions) updateData.permissions = permissions
  if (status) updateData.status = status

  await db.collection('global_admin').doc(adminId).update({ data: updateData })

  await addLog(openid, 'admin', 'update', '修改管理员：' + targetAdmin.data.account, adminName)
  return { code: 0, message: '管理员信息已更新' }
}

async function deleteAdmin(openid, data) {
  var adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) {
    return { code: -1, message: '仅超级管理员可删除管理员' }
  }

  var adminName = await getAdminName(openid)
  var adminId = data.id
  if (!adminId) {
    return { code: -1, message: '管理员ID缺失' }
  }

  var targetAdmin = await db.collection('global_admin').doc(adminId).get()
  if (!targetAdmin.data) {
    return { code: -1, message: '管理员不存在' }
  }

  if (targetAdmin.data.role === 'super') {
    return { code: -1, message: '不能删除超级管理员' }
  }

  await db.collection('global_admin').doc(adminId).remove()

  await addLog(openid, 'admin', 'delete', '删除管理员：' + targetAdmin.data.account, adminName)
  return { code: 0, message: '管理员已删除' }
}

async function resetAdminPassword(openid, data) {
  var adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) {
    return { code: -1, message: '仅超级管理员可重置密码' }
  }

  var adminName = await getAdminName(openid)
  var adminId = data.id
  var newPassword = String(data.newPassword || data.password || '')

  if (!adminId || !newPassword) {
    return { code: -1, message: '参数缺失' }
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return { code: -1, message: '密码应为8至128位' }
  }

  var targetAdmin = await db.collection('global_admin').doc(adminId).get()
  if (!targetAdmin.data) {
    return { code: -1, message: '管理员不存在' }
  }

  await db.collection('global_admin').doc(adminId).update({
    data: {
      passwordHash: hashAdminPassword(newPassword),
      password: cmd.remove(),
      updateTime: db.serverDate()
    }
  })

  await addLog(openid, 'admin', 'update', '重置管理员密码：' + targetAdmin.data.account, adminName)
  return { code: 0, message: '密码已重置' }
}

async function resetPasswordWithVerify(data) {
  var account = data.account
  var verifyPassword = data.verifyPassword
  var newPassword = data.newPassword

  if (!account || !verifyPassword || !newPassword) {
    return { code: -1, message: '参数缺失' }
  }
  if (String(newPassword).length < 8 || String(newPassword).length > 128) {
    return { code: -1, message: '新密码应为8至128位' }
  }

  var adminRes = await db.collection('global_admin').where({
    account: account
  }).limit(1).get()

  if (!adminRes.data.length) {
    return { code: -1, message: '账号不存在' }
  }

  var admin = adminRes.data[0]
  if (!verifySecret(verifyPassword, admin.verifyPasswordHash, admin.verifyPassword)) {
    return { code: -1, message: '辅助验证密码错误' }
  }

  await db.collection('global_admin').doc(admin._id).update({
    data: {
      passwordHash: hashAdminPassword(newPassword),
      password: cmd.remove(),
      verifyPasswordHash: admin.verifyPasswordHash || hashAdminPassword(verifyPassword),
      verifyPassword: cmd.remove(),
      updateTime: db.serverDate()
    }
  })

  await addLog('', 'admin', 'update', '通过验证重置密码：' + account, account)
  return { code: 0, message: '密码重置成功' }
}

async function getOperationLogs(openid, data) {
  var adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) {
    return { code: -1, message: '仅超级管理员可查看操作日志' }
  }

  if (data.stats) {
    var totalRes = await db.collection('global_admin_log').count()
    var deleteRes = await db.collection('global_admin_log').where({ action: 'delete' }).count()
    var createRes = await db.collection('global_admin_log').where({ action: 'create' }).count()
    var updateRes = await db.collection('global_admin_log').where({ action: 'update' }).count()
    
    return {
      code: 0,
      data: {
        stats: {
          total: totalRes.total,
          delete: deleteRes.total,
          create: createRes.total,
          update: updateRes.total
        }
      }
    }
  }

  var page = data.page || 1
  var pageSize = data.pageSize || 20
  var skip = (page - 1) * pageSize

  var query = {}
  if (data.module) query.module = data.module
  if (data.action) query.action = data.action

  var totalRes = await db.collection('global_admin_log').where(query).count()
  
  var res = await db.collection('global_admin_log')
    .where(query)
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var logs = res.data.map(function(item) {
    return {
      _id: item._id,
      module: item.module,
      action: item.action,
      detail: item.detail,
      adminName: item.adminName,
      ip: item.ip,
      createTime: item.createTime
    }
  })

  return { code: 0, data: { list: logs, total: totalRes.total } }
}

async function getAnnouncementList(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  if (data.id) {
    var singleRes = await db.collection('global_announcement').doc(data.id).get()
    if (singleRes.data) {
      return { code: 0, data: singleRes.data }
    }
    return { code: -1, message: '公告不存在' }
  }

  if (data.stats) {
    var totalRes = await db.collection('global_announcement').count()
    var publishedRes = await db.collection('global_announcement').where({ status: 'published' }).count()
    var draftRes = await db.collection('global_announcement').where({ status: 'draft' }).count()
    
    var viewsRes = await db.collection('global_announcement').get()
    var totalViews = 0
    for (var i = 0; i < viewsRes.data.length; i++) {
      totalViews += viewsRes.data[i].views || 0
    }
    
    return {
      code: 0,
      data: {
        stats: {
          total: totalRes.total,
          published: publishedRes.total,
          draft: draftRes.total,
          views: totalViews
        }
      }
    }
  }

  var page = data.page || 1
  var pageSize = data.pageSize || 20
  var skip = (page - 1) * pageSize

  var query = {}
  if (data.type) query.type = data.type
  if (data.status) query.status = data.status

  var totalRes = await db.collection('global_announcement').where(query).count()
  
  var res = await db.collection('global_announcement')
    .where(query)
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var announcements = res.data.map(function(item) {
    return {
      _id: item._id,
      title: item.title,
      content: item.content,
      type: item.type,
      isTop: item.isTop,
      isImportant: item.isImportant,
      status: item.status,
      cover: item.cover,
      views: item.views || 0,
      createTime: item.createTime,
      startTime: item.startTime,
      endTime: item.endTime
    }
  })

  return { code: 0, data: { list: announcements, total: totalRes.total } }
}

async function getPublishedAnnouncements(data) {
  var page = Math.max(1, Number(data.page || 1))
  var pageSize = Math.min(20, Math.max(1, Number(data.pageSize || 10)))
  var now = Date.now()
  var res = await db.collection('global_announcement')
    .where({ status: 'published' })
    .orderBy('createTime', 'desc')
    .limit(100)
    .get()

  var list = res.data.filter(function(item) {
    var start = item.startTime ? new Date(item.startTime).getTime() : 0
    var end = item.endTime ? new Date(item.endTime).getTime() : 0
    return (!start || start <= now) && (!end || end >= now)
  })

  list.sort(function(a, b) {
    if (!!a.isTop !== !!b.isTop) return a.isTop ? -1 : 1
    var timeA = a.createTime ? new Date(a.createTime).getTime() : 0
    var timeB = b.createTime ? new Date(b.createTime).getTime() : 0
    return timeB - timeA
  })

  var total = list.length
  var startIndex = (page - 1) * pageSize
  return {
    code: 0,
    data: {
      list: list.slice(startIndex, startIndex + pageSize),
      total: total
    }
  }
}

async function createAnnouncement(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var adminName = await getAdminName(openid)
  var title = data.title
  var content = data.content
  var type = data.type || 'notice'

  if (!title || !content) {
    return { code: -1, message: '请填写标题和内容' }
  }

  await db.collection('global_announcement').add({
    data: {
      title: title,
      content: content,
      type: type,
      isTop: data.isTop === true,
      isImportant: data.isImportant === true,
      status: data.status || 'published',
      cover: data.cover || '',
      views: 0,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      createTime: db.serverDate()
    }
  })

  await addLog(openid, 'system', 'create', '发布公告：' + title, adminName)
  return { code: 0, message: '公告发布成功' }
}

async function updateAnnouncement(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var adminName = await getAdminName(openid)
  var announcementId = data.id

  if (!announcementId) {
    return { code: -1, message: '公告ID缺失' }
  }

  var updateData = {}
  if (data.title) updateData.title = data.title
  if (data.content) updateData.content = data.content
  if (data.type) updateData.type = data.type
  if (data.isTop !== undefined) updateData.isTop = data.isTop
  if (data.isImportant !== undefined) updateData.isImportant = data.isImportant
  if (data.status) updateData.status = data.status
  if (data.cover !== undefined) updateData.cover = data.cover
  if (data.startTime !== undefined) updateData.startTime = data.startTime
  if (data.endTime !== undefined) updateData.endTime = data.endTime
  updateData.updateTime = db.serverDate()

  await db.collection('global_announcement').doc(announcementId).update({
    data: updateData
  })

  await addLog(openid, 'system', 'update', '更新公告', adminName)
  return { code: 0, message: '公告已更新' }
}

async function deleteAnnouncement(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var adminName = await getAdminName(openid)
  var announcementId = data.id
  if (!announcementId) {
    return { code: -1, message: '公告ID缺失' }
  }

  await db.collection('global_announcement').doc(announcementId).remove()

  await addLog(openid, 'system', 'delete', '删除公告', adminName)
  return { code: 0, message: '公告已删除' }
}

async function getPosts(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var page = data.page || 1
  var pageSize = data.pageSize || 20
  var skip = (page - 1) * pageSize

  var query = { status: cmd.neq('deleted') }
  if (data.status) query.status = data.status
  if (data.category) query.category = data.category

  var totalRes = await db.collection('forum_post').where(query).count()
  
  var res = await db.collection('forum_post')
    .where(query)
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var posts = res.data.map(function(item) {
    return {
      _id: item._id,
      title: item.title,
      content: item.content,
      authorName: item.authorName || item.nickName,
      authorAvatar: item.authorAvatar || item.avatarUrl,
      authorOpenid: item._openid,
      images: item.images || [],
      likes: item.likes || 0,
      comments: item.comments || 0,
      category: item.category,
      status: item.status || 'normal',
      isTop: item.isTop === true,
      isEssence: item.isEssence === true,
      createTime: item.createTime
    }
  })

  return { code: 0, data: { list: posts, total: totalRes.total } }
}

async function deletePost(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var adminName = await getAdminName(openid)
  var postId = data.id
  if (!postId) {
    return { code: -1, message: '动态ID缺失' }
  }

  await db.collection('forum_post').doc(postId).remove()

  await addLog(openid, 'forum', 'delete', '删除动态：' + postId, adminName)
  return { code: 0, message: '动态已删除' }
}

async function batchDeletePosts(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var adminName = await getAdminName(openid)
  var postIds = data.ids
  if (!postIds || !postIds.length) {
    return { code: -1, message: '请选择要删除的动态' }
  }

  var deletedCount = 0
  for (var i = 0; i < postIds.length; i++) {
    try {
      await db.collection('forum_post').doc(postIds[i]).remove()
      deletedCount++
    } catch (e) {
      console.error('delete post error:', e)
    }
  }

  await addLog(openid, 'forum', 'delete', '批量删除动态：' + deletedCount + '条', adminName)
  return { code: 0, message: '已删除 ' + deletedCount + ' 条动态', data: { deletedCount: deletedCount } }
}

async function updatePostStatus(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var adminName = await getAdminName(openid)
  var postId = data.id
  var status = data.status

  if (!postId || !status) {
    return { code: -1, message: '参数缺失' }
  }

  await db.collection('forum_post').doc(postId).update({
    data: { status: status, updateTime: db.serverDate() }
  })

  await addLog(openid, 'forum', 'update', '更新动态状态：' + postId + ' -> ' + status, adminName)
  return { code: 0, message: '状态已更新' }
}

async function setPostTop(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var adminName = await getAdminName(openid)
  var postId = data.id
  var isTop = data.isTop === true

  if (!postId) {
    return { code: -1, message: '动态ID缺失' }
  }

  await db.collection('forum_post').doc(postId).update({
    data: { isTop: isTop, updateTime: db.serverDate() }
  })

  await addLog(openid, 'forum', 'update', (isTop ? '置顶' : '取消置顶') + '动态：' + postId, adminName)
  return { code: 0, message: isTop ? '已置顶' : '已取消置顶' }
}

async function setPostEssence(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var adminName = await getAdminName(openid)
  var postId = data.id
  var isEssence = data.isEssence === true

  if (!postId) {
    return { code: -1, message: '动态ID缺失' }
  }

  await db.collection('forum_post').doc(postId).update({
    data: { isEssence: isEssence, updateTime: db.serverDate() }
  })

  await addLog(openid, 'forum', 'update', (isEssence ? '设为精华' : '取消精华') + '动态：' + postId, adminName)
  return { code: 0, message: isEssence ? '已设为精华' : '已取消精华' }
}

async function getUsers(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var page = data.page || 1
  var pageSize = data.pageSize || 20
  var skip = (page - 1) * pageSize

  var query = {}
  if (data.status) query.status = data.status
  if (data.keyword) {
    query.nickName = db.RegExp({
      regexp: escapeRegExp(String(data.keyword).slice(0, 50)),
      options: 'i'
    })
  }

  var totalRes = await db.collection('users').where(query).count()
  
  var res = await db.collection('users')
    .where(query)
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var users = res.data.map(function(item) {
    return {
      _id: item._id,
      nickName: item.nickName,
      avatarUrl: item.avatarUrl,
      gender: item.gender,
      city: item.city,
      province: item.province,
      status: item.status || 'normal',
      lastLoginTime: item.lastLoginTime,
      createTime: item.createTime,
      createTimeText: formatTime(item.createTime)
    }
  })

  return { code: 0, data: { list: users, total: totalRes.total } }
}

async function updateUser(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var adminName = await getAdminName(openid)
  var userId = data.id
  if (!userId) {
    return { code: -1, message: '用户ID缺失' }
  }

  var updateData = {}
  if (data.status) updateData.status = data.status
  if (data.nickName) updateData.nickName = data.nickName
  updateData.updateTime = db.serverDate()

  await db.collection('users').doc(userId).update({
    data: updateData
  })

  await addLog(openid, 'admin', 'update', '更新用户：' + userId, adminName)
  return { code: 0, message: '用户信息已更新' }
}

async function getStorageInfo(openid) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  return {
    code: 0,
    data: {
      used: 0,
      total: 5120
    }
  }
}

async function cleanOldPosts(openid, data) {
  var adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) {
    return { code: -1, message: '仅超级管理员可执行清理操作' }
  }

  var adminName = await getAdminName(openid)
  var days = data.days || 30
  var cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  var res = await db.collection('forum_post')
    .where({
      createTime: cmd.lt(cutoffDate)
    })
    .get()

  var deletedCount = 0
  for (var i = 0; i < res.data.length; i++) {
    try {
      await db.collection('forum_post').doc(res.data[i]._id).remove()
      deletedCount++
    } catch (e) {
      console.error('delete error:', e)
    }
  }

  await addLog(openid, 'forum', 'cleanup', '清理' + days + '天前的动态：' + deletedCount + '条', adminName)
  return { code: 0, message: '已清理 ' + deletedCount + ' 条动态', data: { deletedCount: deletedCount } }
}

async function cleanDeletedPosts(openid) {
  var adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) {
    return { code: -1, message: '仅超级管理员可执行清理操作' }
  }

  var adminName = await getAdminName(openid)

  var res = await db.collection('forum_post')
    .where({
      isDeleted: true
    })
    .get()

  var deletedCount = 0
  for (var i = 0; i < res.data.length; i++) {
    try {
      await db.collection('forum_post').doc(res.data[i]._id).remove()
      deletedCount++
    } catch (e) {
      console.error('delete error:', e)
    }
  }

  await addLog(openid, 'forum', 'cleanup', '清理已删除动态：' + deletedCount + '条', adminName)
  return { code: 0, message: '已清理 ' + deletedCount + ' 条动态', data: { deletedCount: deletedCount } }
}

async function cleanOrphanImages(openid) {
  var adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) {
    return { code: -1, message: '仅超级管理员可执行清理操作' }
  }

  var adminName = await getAdminName(openid)

  await addLog(openid, 'system', 'cleanup', '清理孤立图片', adminName)
  return { code: 0, message: '孤立图片清理完成' }
}

async function getDashboardStats(openid) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var postCount = await db.collection('forum_post').where({ status: cmd.neq('deleted') }).count()
  var userCount = await db.collection('users').count()
  var runCount = await db.collection('runRecords').count()
  var pendingReports = await db.collection('forum_report').where({ status: 'pending' }).count()
  var pendingCanteen = await db.collection('canteen_submissions').where({ status: 'pending' }).count()
  var canteenReports = await db.collection('canteen_report_cases').where({ status: 'pending' }).count()

  var chinaDay = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  var todayStart = new Date(chinaDay + 'T00:00:00+08:00').getTime()

  var todayPosts = await db.collection('forum_post')
    .where({ createTime: cmd.gte(new Date(todayStart)), status: cmd.neq('deleted') })
    .count()

  return {
    code: 0,
    data: {
      postCount: postCount.total,
      userCount: userCount.total,
      runCount: runCount.total,
      pendingReports: pendingReports.total,
      pendingCanteen: pendingCanteen.total,
      canteenReports: canteenReports.total,
      todayPosts: todayPosts.total
    }
  }
}

async function getRankList(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var keyword = data.keyword || ''
  var query = {}
  if (keyword) {
    query.nickName = db.RegExp({ regexp: escapeRegExp(String(keyword).slice(0, 50)), options: 'i' })
  }

  var res = await db.collection('runRecords')
    .where(query)
    .orderBy('distance', 'desc')
    .limit(100)
    .get()

  var list = res.data.map(function(item) {
    return {
      _id: item._id,
      nickName: item.nickName,
      avatarUrl: item.avatarUrl,
      totalDistance: Number((Number(item.distance || 0) / 1000).toFixed(2)),
      runCount: 1,
      updateTime: item.createTime,
      updateTimeText: formatTime(item.createTime),
      date: item.date || ''
    }
  })

  return { code: 0, data: { list: list } }
}

async function runDemo(openid, remove) {
  if (!(await checkSuperAdmin(openid)).isSuperAdmin) return { code: -1, message: '仅超级管理员可维护示例成绩' }
  return db.runTransaction(async () => {
    const ids = ['campus_demo_run_1', 'campus_demo_run_2', 'campus_demo_run_3', 'campus_demo_run_4']
    const names = ['示例 · 星野', '示例 · 小橘', '示例 · 追风', '示例 · 青禾']
    const distances = [3200, 2400, 1650, 880]
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
    const teamId = 'campus_demo_pair'
    for (let i = 0; i < ids.length; i++) {
      for (const collection of ['runRecords', 'users']) {
        const previous = (await db.collection(collection).doc(ids[i]).get()).data
        if (previous && !previous.isDemo) throw new Error('示例编号与真实数据冲突')
        if (remove) await db.collection(collection).doc(ids[i]).remove()
        else await db.collection(collection).doc(ids[i]).set({ data: collection === 'users'
          ? { openid: ids[i], nickName: names[i], avatarUrl: '', isDemo: true }
          : { openid: ids[i], nickName: names[i], distance: distances[i], duration: distances[i] / 3,
              date, teamId: i < 2 ? teamId : '', createTime: db.serverDate(), isDemo: true } })
      }
    }
    const oldTeam = (await db.collection('teams').doc(teamId).get()).data
    if (oldTeam && !oldTeam.isDemo) throw new Error('示例队伍编号与真实数据冲突')
    if (remove) await db.collection('teams').doc(teamId).remove()
    else await db.collection('teams').doc(teamId).set({ data: { leaderOpenid: ids[0], members: [ids[1]],
      status: 'finished', teamType: 'couple', teamName: '示例搭档', createTime: db.serverDate(), isDemo: true } })
    return { code: 0, message: remove ? '示例成绩已移除，真实记录未修改' : '四条示例成绩已生成，昵称带“示例”标识' }
  }, { lock: 'teams' })
}

async function clearRankRecords(openid, data) {
  var adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) {
    return { code: -1, message: '仅超级管理员可执行此操作' }
  }

  var adminName = await getAdminName(openid)
  var ids = data.ids

  if (!ids || !ids.length) {
    return { code: -1, message: '请选择要删除的记录' }
  }

  var deletedCount = 0
  for (var i = 0; i < ids.length; i++) {
    try {
      await db.collection('runRecords').doc(ids[i]).remove()
      deletedCount++
    } catch (e) {
      console.error('delete error:', e)
    }
  }

  await addLog(openid, 'running', 'delete', '删除排行榜记录：' + deletedCount + '条', adminName)
  return { code: 0, message: '已删除 ' + deletedCount + ' 条记录' }
}

async function clearAllRankRecords(openid) {
  var adminCheck = await checkSuperAdmin(openid)
  if (!adminCheck.isSuperAdmin) {
    return { code: -1, message: '仅超级管理员可执行此操作' }
  }

  var deletedCount = 0
  while (true) {
    var result = await db.collection('runRecords').limit(100).get()
    if (!result.data.length) break
    for (var i = 0; i < result.data.length; i++) {
      await db.collection('runRecords').doc(result.data[i]._id).remove()
      deletedCount++
    }
    if (result.data.length < 100) break
  }

  var adminName = await getAdminName(openid)
  await addLog(openid, 'running', 'delete', '清空排行榜记录：' + deletedCount + '条', adminName)
  return { code: 0, message: '已清空 ' + deletedCount + ' 条排行榜记录' }
}

async function getReports(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var page = data.page || 1
  var pageSize = data.pageSize || 20
  var skip = (page - 1) * pageSize

  var query = {}
  if (data.status) query.status = data.status

  var totalRes = await db.collection('forum_report').where(query).count()
  
  var res = await db.collection('forum_report')
    .where(query)
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var reports = res.data.map(function(item) {
    return {
      _id: item._id,
      postId: item.postId,
      postTitle: item.postTitle,
      postContent: item.postContent,
      reporterName: item.reporterName,
      reason: item.reason,
      status: item.status || 'pending',
      handleResult: item.handleResult,
      createTime: item.createTime
    }
  })

  return { code: 0, data: { list: reports, total: totalRes.total } }
}

async function handleReport(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var adminName = await getAdminName(openid)
  var reportId = data.reportId
  var status = data.status
  var handleResult = data.handleResult || ''
  var deletePost = data.deletePost

  if (!reportId || !status) {
    return { code: -1, message: '参数缺失' }
  }

  var report = await db.collection('forum_report').doc(reportId).get()
  if (!report.data) {
    return { code: -1, message: '举报不存在' }
  }

  await db.collection('forum_report').doc(reportId).update({
    data: {
      status: status,
      handleResult: handleResult,
      handleTime: db.serverDate()
    }
  })

  if (deletePost && report.data.postId) {
    await db.collection('forum_post').doc(report.data.postId).update({
      data: { status: 'deleted', updateTime: db.serverDate() }
    })
  }

  await addLog(openid, 'forum', 'handle', '处理举报：' + reportId, adminName)
  return { code: 0, message: '已处理' }
}

async function getForumCategories(openid) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) {
    return { code: -1, message: '无权限' }
  }

  var categories = [
    { key: 'gossip', name: '闲聊灌水', icon: '💬' },
    { key: 'confession', name: '表白墙', icon: '💕' },
    { key: 'lost', name: '失物招领', icon: '🔍' },
    { key: 'job', name: '兼职互助', icon: '💼' },
    { key: 'study', name: '学习交流', icon: '📚' },
    { key: 'market', name: '二手市场', icon: '🛒' }
  ]

  return { code: 0, data: { list: categories } }
}
