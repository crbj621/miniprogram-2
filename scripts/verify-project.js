const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const root = path.resolve(__dirname, '../miniprogram')
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const pages = new Set(app.pages.concat(app.subpackages.flatMap(pack => pack.pages.map(page => pack.root + '/' + page))))
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
}
const files = walk(root)
const projectConfig = JSON.parse(fs.readFileSync(path.join(root, '../project.config.json'), 'utf8'))
const privateConfigPath = path.join(root, '../project.private.config.json')
const privateConfig = fs.existsSync(privateConfigPath) ? JSON.parse(fs.readFileSync(privateConfigPath, 'utf8')) : {}
const compileSettings = { ...projectConfig.setting, ...privateConfig.setting }
assert.equal(compileSettings.es6, true, '微信预览必须启用 ES6 转换')
assert.equal(compileSettings.enhance, true, '微信预览必须启用增强编译')
const tsConfig = ts.readConfigFile(path.join(root, '../tsconfig.json'), ts.sys.readFile).config
const emitOptions = ts.convertCompilerOptionsFromJson(tsConfig.compilerOptions, path.dirname(root)).options
assert.ok(emitOptions.target < ts.ScriptTarget.ES2020, 'TypeScript 输出不能保留微信预览不支持的可选链')
for (const file of files.filter(file => /\.(ts|js)$/.test(file))) {
  const source = fs.readFileSync(file, 'utf8')
  const emitted = file.endsWith('.ts') ? ts.transpileModule(source, { compilerOptions: emitOptions }).outputText : source
  const ast = ts.createSourceFile(file + '.js', emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  function compatible(node) {
    assert.ok(!ts.isOptionalChain(node), '预览输出保留可选链：' + path.relative(root, file))
    assert.ok(!(ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken), '预览输出保留空值合并：' + path.relative(root, file))
    ts.forEachChild(node, compatible)
  }
  compatible(ast)
}
for (const page of pages) {
  for (const extension of ['.json', '.wxml', '.wxss']) assert.ok(fs.existsSync(path.join(root, page + extension)), '页面缺少文件：' + page + extension)
  assert.ok(['.ts', '.js'].some(extension => fs.existsSync(path.join(root, page + extension))), '页面缺少逻辑：' + page)
}
for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  if (file.endsWith('.json') && /(^|\/)pages\//.test(relative)) {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!config.component) assert.ok(pages.has(relative.slice(0, -5)), '发现未注册页面：' + relative)
  }
  if (file.endsWith('.js')) assert.ok(!fs.existsSync(file.slice(0, -3) + '.ts'), '重复 TS/JS：' + relative)
  if (/\.(ts|js|wxml|json)$/.test(file)) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/['"`]\/(pages\/[A-Za-z0-9_/-]+|package[A-Za-z]+\/pages\/[A-Za-z0-9_/-]+)(?:\?|['"`])/g)) {
      assert.ok(pages.has(match[1]), '链接到未注册页面：' + relative + ' -> ' + match[1])
    }
    if (file.endsWith('.json')) {
      const components = JSON.parse(source).usingComponents || {}
      for (const component of Object.values(components)) {
        if (!component.startsWith('/') && !component.startsWith('.')) continue
        const base = component.startsWith('/') ? path.join(root, component) : path.resolve(path.dirname(file), component)
        for (const extension of ['.json', '.wxml', '.wxss']) {
          assert.ok(fs.existsSync(base + extension), '组件缺少文件：' + relative + ' -> ' + component + extension)
        }
        assert.ok(['.ts', '.js'].some(extension => fs.existsSync(base + extension)), '组件缺少逻辑：' + component)
      }
    }
    if (file.endsWith('.wxml')) {
      const logicFile = ['.ts', '.js'].map(ext => file.slice(0, -5) + ext).find(fs.existsSync)
      if (logicFile) {
        const ast = ts.createSourceFile(logicFile, fs.readFileSync(logicFile, 'utf8'), ts.ScriptTarget.Latest, true)
        const handlers = new Set()
        function visit(node) {
          if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isPropertyAssignment(node)) && node.name) handlers.add(node.name.getText(ast).replace(/^['"]|['"]$/g, ''))
          ts.forEachChild(node, visit)
        }
        visit(ast)
        for (const match of source.matchAll(/\b(?:bind|catch|capture-bind|capture-catch):?[\w-]+\s*=\s*["']([\w$]+)["']/g)) {
          assert.ok(handlers.has(match[1]), '交互缺少处理函数：' + relative + ' -> ' + match[1])
        }
      }
      for (const match of source.matchAll(/<(?:import|include)\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/g)) {
        const target = match[1].startsWith('/') ? path.join(root, match[1]) : path.resolve(path.dirname(file), match[1])
        assert.ok(fs.existsSync(target), '模板引用不存在：' + relative + ' -> ' + match[1])
      }
    }
  }
}
console.log('项目结构检查通过：' + pages.size + ' 个真实页面，路由和组件完整，无重复 TS/JS')
