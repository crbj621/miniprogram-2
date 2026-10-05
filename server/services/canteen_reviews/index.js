const cloud = require('campus-server-sdk')
const crypto = require('crypto')
const { uploadImage } = require('../../src/campus-rewards')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const COLLECTIONS = ['canteen_stalls', 'canteen_dishes', 'canteen_reviews', 'canteen_ratings', 'canteen_submissions', 'canteen_review_likes', 'canteen_reports', 'canteen_report_cases']

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function ownReviewId(dishId, openid) {
  return crypto.createHash('sha256').update(dishId + ':' + openid).digest('hex')
}

function writeTransaction(callback) {
  // Catalog, contributions and ratings share references: serialize their short writes across processes.
  return db.runTransaction(callback, { lock: 'canteen:write', readCommitted: true })
}

const key = (...parts) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')
const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
const avatar = value => /^https:\/\//i.test(clean(value, 1000)) ? clean(value, 1000) : ''
const MEALS = ['breakfast', 'lunch', 'dinner']
function mealList(value) { return Array.isArray(value) ? MEALS.filter(meal => value.includes(meal)) : MEALS.slice() }
function feedback(rows) {
  return [...new Map(rows.filter(row => typeof row.openid === 'string' && row.openid)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a._id).localeCompare(String(b._id)))
    .map(row => [row.reviewId + ':' + row.openid, row])).values()]
}
let ratingsReady
async function ensureRatings() {
  if (!ratingsReady) ratingsReady = writeTransaction(async () => {
    const legacy = (await all('canteen_reviews')).filter(row => row.ratingVersion !== 2 && row.openid && row.dishId && Number.isInteger(row.score) && row.score >= 1 && row.score <= 5)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)) || String(b._id).localeCompare(String(a._id)))
    for (const row of legacy) {
      const id = ownReviewId(row.dishId, row.openid)
      if ((await db.collection('canteen_ratings').doc(id).get()).data) continue
      await db.collection('canteen_ratings').doc(id).create({ data: { dishId: row.dishId, openid: row.openid, score: row.score,
        reviewId: row._id, status: row.status === 'visible' ? 'visible' : row.status, createdAt: row.createdAt, updatedAt: row.updatedAt || row.createdAt } })
    }
  }).catch(error => { ratingsReady = null; throw error })
  return ratingsReady
}

function scoreOf(rows) {
  const count = rows.length
  const sum = rows.reduce((total, row) => total + Number(row.score || 0), 0)
  return { count, score: count ? Math.round(sum / count * 10) / 10 : 0 }
}

function verdict(score, count) {
  if (count < 2) return ''
  if (score >= 4) return '推荐'
  if (score <= 2.5) return '避雷'
  return ''
}

async function all(collection, query) {
  const request = db.collection(collection)
  return (await (query ? request.where(query) : request).get()).data || []
}

async function admin(openid) {
  const result = await db.collection('global_admin').where({ loginOpenid: openid, status: db.command.neq('disabled') }).limit(1).get()
  return result.data.length > 0
}

async function user(openid) {
  const result = await db.collection('users').where({ openid }).limit(1).get()
  return result.data[0] || null
}

async function isOpen() {
  const result = await db.collection('global_settings').limit(1).get()
  const modules = result.data.length ? result.data[0].modules || {} : {}
  return modules.canteen !== false && (!modules.canteen || modules.canteen.enabled !== false)
}

async function catalog(includeDrafts, meal) {
  const [stalls, dishes, reviews, ratings] = await Promise.all([
    all('canteen_stalls'), all('canteen_dishes'), all('canteen_reviews', { status: 'visible' }), all('canteen_ratings', { status: 'visible' })
  ])
  const visibleStalls = stalls.filter(row => includeDrafts || row.status === 'published')
  const stallIds = new Set(visibleStalls.map(row => row._id))
  const publishedDishes = dishes.filter(row => stallIds.has(row.stallId) && (includeDrafts || row.status === 'published'))
  const visibleDishes = publishedDishes.filter(row => !MEALS.includes(meal) || mealList(row.meals).includes(meal))
  const dishStalls = new Map(visibleDishes.map(row => [row._id, row.stallId]))
  const byDish = {}, stallVotes = {}, commentCounts = {}
  reviews.forEach(row => { if (dishStalls.has(row.dishId)) commentCounts[row.dishId] = (commentCounts[row.dishId] || 0) + 1 })
  ratings.forEach(row => {
    const stallId = dishStalls.get(row.dishId)
    if (!stallId) return
    if (!byDish[row.dishId]) byDish[row.dishId] = []
    if (!stallVotes[stallId]) stallVotes[stallId] = []
    byDish[row.dishId].push(row)
    stallVotes[stallId].push(row)
  })
  const fullDishes = visibleDishes.map(row => {
    const rating = scoreOf(byDish[row._id] || [])
    return { ...row, ...rating, meals: mealList(row.meals), reviewCount: commentCounts[row._id] || 0, verdict: verdict(rating.score, rating.count) }
  })
  const byStall = {}
  fullDishes.forEach(row => {
    if (!byStall[row.stallId]) byStall[row.stallId] = []
    byStall[row.stallId].push(row)
  })
  const fullStalls = visibleStalls.map(row => {
    const items = byStall[row._id] || []
    const votes = stallVotes[row._id] || []
    const rating = scoreOf(votes)
    return { ...row, ...rating, meals: publishedDishes.some(dish => dish.stallId === row._id) ? MEALS.filter(meal => publishedDishes.some(dish => dish.stallId === row._id && mealList(dish.meals).includes(meal))) : mealList(row.meals),
      dishCount: items.length, reviewCount: items.reduce((sum, dish) => sum + dish.reviewCount, 0),
      verdict: verdict(rating.score, rating.count) }
  })
  return { stalls: fullStalls, dishes: fullDishes, reviews }
}

function sortRank(rows) {
  return rows.sort((a, b) => b.score - a.score || b.count - a.count || String(a.name).localeCompare(String(b.name), 'zh-CN'))
}

async function list(event) {
  const data = await catalog(false, event.meal)
  const keyword = clean(event.keyword, 40).toLowerCase()
  const inMeal = row => !MEALS.includes(event.meal) || row.meals.includes(event.meal)
  const stalls = sortRank(data.stalls.filter(row => inMeal(row) && (!keyword || row.name.toLowerCase().includes(keyword) || clean(row.location, 100).toLowerCase().includes(keyword))))
  const dishes = sortRank(data.dishes.filter(row => inMeal(row) && (!keyword || row.name.toLowerCase().includes(keyword))))
  return { success: true, stalls, dishes }
}

async function detail(event, openid) {
  const data = await catalog(false, event.meal)
  const stall = data.stalls.find(row => row._id === clean(event.stallId, 80))
  if (!stall) return { success: false, msg: '档口不存在或尚未发布' }
  const dishes = sortRank(data.dishes.filter(row => row.stallId === stall._id && (!MEALS.includes(event.meal) || row.meals.includes(event.meal))))
  return { success: true, stall, dishes, photos: await stallPhotos(stall._id, openid) }
}

async function reviews(event, openid) {
  const dishId = clean(event.dishId, 80)
  const dish = await db.collection('canteen_dishes').doc(dishId).get().catch(() => null)
  if (!dish || !dish.data || dish.data.status !== 'published') return { success: false, msg: '菜品不存在' }
  const stall = await db.collection('canteen_stalls').doc(dish.data.stallId).get().catch(() => null)
  if (!stall || !stall.data || stall.data.status !== 'published') return { success: false, msg: '档口暂未发布' }
  const [rows, ratings] = await Promise.all([all('canteen_reviews', { dishId, status: 'visible' }), all('canteen_ratings', { dishId })])
  const profiles = rows.length ? await all('users', { openid: db.command.in([...new Set(rows.map(row => row.openid))]) }) : []
  const profileById = new Map(profiles.map(row => [row.openid, row]))
  const ratingByOwner = new Map(ratings.map(row => [row.openid, row]))
  const likesByReview = new Map(rows.map(row => [row._id, new Set()])), downsByReview = new Map(rows.map(row => [row._id, new Set()]))
  if (rows.length) for (const like of feedback(await all('canteen_review_likes', { reviewId: db.command.in(rows.map(row => row._id)) }))) {
    if (typeof like.openid === 'string' && like.openid && likesByReview.has(like.reviewId)) (like.vote === 'down' ? downsByReview : likesByReview).get(like.reviewId).add(like.openid)
  }
  const sort = event.sort === 'hot' ? 'hot' : 'latest'
  const items = rows.map(row => ({ _id: row._id, score: row.score, comment: row.comment,
    nickname: clean((profileById.get(row.openid) || {}).nickName, 30) || row.nickname || '同学',
    avatarUrl: avatar((profileById.get(row.openid) || {}).avatarUrl) || avatar(row.avatarUrl),
    latestRating: Boolean(ratingByOwner.get(row.openid) && ratingByOwner.get(row.openid).status === 'visible' && ratingByOwner.get(row.openid).reviewId === row._id),
    images: row.images || [], likeCount: likesByReview.get(row._id).size, downCount: downsByReview.get(row._id).size,
    isLiked: likesByReview.get(row._id).has(openid), myVote: downsByReview.get(row._id).has(openid) ? 'down' : likesByReview.get(row._id).has(openid) ? 'up' : '',
    disputed: row.disputeStatus === 'pending', updatedAt: row.updatedAt, mine: row.openid === openid }))
  items.sort((a, b) => (sort === 'hot' ? b.likeCount - a.likeCount : 0) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(b._id).localeCompare(String(a._id)))
  const mine = ratingByOwner.get(openid)
  return { success: true, dish: dish.data, stall: stall.data, ...scoreOf(ratings.filter(row => row.status === 'visible')), reviewCount: rows.length,
    myRating: mine ? { score: mine.score, status: mine.status } : null, sort, reviews: items }
}

async function saveReview(event, openid) {
  const account = await user(openid)
  if (!account) return { success: false, msg: '请先登录后评价' }
  const clientId = clean(event.clientId, 80)
  const score = event.score == null ? null : Number(event.score)
  const comment = clean(event.comment, 500)
  if (!clientId && score === null) return { success: false, msg: '请选择 1 到 5 分' }
  if (score !== null && (!Number.isInteger(score) || score < 1 || score > 5)) return { success: false, msg: '请选择 1 到 5 分，或只发交流评论' }
  if (!comment) return { success: false, msg: '请填写评价内容' }
  const dishId = clean(event.dishId, 80)
  const dish = await db.collection('canteen_dishes').doc(dishId).get().catch(() => null)
  if (!dish || !dish.data || dish.data.status !== 'published') return { success: false, msg: '菜品不存在' }
  const stall = await db.collection('canteen_stalls').doc(dish.data.stallId).get().catch(() => null)
  if (!stall || !stall.data || stall.data.status !== 'published') return { success: false, msg: '档口暂未发布' }
  const now = new Date().toISOString()
  const images = event.images === undefined ? [] : event.images
  if (!Array.isArray(images) || images.length > 4 || images.some(image => !uploadImage(image))) return { success: false, msg: '最多4张本站上传的图片' }
  const uniqueImages = [...new Set(images)], requestHash = key(dishId, score, comment, uniqueImages)
  const ratingId = ownReviewId(dishId, openid)
  const previousRating = score !== null ? (await db.collection('canteen_ratings').doc(ratingId).get()).data : null
  const ratingLocked = previousRating && ['contested', 'excluded', 'hidden'].includes(previousRating.status)
  const hashOf = row => row.requestHash || key(row.dishId, row.score, clean(row.comment, 500), [...new Set(row.images || [])])
  let id = key('review', dishId, openid, clientId)
  if (!clientId) {
    // Published clients lack request IDs: replay the current score's comment, or advance from it.
    if (ratingLocked) return { success: false, msg: '你的评分正在核查或已被排除，暂不能修改评分' }
    const linked = previousRating ? (await db.collection('canteen_reviews').doc(previousRating.reviewId).get()).data : null
    id = linked && linked.status === 'visible' && hashOf(linked) === requestHash ? previousRating.reviewId
      : key('legacy-review', dishId, openid, previousRating ? previousRating.reviewId : '', requestHash)
  }
  const previous = (await db.collection('canteen_reviews').doc(id).get()).data
  if (previous) {
    if (previous.status !== 'visible') return { success: false, msg: '这条评论已删除或隐藏，不能重新发布' }
    if (hashOf(previous) !== requestHash) return { success: false, msg: '这次提交的内容已变化，请重新发送' }
    return { success: true, id, msg: '评论已发布' }
  }
  if (ratingLocked) return { success: false, msg: '你的评分正在核查或已被排除，可以不打分继续交流' }
  await db.collection('canteen_reviews').doc(id).create({ data: {
    dishId, stallId: dish.data.stallId, openid, score, comment, images: uniqueImages, imagesAddedAt: images.length ? now : null,
    nickname: clean(account.nickName, 30) || '同学', avatarUrl: avatar(account.avatarUrl), status: 'visible', requestHash, ratingVersion: 2,
    createdAt: now, updatedAt: now
  } })
  if (score !== null) {
    await db.collection('canteen_ratings').doc(ratingId).set({ data: { dishId, openid, score, reviewId: id,
      status: 'visible', createdAt: previousRating ? previousRating.createdAt : now, updatedAt: now } })
  }
  return { success: true, id, msg: score === null ? '评论已发布' : '评论已发布，评分已更新' }
}

async function deleteReview(event, openid) {
  if (!await user(openid)) return { success: false, msg: '请先登录后删除评价' }
  const reviewId = clean(event.reviewId, 80)
  const review = (await db.collection('canteen_reviews').doc(reviewId).get()).data
  if (!review) return { success: false, msg: '评价不存在' }
  if (review.openid !== openid) return { success: false, msg: '只能删除自己的评价' }
  if (review.status === 'deleted') return { success: true, msg: '评价已删除' }
  const now = new Date().toISOString()
  await db.collection('canteen_reviews').doc(reviewId).update({ data: { status: 'deleted', comment: '', images: [], avatarUrl: '', deletedAt: now, updatedAt: now } })
  await db.collection('canteen_review_likes').where({ reviewId }).remove()
  return { success: true, msg: '评价已删除' }
}

async function voteReview(event, openid) {
  if (!await user(openid)) return { success: false, msg: '请先登录后点赞' }
  const reviewId = clean(event.reviewId, 80)
  const review = (await db.collection('canteen_reviews').doc(reviewId).get()).data
  if (!review || review.status !== 'visible') return { success: false, msg: '评价不存在或已隐藏' }
  if (review.openid === openid) return { success: false, msg: '不能给自己的评论投反馈票' }
  const vote = event.vote || 'up'
  if (!['up', 'down'].includes(vote)) return { success: false, msg: '请选择有用或存疑' }
  const dish = (await db.collection('canteen_dishes').doc(review.dishId).get()).data
  const stall = dish && (await db.collection('canteen_stalls').doc(dish.stallId).get()).data
  if (!dish || dish.status !== 'published' || !stall || stall.status !== 'published') return { success: false, msg: '菜品或档口暂未发布' }
  const id = crypto.createHash('sha256').update(reviewId + ':' + openid).digest('hex')
  const previous = (await all('canteen_review_likes', { reviewId, openid }))[0]
  await db.collection('canteen_review_likes').where({ reviewId, openid }).remove()
  const selected = previous && (previous.vote || 'up') === vote ? '' : vote
  if (selected) await db.collection('canteen_review_likes').doc(id).create({ data: { reviewId, openid, vote: selected, createdAt: new Date().toISOString() } })
  const likes = await all('canteen_review_likes', { reviewId })
  const valid = feedback(likes).filter(like => like.openid !== review.openid)
  const up = new Set(valid.filter(like => like.vote !== 'down').map(like => like.openid)), down = new Set(valid.filter(like => like.vote === 'down').map(like => like.openid))
  let disputed = review.disputeStatus === 'pending'
  if (down.size >= 5 && down.size / (up.size + down.size) >= 0.7 && !review.disputeResolution) {
    disputed = true
    await db.collection('canteen_reviews').doc(reviewId).update({ data: { disputeStatus: 'pending', disputeComment: review.comment, disputedAt: new Date().toISOString() } })
    const ratingId = ownReviewId(review.dishId, review.openid), rating = (await db.collection('canteen_ratings').doc(ratingId).get()).data
    if (rating && rating.reviewId === reviewId && rating.status === 'visible') await db.collection('canteen_ratings').doc(ratingId).update({ data: { status: 'contested' } })
  }
  return { success: true, isLiked: selected === 'up', myVote: selected, likeCount: up.size, downCount: down.size, disputed }
}

async function resolveDispute(event, openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  if (!['restore', 'exclude'].includes(event.resolution)) return { success: false, msg: '请选择恢复评分或排除评分' }
  const id = clean(event.id, 80), review = (await db.collection('canteen_reviews').doc(id).get()).data
  if (!review || review.disputeStatus !== 'pending') return { success: false, msg: '这条争议已处理，请刷新' }
  const ratingId = ownReviewId(review.dishId, review.openid), rating = (await db.collection('canteen_ratings').doc(ratingId).get()).data
  if (rating && rating.reviewId === id && rating.status === 'contested') await db.collection('canteen_ratings').doc(ratingId).update({ data: { status: event.resolution === 'restore' ? 'visible' : 'excluded' } })
  await db.collection('canteen_reviews').doc(id).update({ data: { disputeStatus: 'resolved', disputeResolution: event.resolution, resolvedAt: new Date().toISOString(), reviewer: openid } })
  return { success: true, msg: event.resolution === 'restore' ? '已核实并恢复评分；评论的删除状态保持不变' : '已核实，争议评分不再计入排名' }
}

async function random(event) {
  const mode = ['quality', 'all', 'unusual'].includes(event.mode) ? event.mode : 'all'
  const data = await catalog(false)
  let pool = data.dishes.filter(row => !MEALS.includes(event.meal) || row.meals.includes(event.meal))
  if (mode === 'quality') pool = pool.filter(row => row.score >= 4 && row.count >= 2)
  if (mode === 'unusual') pool = pool.filter(row => row.score <= 2.5 && row.count >= 2)
  if (!pool.length) return { success: true, dish: null, msg: mode === 'quality' ? '还没有至少两人评分且达到 4 分的菜品' : mode === 'unusual' ? '还没有至少两人评分且低于 2.5 分的菜品' : '这个模式还没有可抽取的菜品' }
  const dish = pool[crypto.randomInt(pool.length)]
  return { success: true, dish, stall: data.stalls.find(row => row._id === dish.stallId) }
}

async function adminCatalog(openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  const data = await catalog(true)
  return { success: true, stalls: data.stalls, dishes: data.dishes,
    photos: await stallPhotos('', openid),
    disputes: (await all('canteen_reviews', { disputeStatus: 'pending' })).map(row => ({ _id: row._id, dishId: row.dishId, nickname: row.nickname, score: row.score, comment: row.comment || row.disputeComment, disputedAt: row.disputedAt })),
    reports: (await all('canteen_report_cases', { status: 'pending' })).filter(row => row.count >= 3).sort((a, b) => b.count - a.count),
    submissions: (await all('canteen_submissions', { status: 'pending' })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    reviews: data.reviews.map(row => ({ ...row, openid: undefined })) }
}

async function submit(event, openid) {
  const account = await user(openid)
  if (!account) return { success: false, msg: '请先登录后投稿' }
  const clientId = clean(event.clientId, 80)
  if (!clientId) return { success: false, msg: '缺少投稿编号，请重新进入页面' }
  const id = crypto.createHash('sha256').update(openid + ':' + clientId).digest('hex')
  const previous = (await db.collection('canteen_submissions').doc(id).get()).data
  if (previous) return previous.status === 'deleted' ? { success: false, msg: '这份投稿已删除，请重新投稿' } : { success: true, id, stallId: previous.stallId, dishId: previous.dishId, msg: previous.status === 'approved' ? '这份发现已经公开' : '这份发现已收到' }
  const kind = event.kind || 'dish'
  if (!['dish', 'stall', 'photo'].includes(kind)) return { success: false, msg: '请选择投稿类型' }
  const stallId = clean(event.stallId, 80)
  const stallName = clean(event.stallName, 60), location = clean(event.location, 100)
  if (stallId) {
    const stall = (await db.collection('canteen_stalls').doc(stallId).get()).data
    if (!stall || stall.status !== 'published') return { success: false, msg: '请选择已发布的档口' }
  } else if (!stallName || !location) return { success: false, msg: '请填写档口名称和位置' }
  if (kind === 'photo' && !stallId) return { success: false, msg: '请先选择要补图的已有档口' }
  const dishName = kind === 'dish' ? clean(event.dishName, 80) : '', description = clean(event.description, 500)
  if (kind === 'dish' && (!dishName || !description)) return { success: false, msg: '请填写菜品名称和推荐/避雷理由' }
  const price = event.price === '' || event.price == null ? null : Number(event.price)
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 9999)) return { success: false, msg: '价格不正确' }
  const image = clean(event.image, 1000)
  if (image && !uploadImage(image)) return { success: false, msg: '请使用小程序上传的照片' }
  if (kind === 'photo' && !image) return { success: false, msg: '请先上传档口实拍照片' }
  const meals = mealList(event.meals)
  if (!meals.length) return { success: false, msg: '请选择供应餐次' }
  await db.collection('canteen_submissions').doc(id).create({ data: {
    openid, nickname: clean(account.nickName, 30) || '同学', avatarUrl: avatar(account.avatarUrl), kind, meals, stallId, stallName, location,
    dishName, description, price, image, status: 'pending', createdAt: new Date().toISOString()
  } })
  const row = (await db.collection('canteen_submissions').doc(id).get()).data
  const published = await publishSubmission(id, row)
  return published.success === false ? published : { success: true, id, ...published, msg: published.reusedStall ? '已归入已有档口，投稿已公开' : '投稿成功，已经公开展示' }
}

async function matchingStall(name, location, excludeId) {
  return (await all('canteen_stalls')).filter(row => row._id !== excludeId && normalized(row.name) === normalized(name) && normalized(row.location) === normalized(location))
    .sort((a, b) => Number(a.status === 'deleted') - Number(b.status === 'deleted'))[0]
}

async function matchingDish(stallId, name, excludeId) {
  return (await all('canteen_dishes', { stallId })).filter(row => row._id !== excludeId && normalized(row.name) === normalized(name))
    .sort((a, b) => Number(a.status === 'deleted') - Number(b.status === 'deleted'))[0]
}

async function checkStall(event) {
  const name = clean(event.stallName, 60), location = clean(event.location, 100)
  if (!name || !location) return { success: true, exists: false, candidates: [] }
  const rows = (await all('canteen_stalls')).filter(row => row.status !== 'deleted')
  const exact = rows.find(row => normalized(row.name) === normalized(name) && normalized(row.location) === normalized(location))
  return { success: true, exists: Boolean(exact), stall: exact ? { _id: exact._id, name: exact.name, location: exact.location, available: exact.status === 'published' } : null,
    candidates: rows.filter(row => row.status === 'published' && !exact && (normalized(row.name).includes(normalized(name)) || normalized(name).includes(normalized(row.name)))).slice(0, 5)
      .map(row => ({ _id: row._id, name: row.name, location: row.location })) }
}

async function stallPhotos(stallId, openid) {
  const [submissions, stalls] = await Promise.all([all('canteen_submissions', stallId ? { stallId, status: 'approved' } : { status: 'approved' }), all('canteen_stalls')])
  const visible = new Map(stalls.filter(row => row.status === 'published').map(row => [row._id, row]))
  return submissions.filter(row => row.image && uploadImage(row.image) && visible.has(row.stallId) && (row.kind === 'photo' || row.kind === 'stall' || !row.kind && visible.get(row.stallId).submissionId === row._id))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    .map(row => ({ _id: row._id, stallId: row.stallId, stallName: visible.get(row.stallId).name, image: row.image, nickname: row.nickname || '同学',
      avatarUrl: avatar(row.avatarUrl), description: row.description, createdAt: row.updatedAt || row.createdAt, mine: row.openid === openid,
      isCover: visible.get(row.stallId).image === row.image }))
}

async function publishSubmission(id, row) {
  const now = new Date().toISOString()
  const kind = row.kind || 'dish'
  let stall = row.stallId ? (await db.collection('canteen_stalls').doc(row.stallId).get()).data : await matchingStall(row.stallName, row.location)
  const reusedStall = Boolean(stall && stall.status !== 'deleted')
  if (stall && !['published', 'deleted'].includes(stall.status)) return { success: false, msg: '这个档口已存在但暂未发布，请联系管理员' }
  if (!stall || stall.status === 'deleted') {
    const stallId = stall ? stall._id : key('stall', normalized(row.stallName), normalized(row.location), id)
    const payload = { name: row.stallName, location: row.location, meals: mealList(row.meals), description: kind === 'stall' ? row.description : '',
      image: kind === 'stall' ? row.image : '', imageSubmissionId: kind === 'stall' && row.image ? id : '', status: 'published', createdAt: now, updatedAt: now, submissionId: id }
    await db.collection('canteen_stalls').doc(stallId).set({ data: payload })
    stall = { ...payload, _id: stallId }
  }
  const stallId = stall._id
  if (reusedStall && kind === 'stall') await db.collection('canteen_stalls').doc(stallId).update({ data: { meals: MEALS.filter(meal => mealList(stall.meals).includes(meal) || mealList(row.meals).includes(meal)), updatedAt: now } })
  if (!stall.image && row.image && ['stall', 'photo'].includes(kind)) await db.collection('canteen_stalls').doc(stallId).update({ data: { image: row.image, imageSubmissionId: id, updatedAt: now } })
  let dishId = '', reusedDish = false
  if (kind === 'dish') {
    const existing = await matchingDish(stallId, row.dishName)
    if (existing && !['published', 'deleted'].includes(existing.status)) return { success: false, msg: '这道菜已存在但暂未发布，请联系管理员' }
    reusedDish = Boolean(existing && existing.status === 'published')
    dishId = existing ? existing._id : key('dish', stallId, normalized(row.dishName), id)
    if (!reusedDish) await db.collection('canteen_dishes').doc(dishId).set({ data: { stallId, name: row.dishName, price: row.price, image: row.image,
      imageSubmissionId: row.image ? id : '', meals: mealList(row.meals), description: row.description, status: 'published', createdAt: now, updatedAt: now, submissionId: id } })
    else {
      const update = { meals: MEALS.filter(meal => mealList(existing.meals).includes(meal) || mealList(row.meals).includes(meal)), updatedAt: now }
      if (!existing.image && row.image) Object.assign(update, { image: row.image, imageSubmissionId: id })
      await db.collection('canteen_dishes').doc(dishId).update({ data: update })
    }
  }
  await db.collection('canteen_submissions').doc(id).update({ data: { status: 'approved', stallId, dishId, stallName: stall.name, location: stall.location,
    createdStall: !reusedStall, createdDish: kind === 'dish' && !reusedDish, publishedAt: now, publication: 'automatic' } })
  return { stallId, dishId, reusedStall, reusedDish }
}

async function updateSubmission(event, openid) {
  if (!await user(openid)) return { success: false, msg: '请先登录' }
  const id = clean(event.id, 80), row = (await db.collection('canteen_submissions').doc(id).get()).data
  if (!row || row.openid !== openid) return { success: false, msg: '只能修改自己的投稿' }
  if (row.status !== 'approved') return { success: false, msg: '只有已发布投稿可以修改' }
  const kind = row.kind || 'dish', now = new Date().toISOString(), image = clean(event.image, 1000), description = clean(event.description, 500)
  if (image && !uploadImage(image) || kind === 'photo' && !image) return { success: false, msg: '请上传有效的本站实拍照片' }
  const changes = { image, description, updatedAt: now }
  const stall = (await db.collection('canteen_stalls').doc(row.stallId).get()).data
  if (!stall || stall.status !== 'published') return { success: false, msg: '档口暂未开放，请联系管理员' }
  if (kind === 'dish') {
    const dish = (await db.collection('canteen_dishes').doc(row.dishId).get()).data
    if (!dish || dish.status !== 'published') return { success: false, msg: '菜品暂未开放，请联系管理员' }
    const dishName = clean(event.dishName, 80), price = event.price === '' || event.price == null ? null : Number(event.price), meals = mealList(event.meals || row.meals)
    if (!dishName || !description || !meals.length || price !== null && (!Number.isFinite(price) || price < 0 || price > 9999)) return { success: false, msg: '请检查菜名、说明、餐次与价格' }
    Object.assign(changes, { dishName, price, meals })
    if (dish.submissionId === id) {
      const duplicate = await matchingDish(row.stallId, dishName, dish._id)
      if (duplicate && duplicate.status !== 'deleted') return { success: false, msg: '这个档口已有同名菜品，请保留原菜名或联系管理员合并' }
      await db.collection('canteen_dishes').doc(dish._id).update({ data: { name: dishName, price, meals, description, image, imageSubmissionId: image ? id : '', updatedAt: now } })
    } else if (normalized(dishName) !== normalized(row.dishName)) return { success: false, msg: '这道菜由其他人创建，只能修改你自己的图片与说明' }
    else if (dish.imageSubmissionId === id || !dish.image && image) await db.collection('canteen_dishes').doc(dish._id).update({ data: { image, imageSubmissionId: image ? id : '', updatedAt: now } })
  }
  if (['photo', 'stall'].includes(kind) && (stall.imageSubmissionId === id || !stall.image && image)) await db.collection('canteen_stalls').doc(stall._id).update({ data: { image, imageSubmissionId: image ? id : '', updatedAt: now } })
  if (kind === 'stall' && stall.submissionId === id && !stall.managed) await db.collection('canteen_stalls').doc(stall._id).update({ data: { description, updatedAt: now } })
  await db.collection('canteen_submissions').doc(id).update({ data: changes })
  return { success: true, msg: '投稿已更新，原评论和评分已保留' }
}

async function deleteSubmission(event, openid) {
  if (!await user(openid)) return { success: false, msg: '请先登录' }
  const id = clean(event.id, 80), row = (await db.collection('canteen_submissions').doc(id).get()).data
  if (!row || row.openid !== openid) return { success: false, msg: '只能删除自己的投稿' }
  if (row.status === 'deleted') return { success: true, msg: '投稿已删除' }
  const now = new Date().toISOString()
  await db.collection('canteen_submissions').doc(id).update({ data: { status: 'deleted', image: '', description: '', reason: '', deletedAt: now, updatedAt: now } })
  const remaining = await all('canteen_submissions', { stallId: row.stallId, status: 'approved' })
  if (row.dishId) {
    const dish = (await db.collection('canteen_dishes').doc(row.dishId).get()).data
    if (dish) {
      const contributions = remaining.filter(item => item.dishId === row.dishId)
      const changes = {}
      if (dish.imageSubmissionId === id || dish.submissionId === id && dish.image === row.image) {
        const next = contributions.find(item => item.image && uploadImage(item.image))
        Object.assign(changes, { image: next ? next.image : '', imageSubmissionId: next ? next._id : '' })
      }
      const origin = dish.submissionId && (await db.collection('canteen_submissions').doc(dish.submissionId).get()).data
      if (origin && origin.status === 'deleted' && !dish.managed) {
        changes.description = contributions.length ? contributions[0].description : ''
        const reviews = await all('canteen_reviews', { dishId: row.dishId, status: 'visible' }), ratings = await all('canteen_ratings', { dishId: row.dishId })
        if (!contributions.length && !reviews.length && !ratings.length) Object.assign(changes, { status: 'deleted', image: '', price: null })
      }
      if (Object.keys(changes).length) await db.collection('canteen_dishes').doc(dish._id).update({ data: { ...changes, updatedAt: now } })
    }
  }
  const stall = row.stallId && (await db.collection('canteen_stalls').doc(row.stallId).get()).data
  if (stall) {
    const changes = {}
    if (stall.imageSubmissionId === id || stall.submissionId === id && stall.image === row.image) {
      const next = remaining.find(item => item.image && uploadImage(item.image) && ['stall', 'photo'].includes(item.kind))
      Object.assign(changes, { image: next ? next.image : '', imageSubmissionId: next ? next._id : '' })
    }
    const origin = stall.submissionId && (await db.collection('canteen_submissions').doc(stall.submissionId).get()).data
    if (origin && origin.status === 'deleted' && !stall.managed) {
      changes.description = (remaining.find(item => item.kind === 'stall') || {}).description || ''
      const dishes = (await all('canteen_dishes', { stallId: row.stallId })).filter(item => item.status !== 'deleted')
      if (!remaining.length && !dishes.length) Object.assign(changes, { status: 'deleted', image: '' })
    }
    if (Object.keys(changes).length) await db.collection('canteen_stalls').doc(stall._id).update({ data: { ...changes, updatedAt: now } })
  }
  return { success: true, msg: '投稿已删除；其他同学参与的档口或菜品会保留' }
}

async function setStallCover(event, openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  const row = (await db.collection('canteen_submissions').doc(clean(event.id, 80)).get()).data
  if (!row || row.status !== 'approved' || !uploadImage(row.image)) return { success: false, msg: '补图已删除或无效，请刷新' }
  const stall = (await db.collection('canteen_stalls').doc(row.stallId).get()).data
  if (!stall || stall.status !== 'published') return { success: false, msg: '档口暂未发布' }
  if (!['stall', 'photo'].includes(row.kind) && !(!row.kind && stall.submissionId === row._id)) return { success: false, msg: '请选择档口实拍补图' }
  await db.collection('canteen_stalls').doc(row.stallId).update({ data: { image: row.image, imageSubmissionId: row._id, updatedAt: new Date().toISOString() } })
  return { success: true, msg: '档口封面已更新' }
}

async function report(event, openid) {
  if (!await user(openid)) return { success: false, msg: '请先登录后举报' }
  if (!['dish', 'review'].includes(event.targetType) || !['inaccurate', 'spam', 'inappropriate'].includes(event.reason)) return { success: false, msg: '请选择举报对象与原因' }
  const targetId = clean(event.targetId, 100), type = event.targetType
  const target = (await db.collection(type === 'dish' ? 'canteen_dishes' : 'canteen_reviews').doc(targetId).get()).data
  if (!target || target.status !== (type === 'dish' ? 'published' : 'visible')) return { success: false, msg: '内容已下架或不存在' }
  const caseId = crypto.createHash('sha256').update(type + ':' + targetId).digest('hex')
  const reportId = crypto.createHash('sha256').update(caseId + ':' + openid).digest('hex')
  if ((await db.collection('canteen_reports').doc(reportId).get()).data) return { success: true, msg: '你已反馈过，重复举报不会增加次数' }
  const now = new Date().toISOString(), previous = (await db.collection('canteen_report_cases').doc(caseId).get()).data
  const total = (previous && previous.total || 0) + 1, resolvedTotal = previous && previous.resolvedTotal || 0, count = total - resolvedTotal
  await db.collection('canteen_reports').doc(reportId).create({ data: { caseId, openid, reason: event.reason, createdAt: now } })
  await db.collection('canteen_report_cases').doc(caseId).set({ data: { caseId, targetType: type, targetId, dishId: type === 'dish' ? targetId : target.dishId, title: clean(target.name || target.comment, 200),
    total, resolvedTotal, count, status: count >= 3 ? 'pending' : 'collecting', reasons: [...(previous && previous.reasons || []), event.reason].slice(-10), updatedAt: now } })
  return { success: true, msg: count >= 3 ? '已交给审核员核对' : '反馈已收到，多位同学反馈后交给审核员核对' }
}

async function resolveReport(event, openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  if (!['dismiss', 'hide'].includes(event.resolution)) return { success: false, msg: '处理方式不正确' }
  const id = clean(event.id, 80), row = (await db.collection('canteen_report_cases').doc(id).get()).data
  if (!row || row.status !== 'pending') return { success: false, msg: '这份举报已处理或尚未达到审核条件' }
  if (event.resolution === 'hide') {
    const table = row.targetType === 'review' ? 'canteen_reviews' : 'canteen_dishes'
    if (row.targetType === 'review') await hideReview({ id: row.targetId }, openid)
    else await db.collection(table).doc(row.targetId).update({ data: { status: 'draft', updatedAt: new Date().toISOString() } })
  }
  await db.collection('canteen_report_cases').doc(id).update({ data: { status: 'resolved', resolvedTotal: row.total, resolution: event.resolution, reviewer: openid, resolvedAt: new Date().toISOString() } })
  return { success: true, msg: '举报已处理' }
}

async function moderateSubmission(event, openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  if (!['approved', 'rejected'].includes(event.status)) return { success: false, msg: '审核状态不正确' }
  const id = clean(event.id, 80)
  const row = (await db.collection('canteen_submissions').doc(id).get()).data
  if (!row) return { success: false, msg: '投稿不存在' }
  if (row.status !== 'pending') return { success: true, msg: '该投稿已处理' }
  const now = new Date().toISOString()
  if (event.status === 'approved') {
    const published = await publishSubmission(id, row)
    if (published.success === false) return published
  }
  await db.collection('canteen_submissions').doc(id).update({ data: { status: event.status,
    reason: clean(event.reason, 200), reviewedAt: now, reviewer: openid } })
  return { success: true, msg: event.status === 'approved' ? '已发布到食堂评分' : '已退回投稿' }
}

async function saveStall(event, openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  const name = clean(event.name, 60)
  const location = clean(event.location, 100)
  if (!name || !location) return { success: false, msg: '请填写档口名称和位置' }
  const duplicate = await matchingStall(name, location, clean(event.id, 80))
  if (duplicate && duplicate.status !== 'deleted') return { success: false, msg: '同名同位置的档口已存在，请编辑已有档口', existingId: duplicate._id }
  const payload = { name, location, description: clean(event.description, 500), image: clean(event.image, 1000),
    status: event.status === 'published' ? 'published' : 'draft', updatedAt: new Date().toISOString() }
  if (event.id) {
    const id = clean(event.id, 80)
    const previous = await db.collection('canteen_stalls').doc(id).get().catch(() => null)
    if (!previous || !previous.data) return { success: false, msg: '档口不存在' }
    if (payload.image !== previous.data.image) payload.imageSubmissionId = ''
    await db.collection('canteen_stalls').doc(id).update({ data: { ...payload, managed: true } })
    return { success: true, id }
  }
  const id = duplicate ? duplicate._id : key('stall', normalized(name), normalized(location), crypto.randomUUID())
  await db.collection('canteen_stalls').doc(id).set({ data: { ...payload, managed: true, createdAt: payload.updatedAt } })
  return { success: true, id }
}

async function saveDish(event, openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  const stallId = clean(event.stallId, 80)
  const stall = await db.collection('canteen_stalls').doc(stallId).get().catch(() => null)
  if (!stall || !stall.data) return { success: false, msg: '请先选择档口' }
  const name = clean(event.name, 80)
  if (!name) return { success: false, msg: '请填写菜品名称' }
  const duplicate = await matchingDish(stallId, name, clean(event.id, 80))
  if (duplicate && duplicate.status !== 'deleted') return { success: false, msg: '这个档口已有同名菜品，请编辑已有菜品', existingId: duplicate._id }
  const price = event.price === '' || event.price == null ? null : Number(event.price)
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 9999)) return { success: false, msg: '价格不正确' }
  const payload = { stallId, name, price, description: clean(event.description, 500), image: clean(event.image, 1000),
    status: event.status === 'published' ? 'published' : 'draft', updatedAt: new Date().toISOString() }
  if (event.meals !== undefined && !mealList(event.meals).length) return { success: false, msg: '请选择供应餐次' }
  if (event.meals !== undefined) payload.meals = mealList(event.meals)
  if (event.id) {
    const id = clean(event.id, 80)
    const previous = await db.collection('canteen_dishes').doc(id).get().catch(() => null)
    if (!previous || !previous.data) return { success: false, msg: '菜品不存在' }
    if (previous.data.stallId !== stallId) return { success: false, msg: '不能更换菜品所属档口' }
    if (payload.image !== previous.data.image) payload.imageSubmissionId = ''
    await db.collection('canteen_dishes').doc(id).update({ data: { ...payload, managed: true } })
    return { success: true, id }
  }
  const id = duplicate ? duplicate._id : key('dish', stallId, normalized(name), crypto.randomUUID())
  await db.collection('canteen_dishes').doc(id).set({ data: { ...payload, managed: true, createdAt: payload.updatedAt } })
  return { success: true, id }
}

async function hideReview(event, openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  const id = clean(event.id, 80)
  const previous = await db.collection('canteen_reviews').doc(id).get().catch(() => null)
  if (!previous || !previous.data) return { success: false, msg: '评价不存在' }
  await db.collection('canteen_reviews').doc(id).update({ data: { status: previous.data.status === 'deleted' ? 'deleted' : 'hidden',
    ...(previous.data.disputeStatus === 'pending' ? { disputeStatus: 'resolved', disputeResolution: 'hide' } : {}), updatedAt: new Date().toISOString() } })
  const ratingId = ownReviewId(previous.data.dishId, previous.data.openid), rating = (await db.collection('canteen_ratings').doc(ratingId).get()).data
  if (rating && rating.reviewId === id) await db.collection('canteen_ratings').doc(ratingId).update({ data: { status: 'hidden' } })
  return { success: true }
}

exports.main = async (event = {}) => {
  const openid = cloud.getWXContext().OPENID || ''
  try {
    if (event.action === 'init') {
      if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
      for (const name of COLLECTIONS) {
        try { await db.createCollection(name) } catch (error) {
          if (!/already exists|DATABASE_COLLECTION_EXIST|同名集合/.test(String(error.message || error))) throw error
        }
      }
      return { success: true }
    }
    if (['list', 'detail', 'reviews', 'saveReview', 'deleteReview', 'likeReview', 'voteReview', 'random', 'submit', 'checkStall', 'updateSubmission', 'deleteSubmission', 'mySubmissions', 'report'].includes(event.action) && !await isOpen()) {
      return { success: false, msg: '食堂评价模块暂未开放' }
    }
    await ensureRatings()
    if (event.action === 'list') return await list(event)
    if (event.action === 'detail') return await detail(event, openid)
    if (event.action === 'reviews') return await reviews(event, openid)
    if (event.action === 'saveReview') return await writeTransaction(() => saveReview(event, openid))
    if (event.action === 'deleteReview') return await writeTransaction(() => deleteReview(event, openid))
    if (event.action === 'voteReview' || event.action === 'likeReview') {
      const result = await writeTransaction(() => voteReview(event.action === 'likeReview' ? { ...event, vote: 'up' } : event, openid))
      return event.action === 'likeReview' && result.success ? { success: true, isLiked: result.isLiked, likeCount: result.likeCount } : result
    }
    if (event.action === 'report') return await writeTransaction(() => report(event, openid))
    if (event.action === 'resolveReport') return await writeTransaction(() => resolveReport(event, openid))
    if (event.action === 'resolveDispute') return await writeTransaction(() => resolveDispute(event, openid))
    if (event.action === 'checkStall') return await checkStall(event)
    if (event.action === 'submit') return await writeTransaction(() => submit(event, openid))
    if (event.action === 'updateSubmission') return await writeTransaction(() => updateSubmission(event, openid))
    if (event.action === 'deleteSubmission') return await writeTransaction(() => deleteSubmission(event, openid))
    if (event.action === 'setStallCover') return await writeTransaction(() => setStallCover(event, openid))
    if (event.action === 'mySubmissions') {
      if (!await user(openid)) return { success: false, msg: '请先登录' }
      return { success: true, submissions: (await all('canteen_submissions', { openid })).filter(row => row.status !== 'deleted').sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
    }
    if (event.action === 'moderateSubmission') return await writeTransaction(() => moderateSubmission(event, openid))
    if (event.action === 'random') return await random(event)
    if (event.action === 'adminCatalog') return await adminCatalog(openid)
    if (event.action === 'saveStall') return await writeTransaction(() => saveStall(event, openid))
    if (event.action === 'saveDish') return await writeTransaction(() => saveDish(event, openid))
    if (event.action === 'hideReview') return await writeTransaction(() => hideReview(event, openid))
    return { success: false, msg: '未知操作' }
  } catch (error) {
    console.error('canteen_reviews:', error)
    return { success: false, msg: error.message || '服务异常' }
  }
}
