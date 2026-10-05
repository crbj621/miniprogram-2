import { API_BASE_URL } from '../../config/api'

export function companionImageUrl(path: any): string {
  if (typeof path !== 'string' || !path) return ''
  if (/^https:\/\//.test(path)) return path
  if (path.indexOf('/english-assets/') === 0) return API_BASE_URL.replace(/\/+$/, '') + path
  return ''
}

function imageFor(item: any, character: string) {
  if (!item || item.character && item.character !== 'all' && item.character !== character) return ''
  const images = item.imagesByCharacter || item.images || {}
  return companionImageUrl(images[character] || item.image)
}

function anchorStyle(item: any) {
  const anchor = item && item.anchor
  if (!anchor) return ''
  const values = ['left', 'top', 'width', 'height'].map(key => Number(anchor[key]))
  if (values.some(value => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) return ''
  return 'left:' + values[0] + '%;top:' + values[1] + '%;width:' + values[2] + '%;height:' + values[3] + '%;'
}

export function getCompanionAppearance(wardrobe: any) {
  const character = wardrobe && wardrobe.character === 'girl' ? 'girl' : 'boy'
  const catalog = wardrobe && Array.isArray(wardrobe.catalog) ? wardrobe.catalog : []
  const equipped = wardrobe && wardrobe.equipped || {}
  const itemFor = (slot: string) => catalog.find((item: any) => item.id === equipped[slot])
  const outfit = itemFor('outfit')
  const accessory = itemFor('accessory')
  const shoes = itemFor('shoes')
  const assets = wardrobe && wardrobe.assets || {}
  return {
    character,
    image: outfit && outfit.renderMode !== 'layer' && imageFor(outfit, character) || companionImageUrl(assets[character]),
    outfit: outfit && outfit.renderMode === 'layer' ? imageFor(outfit, character) : '',
    accessory: imageFor(accessory, character), accessoryStyle: anchorStyle(accessory),
    shoes: imageFor(shoes, character), shoesStyle: anchorStyle(shoes)
  }
}
