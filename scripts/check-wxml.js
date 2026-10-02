const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../miniprogram')
const compiler = process.env.WXML_COMPILER || 'C:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe'
if (!fs.existsSync(compiler)) throw new Error('找不到微信 WXML 编译器，请设置 WXML_COMPILER 为 wcc 路径')
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
}
const files = walk(root).filter(file => /\.(wxml|wxs)$/.test(file)).map(file => path.relative(root, file).replaceAll('\\', '/'))
const result = spawnSync(compiler, files, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(result.stderr || 'WXML 编译失败')
console.log('微信官方 WXML 编译检查通过：' + files.length + ' 个模板和脚本文件')
