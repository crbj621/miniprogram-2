const cloud = require('campus-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const cmd = db.command
const actionLocks = new Set()

const SENSITIVE_WORDS = ['傻逼', '操你', '妈的', '草你', 'fuck', 'shit', '傻X', '煞笔']

const CATEGORIES = {
  'gossip': { name: '灌水区', icon: '💬' },
  'confession': { name: '表白墙', icon: '💕' },
  'melon': { name: '吃瓜', icon: '🍉' },
  'job': { name: '兼职', icon: '💼' },
  'lost': { name: '失物招领', icon: '🔍' },
  'study': { name: '学习互助', icon: '📚' }
}

function getCategoryName(category) {
  if (CATEGORIES[category] && CATEGORIES[category].name) {
    return CATEGORIES[category].name
  }
  return category
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex')
}

async function withActionLock(key, callback) {
  if (actionLocks.has(key)) {
    return { success: false, msg: '操作正在处理中，请稍后再试' }
  }
  actionLocks.add(key)
  try {
    return await callback()
  } finally {
    actionLocks.delete(key)
  }
}

function relationId(prefix, openid, targetId) {
  return prefix + '_' + crypto.createHash('sha256')
    .update(String(openid) + ':' + String(targetId))
    .digest('hex')
    .slice(0, 32)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function checkSensitive(content) {
  var lower = content.toLowerCase()
  for (var i = 0; i < SENSITIVE_WORDS.length; i++) {
    var word = SENSITIVE_WORDS[i]
    if (lower.indexOf(word.toLowerCase()) !== -1) {
      return { hasSensitive: true, word: word }
    }
  }
  return { hasSensitive: false }
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
  if (m.length === 1) m = '0' + m
  if (d.length === 1) d = '0' + d
  if (hh.length === 1) hh = '0' + hh
  if (mm.length === 1) mm = '0' + mm
  return y + '-' + m + '-' + d + ' ' + hh + ':' + mm
}

async function checkBanStatus(openid) {
  var userRes = await db.collection('forum_user').where({ _openid: openid }).limit(1).get()
  if (!userRes.data.length) return { isBanned: false }
  var user = userRes.data[0]
  if (user.status === 'banned' && user.banTime) {
    var banEndTime = new Date(user.banTime)
    if (banEndTime > new Date()) {
      return { isBanned: true, banTime: user.banTime, banReason: user.banReason || '违规操作' }
    }
  }
  return { isBanned: false }
}

async function checkAdmin(openid) {
  var adminRes = await db.collection('forum_admin').where({ _openid: openid }).limit(1).get()
  if (!adminRes.data.length) return { isAdmin: false }
  return { isAdmin: true, admin: adminRes.data[0] }
}

async function checkRateLimit(openid, type) {
  var now = Date.now()
  var oneMinuteAgo = new Date(now - 60000)
  var collection = type === 'post' ? 'forum_post' : 'forum_comment'
  var countRes = await db.collection(collection)
    .where({ _openid: openid, createTime: cmd.gt(oneMinuteAgo) })
    .count()
  var limit = type === 'post' ? 1 : 3
  return { allowed: countRes.total < limit, current: countRes.total, limit: limit }
}

exports.main = async function(event) {
  var wxContext = cloud.getWXContext()
  var openid = wxContext.OPENID
  var action = event.action
  var data = event.data || {}

  try {
    if (action === 'initDatabase') {
      return await initDatabase(openid)
    } else if (action === 'getCategories') {
      return await getCategories()
    } else if (action === 'getPosts') {
      return await getPosts(data)
    } else if (action === 'getPostDetail') {
      return await getPostDetail(data, openid)
    } else if (action === 'createPost') {
      return await createPost(openid, data)
    } else if (action === 'updatePost') {
      return await updatePost(openid, data)
    } else if (action === 'deletePost') {
      return await deletePost(openid, data)
    } else if (action === 'likePost') {
      return await withActionLock('post-like:' + openid + ':' + data.postId, function() {
        return likePost(openid, data)
      })
    } else if (action === 'collectPost') {
      return await withActionLock('post-collect:' + openid + ':' + data.postId, function() {
        return collectPost(openid, data)
      })
    } else if (action === 'getComments') {
      return await getComments(data, openid)
    } else if (action === 'createComment') {
      return await withActionLock('comment-create:' + openid + ':' + data.postId, function() {
        return createComment(openid, data)
      })
    } else if (action === 'deleteComment') {
      return await deleteComment(openid, data)
    } else if (action === 'likeComment') {
      return await withActionLock('comment-like:' + openid + ':' + data.commentId, function() {
        return likeComment(openid, data)
      })
    } else if (action === 'reportPost') {
      return await reportPost(openid, data)
    } else if (action === 'getUserInfo') {
      return await getUserInfo(openid)
    } else if (action === 'getUserPosts') {
      return await getUserPosts(openid, data)
    } else if (action === 'getUserCollections') {
      return await getUserCollections(openid, data)
    } else if (action === 'getUserComments') {
      return await getUserComments(openid, data)
    } else if (action === 'adminLogin') {
      return await adminLogin(data)
    } else if (action === 'adminGetPosts') {
      return await adminGetPosts(openid, data)
    } else if (action === 'adminDeletePost') {
      return await adminDeletePost(openid, data)
    } else if (action === 'adminTopPost') {
      return await adminTopPost(openid, data)
    } else if (action === 'adminEssencePost') {
      return await adminEssencePost(openid, data)
    } else if (action === 'adminGetReports') {
      return await adminGetReports(openid, data)
    } else if (action === 'adminHandleReport') {
      return await adminHandleReport(openid, data)
    } else if (action === 'adminGetUsers') {
      return await adminGetUsers(openid, data)
    } else if (action === 'adminBanUser') {
      return await adminBanUser(openid, data)
    } else if (action === 'adminUnbanUser') {
      return await adminUnbanUser(openid, data)
    } else if (action === 'adminGetLogs') {
      return await adminGetLogs(openid, data)
    } else if (action === 'adminCreateAdmin') {
      return await adminCreateAdmin(openid, data)
    } else if (action === 'adminDeleteAdmin') {
      return await adminDeleteAdmin(openid, data)
    } else if (action === 'adminGetAdmins') {
      return await adminGetAdmins(openid)
    } else if (action === 'adminUpdatePostStatus') {
      return await adminUpdatePostStatus(openid, data)
    } else if (action === 'searchPosts') {
      return await searchPosts(data)
    } else if (action === 'syncUserInfo') {
      return await syncUserInfo(openid, data)
    } else if (action === 'updateUserInfo') {
      return await updateUserInfo(openid, data)
    } else if (action === 'getNotifications') {
      return await getNotifications(openid, data)
    } else if (action === 'markNotificationRead') {
      return await markNotificationRead(openid, data)
    } else if (action === 'getUnreadCount') {
      return await getUnreadCount(openid)
    } else if (action === 'getConversations') {
      return await getConversations(openid)
    } else if (action === 'getChatMessages') {
      return await getChatMessages(openid, data)
    } else if (action === 'sendChatMessage') {
      return await sendChatMessage(openid, data)
    } else if (action === 'markChatRead') {
      return await markChatRead(openid, data)
    } else if (action === 'getAnnouncement') {
      return await getAnnouncement()
    } else if (action === 'adminCreateAnnouncement') {
      return await adminCreateAnnouncement(openid, data)
    } else if (action === 'adminGetAnnouncements') {
      return await adminGetAnnouncements(openid, data)
    } else if (action === 'adminDeleteAnnouncement') {
      return await adminDeleteAnnouncement(openid, data)
    } else {
      return { success: false, msg: 'Unknown action: ' + action }
    }
  } catch (error) {
    console.error('Forum cloud function error:', error)
    return { success: false, msg: error.message || '服务异常', error: error.toString() }
  }
}

async function initDatabase(openid) {
  var globalAdminRes = await db.collection('global_admin').where({
    loginOpenid: openid,
    role: 'super',
    status: cmd.neq('disabled')
  }).limit(1).get()
  if (!globalAdminRes.data.length) {
    return { success: false, msg: '仅全局超级管理员可初始化校园动态数据' }
  }

  var collections = ['forum_post', 'forum_comment', 'forum_user', 'forum_admin', 'forum_report', 'forum_admin_log', 'forum_like', 'forum_collect', 'forum_notification', 'forum_chat', 'forum_chat_message', 'forum_announcement']
  var results = []
  
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

  return { success: true, msg: '数据库初始化完成', results: results }
}

async function getCategories() {
  var categories = []
  var keys = Object.keys(CATEGORIES)
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i]
    var value = CATEGORIES[key]
    var countRes = await db.collection('forum_post')
      .where({ category: key, status: cmd.neq('deleted') })
      .count()
    var latestRes = await db.collection('forum_post')
      .where({ category: key, status: cmd.neq('deleted') })
      .orderBy('createTime', 'desc')
      .limit(1)
      .get()
    categories.push({
      key: key,
      name: value.name,
      icon: value.icon,
      postCount: countRes.total,
      latestTime: latestRes.data.length > 0 ? formatTime(latestRes.data[0].createTime) : ''
    })
  }
  return { success: true, categories: categories }
}

async function getPosts(data) {
  var category = data.category
  var orderBy = data.orderBy || 'latest'
  var page = Math.max(1, Number(data.page || 1))
  var pageSize = Math.min(30, Math.max(1, Number(data.pageSize || 10)))
  
  var query = { status: cmd.neq('deleted') }
  if (category) query.category = category

  var skip = (page - 1) * pageSize
  var orderField = orderBy === 'hot' ? 'likeCount' : 'createTime'

  var res = await db.collection('forum_post')
    .where(query)
    .orderBy(orderField, 'desc')
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var posts = []
  var allFileIDs = []
  var fileUrlMap = {}
  var openidSet = new Set()
  
  for (var i = 0; i < res.data.length; i++) {
    var item = res.data[i]
    if (!item.isAnonymous && item._openid) {
      openidSet.add(item._openid)
    }
  }
  
  var openids = Array.from(openidSet)
  var userMap = {}
  
  if (openids.length > 0) {
    var userRes = await db.collection('users').where({
      openid: cmd.in(openids)
    }).get()
    
    for (var j = 0; j < userRes.data.length; j++) {
      var user = userRes.data[j]
      userMap[user.openid] = {
        nickname: user.nickName || '用户' + user.openid.slice(-6),
        avatar: user.avatarUrl || ''
      }
      if (user.avatarUrl && user.avatarUrl.indexOf('cloud://') === 0) {
        allFileIDs.push(user.avatarUrl)
      }
    }
    
    var forumUserRes = await db.collection('forum_user').where({
      _openid: cmd.in(openids)
    }).get()
    
    for (var fu = 0; fu < forumUserRes.data.length; fu++) {
      var forumUser = forumUserRes.data[fu]
      if (!userMap[forumUser._openid]) {
        userMap[forumUser._openid] = {
          nickname: forumUser.nickname || '用户' + forumUser._openid.slice(-6),
          avatar: forumUser.avatar || ''
        }
      } else if (!userMap[forumUser._openid].avatar && forumUser.avatar) {
        userMap[forumUser._openid].avatar = forumUser.avatar
      }
      if (forumUser.avatar && forumUser.avatar.indexOf('cloud://') === 0) {
        allFileIDs.push(forumUser.avatar)
      }
    }
  }
  
  for (var k = 0; k < res.data.length; k++) {
    var item = res.data[k]
    var itemOpenid = String(item._openid || '')
    var authorName = itemOpenid ? '用户' + itemOpenid.slice(-6) : '校园同学'
    var authorAvatar = ''
    
    if (item.isAnonymous) {
      authorName = '匿名用户'
      authorAvatar = ''
    } else if (userMap[item._openid]) {
      authorName = userMap[item._openid].nickname
      authorAvatar = userMap[item._openid].avatar
    } else if (item.authorName || item.authorAvatar) {
      authorName = item.authorName || authorName
      authorAvatar = item.authorAvatar || ''
    }
    
    if (authorAvatar && authorAvatar.indexOf('cloud://') === 0) {
      allFileIDs.push(authorAvatar)
    }
    
    if (item.imgList && item.imgList.length > 0) {
      for (var imgIdx = 0; imgIdx < item.imgList.length; imgIdx++) {
        var img = item.imgList[imgIdx]
        if (img && img.indexOf('cloud://') === 0) {
          allFileIDs.push(img)
        }
      }
    }
    
    posts.push({
      _id: item._id,
      _openid: item._openid,
      title: item.title,
      content: item.content,
      imgList: Array.isArray(item.imgList) ? item.imgList : [],
      category: item.category,
      isAnonymous: item.isAnonymous,
      authorName: authorName,
      authorAvatar: authorAvatar,
      likeCount: item.likeCount,
      commentCount: item.commentCount,
      collectCount: item.collectCount,
      isTop: item.isTop,
      isEssence: item.isEssence,
      createTime: item.createTime,
      createTimeText: formatTime(item.createTime),
      categoryName: getCategoryName(item.category)
    })
  }

  if (allFileIDs.length > 0) {
    try {
      var tempUrlRes = await cloud.getTempFileURL({ fileList: allFileIDs })
      if (tempUrlRes.fileList && tempUrlRes.fileList.length > 0) {
        for (var m = 0; m < tempUrlRes.fileList.length; m++) {
          var fileItem = tempUrlRes.fileList[m]
          if (fileItem.tempFileURL) {
            fileUrlMap[fileItem.fileID] = fileItem.tempFileURL
          }
        }
      }
    } catch (err) {
      console.error('获取临时链接失败:', err)
    }
  }

  for (var n = 0; n < posts.length; n++) {
    var post = posts[n]
    if (post.authorAvatar && fileUrlMap[post.authorAvatar]) {
      post.authorAvatar = fileUrlMap[post.authorAvatar]
    }
    if (post.imgList && post.imgList.length > 0) {
      var newImgList = []
      for (var imgK = 0; imgK < post.imgList.length; imgK++) {
        var img = post.imgList[imgK]
        if (img && fileUrlMap[img]) {
          newImgList.push(fileUrlMap[img])
        } else {
          newImgList.push(img)
        }
      }
      post.imgList = newImgList
    }
  }

  return { success: true, posts: posts, hasMore: res.data.length === pageSize }
}

async function getAnnouncement() {
  var res = await db.collection('forum_announcement')
    .where({ status: 'active' })
    .orderBy('createTime', 'desc')
    .limit(1)
    .get()

  if (res.data.length > 0) {
    return { success: true, announcement: res.data[0] }
  }
  return { success: true, announcement: null }
}

async function adminCreateAnnouncement(openid, data) {
  var isAdmin = await checkAdminPermission(openid, 'all')
  if (!isAdmin) return { success: false, msg: '无权限' }

  var title = data.title
  var content = data.content

  if (!title || !content) return { success: false, msg: '标题和内容不能为空' }

  var res = await db.collection('forum_announcement').add({
    data: {
      title: title,
      content: content,
      status: 'active',
      createTime: db.serverDate()
    }
  })

  return { success: true, announcementId: res._id }
}

async function adminGetAnnouncements(openid, data) {
  var isAdmin = await checkAdminPermission(openid, 'all')
  if (!isAdmin) return { success: false, msg: '无权限' }

  var res = await db.collection('forum_announcement')
    .orderBy('createTime', 'desc')
    .limit(50)
    .get()

  return { success: true, announcements: res.data }
}

async function adminDeleteAnnouncement(openid, data) {
  var isAdmin = await checkAdminPermission(openid, 'all')
  if (!isAdmin) return { success: false, msg: '无权限' }

  var announcementId = data.announcementId
  if (!announcementId) return { success: false, msg: '公告ID缺失' }

  await db.collection('forum_announcement').doc(announcementId).remove()

  return { success: true }
}

async function getNotifications(openid, data) {
  var page = Math.max(1, Number(data.page || 1))
  var pageSize = Math.min(50, Math.max(1, Number(data.pageSize || 20)))
  var skip = (page - 1) * pageSize

  var res = await db.collection('forum_notification')
    .where({ toOpenid: openid })
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var notifications = res.data.map(function(item) {
    return {
      _id: item._id,
      type: item.type,
      postId: item.postId,
      postTitle: item.postTitle,
      commentContent: item.commentContent,
      isRead: item.isRead,
      createTime: item.createTime,
      createTimeText: formatTime(item.createTime)
    }
  })

  return { success: true, notifications: notifications, hasMore: res.data.length === pageSize }
}

async function markNotificationRead(openid, data) {
  var notificationId = data.notificationId
  if (!notificationId) return { success: false, msg: '通知ID缺失' }

  var result = await db.collection('forum_notification').where({
    _id: notificationId,
    toOpenid: openid
  }).update({
    data: { isRead: true }
  })
  if (!result.stats || result.stats.updated !== 1) {
    return { success: false, msg: '通知不存在或无权操作' }
  }

  return { success: true, msg: '已标记为已读' }
}

async function getUnreadCount(openid) {
  var countRes = await db.collection('forum_notification')
    .where({ toOpenid: openid, isRead: false })
    .count()

  return { success: true, count: countRes.total }
}

async function getConversations(openid) {
  var res = await db.collection('forum_chat')
    .where(cmd.or([
      { fromOpenid: openid },
      { toOpenid: openid }
    ]))
    .orderBy('lastTime', 'desc')
    .get()

  var conversations = []
  var seenOpenids = {}
  for (var i = 0; i < res.data.length; i++) {
    var item = res.data[i]
    var toOpenid = item.fromOpenid === openid ? item.toOpenid : item.fromOpenid
    if (!toOpenid || seenOpenids[toOpenid]) continue
    seenOpenids[toOpenid] = true
    var toName = item.fromOpenid === openid ? item.toName : item.fromName
    var toAvatar = item.fromOpenid === openid ? item.toAvatar : item.fromAvatar
    
    var unreadRes = await db.collection('forum_chat_message')
      .where({
        fromOpenid: toOpenid,
        toOpenid: openid,
        isRead: false
      })
      .count()

    conversations.push({
      _id: item._id,
      toOpenid: toOpenid,
      toName: toName || '用户',
      toAvatar: toAvatar || '',
      lastMessage: item.lastMessage || '',
      lastTime: item.lastTime,
      lastTimeText: formatTime(item.lastTime),
      unreadCount: unreadRes.total
    })
  }

  return { success: true, conversations: conversations }
}

async function getChatMessages(openid, data) {
  var toOpenid = data.toOpenid
  if (!toOpenid) return { success: false, msg: '对方ID缺失' }

  var res = await db.collection('forum_chat_message')
    .where(cmd.or([
      { fromOpenid: openid, toOpenid: toOpenid },
      { fromOpenid: toOpenid, toOpenid: openid }
    ]))
    .orderBy('createTime', 'asc')
    .limit(100)
    .get()

  var messages = res.data.map(function(item) {
    return {
      _id: item._id,
      fromOpenid: item.fromOpenid,
      toOpenid: item.toOpenid,
      content: item.content,
      createTime: item.createTime
    }
  })

  return { success: true, messages: messages }
}

async function sendChatMessage(openid, data) {
  var toOpenid = String(data.toOpenid || '')
  var content = String(data.content || '').trim()
  var fromName = String(data.fromName || '用户').trim().slice(0, 30)
  var fromAvatar = String(data.fromAvatar || '').trim().slice(0, 1000)

  if (!toOpenid) return { success: false, msg: '对方ID缺失' }
  if (toOpenid === openid) return { success: false, msg: '不能给自己发送私信' }
  if (!content) return { success: false, msg: '消息内容不能为空' }
  if (content.length > 500) return { success: false, msg: '单条消息不能超过500个字' }
  var sensitiveCheck = checkSensitive(content)
  if (sensitiveCheck.hasSensitive) {
    return { success: false, msg: '消息包含不合适的内容' }
  }
  var banCheck = await checkBanStatus(openid)
  if (banCheck.isBanned) return { success: false, msg: '当前账号已被禁言' }
  var recentMessages = await db.collection('forum_chat_message').where({
    fromOpenid: openid,
    createTime: cmd.gt(new Date(Date.now() - 60000))
  }).count()
  if (recentMessages.total >= 10) {
    return { success: false, msg: '发送太频繁，请稍后再试' }
  }

  var fromUserRes = await db.collection('users').where({ openid: openid }).limit(1).get()
  if (fromUserRes.data.length > 0) {
    if (!fromName || fromName === '用户') {
      fromName = fromUserRes.data[0].nickName || '用户'
    }
    if (!fromAvatar) {
      fromAvatar = fromUserRes.data[0].avatarUrl || ''
    }
  }

  var toUserRes = await db.collection('users').where({ openid: toOpenid }).limit(1).get()
  var toName = '用户'
  var toAvatar = ''
  if (toUserRes.data.length > 0) {
    toName = toUserRes.data[0].nickName || '用户'
    toAvatar = toUserRes.data[0].avatarUrl || ''
  } else {
    var toForumUser = await db.collection('forum_user').where({ _openid: toOpenid }).limit(1).get()
    if (!toForumUser.data.length) return { success: false, msg: '对方用户不存在' }
    toName = toForumUser.data[0].nickname || '用户'
    toAvatar = toForumUser.data[0].avatar || ''
  }

  var res = await db.collection('forum_chat_message').add({
    data: {
      fromOpenid: openid,
      toOpenid: toOpenid,
      content: content,
      isRead: false,
      createTime: db.serverDate()
    }
  })

  var existingChat = await db.collection('forum_chat')
    .where(cmd.or([
      { fromOpenid: openid, toOpenid: toOpenid },
      { fromOpenid: toOpenid, toOpenid: openid }
    ]))
    .limit(1)
    .get()

  if (existingChat.data.length > 0) {
    await db.collection('forum_chat').doc(existingChat.data[0]._id).update({
      data: {
        lastMessage: content.substring(0, 50),
        lastTime: db.serverDate(),
        fromOpenid: openid,
        toOpenid: toOpenid,
        fromName: fromName,
        fromAvatar: fromAvatar,
        toName: toName,
        toAvatar: toAvatar
      }
    })
  } else {
    var conversationId = relationId('chat', [openid, toOpenid].sort().join(':'), 'conversation')
    await db.collection('forum_chat').doc(conversationId).set({
      data: {
        fromOpenid: openid,
        toOpenid: toOpenid,
        fromName: fromName,
        fromAvatar: fromAvatar,
        toName: toName,
        toAvatar: toAvatar,
        lastMessage: content.substring(0, 50),
        lastTime: db.serverDate(),
        createTime: db.serverDate()
      }
    })
  }

  return { success: true, messageId: res._id }
}

async function markChatRead(openid, data) {
  var toOpenid = data.toOpenid
  if (!toOpenid) return { success: false, msg: '对方ID缺失' }

  await db.collection('forum_chat_message')
    .where({
      fromOpenid: toOpenid,
      toOpenid: openid,
      isRead: false
    })
    .update({
      data: { isRead: true }
    })

  return { success: true, msg: '已标记为已读' }
}

async function syncUserInfo(openid, data) {
  var nickname = data.nickname || ''
  var avatar = data.avatar || ''
  
  if (!openid) {
    return { success: false, msg: '用户未登录' }
  }
  
  var userRes = await db.collection('forum_user').where({ _openid: openid }).limit(1).get()
  
  if (userRes.data.length > 0) {
    var updateData = { updateTime: db.serverDate() }
    if (nickname) updateData.nickname = nickname
    if (avatar) updateData.avatar = avatar
    await db.collection('forum_user').doc(userRes.data[0]._id).update({
      data: updateData
    })
    return { success: true, msg: '用户信息同步成功', isNew: false }
  } else {
    await db.collection('forum_user').add({
      data: {
        _openid: openid,
        nickname: nickname || '用户' + openid.slice(-6),
        avatar: avatar,
        status: 'normal',
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
    return { success: true, msg: '用户信息创建成功', isNew: true }
  }
}

async function updateUserInfo(openid, data) {
  var nickname = data.nickname || ''
  var avatar = data.avatar
  
  if (!openid) {
    return { success: false, msg: '用户未登录' }
  }
  
  if (!nickname) {
    return { success: false, msg: '昵称不能为空' }
  }
  
  if (nickname.length > 10) {
    return { success: false, msg: '昵称不能超过10字' }
  }
  
  var userRes = await db.collection('forum_user').where({ _openid: openid }).limit(1).get()
  
  if (userRes.data.length > 0) {
    var updateData = {
      nickname: nickname,
      updateTime: db.serverDate()
    }
    if (avatar !== undefined) {
      updateData.avatar = avatar
    }
    
    await db.collection('forum_user').doc(userRes.data[0]._id).update({
      data: updateData
    })
    return { success: true, msg: '昵称修改成功' }
  } else {
    await db.collection('forum_user').add({
      data: {
        _openid: openid,
        nickname: nickname,
        avatar: avatar || '',
        status: 'normal',
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
    return { success: true, msg: '用户信息创建成功' }
  }
}

async function getPostDetail(data, openid) {
  var postId = data.postId
  if (!postId) return { success: false, msg: '动态ID缺失' }

  var postRes = await db.collection('forum_post').doc(postId).get()
  if (!postRes.data) return { success: false, msg: '动态不存在' }
  
  var post = postRes.data
  if (post.status === 'deleted') return { success: false, msg: '动态已被删除' }
  post.imgList = Array.isArray(post.imgList) ? post.imgList : []

  var authorInfo = { nickname: '匿名用户', avatar: '', openid: '' }
  if (!post.isAnonymous) {
    var userRes = await db.collection('users').where({ openid: post._openid }).limit(1).get()
    if (userRes.data.length) {
      authorInfo = { 
        nickname: userRes.data[0].nickName || '用户' + post._openid.slice(-6), 
        avatar: userRes.data[0].avatarUrl || '', 
        openid: post._openid 
      }
    }
    
    if (!authorInfo.avatar) {
      var forumUserRes = await db.collection('forum_user').where({ _openid: post._openid }).limit(1).get()
      if (forumUserRes.data.length) {
        if (!authorInfo.nickname || authorInfo.nickname === '用户' + post._openid.slice(-6)) {
          authorInfo.nickname = forumUserRes.data[0].nickname || authorInfo.nickname
        }
        authorInfo.avatar = forumUserRes.data[0].avatar || ''
      }
    }
    
    if (!authorInfo.nickname || authorInfo.nickname === '用户' + post._openid.slice(-6)) {
      authorInfo.nickname = post.authorName || authorInfo.nickname
    }
    if (!authorInfo.avatar) {
      authorInfo.avatar = post.authorAvatar || ''
    }
  }

  var allFileIDs = []
  if (authorInfo.avatar && authorInfo.avatar.indexOf('cloud://') === 0) {
    allFileIDs.push(authorInfo.avatar)
  }
  if (post.imgList && post.imgList.length > 0) {
    for (var imgIdx = 0; imgIdx < post.imgList.length; imgIdx++) {
      var img = post.imgList[imgIdx]
      if (img && img.indexOf('cloud://') === 0) {
        allFileIDs.push(img)
      }
    }
  }

  if (allFileIDs.length > 0) {
    try {
      var tempUrlRes = await cloud.getTempFileURL({ fileList: allFileIDs })
      if (tempUrlRes.fileList && tempUrlRes.fileList.length > 0) {
        for (var j = 0; j < tempUrlRes.fileList.length; j++) {
          var fileItem = tempUrlRes.fileList[j]
          if (fileItem.tempFileURL) {
            if (fileItem.fileID === authorInfo.avatar) {
              authorInfo.avatar = fileItem.tempFileURL
            }
          }
        }
        var newImgList = []
        for (var k = 0; k < post.imgList.length; k++) {
          var img = post.imgList[k]
          var found = false
          for (var m = 0; m < tempUrlRes.fileList.length; m++) {
            if (tempUrlRes.fileList[m].fileID === img && tempUrlRes.fileList[m].tempFileURL) {
              newImgList.push(tempUrlRes.fileList[m].tempFileURL)
              found = true
              break
            }
          }
          if (!found) {
            newImgList.push(img)
          }
        }
        post.imgList = newImgList
      }
    } catch (err) {
      console.error('获取临时链接失败:', err)
    }
  }

  var likeRes = await db.collection('forum_like').where({ postId: postId, _openid: openid }).limit(1).get()
  var collectRes = await db.collection('forum_collect').where({ postId: postId, _openid: openid }).limit(1).get()

  return {
    success: true,
    post: {
      _id: post._id,
      _openid: post._openid,
      title: post.title,
      content: post.content,
      imgList: post.imgList,
      category: post.category,
      isAnonymous: post.isAnonymous,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      collectCount: post.collectCount,
      isTop: post.isTop,
      isEssence: post.isEssence,
      createTime: post.createTime,
      createTimeText: formatTime(post.createTime),
      categoryName: getCategoryName(post.category),
      authorInfo: authorInfo,
      isLiked: likeRes.data.length > 0,
      isCollected: collectRes.data.length > 0,
      isOwner: post._openid === openid
    }
  }
}

async function createPost(openid, data) {
  var title = String(data.title || '').trim()
  var content = String(data.content || '').trim()
  var imgList = Array.isArray(data.imgList) ? data.imgList : []
  var category = String(data.category || '')
  var isAnonymous = data.isAnonymous === true
  var nickname = String(data.nickname || '').trim().slice(0, 30)
  var avatar = String(data.avatar || '').trim().slice(0, 1000)

  if (!openid) return { success: false, msg: '登录状态无效' }
  if (!title) return { success: false, msg: '请输入标题' }
  if (!content) return { success: false, msg: '请输入内容' }
  if (title.length > 60) return { success: false, msg: '标题不能超过60个字' }
  if (content.length > 5000) return { success: false, msg: '内容不能超过5000个字' }
  if (!CATEGORIES[category]) return { success: false, msg: '动态分类无效' }
  if (imgList.length > 9) return { success: false, msg: '最多上传9张图片' }
  imgList = imgList.filter(function(url) {
    return typeof url === 'string' && /^(cloud:\/\/|https?:\/\/)/.test(url) && url.length <= 1000
  })

  var sensitiveCheck = checkSensitive(title + content)
  if (sensitiveCheck.hasSensitive) {
    return { success: false, msg: '内容包含敏感词：' + sensitiveCheck.word }
  }

  var banCheck = await checkBanStatus(openid)
  if (banCheck.isBanned) {
    return { success: false, msg: '您已被禁言，禁言至：' + formatTime(banCheck.banTime) }
  }

  var rateCheck = await checkRateLimit(openid, 'post')
  if (!rateCheck.allowed) {
    return { success: false, msg: '发帖过于频繁，请稍后再试' }
  }

  var userRes = await db.collection('users').where({ openid: openid }).limit(1).get()
  var userNickname = '用户' + openid.slice(-6)
  var userAvatar = ''

  if (userRes.data.length > 0) {
    userNickname = userRes.data[0].nickName || nickname || userNickname
    userAvatar = userRes.data[0].avatarUrl || avatar || ''
  } else {
    userNickname = nickname || userNickname
    userAvatar = avatar || ''
  }
  
  var forumUserRes = await db.collection('forum_user').where({ _openid: openid }).limit(1).get()
  if (forumUserRes.data.length === 0) {
    await db.collection('forum_user').add({
      data: {
        _openid: openid,
        nickname: userNickname,
        avatar: userAvatar,
        status: 'normal',
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
  } else {
    var updateData = { updateTime: db.serverDate() }
    if (userNickname && userNickname !== forumUserRes.data[0].nickname) {
      updateData.nickname = userNickname
    }
    if (userAvatar && userAvatar !== forumUserRes.data[0].avatar) {
      updateData.avatar = userAvatar
    }
    await db.collection('forum_user').doc(forumUserRes.data[0]._id).update({
      data: updateData
    })
  }

  var res = await db.collection('forum_post').add({
    data: {
      _openid: openid,
      title: title,
      content: content,
      imgList: imgList,
      category: category,
      isAnonymous: isAnonymous,
      authorName: isAnonymous ? '匿名用户' : userNickname,
      authorAvatar: isAnonymous ? '' : userAvatar,
      likeCount: 0,
      commentCount: 0,
      collectCount: 0,
      status: 'normal',
      isTop: false,
      isEssence: false,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  })

  return { success: true, postId: res._id, msg: '发布成功' }
}

async function updatePost(openid, data) {
  var postId = data.postId
  var title = data.title
  var content = data.content
  var imgList = data.imgList
  
  if (!postId) return { success: false, msg: '动态ID缺失' }

  var postRes = await db.collection('forum_post').doc(postId).get()
  if (!postRes.data) return { success: false, msg: '动态不存在' }
  if (postRes.data._openid !== openid) return { success: false, msg: '无权限编辑此动态' }

  var sensitiveCheck = checkSensitive((title || '') + (content || ''))
  if (sensitiveCheck.hasSensitive) {
    return { success: false, msg: '内容包含敏感词：' + sensitiveCheck.word }
  }

  var updateData = { updateTime: db.serverDate() }
  if (title) updateData.title = title.trim()
  if (content) updateData.content = content.trim()
  if (imgList !== undefined) updateData.imgList = imgList

  await db.collection('forum_post').doc(postId).update({ data: updateData })
  return { success: true, msg: '更新成功' }
}

async function deletePost(openid, data) {
  var postId = data.postId
  if (!postId) return { success: false, msg: '动态ID缺失' }

  var postRes = await db.collection('forum_post').doc(postId).get()
  if (!postRes.data) return { success: false, msg: '动态不存在' }
  if (postRes.data._openid !== openid) return { success: false, msg: '无权限删除此动态' }

  await db.collection('forum_post').doc(postId).update({
    data: { status: 'deleted', updateTime: db.serverDate() }
  })
  return { success: true, msg: '删除成功' }
}

async function likePost(openid, data) {
  var postId = data.postId
  if (!postId) return { success: false, msg: '动态ID缺失' }

  var postResult = await db.collection('forum_post').doc(postId).get()
  if (!postResult.data || postResult.data.status === 'deleted') {
    return { success: false, msg: '动态不存在或已删除' }
  }

  var existingLike = await db.collection('forum_like').where({ postId: postId, _openid: openid }).get()
  var liked = false
  
  if (existingLike.data.length) {
    for (var i = 0; i < existingLike.data.length; i++) {
      await db.collection('forum_like').doc(existingLike.data[i]._id).remove()
    }
  } else {
    await db.collection('forum_like').doc(relationId('post_like', openid, postId)).set({
      data: { postId: postId, _openid: openid, createTime: db.serverDate() }
    })
    liked = true
  }

  var countResult = await db.collection('forum_like').where({ postId: postId }).count()
  await db.collection('forum_post').doc(postId).update({
    data: { likeCount: countResult.total, updateTime: db.serverDate() }
  })
  return {
    success: true,
    liked: liked,
    likeCount: countResult.total,
    msg: liked ? '点赞成功' : '取消点赞'
  }
}

async function collectPost(openid, data) {
  var postId = data.postId
  if (!postId) return { success: false, msg: '动态ID缺失' }

  var postResult = await db.collection('forum_post').doc(postId).get()
  if (!postResult.data || postResult.data.status === 'deleted') {
    return { success: false, msg: '动态不存在或已删除' }
  }

  var existingCollect = await db.collection('forum_collect').where({ postId: postId, _openid: openid }).get()
  var collected = false
  
  if (existingCollect.data.length) {
    for (var i = 0; i < existingCollect.data.length; i++) {
      await db.collection('forum_collect').doc(existingCollect.data[i]._id).remove()
    }
  } else {
    await db.collection('forum_collect').doc(relationId('post_collect', openid, postId)).set({
      data: { postId: postId, _openid: openid, createTime: db.serverDate() }
    })
    collected = true
  }

  var countResult = await db.collection('forum_collect').where({ postId: postId }).count()
  await db.collection('forum_post').doc(postId).update({
    data: { collectCount: countResult.total, updateTime: db.serverDate() }
  })
  return {
    success: true,
    collected: collected,
    collectCount: countResult.total,
    msg: collected ? '收藏成功' : '取消收藏'
  }
}

async function getComments(data, openid) {
  var postId = data.postId
  var page = data.page || 1
  var pageSize = data.pageSize || 20
  
  if (!postId) return { success: false, msg: '动态ID缺失' }

  var skip = (page - 1) * pageSize
  var res = await db.collection('forum_comment')
    .where({ postId: postId, status: cmd.neq('deleted') })
    .orderBy('createTime', 'asc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var comments = []
  var avatarFileIDs = []
  var avatarMap = {}
  var openidSet = new Set()
  
  for (var i = 0; i < res.data.length; i++) {
    var item = res.data[i]
    if (!item.isAnonymous && item._openid) {
      openidSet.add(item._openid)
    }
  }
  
  var openids = Array.from(openidSet)
  var userMap = {}
  
  if (openids.length > 0) {
    var userRes = await db.collection('users').where({
      openid: cmd.in(openids)
    }).get()
    
    for (var j = 0; j < userRes.data.length; j++) {
      var user = userRes.data[j]
      userMap[user.openid] = {
        nickname: user.nickName || '用户' + user.openid.slice(-6),
        avatar: user.avatarUrl || ''
      }
      if (user.avatarUrl && user.avatarUrl.indexOf('cloud://') === 0) {
        avatarFileIDs.push(user.avatarUrl)
      }
    }
    
    var forumUserRes = await db.collection('forum_user').where({
      _openid: cmd.in(openids)
    }).get()
    
    for (var fu = 0; fu < forumUserRes.data.length; fu++) {
      var forumUser = forumUserRes.data[fu]
      if (!userMap[forumUser._openid]) {
        userMap[forumUser._openid] = {
          nickname: forumUser.nickname || '用户' + forumUser._openid.slice(-6),
          avatar: forumUser.avatar || ''
        }
      } else if (!userMap[forumUser._openid].avatar && forumUser.avatar) {
        userMap[forumUser._openid].avatar = forumUser.avatar
      }
      if (forumUser.avatar && forumUser.avatar.indexOf('cloud://') === 0) {
        avatarFileIDs.push(forumUser.avatar)
      }
    }
  }
  
  for (var k = 0; k < res.data.length; k++) {
    var item = res.data[k]
    var authorInfo = { nickname: '匿名用户', avatar: '', openid: '' }
    if (!item.isAnonymous) {
      if (userMap[item._openid]) {
        authorInfo = { 
          nickname: userMap[item._openid].nickname, 
          avatar: userMap[item._openid].avatar, 
          openid: item._openid
        }
      } else if (item.authorName || item.authorAvatar) {
        authorInfo = { 
          nickname: item.authorName || '用户' + item._openid.slice(-6), 
          avatar: item.authorAvatar || '',
          openid: item._openid
        }
      }
    }
    
    if (authorInfo.avatar && authorInfo.avatar.indexOf('cloud://') === 0) {
      avatarFileIDs.push(authorInfo.avatar)
    }
    
    var replyToInfo = null
    if (item.replyTo) {
      var replyComment = await db.collection('forum_comment').doc(item.replyTo).get()
      if (replyComment.data) {
        replyToInfo = { nickname: '匿名用户' }
        if (!replyComment.data.isAnonymous) {
          if (userMap[replyComment.data._openid]) {
            replyToInfo.nickname = userMap[replyComment.data._openid].nickname
          }
        }
      }
    }

    comments.push({
      _id: item._id,
      _openid: item._openid,
      postId: item.postId,
      content: item.content,
      replyTo: item.replyTo,
      isAnonymous: item.isAnonymous,
      likeCount: item.likeCount,
      createTime: item.createTime,
      createTimeText: formatTime(item.createTime),
      authorInfo: authorInfo,
      replyToInfo: replyToInfo
    })
  }

  if (avatarFileIDs.length > 0) {
    try {
      var tempUrlRes = await cloud.getTempFileURL({ fileList: avatarFileIDs })
      if (tempUrlRes.fileList && tempUrlRes.fileList.length > 0) {
        for (var m = 0; m < tempUrlRes.fileList.length; m++) {
          var fileItem = tempUrlRes.fileList[m]
          if (fileItem.tempFileURL) {
            avatarMap[fileItem.fileID] = fileItem.tempFileURL
          }
        }
      }
    } catch (err) {
      console.error('获取评论头像临时链接失败:', err)
    }
  }

  for (var n = 0; n < comments.length; n++) {
    var comment = comments[n]
    if (comment.authorInfo && comment.authorInfo.avatar && avatarMap[comment.authorInfo.avatar]) {
      comment.authorInfo.avatar = avatarMap[comment.authorInfo.avatar]
    }
  }

  if (comments.length && openid) {
    var commentIds = comments.map(function(comment) { return comment._id })
    var myLikes = await db.collection('forum_like').where({
      commentId: cmd.in(commentIds),
      _openid: openid
    }).get()
    var likedCommentMap = {}
    ;(myLikes.data || []).forEach(function(like) {
      if (like.commentId) likedCommentMap[like.commentId] = true
    })
    comments.forEach(function(comment) {
      comment.isLiked = !!likedCommentMap[comment._id]
    })
  }

  return { success: true, comments: comments, hasMore: res.data.length === pageSize }
}

async function createComment(openid, data) {
  var postId = data.postId
  var content = String(data.content || '').trim()
  var replyTo = String(data.replyTo || '')
  var isAnonymous = data.isAnonymous === true
  var nickname = String(data.nickname || '').trim().slice(0, 30)
  var avatar = String(data.avatar || '').trim().slice(0, 1000)

  if (!postId) return { success: false, msg: '动态ID缺失' }
  if (!content) return { success: false, msg: '请输入评论内容' }
  if (content.length > 1000) return { success: false, msg: '评论不能超过1000个字' }

  var postRes = await db.collection('forum_post').doc(postId).get()
  if (!postRes.data || postRes.data.status === 'deleted') {
    return { success: false, msg: '动态不存在或已删除' }
  }
  var replyComment = null
  if (replyTo) {
    var replyResult = await db.collection('forum_comment').doc(replyTo).get()
    replyComment = replyResult.data
    if (!replyComment || replyComment.postId !== postId || replyComment.status === 'deleted') {
      return { success: false, msg: '回复的评论不存在或已删除' }
    }
  }

  var sensitiveCheck = checkSensitive(content)
  if (sensitiveCheck.hasSensitive) {
    return { success: false, msg: '内容包含敏感词：' + sensitiveCheck.word }
  }

  var banCheck = await checkBanStatus(openid)
  if (banCheck.isBanned) {
    return { success: false, msg: '您已被禁言，禁言至：' + formatTime(banCheck.banTime) }
  }

  var rateCheck = await checkRateLimit(openid, 'comment')
  if (!rateCheck.allowed) {
    return { success: false, msg: '评论过于频繁，请稍后再试' }
  }

  var userRes = await db.collection('users').where({ openid: openid }).limit(1).get()
  var userNickname = '用户' + openid.slice(-6)
  var userAvatar = ''

  if (userRes.data.length > 0) {
    userNickname = userRes.data[0].nickName || nickname || userNickname
    userAvatar = userRes.data[0].avatarUrl || avatar || ''
  } else {
    userNickname = nickname || userNickname
    userAvatar = avatar || ''
  }
  
  var forumUserRes = await db.collection('forum_user').where({ _openid: openid }).limit(1).get()
  if (forumUserRes.data.length === 0) {
    await db.collection('forum_user').add({
      data: {
        _openid: openid,
        nickname: userNickname,
        avatar: userAvatar,
        status: 'normal',
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
  } else {
    var updateData = { updateTime: db.serverDate() }
    if (userNickname && userNickname !== forumUserRes.data[0].nickname) {
      updateData.nickname = userNickname
    }
    if (userAvatar && userAvatar !== forumUserRes.data[0].avatar) {
      updateData.avatar = userAvatar
    }
    await db.collection('forum_user').doc(forumUserRes.data[0]._id).update({
      data: updateData
    })
  }

  var res = await db.collection('forum_comment').add({
    data: {
      _openid: openid,
      postId: postId,
      content: content,
      replyTo: replyTo || '',
      isAnonymous: isAnonymous,
      authorName: isAnonymous ? '匿名用户' : userNickname,
      authorAvatar: isAnonymous ? '' : userAvatar,
      likeCount: 0,
      status: 'normal',
      createTime: db.serverDate()
    }
  })

  var commentCount = await db.collection('forum_comment').where({
    postId: postId,
    status: cmd.neq('deleted')
  }).count()
  await db.collection('forum_post').doc(postId).update({
    data: { commentCount: commentCount.total, updateTime: db.serverDate() }
  })

  if (postRes.data && postRes.data._openid !== openid) {
    await db.collection('forum_notification').add({
      data: {
        type: 'comment',
        fromOpenid: openid,
        toOpenid: postRes.data._openid,
        postId: postId,
        postTitle: postRes.data.title,
        commentId: res._id,
        commentContent: content.substring(0, 50),
        isRead: false,
        createTime: db.serverDate()
      }
    })
  }

  if (replyTo) {
    if (replyComment && replyComment._openid !== openid && replyComment._openid !== (postRes.data ? postRes.data._openid : '')) {
      await db.collection('forum_notification').add({
        data: {
          type: 'reply',
          fromOpenid: openid,
          toOpenid: replyComment._openid,
          postId: postId,
          postTitle: postRes.data ? postRes.data.title : '',
          commentId: res._id,
          commentContent: content.substring(0, 50),
          replyToCommentId: replyTo,
          isRead: false,
          createTime: db.serverDate()
        }
      })
    }
  }

  return { success: true, commentId: res._id, msg: '评论成功' }
}

async function deleteComment(openid, data) {
  var commentId = data.commentId
  if (!commentId) return { success: false, msg: '评论ID缺失' }

  var commentRes = await db.collection('forum_comment').doc(commentId).get()
  if (!commentRes.data) return { success: false, msg: '评论不存在' }
  if (commentRes.data._openid !== openid) return { success: false, msg: '无权限删除此评论' }

  var transition = await db.collection('forum_comment').where({
    _id: commentId,
    _openid: openid,
    status: cmd.neq('deleted')
  }).update({
    data: { status: 'deleted', updateTime: db.serverDate() }
  })
  if (!transition.stats || transition.stats.updated !== 1) {
    return { success: false, msg: '评论已删除，请刷新' }
  }

  var commentCount = await db.collection('forum_comment').where({
    postId: commentRes.data.postId,
    status: cmd.neq('deleted')
  }).count()
  await db.collection('forum_post').doc(commentRes.data.postId).update({
    data: { commentCount: commentCount.total, updateTime: db.serverDate() }
  })

  return { success: true, msg: '删除成功' }
}

async function likeComment(openid, data) {
  var commentId = data.commentId
  if (!commentId) return { success: false, msg: '评论ID缺失' }

  var commentResult = await db.collection('forum_comment').doc(commentId).get()
  if (!commentResult.data || commentResult.data.status === 'deleted') {
    return { success: false, msg: '评论不存在或已删除' }
  }

  var existingLike = await db.collection('forum_like').where({ commentId: commentId, _openid: openid }).get()
  var liked = false
  
  if (existingLike.data.length) {
    for (var i = 0; i < existingLike.data.length; i++) {
      await db.collection('forum_like').doc(existingLike.data[i]._id).remove()
    }
  } else {
    await db.collection('forum_like').doc(relationId('comment_like', openid, commentId)).set({
      data: { commentId: commentId, _openid: openid, createTime: db.serverDate() }
    })
    liked = true
  }

  var countResult = await db.collection('forum_like').where({ commentId: commentId }).count()
  await db.collection('forum_comment').doc(commentId).update({
    data: { likeCount: countResult.total, updateTime: db.serverDate() }
  })
  return { success: true, liked: liked, likeCount: countResult.total }
}

async function reportPost(openid, data) {
  var postId = data.postId
  var reason = data.reason
  if (!postId) return { success: false, msg: '动态ID缺失' }
  reason = String(reason || '').trim()
  if (!reason) return { success: false, msg: '请填写举报理由' }
  if (reason.length > 500) return { success: false, msg: '举报理由不能超过500个字' }

  var postResult = await db.collection('forum_post').doc(postId).get()
  if (!postResult.data || postResult.data.status === 'deleted') {
    return { success: false, msg: '动态不存在或已删除' }
  }
  if (postResult.data._openid === openid) {
    return { success: false, msg: '不能举报自己发布的动态' }
  }
  var existing = await db.collection('forum_report').where({
    _openid: openid,
    postId: postId,
    status: 'pending'
  }).limit(1).get()
  if (existing.data.length) {
    return { success: false, msg: '你已经举报过这条动态，请等待处理' }
  }

  await db.collection('forum_report').add({
    data: {
      _openid: openid,
      postId: postId,
      reason: reason,
      status: 'pending',
      handleAdmin: '',
      createTime: db.serverDate()
    }
  })

  return { success: true, msg: '举报已提交' }
}

async function getUserInfo(openid) {
  var userRes = await db.collection('forum_user').where({ _openid: openid }).limit(1).get()
  
  if (!userRes.data.length) {
    await db.collection('forum_user').add({
      data: {
        _openid: openid,
        nickname: '用户' + openid.slice(-6),
        avatar: '',
        status: 'normal',
        createTime: db.serverDate()
      }
    })
    userRes = await db.collection('forum_user').where({ _openid: openid }).limit(1).get()
  }

  var user = userRes.data[0]
  var postCount = await db.collection('forum_post').where({ _openid: openid, status: cmd.neq('deleted') }).count()
  var collectCount = await db.collection('forum_collect').where({ _openid: openid }).count()
  var commentCount = await db.collection('forum_comment').where({ _openid: openid, status: cmd.neq('deleted') }).count()

  var banInfo = null
  if (user.status === 'banned' && user.banTime) {
    var banEndTime = new Date(user.banTime)
    if (banEndTime > new Date()) {
      banInfo = {
        isBanned: true,
        banTime: user.banTime,
        banReason: user.banReason || '违规操作'
      }
    }
  }

  return {
    success: true,
    user: {
      _id: user._id,
      _openid: user._openid,
      nickname: user.nickname,
      avatar: user.avatar,
      status: user.status,
      createTime: user.createTime,
      postCount: postCount.total,
      collectCount: collectCount.total,
      commentCount: commentCount.total,
      banInfo: banInfo
    }
  }
}

async function getUserPosts(openid, data) {
  var page = Math.max(1, Number(data.page || 1))
  var pageSize = Math.min(50, Math.max(1, Number(data.pageSize || 10)))
  var skip = (page - 1) * pageSize

  var res = await db.collection('forum_post')
    .where({ _openid: openid, status: cmd.neq('deleted') })
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var posts = res.data.map(function(item) {
    return {
      _id: item._id,
      title: item.title,
      content: item.content,
      imgList: Array.isArray(item.imgList) ? item.imgList : [],
      category: item.category,
      isAnonymous: !!item.isAnonymous,
      authorName: item.authorName || '',
      authorAvatar: item.authorAvatar || '',
      likeCount: item.likeCount,
      commentCount: item.commentCount,
      collectCount: item.collectCount,
      createTime: item.createTime,
      createTimeText: formatTime(item.createTime),
      categoryName: getCategoryName(item.category)
    }
  })

  return { success: true, posts: posts, hasMore: res.data.length === pageSize }
}

async function getUserCollections(openid, data) {
  var page = Math.max(1, Number(data.page || 1))
  var pageSize = Math.min(50, Math.max(1, Number(data.pageSize || 10)))
  var skip = (page - 1) * pageSize

  var collectRes = await db.collection('forum_collect')
    .where({ _openid: openid })
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var posts = []
  for (var i = 0; i < collectRes.data.length; i++) {
    var collect = collectRes.data[i]
    var postRes = await db.collection('forum_post').doc(collect.postId).get()
    if (postRes.data && postRes.data.status !== 'deleted') {
      posts.push({
        _id: postRes.data._id,
        title: postRes.data.title,
        content: postRes.data.content,
        imgList: Array.isArray(postRes.data.imgList) ? postRes.data.imgList : [],
        category: postRes.data.category,
        isAnonymous: !!postRes.data.isAnonymous,
        authorName: postRes.data.authorName || '',
        authorAvatar: postRes.data.authorAvatar || '',
        likeCount: postRes.data.likeCount,
        commentCount: postRes.data.commentCount,
        collectCount: postRes.data.collectCount,
        createTime: postRes.data.createTime,
        createTimeText: formatTime(postRes.data.createTime),
        categoryName: getCategoryName(postRes.data.category)
      })
    }
  }

  return { success: true, posts: posts, hasMore: collectRes.data.length === pageSize }
}

async function getUserComments(openid, data) {
  var page = Math.max(1, Number(data.page || 1))
  var pageSize = Math.min(50, Math.max(1, Number(data.pageSize || 10)))
  var skip = (page - 1) * pageSize

  var res = await db.collection('forum_comment')
    .where({ _openid: openid, status: cmd.neq('deleted') })
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var comments = []
  for (var i = 0; i < res.data.length; i++) {
    var comment = res.data[i]
    var postRes = await db.collection('forum_post').doc(comment.postId).get()
    var postAvailable = !!(postRes.data && postRes.data.status !== 'deleted')
    comments.push({
      _id: comment._id,
      postId: comment.postId,
      content: comment.content,
      createTime: comment.createTime,
      createTimeText: formatTime(comment.createTime),
      postTitle: postAvailable ? postRes.data.title : '原动态已删除',
      postDeleted: !postAvailable
    })
  }

  return { success: true, comments: comments, hasMore: res.data.length === pageSize }
}

async function adminLogin(data) {
  return { success: false, msg: '旧动态管理员登录已停用，请使用全局后台' }
}

async function adminGetPosts(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { success: false, msg: '无权限' }

  var status = data.status
  var category = data.category
  var page = data.page || 1
  var pageSize = data.pageSize || 20
  
  var query = {}
  if (status) query.status = status
  if (category) query.category = category

  var skip = (page - 1) * pageSize
  var res = await db.collection('forum_post')
    .where(query)
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var openidSet = new Set()
  for (var i = 0; i < res.data.length; i++) {
    if (res.data[i]._openid) openidSet.add(res.data[i]._openid)
  }
  
  var openids = Array.from(openidSet)
  var userMap = {}
  
  if (openids.length > 0) {
    var userRes = await db.collection('users').where({
      openid: cmd.in(openids)
    }).get()
    for (var j = 0; j < userRes.data.length; j++) {
      userMap[userRes.data[j].openid] = {
        nickname: userRes.data[j].nickName || '用户',
        avatar: userRes.data[j].avatarUrl || ''
      }
    }
  }

  var posts = []
  for (var k = 0; k < res.data.length; k++) {
    var post = res.data[k]
    var authorInfo = { nickname: '匿名用户', avatar: '' }
    if (!post.isAnonymous) {
      if (userMap[post._openid]) {
        authorInfo = userMap[post._openid]
      } else if (post.authorName) {
        authorInfo = { nickname: post.authorName, avatar: post.authorAvatar || '' }
      }
    }
    posts.push({
      _id: post._id,
      title: post.title,
      content: post.content,
      category: post.category,
      status: post.status,
      likeCount: post.likeCount || 0,
      commentCount: post.commentCount || 0,
      isTop: post.isTop || false,
      isEssence: post.isEssence || false,
      createTime: post.createTime,
      createTimeText: formatTime(post.createTime),
      categoryName: getCategoryName(post.category),
      authorInfo: authorInfo
    })
  }

  return { success: true, posts: posts, hasMore: res.data.length === pageSize }
}

async function adminDeletePost(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { success: false, msg: '无权限' }

  var postId = data.postId
  var reason = data.reason
  if (!postId) return { success: false, msg: '动态ID缺失' }

  await db.collection('forum_post').doc(postId).update({
    data: { status: 'deleted', updateTime: db.serverDate() }
  })

  await db.collection('forum_admin_log').add({
    data: {
      adminId: adminCheck.admin._id,
      adminAccount: adminCheck.admin.adminAccount,
      operation: 'delete_post',
      targetId: postId,
      content: reason || '管理员删帖',
      createTime: db.serverDate()
    }
  })

  return { success: true, msg: '删除成功' }
}

async function adminTopPost(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { success: false, msg: '无权限' }

  var postId = data.postId
  var isTop = data.isTop
  if (!postId) return { success: false, msg: '动态ID缺失' }

  await db.collection('forum_post').doc(postId).update({
    data: { isTop: isTop, updateTime: db.serverDate() }
  })

  await db.collection('forum_admin_log').add({
    data: {
      adminId: adminCheck.admin._id,
      adminAccount: adminCheck.admin.adminAccount,
      operation: isTop ? 'top_post' : 'untop_post',
      targetId: postId,
      content: isTop ? '置顶动态' : '取消置顶',
      createTime: db.serverDate()
    }
  })

  return { success: true, msg: isTop ? '已置顶' : '已取消置顶' }
}

async function adminEssencePost(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { success: false, msg: '无权限' }

  var postId = data.postId
  var isEssence = data.isEssence
  if (!postId) return { success: false, msg: '动态ID缺失' }

  await db.collection('forum_post').doc(postId).update({
    data: { isEssence: isEssence, updateTime: db.serverDate() }
  })

  await db.collection('forum_admin_log').add({
    data: {
      adminId: adminCheck.admin._id,
      adminAccount: adminCheck.admin.adminAccount,
      operation: isEssence ? 'essence_post' : 'unessence_post',
      targetId: postId,
      content: isEssence ? '设为精华' : '取消精华',
      createTime: db.serverDate()
    }
  })

  return { success: true, msg: isEssence ? '已设为精华' : '已取消精华' }
}

async function adminGetReports(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { success: false, msg: '无权限' }

  var status = data.status
  var page = data.page || 1
  var pageSize = data.pageSize || 20
  
  var query = {}
  if (status) query.status = status

  var skip = (page - 1) * pageSize
  var res = await db.collection('forum_report')
    .where(query)
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var reports = []
  for (var i = 0; i < res.data.length; i++) {
    var report = res.data[i]
    var postRes = await db.collection('forum_post').doc(report.postId).get()
    reports.push({
      _id: report._id,
      postId: report.postId,
      reason: report.reason,
      status: report.status,
      createTime: report.createTime,
      createTimeText: formatTime(report.createTime),
      postTitle: postRes.data ? postRes.data.title : '动态已删除'
    })
  }

  return { success: true, reports: reports, hasMore: res.data.length === pageSize }
}

async function adminHandleReport(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { success: false, msg: '无权限' }

  var reportId = data.reportId
  var action = data.action
  var reason = data.reason
  if (!reportId) return { success: false, msg: '举报ID缺失' }

  var reportRes = await db.collection('forum_report').doc(reportId).get()
  if (!reportRes.data) return { success: false, msg: '举报不存在' }

  await db.collection('forum_report').doc(reportId).update({
    data: {
      status: 'handled',
      handleAdmin: adminCheck.admin.adminAccount,
      handleTime: db.serverDate()
    }
  })

  if (action === 'delete') {
    await db.collection('forum_post').doc(reportRes.data.postId).update({
      data: { status: 'deleted', updateTime: db.serverDate() }
    })
  }

  await db.collection('forum_admin_log').add({
    data: {
      adminId: adminCheck.admin._id,
      adminAccount: adminCheck.admin.adminAccount,
      operation: 'handle_report',
      targetId: reportId,
      content: action === 'delete' ? '删除被举报动态' : '忽略举报',
      createTime: db.serverDate()
    }
  })

  return { success: true, msg: '处理完成' }
}

async function adminGetUsers(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { success: false, msg: '无权限' }

  var status = data.status
  var keyword = data.keyword
  var page = data.page || 1
  var pageSize = data.pageSize || 20
  
  var query = {}
  if (status) query.status = status
  if (keyword) {
    query.nickname = db.RegExp({ regexp: keyword, options: 'i' })
  }

  var skip = (page - 1) * pageSize
  var res = await db.collection('forum_user')
    .where(query)
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var users = res.data.map(function(item) {
    return {
      _id: item._id,
      _openid: item._openid,
      nickname: item.nickname,
      avatar: item.avatar,
      status: item.status,
      banTime: item.banTime,
      banReason: item.banReason,
      createTime: item.createTime,
      createTimeText: formatTime(item.createTime)
    }
  })

  return { success: true, users: users, hasMore: res.data.length === pageSize }
}

async function adminBanUser(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { success: false, msg: '无权限' }

  var targetOpenid = data.targetOpenid
  var duration = data.duration
  var reason = data.reason
  if (!targetOpenid) return { success: false, msg: '用户ID缺失' }

  var banEndTime = null
  if (duration === 'forever') {
    banEndTime = new Date('2099-12-31')
  } else {
    var days = parseInt(duration) || 1
    banEndTime = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  }

  await db.collection('forum_user').where({ _openid: targetOpenid }).update({
    data: {
      status: 'banned',
      banTime: banEndTime,
      banReason: reason || '违规操作'
    }
  })

  await db.collection('forum_admin_log').add({
    data: {
      adminId: adminCheck.admin._id,
      adminAccount: adminCheck.admin.adminAccount,
      operation: 'ban_user',
      targetId: targetOpenid,
      content: '禁言用户，时长：' + (duration === 'forever' ? '永久' : duration + '天') + '，原因：' + (reason || '违规操作'),
      createTime: db.serverDate()
    }
  })

  return { success: true, msg: '禁言成功' }
}

async function adminUnbanUser(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { success: false, msg: '无权限' }

  var targetOpenid = data.targetOpenid
  if (!targetOpenid) return { success: false, msg: '用户ID缺失' }

  await db.collection('forum_user').where({ _openid: targetOpenid }).update({
    data: {
      status: 'normal',
      banTime: null,
      banReason: ''
    }
  })

  await db.collection('forum_admin_log').add({
    data: {
      adminId: adminCheck.admin._id,
      adminAccount: adminCheck.admin.adminAccount,
      operation: 'unban_user',
      targetId: targetOpenid,
      content: '解除禁言',
      createTime: db.serverDate()
    }
  })

  return { success: true, msg: '已解除禁言' }
}

async function adminGetLogs(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { success: false, msg: '无权限' }

  var page = data.page || 1
  var pageSize = data.pageSize || 20
  var skip = (page - 1) * pageSize

  var res = await db.collection('forum_admin_log')
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var logs = res.data.map(function(item) {
    return {
      _id: item._id,
      adminAccount: item.adminAccount,
      operation: item.operation,
      targetId: item.targetId,
      content: item.content,
      createTime: item.createTime,
      createTimeText: formatTime(item.createTime)
    }
  })

  return { success: true, logs: logs, hasMore: res.data.length === pageSize }
}

async function adminCreateAdmin(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin || adminCheck.admin.role !== 'super') {
    return { success: false, msg: '仅超级管理员可添加管理员' }
  }

  var account = data.account
  var password = data.password
  var role = data.role
  var manageScope = data.manageScope
  
  if (!account || !password) return { success: false, msg: '请输入账号密码' }

  var existingAdmin = await db.collection('forum_admin').where({ adminAccount: account }).get()
  if (existingAdmin.data.length) {
    return { success: false, msg: '账号已存在' }
  }

  await db.collection('forum_admin').add({
    data: {
      adminAccount: account,
      adminPwd: md5(password),
      role: role || 'normal',
      manageScope: manageScope || ['all'],
      createTime: db.serverDate()
    }
  })

  await db.collection('forum_admin_log').add({
    data: {
      adminId: adminCheck.admin._id,
      adminAccount: adminCheck.admin.adminAccount,
      operation: 'create_admin',
      targetId: account,
      content: '创建管理员账号：' + account,
      createTime: db.serverDate()
    }
  })

  return { success: true, msg: '创建成功' }
}

async function adminDeleteAdmin(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin || adminCheck.admin.role !== 'super') {
    return { success: false, msg: '仅超级管理员可删除管理员' }
  }

  var adminId = data.adminId
  if (!adminId) return { success: false, msg: '管理员ID缺失' }

  var targetAdmin = await db.collection('forum_admin').doc(adminId).get()
  if (!targetAdmin.data) return { success: false, msg: '管理员不存在' }
  if (targetAdmin.data.role === 'super') {
    return { success: false, msg: '不能删除超级管理员' }
  }

  await db.collection('forum_admin').doc(adminId).remove()

  await db.collection('forum_admin_log').add({
    data: {
      adminId: adminCheck.admin._id,
      adminAccount: adminCheck.admin.adminAccount,
      operation: 'delete_admin',
      targetId: adminId,
      content: '删除管理员账号：' + targetAdmin.data.adminAccount,
      createTime: db.serverDate()
    }
  })

  return { success: true, msg: '删除成功' }
}

async function adminGetAdmins(openid) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin || adminCheck.admin.role !== 'super') {
    return { success: false, msg: '仅超级管理员可查看管理员列表' }
  }

  var res = await db.collection('forum_admin').get()
  var admins = res.data.map(function(item) {
    return {
      _id: item._id,
      adminAccount: item.adminAccount,
      role: item.role,
      manageScope: item.manageScope,
      createTimeText: formatTime(item.createTime)
    }
  })

  return { success: true, admins: admins }
}

async function adminUpdatePostStatus(openid, data) {
  var adminCheck = await checkAdmin(openid)
  if (!adminCheck.isAdmin) return { success: false, msg: '无权限' }

  var postId = data.postId
  var status = data.status
  if (!postId) return { success: false, msg: '动态ID缺失' }

  await db.collection('forum_post').doc(postId).update({
    data: { status: status, updateTime: db.serverDate() }
  })

  await db.collection('forum_admin_log').add({
    data: {
      adminId: adminCheck.admin._id,
      adminAccount: adminCheck.admin.adminAccount,
      operation: 'update_status',
      targetId: postId,
      content: '更新动态状态为：' + status,
      createTime: db.serverDate()
    }
  })

  return { success: true, msg: '状态更新成功' }
}

async function searchPosts(data) {
  var keyword = String(data.keyword || '').trim()
  var page = Math.max(1, Number(data.page || 1))
  var pageSize = Math.min(30, Math.max(1, Number(data.pageSize || 10)))
  if (!keyword) return { success: false, msg: '请输入搜索关键词' }
  if (keyword.length > 40) return { success: false, msg: '搜索关键词不能超过40个字' }

  var skip = (page - 1) * pageSize
  var safeKeyword = escapeRegExp(keyword)
  var res = await db.collection('forum_post')
    .where(cmd.or([
      { title: db.RegExp({ regexp: safeKeyword, options: 'i' }) },
      { content: db.RegExp({ regexp: safeKeyword, options: 'i' }) }
    ]).and({ status: cmd.neq('deleted') }))
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get()

  var posts = res.data.map(function(item) {
    return {
      _id: item._id,
      title: item.title,
      content: item.content,
      imgList: item.imgList,
      category: item.category,
      likeCount: item.likeCount,
      commentCount: item.commentCount,
      collectCount: item.collectCount,
      createTime: item.createTime,
      createTimeText: formatTime(item.createTime),
      categoryName: getCategoryName(item.category)
    }
  })

  return { success: true, posts: posts, hasMore: res.data.length === pageSize }
}
