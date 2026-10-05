'use strict'

const WEARABLE_SLOTS = ['outfit', 'accessory', 'shoes']

function wardrobeHeat(profile, catalog) {
  const owned = new Set(Array.isArray(profile.owned) ? profile.owned : [])
  const equipped = profile.equipped || {}
  const items = new Map((catalog.items || []).map(item => [item.id, item]))
  const selected = [...WEARABLE_SLOTS.map(slot => ({ id: equipped[slot], category: slot })), ...Object.values(equipped.themes || {}).map(id => ({ id, category: 'theme' }))]
  const counted = new Set(), breakdown = []
  for (const selection of selected) {
    const item = items.get(selection.id)
    if (!item || !owned.has(item.id) || counted.has(item.id) || item.category !== selection.category || item.enabled === false) continue
    const compatible = item.character === 'all' || item.character === profile.character || (item.compatibleCharacters || []).includes(profile.character)
    if (!compatible) continue
    const heat = Number(item.heat)
    if (!Number.isInteger(heat) || heat <= 0) continue
    counted.add(item.id)
    breakdown.push({ id: item.id, name: item.name, category: item.category, heat })
  }
  return { heat: breakdown.reduce((total, item) => total + item.heat, 0), equippedCount: breakdown.length, breakdown }
}

function buildWardrobeRanking(profiles, catalog, users, openid) {
  const names = new Map(users.map(user => [user.openid, user]))
  const list = profiles.map(profile => {
    const appearance = wardrobeHeat(profile, catalog), user = names.get(profile.openid) || {}
    const outfit = appearance.breakdown.find(item => item.category === 'outfit')
    return { openid: profile.openid, character: profile.character === 'girl' ? 'girl' : 'boy', nickName: user.nickName || '校园伙伴', avatarUrl: user.avatarUrl || '', heat: appearance.heat, equippedCount: appearance.equippedCount, outfitName: outfit ? outfit.name : '初始衣装' }
  }).filter(row => row.heat > 0).sort((a, b) => b.heat - a.heat || a.openid.localeCompare(b.openid))
  let lastHeat = null, lastRank = 0
  const ranked = list.map((row, index) => {
    if (row.heat !== lastHeat) { lastRank = index + 1; lastHeat = row.heat }
    return { ...row, rank: lastRank }
  })
  const mine = ranked.find(row => row.openid === openid)
  const profile = profiles.find(row => row.openid === openid)
  return { items: ranked.slice(0, 100), myRank: mine ? mine.rank : null, myHeat: profile ? wardrobeHeat(profile, catalog).heat : 0, total: ranked.length, rule: '当前穿戴的衣服、首饰、鞋子和已应用主题的热力值相加。同一主题应用到多个板块只计算一次；食物与未穿戴收藏不计入。分数相同并列排名。' }
}

module.exports = { wardrobeHeat, buildWardrobeRanking }
