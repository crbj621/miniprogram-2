'use strict'

// Browser-only WXML/WXSS conversion. No wx runtime, API, keyboard, or native layout claims.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const vm = require('node:vm')
const ts = require('typescript')
const dependencyRoot = process.env.PREVIEW_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
const { chromium } = require(path.join(dependencyRoot, 'playwright'))
const root = path.resolve(__dirname, '..')
const mini = path.join(root, 'miniprogram')
const output = path.join(root, 'docs/ui-preview')
const cache = new Map()
const wxMock = { getStorageSync: () => '', setStorageSync() {}, pageScrollTo() {} }

function loadTs(file) {
  if (cache.has(file)) return cache.get(file)
  const result = { exports: {}, definition: null }
  cache.set(file, result)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } }).outputText
  const localRequire = name => {
    if (!name.startsWith('.')) return require(name)
    const base = path.resolve(path.dirname(file), name)
    const found = [base + '.ts', base + '.js', path.join(base, 'index.ts')].find(candidate => fs.existsSync(candidate))
    return found ? loadTs(found).exports : require(base)
  }
  vm.runInNewContext(code, { exports: result.exports, require: localRequire, wx: wxMock, Page: value => { result.definition = value }, Component: value => { result.definition = value }, getApp: () => ({}), console, setTimeout, clearTimeout }, { filename: file })
  return result
}

function pageData(page, overrides = {}) {
  const data = Object.assign({ __sharePublic: false }, loadTs(path.join(mini, page + '.ts')).definition.data, overrides)
  if (page === 'pages/portal/portal') data.moduleCopy = Object.fromEntries(['running', 'food', 'canteen', 'forum', 'english', 'gifts'].map(scope => [scope, loadTs(path.join(mini, 'utils/page-copy.ts')).exports.getPageCopy(scope)]))
  return data
}

function css(file, stack = []) {
  if (stack.includes(file)) throw new Error('Circular WXSS import: ' + file)
  return fs.readFileSync(file, 'utf8').replace(/@import\s+["']([^"']+)["'];/g, (_, relative) => css(path.resolve(path.dirname(file), relative), [...stack, file]))
}

const theme = loadTs(path.join(mini, 'utils/campus-theme.ts')).exports
const shop = JSON.parse(fs.readFileSync(path.join(root, 'server/data/english/shop.json'), 'utf8'))
function wardrobe(character, category, feeding = false, outfitId = '') {
  const definition = loadTs(path.join(mini, 'packageProfile/pages/wardrobe/wardrobe.ts')).definition
  const instance = Object.assign({}, definition, { data: pageData('packageProfile/pages/wardrobe/wardrobe', { category, feeding, expression: 'yum', foodSymbol: '🍰' }), setData(values) { Object.assign(this.data, values) } })
  const state = { character, coins: 280, catalog: shop.items, assets: shop.assets, owned: shop.items.filter(item => item.category !== 'food').map(item => item.id),
    foodStock: { food_apple: 2, food_cake: 1, food_milk: 3 }, equipped: { outfit: outfitId || (character === 'boy' ? 'boy_campus' : ''), accessory: 'accessory_star', shoes: 'shoes_cloud', themes: { profile: 'theme_sakura', portal: 'theme_sakura', english: 'theme_mint' } } }
  Object.assign(state, require('../server/services/english_learning/companion-ranking').wardrobeHeat(state, shop))
  instance.applyWardrobe(state)
  return instance.data
}

function wardrobeRank(empty = false) {
  const data = wardrobe('girl', 'outfit', false, 'girl_peach_hanfu')
  const ranking = { myRank: empty ? null : 1, myHeat: data.wardrobe.heat, total: empty ? 0 : 3, rule: '当前穿戴装扮的热力总和；同分并列，未穿戴不计入。', items: [] }
  return { ...data, view: 'rank', rankState: 'ready', ranking, rankItems: empty ? [] : [
    { openid: 'layout-one', rank: 1, crown: '👑', title: '闪耀之星', nickName: '桃花小同学', heat: data.wardrobe.heat, outfitName: '桃花小仙子' },
    { openid: 'layout-two', rank: 1, crown: '👑', title: '闪耀之星', nickName: '超长昵称的校园小伙伴也要整齐显示', heat: data.wardrobe.heat, outfitName: '月白小书生' },
    { openid: 'layout-three', rank: 3, crown: '🥉', title: '穿搭新星', nickName: '薄荷同学', heat: 145, outfitName: '薄荷学院' }
  ] }
}

const englishHome = { level: 'CET4', coins: 280, today: { newCount: 12, reviewCount: 8, checkedIn: false }, plan: { level: 'CET4', newGoal: 20, reviewGoal: 40, frozen: true, pending: { level: 'CET4', newGoal: 25, reviewGoal: 50, appliesOn: '2026-10-04' } }, stats: { totalWords: 4449, learnedWords: 236, dueWords: 48, newRemaining: 4213, streak: 12, totalCheckins: 31 }, tasks: [{ id: 'new', label: '完成新词目标', target: 20, progress: 12, reward: 10, rewarded: false }, { id: 'review', label: '完成旧词目标', target: 40, progress: 8, reward: 10, rewarded: false }, { id: 'challenge', label: '完成每日挑战', target: 1, progress: 0, reward: 5, rewarded: false }], checkins: [] }
function homePreview(overrides = {}) {
  const definition = loadTs(path.join(mini, 'packageEnglish/pages/index/index.ts')).definition
  const instance = Object.assign({}, definition, { data: pageData('packageEnglish/pages/index/index', { theme: theme.getCampusTheme('mint', 'english') }), setData(values) { Object.assign(this.data, values) } })
  instance.applyHome(englishHome)
  return Object.assign(instance.data, overrides)
}
const longMeaning = 'n. 机会；时机；有利条件。指可以实现某一目标、改善现状或展示能力的合适时间、情境或环境。相关搭配：take the opportunity to do something（抓住机会做某事）。'
const localContent = require(path.join(root, 'server/src/english-content.js')).content()
const sourcePaper = localContent.papers.find(paper => paper.id === 'cet4-2023-06-1')
const realQuestions = sourcePaper.questionIds.map(id => localContent.questionById.get(id)).filter(question => question.skill !== 'listening')
const fullPaper = { ...sourcePaper, title: sourcePaper.title + '（不含听力）', questionIds: realQuestions.map(question => question.id), durationSeconds: 6000, coverage: { fullNonListening: true, listeningExcluded: true } }
function papersPreview() {
  const papers = localContent.papers.filter(paper => paper.level === 'CET4' && paper.year === 2023).map(paper => ({
    ...paper, available: Boolean(paper.questionIds.length), questionCount: paper.coverage && (paper.coverage.fullPaper || paper.coverage.fullNonListening) ? 32 : paper.questionIds.length,
    resources: (paper.resources || []).filter(resource => resource.type !== 'audio'), durationMinutes: 100,
    isFullPaper: Boolean(paper.authenticity === 'past_exam' && paper.coverage && (paper.coverage.fullPaper || paper.coverage.fullNonListening)),
    badgeText: paper.authenticity === 'past_exam' && paper.coverage && (paper.coverage.fullPaper || paper.coverage.fullNonListening) ? '真题整卷 · 不含听力' : '真题节选 · 非整卷',
    coverageText: paper.coverage && (paper.coverage.note || paper.coverage.label) || ''
  }))
  const definition = loadTs(path.join(mini, 'packageEnglish/pages/papers/papers.ts')).definition
  const instance = Object.assign({}, definition, { data: pageData('packageEnglish/pages/papers/papers', { papers, years: ['全部年份', '2023'], yearIndex: 1, coverageText: '2023年布局样例 · 每套32题（不含听力）', theme: theme.getCampusTheme('mint', 'english') }), setData(values) { Object.assign(this.data, values) } })
  instance.filterPapers()
  return instance.data
}
function attemptPreview(section, navigationExpanded = false, sourceId = '') {
  const definition = loadTs(path.join(mini, 'packageEnglish/pages/attempt/attempt.ts')).definition
  const paper = sourceId ? localContent.papers.find(item => item.id === sourceId) : fullPaper
  const questions = sourceId ? paper.questionIds.map(id => localContent.questionById.get(id)) : realQuestions
  const question = questions.find(item => item.section === section)
  const instance = Object.assign({}, definition, { data: pageData('packageEnglish/pages/attempt/attempt', { level: paper.level, mode: 'exam', navigationExpanded, remainingText: '99:35', theme: theme.getCampusTheme('mint', 'english') }), setData(values, complete) { Object.assign(this.data, values); if (complete) complete() } })
  instance.showAttempt({ attemptId: 'layout-only', paper, mode: 'exam', status: 'active', completed: 0, total: questions.length, question, questions, answers: [], drafts: {} })
  instance.setData({ navigationExpanded })
  return instance.data
}
function studyPreview(feedback = false) {
  const exampleEn = 'The project gives students an opportunity to practise their English.'
  return pageData('packageEnglish/pages/study/study', {
    session: { completed: feedback ? 4 : 3, total: 20 }, completed: feedback ? 4 : 3, total: 20, progress: feedback ? 20 : 15,
    question: { lemma: 'opportunity', ipa: '/ˌɒpəˈtjuːnəti/', partOfSpeech: 'n.', hasHint: true, exampleEn,
      options: [{ id: 'a', text: 'n. 机会；时机' }, { id: 'b', text: 'adj. 持续不断的；不间断的' }, { id: 'c', text: 'v. 作出回应；响应请求' }, { id: 'd', text: 'n. 责任；义务' }] },
    chosen: feedback ? 'b' : '',
    feedback: feedback ? { correct: false, correctAnswer: 'a', meaningText: longMeaning + '\n\n常见搭配：a rare opportunity（难得的机会）；equal opportunities（平等机会）；miss an opportunity（错失机会）。', examples: [
      { index: 0, exampleEn, exampleZh: '这个项目让学生有机会练习英语。' },
      { index: 1, exampleEn: 'The university offers every student an opportunity to learn from different cultures and develop practical communication skills.', exampleZh: '大学为每一位学生提供了解不同文化、培养实际沟通能力的机会。' }
    ], explanation: '结合例句中 practise their English 的上下文，这里表示获得学习和成长的合适机会。注意与 possibility（可能性）以及 occasion（特定场合）的区别。' } : null,
    intervalLabel: feedback ? '本轮稍后会再次复习这个单词' : '', cardState: feedback ? 'retry' : 'enter', theme: theme.getCampusTheme('mint', 'english')
  })
}
const scenarios = [
  { name: 'portal-mahiro', page: 'pages/portal/portal', data: pageData('pages/portal/portal', { userInfo: { nickName: '小橘同学的超长校园昵称直到这里还没结束', avatarUrl: '' }, isLoggedIn: true, daily: { title: '把日常过成小欢喜', subtitle: '跑一步 · 吃好饭 · 收藏校园时光', color: '#95627d' }, modulesState: 'ready', hasOpenModules: true, modules: { running: true, food: true, canteen: true, forum: true, english: true }, companionState: 'ready', companion: wardrobe('girl', 'food').appearance, theme: theme.getCampusTheme('sakura', 'portal') }) },
  { name: 'wardrobe-boy', page: 'packageProfile/pages/wardrobe/wardrobe', data: wardrobe('boy', 'outfit') },
  { name: 'wardrobe-mahiro-feed', page: 'packageProfile/pages/wardrobe/wardrobe', data: wardrobe('girl', 'food', true) },
  { name: 'wardrobe-girl-ancient', page: 'packageProfile/pages/wardrobe/wardrobe', data: wardrobe('girl', 'outfit', false, 'girl_peach_hanfu') },
  { name: 'wardrobe-boy-campus-layer', page: 'packageProfile/pages/wardrobe/wardrobe', data: wardrobe('boy', 'outfit', false, 'boy_campus_vest') },
  { name: 'wardrobe-rank', page: 'packageProfile/pages/wardrobe/wardrobe', data: wardrobeRank() },
  { name: 'wardrobe-rank-empty', page: 'packageProfile/pages/wardrobe/wardrobe', data: wardrobeRank(true) },
  { name: 'home', page: 'packageEnglish/pages/index/index', data: homePreview() },
  { name: 'home-plan', page: 'packageEnglish/pages/index/index', data: homePreview({ planOpen: true, myOpen: true }) },
  { name: 'home-extra', page: 'packageEnglish/pages/index/index', data: homePreview({ home: { ...englishHome, today: { ...englishHome.today, newCount: 25, reviewCount: 42, extraNewCount: 5, extraReviewCount: 2, checkedIn: true }, extraStudy: { enabled: true, maxCount: 100, newAvailable: 4208, reviewAvailable: 6 } }, extraCount: '100', progress: 100, checkedAt: '18:00' }) },
  { name: 'papers-full', page: 'packageEnglish/pages/papers/papers', data: papersPreview() },
  { name: 'challenge', page: 'packageEnglish/pages/challenge/challenge', data: pageData('packageEnglish/pages/challenge/challenge', { theme: theme.getCampusTheme('mint', 'english') }) },
  { name: 'rank', page: 'packageEnglish/pages/rank/rank', data: pageData('packageEnglish/pages/rank/rank', { myRank: 4, myScore: 28, topThree: [{ openid: 'first', rank: 1, medal: '🥇', nickName: '小橘', score: 60, newCount: 20, reviewCount: 40, streak: 12, totalCheckins: 31 }, { openid: 'second', rank: 2, medal: '🥈', nickName: '校园同学', score: 45, newCount: 15, reviewCount: 30, streak: 6, totalCheckins: 20 }, { openid: 'third', rank: 3, medal: '🥉', nickName: '努力记词', score: 36, newCount: 12, reviewCount: 24, streak: 4, totalCheckins: 12 }], theme: theme.getCampusTheme('mint', 'english') }) },
  { name: 'study-question', page: 'packageEnglish/pages/study/study', data: studyPreview() },
  { name: 'study-long', page: 'packageEnglish/pages/study/study', data: studyPreview(true) },
  { name: 'study-extra-correct', page: 'packageEnglish/pages/study/study', data: { ...studyPreview(true), session: { total: 10, completed: 4, extra: true }, cardState: 'correct', feedback: { ...studyPreview(true).feedback, correct: true } } },
  { name: 'attempt-writing', page: 'packageEnglish/pages/attempt/attempt', data: attemptPreview('writing') },
  { name: 'attempt-writing-chart', page: 'packageEnglish/pages/attempt/attempt', data: attemptPreview('writing', false, 'cet6-2021-06-1-nonlistening') },
  { name: 'attempt-reading', page: 'packageEnglish/pages/attempt/attempt', data: attemptPreview('reading_comprehension') },
  { name: 'attempt-navigation', page: 'packageEnglish/pages/attempt/attempt', data: attemptPreview('writing', true) }
]

const componentPaths = Object.fromEntries(['campus-companion', 'campus-sticker', 'mahiro-scroll', 'tech-loader'].map(name => [name, path.join(mini, 'components', name, name)]))
componentPaths['english-nav'] = path.join(mini, 'packageEnglish/components/english-nav/english-nav')
const components = Object.fromEntries(Object.entries(componentPaths).map(([name, base]) => {
  const definition = loadTs(base + '.ts').definition
  const defaults = Object.assign({}, definition.data || {})
  for (const [key, value] of Object.entries(definition.properties || {})) defaults[key] = value.value
  return [name, { template: fs.readFileSync(base + '.wxml', 'utf8'), defaults, css: css(base + '.wxss') }]
}))

// Only standard tags and expressions used by the current fixture templates are converted.
const renderBrowser = String(function renderBrowser(source, initialData, componentSources) {
  const evaluate = (expression, context) => Function('context', 'with(context){return (' + expression + ')}')(context)
  const value = (text, context) => {
    const single = text.match(/^\{\{([\s\S]*)\}\}$/)
    if (single && !single[1].includes('}}')) { const result = evaluate(single[1], context); return result == null ? '' : result }
    return text.replace(/\{\{([\s\S]*?)\}\}/g, (_, expression) => { const result = evaluate(expression, context); return result == null ? '' : String(result) })
  }
  const parse = text => {
    const markup = text.replace(/\{\{[\s\S]*?\}\}/g, expression => expression.replace(/</g, '&lt;')).replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/\b(wx:else|scroll-y|scroll-x|refresher-enabled|lazy-load)(?=\s|\/?>)(?!\s*=)/g, '$1=""')
    const xml = new DOMParser().parseFromString('<preview xmlns:wx="urn:wx">' + markup + '</preview>', 'application/xml')
    const error = xml.querySelector('parsererror')
    if (error) throw new Error(error.textContent)
    return xml.documentElement.childNodes
  }
  function children(nodes, context, slots) {
    const output = document.createDocumentFragment()
    let conditional = false, matched = false
    for (const node of nodes) {
      if (node.nodeType === 3) { if (node.nodeValue.trim()) output.append(document.createTextNode(value(node.nodeValue, context))); continue }
      if (node.nodeType !== 1) continue
      if (node.hasAttribute('wx:for')) {
        const list = value(node.getAttribute('wx:for'), context) || []
        Array.from(list).forEach((item, index) => {
          const copy = node.cloneNode(true); copy.removeAttribute('wx:for')
          output.append(children([copy], Object.assign({}, context, { [node.getAttribute('wx:for-item') || 'item']: item, [node.getAttribute('wx:for-index') || 'index']: index }), slots))
        })
        conditional = false; continue
      }
      if (node.hasAttribute('wx:if')) { conditional = true; matched = Boolean(value(node.getAttribute('wx:if'), context)); if (!matched) continue }
      else if (node.hasAttribute('wx:elif')) { if (!conditional || matched || !value(node.getAttribute('wx:elif'), context)) continue; matched = true }
      else if (node.hasAttribute('wx:else')) { if (!conditional || matched) continue; matched = true }
      else conditional = false
      if (node.getAttribute('slot') === 'refresher' && !context.triggered) continue
      const tag = node.tagName
      if (tag === 'block') { output.append(children(node.childNodes, context, slots)); continue }
      if (tag === 'slot') { if (slots) output.append(children(slots.nodes, slots.context, null)); continue }
      if (componentSources[tag]) {
        const host = document.createElement(tag)
        const properties = Object.assign({}, componentSources[tag].defaults)
        for (const attr of node.attributes) {
          if (attr.name.startsWith('wx:') || /^(bind|catch)/.test(attr.name)) continue
          const property = attr.name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
          properties[property] = value(attr.value, context)
          if (['id', 'class', 'style'].includes(attr.name)) host.setAttribute(attr.name, value(attr.value, context))
        }
        host.append(children(parse(componentSources[tag].template), properties, { nodes: node.childNodes, context }))
        output.append(host); continue
      }
      const element = document.createElement(tag === 'image' ? 'img' : tag === 'text' ? 'span' : tag)
      for (const attr of node.attributes) {
        if (attr.name.startsWith('wx:') || /^(bind|catch)/.test(attr.name)) continue
        const resolved = value(attr.value, context)
        if (['disabled', 'checked'].includes(attr.name)) { if (resolved) element.setAttribute(attr.name, ''); continue }
        if (attr.name === 'src') {
          const local = String(resolved || '').match(/\/english-assets\/(companions|exams)\/([^/?]+)$/)
          element.setAttribute('src', local ? '../../server/public/english/' + local[1] + '/' + local[2] : resolved); continue
        }
        if (resolved != null) element.setAttribute(attr.name, resolved)
      }
      if (tag === 'image') element.style.objectFit = node.getAttribute('mode') === 'aspectFill' ? 'cover' : 'contain'
      if (tag === 'input') element.value = value(node.getAttribute('value') || '', context)
      element.append(children(node.childNodes, context, slots)); output.append(element)
    }
    return output
  }
  document.getElementById('preview').append(children(parse(source), initialData, null))
  window.previewReady = true
})

function styles(scenario, width) {
  const native = 'html,body{margin:0;padding:0;width:100%;}body{--rpx:' + width / 750 + 'px;}view,scroll-view,mahiro-scroll,campus-companion,campus-sticker,tech-loader,english-nav{display:block;}span{white-space:normal;}button{display:block;position:relative;width:184px;margin-left:auto;margin-right:auto;padding:0 14px;border:0;box-sizing:border-box;line-height:2.55555556;text-align:center;background:#f8f8f8;font:inherit;}button::after{content:"";position:absolute;inset:0;border:1px solid #0003;border-radius:inherit;pointer-events:none;}input{display:block;border:0;box-sizing:border-box;font:inherit;}img{display:block;}textarea{display:block;box-sizing:border-box;font:inherit;}scroll-view[scroll-x]{overflow-x:auto;overflow-y:hidden;}scroll-view[scroll-y]{overflow-y:auto;}scroll-view::-webkit-scrollbar{display:none;}.preview-watermark{position:fixed;right:5px;top:1px;z-index:99999;padding:2px 6px;background:#ffffffdb;color:#806b86;font:9px sans-serif;border-radius:6px;pointer-events:none;}'
  const actual = css(path.join(mini, 'app.wxss')) + '\n' + css(path.join(mini, scenario.page + '.wxss'))
  const scoped = Object.entries(components).map(([name, component]) => '@scope (' + name + '){' + component.css.replace(/:host\b/g, ':scope') + '}').join('\n')
  return native + '\n' + (actual + '\n' + scoped).replace(/(^|[\n\r}])(\s*)page(?=\s*[{,])/g, '$1$2body').replace(/(?<![.\w-])image(?![\w-])/g, 'img').replace(/(-?\d*\.?\d+)rpx/g, 'calc($1 * var(--rpx))')
}

function html(scenario, width, height) {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>浏览器WXML转换样例 · ' + scenario.name + ' ' + width + '×' + height + '</title><style>' + styles(scenario, width) + '</style></head><body><main id="preview"></main><aside class="preview-watermark">浏览器转换样例 · 非微信真机</aside><script>(' + renderBrowser + ')(' + JSON.stringify(fs.readFileSync(path.join(mini, scenario.page + '.wxml'), 'utf8')) + ',' + JSON.stringify(scenario.data) + ',' + JSON.stringify(components) + ')</script></body></html>'
}

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const server = http.createServer((request, response) => {
    const filename = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return }
    fs.readFile(filename, (error, buffer) => { if (error) { response.writeHead(404).end(); return } response.setHeader('Content-Type', filename.endsWith('.png') ? 'image/png' : 'text/html;charset=utf-8'); response.end(buffer) })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ channel: process.env.PREVIEW_BROWSER || 'msedge', headless: true })
  const reports = []
  try {
    for (const [width, height] of [[320, 568], [390, 844]]) for (const scenario of scenarios) {
      const name = 'english-' + scenario.name + '-' + width + 'x' + height
      fs.writeFileSync(path.join(output, name + '.html'), html(scenario, width, height))
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
      const errors = []
      page.on('pageerror', error => { errors.push(error.message); console.error(name + ': ' + error.message) })
      await page.route('https://**/*', route => route.abort())
      await page.goto('http://127.0.0.1:' + server.address().port + '/docs/ui-preview/' + name + '.html')
      await page.waitForFunction(() => window.previewReady === true, null, { timeout: 5000 })
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(img => img.decode().catch(() => {}))) })
      const layout = await page.evaluate(() => {
        const rawOverflow = Array.from(document.querySelectorAll('#preview *')).filter(element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1) && !element.closest('scroll-view[scroll-x]') })
        const isClipped = element => {
          let left = element.getBoundingClientRect().left, right = element.getBoundingClientRect().right
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) { const rect = parent.getBoundingClientRect(); left = Math.max(left, rect.left); right = Math.min(right, rect.right) }
          }
          return right <= left || left >= -1 && right <= innerWidth + 1
        }
        const describe = element => ({ tag: element.tagName, class: element.className, text: element.textContent.slice(0, 60) })
        return {
        documentWidth: document.documentElement.scrollWidth,
        optionCount: document.querySelectorAll('button.option').length,
        navigationQuestionCount: document.querySelectorAll('.navigation-grid button').length,
        brokenImages: Array.from(document.images).filter(img => !img.complete || !img.naturalWidth).map(img => img.getAttribute('src')),
        overflow: rawOverflow.filter(element => !isClipped(element)).map(describe),
        clippedDecorations: rawOverflow.filter(isClipped).map(describe),
        textOverflow: Array.from(document.querySelectorAll('.option-copy,.meaning,.hero-title,.item-name,.item-description,.title')).filter(element => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1).map(describe),
        fixedActions: Array.from(document.querySelectorAll('.english-nav,.study-footer,.attempt-actions')).map(element => { const rect = element.getBoundingClientRect(); return { class: element.className, top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) } }),
        inputs: Array.from(document.querySelectorAll('input')).map(element => ({ value: element.value, width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height) })),
        buttons: Array.from(document.querySelectorAll('button')).filter(element => element.offsetWidth).map(element => ({ text: element.textContent.trim(), width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height) }))
      } })
      reports.push({ scenario: scenario.name, viewport: { width, height }, errors, ...layout })
      if (scenario.name === 'study-question' && layout.optionCount !== 4) errors.push('normal study must show four options')
      if (scenario.name === 'study-long' && layout.optionCount !== 0) errors.push('answered study must hide old options')
      if (scenario.name === 'attempt-navigation' && layout.navigationQuestionCount !== 32) errors.push('non-listening paper must preserve 32 question navigation entries')
      await page.screenshot({ path: path.join(output, name + '.png') })
      if (['study-long', 'home-plan', 'wardrobe-boy', 'papers-full', 'attempt-writing', 'attempt-reading', 'attempt-navigation'].includes(scenario.name)) await page.screenshot({ path: path.join(output, name + '-full.png'), fullPage: true })
      if (['study-long', 'home-plan', 'attempt-writing', 'attempt-reading', 'attempt-navigation'].includes(scenario.name)) {
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
        await page.screenshot({ path: path.join(output, name + '-bottom.png') })
        const clearance = await page.evaluate(() => {
          const footer = document.querySelector('.study-footer,.attempt-actions,.english-nav')
          const cards = document.querySelectorAll('.english-page > .card,.study-card')
          if (!footer || !cards.length) return null
          return Math.round(footer.getBoundingClientRect().top - cards[cards.length - 1].getBoundingClientRect().bottom)
        })
        reports[reports.length - 1].bottomClearance = clearance
        if (clearance != null && clearance < -1) errors.push('last card overlaps fixed actions at page bottom')
      }
      await page.close()
    }
    fs.writeFileSync(path.join(output, 'english-layout-report.json'), JSON.stringify({ kind: 'browser-wxml-conversion-only', source: 'current WXML/WXSS with explicit fixture data and unmodified local PNG', generatedAt: new Date().toISOString(), reports }, null, 2))
    console.log(JSON.stringify(reports.map(report => ({ scenario: report.scenario, viewport: report.viewport, width: report.documentWidth, overflow: report.overflow.length, brokenImages: report.brokenImages.length, errors: report.errors })), null, 2))
    if (reports.some(report => report.errors.length || report.brokenImages.length || report.overflow.length || report.textOverflow.length || report.documentWidth > report.viewport.width)) process.exitCode = 1
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
