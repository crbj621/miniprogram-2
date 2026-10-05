'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const uploadUrl = name => 'https://www.crbuj.icu/campus-api/uploads/canteen-reviews/' + name + '.jpg'
const oldImages = [uploadUrl('original-1'), uploadUrl('original-2')]
const row = (id, mine = false) => ({ _id: id, mine, score: 5, comment: '原来的评价', images: mine ? oldImages.slice() : [uploadUrl('other')],
  nickname: mine ? '我' : '同学', likeCount: 3, isLiked: false, updatedAt: '2026-10-03T02:00:00Z' })
const overview = reviews => ({ success: true, dish: { _id: 'dish', name: '番茄鸡蛋面' }, stall: { name: '一食堂', location: '一楼' }, score: 5, count: 2, reviewCount: reviews.length, myRating: { score: 5, status: 'visible' }, reviews })

function loadPage(request, upload = async () => ({ fileID: uploadUrl('new') }), rewards = async () => ({})) {
  const storage = new Map([['openid', 'student']]), calls = [], uploads = [], previews = [], navigation = [], notices = [], claims = []
  const app = { loggedIn: true, isLoggedIn() { return this.loggedIn } }
  const wx = { getStorageSync: key => storage.get(key), setNavigationBarTitle() {}, stopPullDownRefresh() {},
    previewImage: options => previews.push(options), navigateTo: options => navigation.push(options.url), showToast: options => notices.push(options.title), chooseMedia() {} }
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }
    cache.set(file, module.exports)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, wx, getApp: () => app, console, Date, Math,
      Page: page => { module.exports = page }, require: ref => {
        if (ref.endsWith('/page-share')) return { withSharing: value => value }
        if (ref.endsWith('/api-client')) return { api: {
          call: async options => { calls.push(options); return { result: await request(options.data, options.name) } },
          uploadFile: async options => { uploads.push(options); return upload(options) }
        } }
        if (ref.endsWith('/english-api')) return { callEnglish: action => { claims.push(action); return rewards(action) } }
        return load(path.resolve(path.dirname(file), ref + '.ts'))
      } })
    cache.set(file, module.exports)
    return module.exports
  }
  const page = load(path.resolve(__dirname, '../miniprogram/packageCanteen/pages/dish/dish.ts'))
  page.setData = update => Object.assign(page.data, update)
  page.onLoad({ id: 'dish' })
  return { page, wx, app, storage, calls, uploads, previews, navigation, notices, claims }
}

async function main() {
  let reviews = [row('mine', true), row('other')]
  const editor = loadPage(async (input, service) => {
    assert.equal(service, 'canteen_reviews')
    if (input.action === 'saveReview') {
      assert.equal(input.score, 5); assert.equal(Object.hasOwn(input, 'rating'), false)
      assert.ok(input.clientId); reviews.push({ ...row('new-comment', true), comment: input.comment, images: input.images.slice() })
      return { success: true }
    }
    return overview(reviews)
  }, undefined, async () => { throw new Error('reward offline') })
  await editor.page.load()
  assert.equal(editor.page.data.images.length, 0, 'new comment does not refill a published comment'); assert.equal(editor.page.data.comment, '')
  editor.page.editDraft({ images: oldImages.slice() }); editor.page.selectScore({ currentTarget: { dataset: { score: 5 } } })
  editor.page.previewImages({ currentTarget: { dataset: { url: oldImages[1] } } })
  editor.page.previewImages({ currentTarget: { dataset: { reviewId: 'other', url: uploadUrl('other') } } })
  assert.equal(editor.previews[0].current, oldImages[1]); assert.deepEqual(Array.from(editor.previews[0].urls), oldImages)
  assert.equal(editor.previews[1].urls.length, 1, 'list image preview uses that review only')
  editor.page.onComment({ detail: { value: '追加一条新评论' } })
  await editor.page.submit()
  assert.deepEqual(Array.from(editor.calls.find(call => call.data.action === 'saveReview').data.images), oldImages)
  assert.equal(editor.page.data.saving, false); assert.equal(editor.notices.includes('评论已发布'), true)
  assert.equal(editor.notices.some(message => /reward offline|发布失败/.test(message)), false, 'reward rejection cannot turn successful save into failure')
  assert.deepEqual(editor.claims, ['claimCampusRewards']); assert.equal(reviews.length, 3); assert.equal(editor.page.data.comment, ''); assert.equal(editor.page.data.images.length, 0)

  let choose, uploadNumber = 0
  const photo = loadPage(async () => overview([row('mine', true)]), async () => {
    uploadNumber += 1
    if (uploadNumber === 2) throw new Error('one photo failed')
    return { fileID: uploadUrl('uploaded-' + uploadNumber) }
  })
  await photo.page.load(); photo.page.editDraft({ images: oldImages.slice() })
  photo.wx.chooseMedia = options => { choose = options }
  const selected = photo.page.chooseImages()
  assert.equal(choose.count, 2, 'picker capacity excludes existing photos')
  assert.deepEqual(Array.from(choose.mediaType), ['image'])
  await photo.page.chooseImages(); await photo.page.submit()
  assert.equal(photo.calls.some(call => call.data.action === 'saveReview'), false, 'save is blocked while photos are being selected or uploaded')
  choose.success({ tempFiles: [{ tempFilePath: '/tmp/a.jpg' }, { tempFilePath: '/tmp/b.jpg' }, { tempFilePath: '/tmp/extra.jpg' }] })
  await selected
  assert.equal(photo.uploads.length, 2, 'unexpected picker overflow cannot exceed four photos')
  assert.deepEqual(Array.from(photo.page.data.images), oldImages.concat(uploadUrl('uploaded-1')))
  assert.match(photo.page.data.uploadError, /1 张照片上传失败/)
  photo.page.removeImage({ currentTarget: { dataset: { index: 1 } } })
  assert.deepEqual(Array.from(photo.page.data.images), [oldImages[0], uploadUrl('uploaded-1')])
  photo.wx.chooseMedia = options => options.success({ tempFiles: [{ tempFilePath: '/tmp/c.jpg' }, { tempFilePath: '/tmp/d.jpg' }] })
  await photo.page.chooseImages()
  assert.equal(photo.page.data.images.length, 4)
  const uploadedCount = photo.uploads.length
  await photo.page.chooseImages()
  assert.equal(photo.uploads.length, uploadedCount, 'full photo editor cannot upload a fifth image')

  for (const invalidUrl of ['wxfile://temporary.jpg', 'cloud://old-cloud/image.jpg', 'https://other.example.com/photo.jpg']) {
    const invalid = loadPage(async () => overview([]), async () => ({ fileID: invalidUrl }))
    invalid.wx.chooseMedia = options => options.success({ tempFiles: [{ tempFilePath: '/tmp/photo.jpg' }] })
    await invalid.page.chooseImages()
    assert.equal(invalid.page.data.images.length, 0, 'only own-server uploaded URL enters comment draft')
    invalid.page.data.images = [invalidUrl]
    await invalid.page.submit()
    assert.equal(invalid.calls.length, 0, 'temporary or external image cannot be submitted')
  }

  reviews = [row('mine', true), row('other')]
  let releaseLike, likes = 0
  const like = loadPage(async input => {
    if (input.action !== 'voteReview') return overview(reviews)
    likes += 1
    return new Promise(resolve => { releaseLike = () => { reviews[1] = { ...reviews[1], likeCount: 4, isLiked: true }; resolve({ success: true, likeCount: 4, isLiked: true }) } })
  })
  await like.page.load(); like.page.editDraft({ images: oldImages.slice() })
  const liked = like.page.likeReview({ currentTarget: { dataset: { id: 'other' } } })
  await like.page.likeReview({ currentTarget: { dataset: { id: 'other' } } })
  assert.equal(likes, 1, 'repeated tap cannot double-toggle pending like')
  like.page.onComment({ detail: { value: '我正在编辑的新评价' } })
  like.page.selectScore({ currentTarget: { dataset: { score: 3 } } })
  like.page.removeImage({ currentTarget: { dataset: { index: 0 } } })
  releaseLike(); await liked
  assert.equal(like.page.data.reviews.find(review => review._id === 'other').isLiked, true)
  assert.equal(like.page.data.reviews.find(review => review._id === 'other').likeCount, 4)
  assert.equal(like.page.data.comment, '我正在编辑的新评价', 'like refresh cannot overwrite pending comment')
  assert.equal(like.page.data.myScore, 3)
  assert.deepEqual(Array.from(like.page.data.images), [oldImages[1]])
  like.app.loggedIn = false
  await like.page.likeReview({ currentTarget: { dataset: { id: 'other' } } })
  assert.equal(likes, 1); assert.match(like.navigation[0], /forceLogin=true&redirect=/)

  let sortedRows = [row('mine', true), row('other')]
  const sorting = loadPage(async input => ({ ...overview(input.sort === 'hot' ? sortedRows.slice().reverse() : sortedRows), sort: input.sort }))
  await sorting.page.load(); sorting.page.editDraft({ images: oldImages.slice() })
  sorting.page.onComment({ detail: { value: '排序时保留编辑内容' } })
  sorting.page.selectScore({ currentTarget: { dataset: { score: 2 } } })
  sorting.page.removeImage({ currentTarget: { dataset: { index: 0 } } })
  await sorting.page.switchReviewSort({ currentTarget: { dataset: { sort: 'hot' } } })
  assert.equal(sorting.calls[sorting.calls.length - 1].data.sort, 'hot', 'popular sort is requested from the server')
  assert.equal(sorting.page.data.reviews[0]._id, 'other'); assert.equal(sorting.page.data.reviewSort, 'hot')
  assert.equal(sorting.page.data.comment, '排序时保留编辑内容'); assert.equal(sorting.page.data.myScore, 2)
  assert.deepEqual(Array.from(sorting.page.data.images), [oldImages[1]], 'changing sort preserves edited photos')
  await sorting.page.switchReviewSort({ currentTarget: { dataset: { sort: 'latest' } } })
  assert.equal(sorting.page.data.reviews[0]._id, 'mine')

  const sortReads = []
  const sortRace = loadPage(input => new Promise(resolve => sortReads.push({ input, resolve })))
  const latestRead = sortRace.page.load()
  const hotRead = sortRace.page.switchReviewSort({ currentTarget: { dataset: { sort: 'hot' } } })
  sortReads[1].resolve(overview([row('hot')])); await hotRead
  sortReads[0].resolve(overview([row('latest')])); await latestRead
  assert.equal(sortRace.page.data.reviewSort, 'hot'); assert.equal(sortRace.page.data.reviews[0]._id, 'hot', 'a late latest response cannot replace selected popular reviews')

  let reviewRows = [row('mine', true), row('other')], finishDelete, showDelete, modalCount = 0
  const deletion = loadPage(async input => {
    if (input.action !== 'deleteReview') return overview(reviewRows)
    return new Promise(resolve => { finishDelete = () => { reviewRows = reviewRows.filter(review => review._id !== input.reviewId); resolve({ success: true }) } })
  })
  deletion.wx.showModal = options => { modalCount++; showDelete = options }
  await deletion.page.load()
  await deletion.page.deleteReview({ currentTarget: { dataset: { id: 'other' } } })
  assert.equal(modalCount, 0, 'client cannot offer deletion for another author')
  const canceled = deletion.page.deleteReview({ currentTarget: { dataset: { id: 'mine' } } })
  showDelete.success({ confirm: false }); await canceled
  assert.equal(deletion.calls.some(call => call.data.action === 'deleteReview'), false, 'canceling confirmation does not call deletion')
  const deleting = deletion.page.deleteReview({ currentTarget: { dataset: { id: 'mine' } } })
  await deletion.page.deleteReview({ currentTarget: { dataset: { id: 'mine' } } })
  assert.equal(modalCount, 2, 'repeated taps cannot open another confirmation')
  showDelete.success({ confirm: true }); await new Promise(resolve => setImmediate(resolve))
  await deletion.page.submit(); await deletion.page.likeReview({ currentTarget: { dataset: { id: 'other' } } })
  assert.equal(deletion.calls.filter(call => call.data.action === 'deleteReview').length, 1, 'confirmed owner deletion makes one request')
  assert.equal(deletion.calls.some(call => ['saveReview', 'voteReview'].includes(call.data.action)), false, 'deletion blocks conflicting page mutations')
  finishDelete(); await deleting
  assert.equal(deletion.page.data.reviews.some(review => review.mine), false)
  assert.equal(deletion.page.data.count, 2, 'server retains the independent rating after comment deletion'); assert.equal(deletion.page.data.reviewCount, 1)
  assert.equal(deletion.page.data.comment, ''); assert.equal(deletion.page.data.myScore, 5)
  assert.equal(deletion.page.data.images.length, 0); assert.equal(deletion.page.data.deletingReview, '')

  const editedDelete = loadPage(async input => input.action === 'deleteReview' ? { success: true } : overview(input.sort === 'hot' ? [row('other')] : [row('mine', true), row('other')]))
  await editedDelete.page.load()
  editedDelete.page.onComment({ detail: { value: '尚未发布的新草稿' } })
  editedDelete.page.data.reviewSort = 'hot'
  editedDelete.wx.showModal = options => options.success({ confirm: true })
  await editedDelete.page.deleteReview({ currentTarget: { dataset: { id: 'mine' } } })
  assert.equal(editedDelete.page.data.comment, '尚未发布的新草稿', 'deleting the published review preserves an already edited draft')
  assert.equal(editedDelete.calls[editedDelete.calls.length - 1].data.sort, 'hot', 'deletion refresh keeps the chosen sort')

  const failedDelete = loadPage(async input => input.action === 'deleteReview' ? { success: false, msg: '删除失败' } : overview([row('mine', true)]))
  await failedDelete.page.load(); failedDelete.wx.showModal = options => options.success({ confirm: true })
  await failedDelete.page.deleteReview({ currentTarget: { dataset: { id: 'mine' } } })
  assert.equal(failedDelete.page.data.reviews.length, 1); assert.equal(failedDelete.page.data.images.length, 0)
  assert.equal(failedDelete.page.data.deletingReview, ''); assert.equal(failedDelete.notices.includes('删除失败'), true)

  for (const exit of ['unload', 'account']) {
    let finishDelete
    const lateDelete = loadPage(input => input.action === 'deleteReview' ? new Promise(resolve => { finishDelete = resolve }) : Promise.resolve(overview([row('mine', true)])))
    await lateDelete.page.load(); lateDelete.wx.showModal = options => options.success({ confirm: true })
    const pending = lateDelete.page.deleteReview({ currentTarget: { dataset: { id: 'mine' } } })
    await new Promise(resolve => setImmediate(resolve))
    if (exit === 'unload') lateDelete.page.onUnload()
    else lateDelete.storage.set('openid', 'someone-else')
    finishDelete({ success: true }); await pending
    assert.equal(lateDelete.page.data.reviews.length, 1, 'late deletion response cannot rewrite page after ' + exit)
    assert.equal(lateDelete.notices.includes('评论已删除'), false)
  }

  const reads = []
  const racing = loadPage(() => new Promise(resolve => reads.push(resolve)))
  const older = racing.page.load(), newer = racing.page.load()
  reads[1]({ ...overview([row('mine', true)]), dish: { name: '最新菜名' } }); await newer
  racing.page.onComment({ detail: { value: '读取期间编辑的草稿' } })
  reads[0]({ ...overview([]), dish: { name: '旧菜名' } }); await older
  assert.equal(racing.page.data.dish.name, '最新菜名'); assert.equal(racing.page.data.comment, '读取期间编辑的草稿')

  for (const exit of ['unload', 'account']) {
    let finishUpload
    const late = loadPage(async () => overview([]), () => new Promise((resolve, reject) => { finishUpload = { resolve, reject } }))
    late.wx.chooseMedia = options => options.success({ tempFiles: [{ tempFilePath: '/tmp/a.jpg' }, { tempFilePath: '/tmp/b.jpg' }] })
    const uploading = late.page.chooseImages()
    await new Promise(resolve => setImmediate(resolve))
    if (exit === 'unload') { late.page.onUnload(); finishUpload.resolve({ fileID: uploadUrl('late') }) }
    else { late.storage.set('openid', 'another'); finishUpload.reject(new Error('old session failed')) }
    await uploading
    assert.equal(late.page.data.images.length, 0, 'late upload cannot insert images after ' + exit)
    assert.equal(late.uploads.length, 1, 'account change prevents uploading remaining old photos')
  }

  const nonblocking = loadPage(async input => input.action === 'reviews' ? overview([]) : { success: true }, undefined, () => new Promise(() => {}))
  nonblocking.page.data.myScore = 5; nonblocking.page.data.comment = '好吃'
  await Promise.race([nonblocking.page.submit(), new Promise((resolve, reject) => setTimeout(() => reject(new Error('save incorrectly awaits rewards')), 100))])
  assert.equal(nonblocking.page.data.saving, false)
  await postingControls()
  console.log('食堂评论前端回归通过：追加不覆盖、最新评分／交流切换、晒图、反馈防重、排序、删除、草稿及迟到响应')
}

async function postingControls() {
  let fail = true, attempts = []
  const retry = loadPage(async input => {
    if (input.action === 'reviews') return overview([])
    attempts.push(input)
    if (fail) { fail = false; throw new Error('network timeout') }
    return { success: true }
  })
  retry.page.onComment({ detail: { value: '交流评论' } })
  await retry.page.submit()
  assert.equal(retry.page.data.comment, '交流评论')
  await retry.page.submit()
  assert.equal(attempts[0].clientId, attempts[1].clientId, 'uncertain network outcome retries same idempotent request')
  assert.equal(Object.hasOwn(attempts[0], 'score'), false, 'unscored discussion cannot accidentally update rating')
  retry.page.onComment({ detail: { value: '下一条评论' } })
  retry.page.selectScore({ currentTarget: { dataset: { score: 2 } } })
  await retry.page.submit()
  assert.notEqual(attempts[2].clientId, attempts[1].clientId)
  assert.equal(attempts[2].score, 2)

  const contested = loadPage(async input => input.action === 'reviews' ? { ...overview([row('other')]), myRating: { score: 5, status: 'contested' } } : { success: true })
  await contested.page.load(); contested.page.selectScore({ currentTarget: { dataset: { score: 1 } } })
  contested.page.onComment({ detail: { value: '暂停评分后仍交流' } }); await contested.page.submit()
  assert.equal(Object.hasOwn(contested.calls.find(call => call.data.action === 'saveReview').data, 'score'), false)

  const votes = loadPage(async input => input.action === 'reviews' ? overview([row('other')]) : { success: true, myVote: 'down', likeCount: 0, downCount: 1, disputed: false })
  await votes.page.load(); await votes.page.likeReview({ currentTarget: { dataset: { id: 'other', vote: 'down' } } })
  assert.equal(votes.calls.find(call => call.data.action === 'voteReview').data.vote, 'down')

  for (const exit of ['account', 'unload']) {
    let finish
    const late = loadPage(input => input.action === 'reviews' ? Promise.resolve(overview([])) : new Promise(resolve => { finish = resolve }))
    late.page.onComment({ detail: { value: '旧账号未完成提交' } })
    const waiting = late.page.submit()
    await new Promise(resolve => setImmediate(resolve))
    if (exit === 'account') late.storage.set('openid', 'new-account')
    else late.page.onUnload()
    finish({ success: true }); await waiting
    assert.equal(late.page.data.comment, '旧账号未完成提交', 'late save does not clear a different account or disposed page')
    assert.equal(late.notices.includes('评论已发布'), false)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
