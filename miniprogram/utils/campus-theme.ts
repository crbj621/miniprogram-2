export const CAMPUS_THEME_MODULES = [
  { key: 'portal', name: '首页' }, { key: 'english', name: '英语学习' },
  { key: 'running', name: '校园跑' },
  { key: 'canteen', name: '食堂评分' }, { key: 'forum', name: '校园动态' },
  { key: 'profile', name: '个人中心' }
]

const palettes: any = {
  default: { name: '校园晴天', accent: '#5274a1', soft: '#f2f6fa', line: '#d7e4f1', button: 'linear-gradient(110deg,#bdefff,#d1e0ff,#e3d1ff)', decoration: '✦' },
  sky: { name: '晴空蓝', accent: '#417eac', soft: '#eef8ff', line: '#bddbf1', button: 'linear-gradient(110deg,#b7e8ff,#d5e7ff)', decoration: '☁' },
  sakura: { name: '樱花粉', accent: '#a56488', soft: '#fff2f7', line: '#efd0df', button: 'linear-gradient(110deg,#ffdbeb,#eedcff)', decoration: '✿' },
  mint: { name: '薄荷绿', accent: '#498c7e', soft: '#edf9f4', line: '#c2e5d9', button: 'linear-gradient(110deg,#c4f0df,#d7edfb)', decoration: '❀' },
  night: { name: '星空紫', accent: '#7865a1', soft: '#f2effc', line: '#d7ceef', button: 'linear-gradient(110deg,#ded5ff,#d3e6ff)', decoration: '✧' }
}

export function getCampusTheme(themeKey = 'default', module = 'portal') {
  const key = String(themeKey || 'default').replace(/^theme[-_]/, '')
  const palette = palettes[key] || palettes.default
  return {
    key: palettes[key] ? key : 'default', name: palette.name, module,
    decoration: palette.decoration,
    style: '--campus-theme-accent:' + palette.accent + ';--campus-theme-soft:' + palette.soft +
      ';--campus-theme-line:' + palette.line + ';--campus-theme-button:' + palette.button + ';--campus-theme-tint:' + palette.soft + 'bf;'
  }
}

function themeStorageKey() {
  const openid = wx.getStorageSync('openid')
  return openid ? 'campus_themes_' + openid : ''
}

export function getSavedCampusTheme(module = 'portal') {
  const storageKey = themeStorageKey()
  const themes = storageKey && wx.getStorageSync(storageKey) || {}
  return getCampusTheme(themes[module] || 'default', module)
}

export function saveCampusThemes(themes: any) {
  const storageKey = themeStorageKey()
  if (!storageKey || !themes || typeof themes !== 'object') return
  const saved: any = {}
  CAMPUS_THEME_MODULES.forEach(module => { saved[module.key] = String(themes[module.key] || 'default') })
  wx.setStorageSync(storageKey, saved)
}

export function saveCampusThemeSelection(module: string, themeKey: string) {
  if (!CAMPUS_THEME_MODULES.some(item => item.key === module)) return
  const storageKey = themeStorageKey()
  if (!storageKey) return
  const themes = wx.getStorageSync(storageKey) || {}
  themes[module] = themeKey
  saveCampusThemes(themes)
}
