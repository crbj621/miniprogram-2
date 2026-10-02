const cloud = require('campus-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const COLLECTIONS = ['canteen_stalls', 'canteen_dishes', 'canteen_reviews', 'canteen_submissions']

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
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

async function catalog(includeDrafts) {
  const [stalls, dishes, reviews] = await Promise.all([
    all('canteen_stalls'), all('canteen_dishes'), all('canteen_reviews', { status: 'visible' })
  ])
  const visibleStalls = stalls.filter(row => includeDrafts || row.status === 'published')
  const stallIds = new Set(visibleStalls.map(row => row._id))
  const visibleDishes = dishes.filter(row => stallIds.has(row.stallId) && (includeDrafts || row.status === 'published'))
  const dishStalls = new Map(visibleDishes.map(row => [row._id, row.stallId]))
  const byDish = {}, stallVotes = {}
  reviews.forEach(row => {
    const stallId = dishStalls.get(row.dishId)
    if (!stallId) return
    if (!byDish[row.dishId]) byDish[row.dishId] = []
    if (!stallVotes[stallId]) stallVotes[stallId] = []
    byDish[row.dishId].push(row)
    stallVotes[stallId].push(row)
  })
  const fullDishes = visibleDishes.map(row => {
    const rating = scoreOf(byDish[row._id] || [])
    return { ...row, ...rating, verdict: verdict(rating.score, rating.count) }
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
    return { ...row, dishCount: items.length, reviewCount: votes.length,
      score: rating.score, verdict: verdict(rating.score, rating.count) }
  })
  return { stalls: fullStalls, dishes: fullDishes, reviews }
}

function sortRank(rows) {
  return rows.sort((a, b) => b.score - a.score || b.reviewCount - a.reviewCount || b.count - a.count || String(a.name).localeCompare(String(b.name), 'zh-CN'))
}

async function list(event) {
  const data = await catalog(false)
  const keyword = clean(event.keyword, 40).toLowerCase()
  const stalls = sortRank(data.stalls.filter(row => !keyword || row.name.toLowerCase().includes(keyword) || clean(row.location, 100).toLowerCase().includes(keyword)))
  const dishes = sortRank(data.dishes.filter(row => !keyword || row.name.toLowerCase().includes(keyword)))
  return { success: true, stalls, dishes }
}

async function detail(event) {
  const data = await catalog(false)
  const stall = data.stalls.find(row => row._id === clean(event.stallId, 80))
  if (!stall) return { success: false, msg: '档口不存在或尚未发布' }
  const dishes = sortRank(data.dishes.filter(row => row.stallId === stall._id))
  return { success: true, stall, dishes }
}

async function reviews(event, openid) {
  const dishId = clean(event.dishId, 80)
  const dish = await db.collection('canteen_dishes').doc(dishId).get().catch(() => null)
  if (!dish || !dish.data || dish.data.status !== 'published') return { success: false, msg: '菜品不存在' }
  const stall = await db.collection('canteen_stalls').doc(dish.data.stallId).get().catch(() => null)
  if (!stall || !stall.data || stall.data.status !== 'published') return { success: false, msg: '档口暂未发布' }
  const rows = await all('canteen_reviews', { dishId, status: 'visible' })
  rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return { success: true, dish: dish.data, stall: stall.data, ...scoreOf(rows),
    reviews: rows.map(row => ({ _id: row._id, score: row.score, comment: row.comment,
      nickname: row.nickname, updatedAt: row.updatedAt, mine: row.openid === openid })) }
}

async function saveReview(event, openid) {
  const account = await user(openid)
  if (!account) return { success: false, msg: '请先登录后评价' }
  const score = Number(event.score)
  const comment = clean(event.comment, 500)
  if (!Number.isInteger(score) || score < 1 || score > 5) return { success: false, msg: '请选择 1 到 5 分' }
  if (!comment) return { success: false, msg: '请填写评价内容' }
  const dishId = clean(event.dishId, 80)
  const dish = await db.collection('canteen_dishes').doc(dishId).get().catch(() => null)
  if (!dish || !dish.data || dish.data.status !== 'published') return { success: false, msg: '菜品不存在' }
  const stall = await db.collection('canteen_stalls').doc(dish.data.stallId).get().catch(() => null)
  if (!stall || !stall.data || stall.data.status !== 'published') return { success: false, msg: '档口暂未发布' }
  const id = crypto.createHash('sha256').update(dishId + ':' + openid).digest('hex')
  const previous = await db.collection('canteen_reviews').doc(id).get().catch(() => null)
  if (previous && previous.data && previous.data.status === 'hidden') return { success: false, msg: '该评价已被管理员隐藏' }
  const now = new Date().toISOString()
  await db.collection('canteen_reviews').doc(id).set({ data: {
    dishId, stallId: dish.data.stallId, openid, score, comment,
    nickname: clean(account.nickName, 30) || '同学', status: 'visible',
    createdAt: previous && previous.data ? previous.data.createdAt : now, updatedAt: now
  } })
  return { success: true, msg: '评价已发布' }
}

async function random(event) {
  const mode = ['quality', 'all', 'unusual'].includes(event.mode) ? event.mode : 'all'
  const data = await catalog(false)
  let pool = data.dishes
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
  if (previous) return { success: true, id, msg: '投稿已收到，等待管理员审核' }
  const stallId = clean(event.stallId, 80)
  const stallName = clean(event.stallName, 60), location = clean(event.location, 100)
  if (stallId) {
    const stall = (await db.collection('canteen_stalls').doc(stallId).get()).data
    if (!stall || stall.status !== 'published') return { success: false, msg: '请选择已发布的档口' }
  } else if (!stallName || !location) return { success: false, msg: '请填写档口名称和位置' }
  const dishName = clean(event.dishName, 80), description = clean(event.description, 500)
  if (!dishName || !description) return { success: false, msg: '请填写菜品名称和推荐/避雷理由' }
  const price = event.price === '' || event.price == null ? null : Number(event.price)
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 9999)) return { success: false, msg: '价格不正确' }
  await db.collection('canteen_submissions').doc(id).create({ data: {
    openid, nickname: clean(account.nickName, 30) || '同学', stallId, stallName, location,
    dishName, description, price, image: clean(event.image, 1000), status: 'pending', createdAt: new Date().toISOString()
  } })
  return { success: true, id, msg: '投稿成功，审核通过后公开展示' }
}

async function moderateSubmission(event, openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  if (!['approved', 'rejected'].includes(event.status)) return { success: false, msg: '审核状态不正确' }
  const id = clean(event.id, 80)
  const row = (await db.collection('canteen_submissions').doc(id).get()).data
  if (!row) return { success: false, msg: '投稿不存在' }
  if (row.status !== 'pending') return { success: true, msg: '该投稿已处理' }
  const now = new Date().toISOString()
  let stallId = row.stallId, dishId = ''
  if (event.status === 'approved') {
    if (stallId) {
      const stall = (await db.collection('canteen_stalls').doc(stallId).get()).data
      if (!stall || stall.status !== 'published') return { success: false, msg: '原档口已下架，请先处理档口' }
    } else {
      stallId = (await db.collection('canteen_stalls').add({ data: { name: row.stallName, location: row.location,
        description: '', image: row.image, status: 'published', createdAt: now, updatedAt: now, submissionId: id } }))._id
    }
    dishId = (await db.collection('canteen_dishes').add({ data: { stallId, name: row.dishName, price: row.price,
      image: row.image, description: row.description, status: 'published', createdAt: now, updatedAt: now, submissionId: id } }))._id
  }
  await db.collection('canteen_submissions').doc(id).update({ data: { status: event.status, stallId, dishId,
    reason: clean(event.reason, 200), reviewedAt: now, reviewer: openid } })
  return { success: true, msg: event.status === 'approved' ? '已发布到食堂评分' : '已退回投稿' }
}

async function saveStall(event, openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  const name = clean(event.name, 60)
  const location = clean(event.location, 100)
  if (!name || !location) return { success: false, msg: '请填写档口名称和位置' }
  const payload = { name, location, description: clean(event.description, 500), image: clean(event.image, 1000),
    status: event.status === 'published' ? 'published' : 'draft', updatedAt: new Date().toISOString() }
  if (event.id) {
    const id = clean(event.id, 80)
    const previous = await db.collection('canteen_stalls').doc(id).get().catch(() => null)
    if (!previous || !previous.data) return { success: false, msg: '档口不存在' }
    await db.collection('canteen_stalls').doc(id).update({ data: payload })
    return { success: true, id }
  }
  const result = await db.collection('canteen_stalls').add({ data: { ...payload, createdAt: payload.updatedAt } })
  return { success: true, id: result._id }
}

async function saveDish(event, openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  const stallId = clean(event.stallId, 80)
  const stall = await db.collection('canteen_stalls').doc(stallId).get().catch(() => null)
  if (!stall || !stall.data) return { success: false, msg: '请先选择档口' }
  const name = clean(event.name, 80)
  if (!name) return { success: false, msg: '请填写菜品名称' }
  const price = event.price === '' || event.price == null ? null : Number(event.price)
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 9999)) return { success: false, msg: '价格不正确' }
  const payload = { stallId, name, price, description: clean(event.description, 500), image: clean(event.image, 1000),
    status: event.status === 'published' ? 'published' : 'draft', updatedAt: new Date().toISOString() }
  if (event.id) {
    const id = clean(event.id, 80)
    const previous = await db.collection('canteen_dishes').doc(id).get().catch(() => null)
    if (!previous || !previous.data) return { success: false, msg: '菜品不存在' }
    if (previous.data.stallId !== stallId) return { success: false, msg: '不能更换菜品所属档口' }
    await db.collection('canteen_dishes').doc(id).update({ data: payload })
    return { success: true, id }
  }
  const result = await db.collection('canteen_dishes').add({ data: { ...payload, createdAt: payload.updatedAt } })
  return { success: true, id: result._id }
}

async function hideReview(event, openid) {
  if (!await admin(openid)) return { success: false, msg: '无管理员权限' }
  const id = clean(event.id, 80)
  const previous = await db.collection('canteen_reviews').doc(id).get().catch(() => null)
  if (!previous || !previous.data) return { success: false, msg: '评价不存在' }
  await db.collection('canteen_reviews').doc(id).update({ data: { status: 'hidden', updatedAt: new Date().toISOString() } })
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
    if (['list', 'detail', 'reviews', 'saveReview', 'random', 'submit', 'mySubmissions'].includes(event.action) && !await isOpen()) {
      return { success: false, msg: '食堂评价模块暂未开放' }
    }
    if (event.action === 'list') return await list(event)
    if (event.action === 'detail') return await detail(event)
    if (event.action === 'reviews') return await reviews(event, openid)
    if (event.action === 'saveReview') return await db.runTransaction(() => saveReview(event, openid))
    if (event.action === 'submit') return await db.runTransaction(() => submit(event, openid), { lock: 'canteen:submissions' })
    if (event.action === 'mySubmissions') {
      if (!await user(openid)) return { success: false, msg: '请先登录' }
      return { success: true, submissions: (await all('canteen_submissions', { openid })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
    }
    if (event.action === 'moderateSubmission') return await db.runTransaction(() => moderateSubmission(event, openid), { lock: 'canteen:submissions' })
    if (event.action === 'random') return await random(event)
    if (event.action === 'adminCatalog') return await adminCatalog(openid)
    if (event.action === 'saveStall') return await saveStall(event, openid)
    if (event.action === 'saveDish') return await saveDish(event, openid)
    if (event.action === 'hideReview') return await hideReview(event, openid)
    return { success: false, msg: '未知操作' }
  } catch (error) {
    console.error('canteen_reviews:', error)
    return { success: false, msg: error.message || '服务异常' }
  }
}
