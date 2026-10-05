'use strict'

const moduleDefinitions = {
  running: { name: '校园跑', icon: 'running' },
  canteen: { name: '食堂饭菜评价', icon: 'star' },
  forum: { name: '校园动态', icon: 'comments' },
  english: { name: '四六级学习', icon: 'book' },
  gifts: { name: '祝福小站', icon: 'gift' }
}

function normalizeModules(saved = {}) {
  const modules = {}
  for (const [key, definition] of Object.entries(moduleDefinitions)) {
    const value = saved[key] === undefined && key === 'running' ? saved.run : saved[key]
    modules[key] = {
      name: definition.name,
      enabled: typeof value === 'boolean' ? value : !value || value.enabled !== false
    }
  }
  return modules
}

module.exports = { moduleDefinitions, normalizeModules }
