const routes: { [key: string]: { title: string; keys?: string[] } } = {
  '/pages/portal/portal': { title: '把校园日常过成小欢喜' },
  '/pages/index/index': { title: '和校园伙伴一起开跑', keys: ['addFriend'] },
  '/pages/rank/rank': { title: '校园跑 · 看看谁在认真发光' },
  '/packageCanteen/pages/index/index': { title: '食堂评分 · 发现值得吃的菜' },
  '/packageCanteen/pages/stall/stall': { title: '一起看看这个食堂档口', keys: ['id'] },
  '/packageCanteen/pages/dish/dish': { title: '这道菜值得吃吗？看看同学的点评', keys: ['id'] },
  '/packageForum/pages/index/index': { title: '校园动态 · 分享新鲜事' },
  '/packageForum/pages/list/list': { title: '校园动态 · 遇见同频的朋友', keys: ['category', 'tab'] },
  '/packageForum/pages/detail/detail': { title: '来看看这条校园新鲜事', keys: ['id'] },
  '/packageEnglish/pages/index/index': { title: '四六级英语 · 每天学一点' },
  '/packageEnglish/pages/papers/papers': { title: '四六级整套真题 · 一起练习', keys: ['level'] },
  '/packageEnglish/pages/challenge/challenge': { title: '每日单词挑战 · 来比一场', keys: ['level'] },
  '/packageEnglish/pages/rank/rank': { title: '英语学习榜 · 每一份坚持都闪闪发光', keys: ['level'] },
  '/packageProfile/pages/wardrobe/wardrobe': { title: '校园伙伴 · 装扮自己的小世界' },
  '/packageProfile/pages/tasks/tasks': { title: '校园每日任务 · 收集小小奖励' },
  '/packageGifts/pages/index/index': { title: '祝福小站 · 把心意做成一个网站' },
  '/packageGifts/pages/view/view': { title: '有一份小惊喜，想送给你', keys: ['id', 'demo'] }
}
function entry(route: string, params: any = {}) {
  let path = route.startsWith('/') ? route : '/' + route
  if (!routes[path]) path = path.startsWith('/packageEnglish/') ? '/packageEnglish/pages/papers/papers' : path.startsWith('/packageGifts/') ? '/packageGifts/pages/index/index' : path.startsWith('/packageCanteen/') ? '/packageCanteen/pages/index/index' : path.startsWith('/packageForum/') ? '/packageForum/pages/index/index' : '/pages/portal/portal'
  const query = (routes[path].keys || []).filter(key => typeof params[key] === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(params[key])).map(key => key + '=' + encodeURIComponent(params[key])).join('&')
  return { title: routes[path].title, path: path + (query ? '?' + query : '') }
}
function parseEntry(value: string, route: string) {
  let decoded = String(value || '')
  try { decoded = decodeURIComponent(decoded) } catch (_) { return entry(route) }
  const parts = decoded.split('?'), params: any = {}
  if (!routes[parts[0]]) return entry(route)
  ;(parts[1] || '').split('&').forEach(pair => { const [key, value] = pair.split('='); if (key && value) { try { params[key] = decodeURIComponent(value) } catch (_) {} } })
  return entry(parts[0], params)
}
function menu() { if (typeof wx.showShareMenu === 'function') wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }) }
export function withSharing<T extends { [key: string]: any }>(definition: T): T {
  const result: any = { ...definition }
  result.onLoad = function(options: any = {}) {
    this.__shareParams = options
    this.__shareOnly = options.sharePublic === '1'
    if (this.__shareOnly) {
      const shared = parseEntry(options.entry, this.route || '')
      this.__shareEntry = shared
      this.setData({ __sharePublic: true, __shareTitle: shared.title, __sharePath: shared.path })
      return
    }
    return definition.onLoad && definition.onLoad.call(this, options)
  }
  for (const lifecycle of ['onShow', 'onReady', 'onHide', 'onUnload', 'onReachBottom', 'onPullDownRefresh', 'onPageScroll']) result[lifecycle] = function(...args: any[]) {
    if (lifecycle === 'onShow') menu()
    if (this.__shareOnly) { if (lifecycle === 'onPullDownRefresh') wx.stopPullDownRefresh(); return }
    return definition[lifecycle] && definition[lifecycle].apply(this, args)
  }
  result.onShareAppMessage = function(event: any) {
    if (this.__shareOnly) return this.__shareEntry
    const shared = entry(this.route || '', { ...this.__shareParams, ...(this.data.level === 'CET4' || this.data.level === 'CET6' ? { level: this.data.level } : {}) })
    if (definition.onShareAppMessage) {
      const custom = definition.onShareAppMessage.call(this, event)
      if (custom && typeof custom.path === 'string' && routes[custom.path.split('?')[0]]) return { ...parseEntry(custom.path, this.route), title: custom.title || shared.title }
    }
    if (this.route === 'packageGifts/pages/view/view' && this.data.site) shared.title = this.data.site.title + ' · 给 ' + this.data.site.recipient
    return shared
  }
  result.onShareTimeline = function() {
    const shared = this.__shareOnly ? this.__shareEntry : entry(this.route || '', { ...this.__shareParams, ...(this.data.level === 'CET4' || this.data.level === 'CET6' ? { level: this.data.level } : {}) })
    // 朋友圈保持当前页面路由；单页模式先展示公开卡片，不能请求私密数据或强制登录。
    return { title: shared.title, query: 'sharePublic=1&entry=' + encodeURIComponent(shared.path) }
  }
  return result
}
