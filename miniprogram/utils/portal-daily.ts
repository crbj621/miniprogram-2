const colors = ['#5268a6', '#95627d', '#397e77', '#87659b', '#946946', '#536fa0', '#7b6f35']

// 按北京时间的自然日选择，同一天稳定；页面再次显示时更新。
export function getPortalDaily(timestamp = Date.now()) {
  const day = Math.floor((timestamp + 8 * 60 * 60 * 1000) / 86400000)
  const index = ((day % colors.length) + colors.length) % colors.length
  return { color: colors[index] }
}
