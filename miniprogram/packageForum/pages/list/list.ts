import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
type ListMode = 'all' | 'posts' | 'collections' | 'comments'

Page(withSharing({
  data: {
    mode: 'all' as ListMode,
    category: '',
    categoryName: '校园动态',
    orderBy: 'latest',
    keyword: '',
    showSearch: false,
    posts: [] as any[],
    page: 1,
    hasMore: true,
    loading: false,
    emptyTip: '快来分享第一条校园动态吧~'
  },

  onLoad(options: any) {
    const requestedMode = String((options && options.tab) || '')
    const mode: ListMode = ['posts', 'collections', 'comments'].includes(requestedMode)
      ? requestedMode as ListMode
      : 'all'

    if (mode !== 'all') {
      const app = getApp()
      if (!app.isLoggedIn()) {
        const currentUrl = '/packageForum/pages/list/list?tab=' + mode
        wx.redirectTo({
          url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent(currentUrl)
        })
        return
      }

      const modeConfig: Record<string, { title: string, tip: string }> = {
        posts: { title: '我的动态', tip: '还没有发布过动态，来记录一件校园小事吧~' },
        collections: { title: '我的收藏', tip: '看到喜欢的动态，点亮收藏就会出现在这里~' },
        comments: { title: '我的评论', tip: '还没有留下评论，去和同学们聊聊天吧~' }
      }
      this.setData({
        mode,
        categoryName: modeConfig[mode].title,
        emptyTip: modeConfig[mode].tip,
        showSearch: false
      })
    } else {
      if (options && options.search === '1') {
        this.setData({ showSearch: true })
      }
      if (options && options.category) {
        const categoryNames: Record<string, string> = {
          gossip: '灌水区',
          confession: '表白墙',
          melon: '吃瓜',
          job: '兼职',
          lost: '失物招领',
          study: '学习互助'
        }
        this.setData({
          category: options.category,
          categoryName: categoryNames[options.category] || '校园动态'
        })
      }
      if (options && options.orderBy) {
        this.setData({ orderBy: options.orderBy })
      }
    }

    this.loadPosts()
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/packageForum/pages/index/index' })
    })
  },

  formatTime(date: any): string {
    if (!date) return ''
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()

    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前'
    return (d.getMonth() + 1) + '月' + d.getDate() + '日'
  },

  normalizePost(post: any) {
    const app = getApp()
    const currentUser = app.getUserInfo ? app.getUserInfo() : null
    let authorName = post.isAnonymous ? '匿名同学' : (post.authorName || (post.authorInfo && post.authorInfo.nickname) || '校园同学')
    let authorAvatar = post.isAnonymous ? '' : (post.authorAvatar || (post.authorInfo && post.authorInfo.avatar) || '')

    if (this.data.mode === 'posts' && !post.isAnonymous && currentUser) {
      authorName = currentUser.nickName || authorName
      authorAvatar = currentUser.avatarUrl || authorAvatar
    }

    return {
      ...post,
      _targetId: post._id,
      imgList: Array.isArray(post.imgList) ? post.imgList : [],
      authorName,
      authorAvatar,
      createTimeText: post.createTimeText || this.formatTime(post.createTime),
      likeCount: Number(post.likeCount || 0),
      commentCount: Number(post.commentCount || 0),
      collectCount: Number(post.collectCount || 0)
    }
  },

  normalizeComment(comment: any) {
    const app = getApp()
    const currentUser = app.getUserInfo ? app.getUserInfo() : null
    return {
      ...comment,
      _targetId: comment.postDeleted ? '' : comment.postId,
      title: comment.postTitle || '原动态已删除',
      content: comment.content || '',
      imgList: [],
      categoryName: '我的评论',
      authorName: (currentUser && currentUser.nickName) || '我',
      authorAvatar: (currentUser && currentUser.avatarUrl) || '',
      createTimeText: comment.createTimeText || this.formatTime(comment.createTime),
      isCommentRecord: true,
      postDeleted: !!comment.postDeleted
    }
  },

  onPullDownRefresh() {
    this.setData({ page: 1, posts: [], hasMore: true })
    this.loadPosts().then(() => wx.stopPullDownRefresh())
  },

  async loadPosts() {
    if (this.data.loading || !this.data.hasMore) return
    this.setData({ loading: true })

    try {
      const actionMap: Record<ListMode, string> = {
        all: 'getPosts',
        posts: 'getUserPosts',
        collections: 'getUserCollections',
        comments: 'getUserComments'
      }
      const data: any = {
        orderBy: this.data.orderBy,
        page: this.data.page,
        pageSize: 10
      }
      if (this.data.mode === 'all' && this.data.category) data.category = this.data.category

      const res = await api.call({
        name: 'forum',
        data: { action: actionMap[this.data.mode], data }
      }) as any

      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.msg) || '加载失败')
      }

      const rawList = this.data.mode === 'comments'
        ? (res.result.comments || [])
        : (res.result.posts || [])
      const list = rawList.map((item: any) => (
        this.data.mode === 'comments' ? this.normalizeComment(item) : this.normalizePost(item)
      ))

      this.setData({
        posts: this.data.page === 1 ? list : [...this.data.posts, ...list],
        hasMore: !!res.result.hasMore,
        page: this.data.page + 1
      })
    } catch (err: any) {
      console.error('加载校园动态失败:', err)
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  loadMore() {
    this.loadPosts()
  },

  changeOrder(e: any) {
    if (this.data.mode !== 'all') return
    const orderBy = e.currentTarget.dataset.order
    this.setData({ orderBy, page: 1, posts: [], hasMore: true })
    this.loadPosts()
  },

  toggleSearch() {
    if (this.data.mode !== 'all') return
    this.setData({ showSearch: !this.data.showSearch })
  },

  onSearchInput(e: any) {
    this.setData({ keyword: e.detail.value })
  },

  async onSearch() {
    if (this.data.mode !== 'all') return
    const keyword = String(this.data.keyword || '').trim()
    if (!keyword) {
      this.setData({ page: 1, posts: [], hasMore: true })
      this.loadPosts()
      return
    }

    this.setData({ loading: true, posts: [] })
    try {
      const res = await api.call({
        name: 'forum',
        data: { action: 'searchPosts', data: { keyword, page: 1, pageSize: 50 } }
      }) as any
      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.msg) || '搜索失败')
      }
      this.setData({
        posts: (res.result.posts || []).map((post: any) => this.normalizePost(post)),
        hasMore: false
      })
    } catch (err: any) {
      console.error('搜索校园动态失败:', err)
      wx.showToast({ title: err.message || '搜索失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  previewImage(e: any) {
    const url = e.currentTarget.dataset.url
    const urls = e.currentTarget.dataset.urls
    if (!url || !Array.isArray(urls)) return
    wx.previewImage({ current: url, urls })
  },

  goToDetail(e: any) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '原动态已删除', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/packageForum/pages/detail/detail?id=' + id })
  },

  goToPost() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.navigateTo({
        url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent('/packageForum/pages/post/post')
      })
      return
    }
    wx.navigateTo({ url: '/packageForum/pages/post/post' })
  }
}))
