'use strict'

const crypto = require('node:crypto')
const { normalizeModules } = require('./module-policy')
const { eligible } = require('./run-records')
const key = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex')
const localDate = value => {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : ''
}
function uploadImage(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value), base = new URL(process.env.PUBLIC_BASE_URL || 'https://www.crbuj.icu/campus-api')
    return url.origin === base.origin && url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/uploads/') && !url.search && !url.hash && /\.(png|jpe?g|webp|gif)$/i.test(url.pathname)
  } catch { return false }
}

// Read committed business records before taking the wallet lock, avoiding cross-module lock inversion.
async function campusSnapshot(db, openid, date) {
  const rows = async (name, where) => (await (where ? db.collection(name).where(where) : db.collection(name)).get()).data
  const modules = normalizeModules((await rows('global_settings'))[0]?.modules)
  const runs = (await rows('runRecords', { openid, date })).filter(eligible)
  const comments = [], photos = [], likes = []
  if (modules.canteen.enabled) {
    const dishes = (await rows('canteen_dishes')).filter(row => row.status === 'published')
    const stalls = new Set((await rows('canteen_stalls')).filter(row => row.status === 'published').map(row => row._id))
    const published = new Set(dishes.filter(row => stalls.has(row.stallId)).map(row => row._id))
    const reviews = (await rows('canteen_reviews', { openid, status: 'visible' })).filter(row => published.has(row.dishId))
    for (const review of reviews) {
      if ((review.comment || Number.isInteger(review.score) && review.score >= 1 && review.score <= 5) && localDate(review.createdAt) === date) comments.push(review._id)
      if ((review.images || []).some(uploadImage) && localDate(review.imagesAddedAt || review.createdAt) === date) photos.push(review._id)
    }
    if (reviews.length) for (const like of await rows('canteen_review_likes', { reviewId: db.command.in(reviews.map(row => row._id)) })) {
      if (like.vote !== 'down' && like.openid && like.openid !== openid && localDate(like.createdAt) === date) likes.push({ key: key('canteen', like.reviewId, like.openid), module: 'canteen' })
    }
  }
  if (modules.forum.enabled) {
    const posts = (await rows('forum_post')).filter(row => row.status === 'normal')
    const published = new Set(posts.map(row => row._id))
    const ownedComments = (await rows('forum_comment', { _openid: openid, status: 'normal' })).filter(row => published.has(row.postId))
    for (const comment of ownedComments) if (comment.content && localDate(comment.createTime) === date) comments.push(comment._id)
    for (const post of posts) if (post._openid === openid && localDate(post.createTime) === date && (post.imgList || []).some(uploadImage)) photos.push(post._id)
    if (ownedComments.length) for (const like of await rows('forum_like', { commentId: db.command.in(ownedComments.map(row => row._id)) })) {
      if (like._openid && like._openid !== openid && localDate(like.createTime) === date) likes.push({ key: key('forum', like.commentId, like._openid), module: 'forum' })
    }
  }
  return { modules, distanceKm: runs.reduce((sum, row) => sum + Number(row.distance), 0) / 1000, hasRun: runs.length > 0, comment: comments.length > 0, photo: photos.length > 0, likes: [...new Map(likes.map(like => [like.key, like])).values()] }
}

async function settleCampusRewards({ db, get, profile, day, snapshot, now }) {
  if (!day.campusRunGoalKm) day.campusRunGoalKm = profile.campusRunPlan.goalKm
  if (snapshot.hasRun) day.campusRunFrozen = true
  const config = day.rewards, existing = (await db.collection('english_coin_ledger').where({ openid: profile.openid, date: day.date }).get()).data
  const issued = existing.filter(row => row.kind === 'campus_reward')
  let coinsEarned = 0, likeCount = issued.filter(row => row.task === 'like').length
  const award = async (task, id) => {
    const ledgerId = key('campus-reward', profile.openid, task, id)
    if (await get('english_coin_ledger', ledgerId)) return
    const amount = config[task + 'Reward']
    const row = { openid: profile.openid, date: day.date, kind: 'campus_reward', task, sourceId: id, amount, createdAt: now }
    await db.collection('english_coin_ledger').doc(ledgerId).create({ data: row })
    issued.push(row)
    profile.coins += amount
    coinsEarned += amount
    if (task === 'like') likeCount++
  }
  if (snapshot.modules.running.enabled && snapshot.distanceKm >= day.campusRunGoalKm) await award('running', day.date)
  if (snapshot.comment) await award('comment', day.date)
  if (snapshot.photo) await award('photo', day.date)
  for (const like of snapshot.likes) { if (likeCount >= config.likeDailyCap) break; await award('like', like.key) }
  return { coinsEarned, issued }
}

function campusTasks(profile, day, snapshot, issued) {
  const interaction = snapshot.modules.canteen.enabled || snapshot.modules.forum.enabled
  const path = snapshot.modules.canteen.enabled ? '/packageCanteen/pages/index/index' : '/packageForum/pages/index/index'
  const definitions = [
    { id: 'running', label: '完成每日跑步目标', target: day.campusRunGoalKm, progress: Math.round(snapshot.distanceKm * 1000) / 1000, unit: '公里', available: snapshot.modules.running.enabled, module: 'running', path: '/pages/index/index' },
    { id: 'comment', label: '发表一条评价或评论', target: 1, progress: Number(snapshot.comment), unit: '条', available: interaction, module: snapshot.modules.canteen.enabled ? 'canteen' : 'forum', path },
    { id: 'photo', label: '分享一张照片', target: 1, progress: Number(snapshot.photo), unit: '次', available: interaction, module: snapshot.modules.canteen.enabled ? 'canteen' : 'forum', path },
    { id: 'like', label: '自己的评论收到赞', target: day.rewards.likeDailyCap, progress: issued.filter(row => row.task === 'like').length, unit: '个', available: interaction, module: snapshot.modules.canteen.enabled ? 'canteen' : 'forum', path }
  ]
  return { date: day.date, coins: profile.coins, runGoalKm: day.campusRunGoalKm, runGoalFrozen: Boolean(day.campusRunFrozen), pendingRunGoal: profile.campusRunPlan.pending, earnedToday: issued.reduce((sum, row) => sum + row.amount, 0), tasks: definitions.map(task => {
    const rewards = issued.filter(row => row.task === task.id)
    return { ...task, reward: day.rewards[task.id + 'Reward'], earned: rewards.reduce((sum, row) => sum + row.amount, 0), rewarded: task.id === 'like' ? rewards.length >= task.target : rewards.length > 0 }
  }) }
}

module.exports = { campusSnapshot, settleCampusRewards, campusTasks, uploadImage }
