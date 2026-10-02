'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { readPortfolio, writePortfolio } = require('../src/portfolio-store')
const source = require('../data/portfolio-content.json')

const testFile = path.join(os.tmpdir(),`nova-portfolio-${process.pid}-${Date.now()}.json`)
try {
  const first = writePortfolio(source,testFile)
  assert.strictEqual(first.profile.name,'宠辱不惊')
  const second = writePortfolio({...first,profile:{...first.profile,intro:'自由编辑验证通过'}},testFile)
  const restored = readPortfolio(testFile)
  assert.strictEqual(second.profile.intro,'自由编辑验证通过')
  assert.strictEqual(restored.profile.intro,'自由编辑验证通过')
  assert.ok(Array.isArray(restored.chapters) && restored.chapters.length === 4)
  console.log('portfolio-store: read/write/validation passed')
} finally {
  if (fs.existsSync(testFile)) fs.unlinkSync(testFile)
}
