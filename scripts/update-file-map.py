"""Generate the technical file inventory, excluding installed dependency internals."""
from pathlib import Path
import csv
import json
import os

root = Path(__file__).resolve().parent.parent
app = json.loads((root / 'miniprogram/app.json').read_text(encoding='utf-8'))
pages = set(app['pages'])
for package in app['subpackages']:
    pages.update(package['root'] + '/' + page for page in package['pages'])

roles = {
    'package.json': '本机检查工具依赖与 npm 命令',
    'package-lock.json': '固定本机依赖版本',
    'server/package.json': '服务器启动、检查与部署依赖',
    'server/package-lock.json': '固定服务器部署依赖版本',
    'server/sql/schema.sql': 'MariaDB 兼容数据表初始化',
    'server/deploy/campus-api.service': 'systemd 服务启动配置',
    'server/data/portfolio-content.json': '当前个人网站路由使用的内容数据',
    '.gitignore': '依赖、运行环境、密钥与维护副本忽略规则',
    'README.md': '使用入口、目录与文档导航',
    'AGENTS.md': '当前项目 AI 修改规则',
    'AI_GUIDE.md': '实际代码入口、修改范围与检查',
    'project.config.json': '微信项目 AppID、源码目录与编译设置',
    'project.private.config.json': '当前电脑的开发者工具设置',
    'project.miniapp.json': '未来 Donut App 占位配置，未验证构建',
    'tsconfig.json': 'TypeScript 检查与 ES2017 输出',
    'docs/architecture.md': '架构、目录、接口与数据层',
    'docs/business-rules.md': '权限、事务、评分、跑步与组队算法规则',
    'docs/operations.md': 'SSH、明文凭证位置、服务器备份与部署',
    'docs/ui.md': '当前可爱界面、科技按钮、组件与布局预览',
    'docs/mobile-plan.md': '未来 Android/iOS 选型与验证条件',
    'docs/file-map.csv': '逐文件职责与对应关系，由本脚本生成',
    'miniprogram/app.ts': '应用启动、登录提交、退出与缓存版本',
    'miniprogram/app.json': '实际页面、分包、权限与组件加载',
    'miniprogram/app.wxss': '全局基础样式与 Uiverse 引用',
    'miniprogram/config/api.ts': '自建服务器地址与缓存版本',
    'miniprogram/utils/api-client.ts': '请求、身份、上传下载与组队轮询',
    'miniprogram/utils/portal-daily.ts': '北京时间按日轮换首页文案与颜色',
    'miniprogram/utils/run-metrics.ts': '跑步连续 GPS 路段、跳点 / 静止 / 折返过滤与归一化传感器计步',
    'server/src/app.js': 'HTTP 路由、身份、文件上传和网页后台',
    'server/src/data-store/index.js': 'MariaDB 兼容层、事务、行锁与身份上下文',
    'server/src/portfolio-store.js': '当前 HTTP 路由使用的原个人网站内容存取',
    'server/src/run-records.js': '运动成绩校验、北京时间、SQL 历史分页 / 统计 / 榜单聚合',
    'server/src/we-run.js': '微信会话关联、微信运动数据解密校验与按用户按日保存',
}
rows = []
for directory, folders, files in os.walk(root):
    folders[:] = [name for name in folders if name not in ('node_modules', '__pycache__', '.git')]
    for name in files:
        file = Path(directory) / name
        relative = file.relative_to(root).as_posix()
        extension = file.suffix.lstrip('.')
        purpose = roles.get(relative, '')
        relation = ''
        page = relative.removeprefix('miniprogram/').rsplit('.', 1)[0]
        if page in pages:
            purpose = {'wxml': '页面结构、数据绑定与控件事件', 'wxss': '页面布局、颜色与交互样式', 'json': '页面配置与组件注册', 'ts': '页面数据、接口请求与点击逻辑', 'js': '页面数据、接口请求与点击逻辑'}.get(extension, '页面配套文件')
            relation = 'miniprogram/' + page + '.*；注册于 miniprogram/app.json'
        elif relative.startswith('maintenance/账号与连接/'):
            purpose = '按用户要求保留的明文维护凭证或已核验主机公钥'
            relation = 'scripts/campus-server.py；服务器 /etc/campus-api/app.env'
        elif relative.startswith('server/services/'):
            purpose = '业务服务：' + relative.split('/')[2]
            relation = 'server/src/app.js → campus-server-sdk → MariaDB'
        elif relative.startswith('miniprogram/components/'):
            purpose = '原生组件：' + relative.split('/')[2] + ' / ' + extension
            relation = '页面 JSON usingComponents；同目录结构、样式、逻辑'
        elif relative.startswith('miniprogram/images/'):
            purpose = '原图片 / 导航图标；按用户要求保留'
            relation = 'hyj/hyjj 当前未引用；login-bg 用于两个登录页；图标见 app.json'
        elif not purpose:
            if relative.startswith('docs/vendor/'):
                purpose = '实际采用的 UI 原码、来源与许可'
                relation = 'docs/ui.md → miniprogram/styles 与 components'
            elif relative.startswith('docs/ui-preview/'):
                purpose = '当前布局预览 / 编译体积；浏览器样例，非真机数据'
                relation = 'docs/ui.md'
            elif relative.startswith('docs/assets/'):
                purpose = '最终刷新角色素材与运行地址说明'
                relation = 'components/mahiro-scroll；服务器 uploads'
            elif relative.startswith(('miniapp/', 'i18n/')):
                purpose = '未来 Donut 平台预备资源，非微信运行入口'
                relation = 'project.miniapp.json；docs/mobile-plan.md'
            elif relative.startswith('scripts/'):
                purpose = '本机检查、回归或维护：' + file.stem
                relation = 'package.json；miniprogram 或 SSH'
            elif relative.startswith('server/scripts/'):
                purpose = '服务器维护 / 真实数据库回归：' + file.stem
                relation = 'docs/operations.md；运行环境与 MariaDB'
            elif relative.startswith('admin-web/'):
                purpose = '网页管理后台：' + file.stem
                relation = 'server/src/app.js 提供 → 自建 API'
            elif relative.startswith('typings/'):
                purpose = '微信 TypeScript 类型声明'
                relation = 'tsconfig.json → TypeScript'
            else:
                purpose = '技术配置或工具：' + file.stem
        rows.append([relative, extension or '无扩展名', purpose, relation])
if not any(row[0] == 'docs/file-map.csv' for row in rows):
    rows.append(['docs/file-map.csv', 'csv', roles['docs/file-map.csv'], 'scripts/update-file-map.py'])
with (root / 'docs/file-map.csv').open('w', encoding='utf-8-sig', newline='') as output:
    writer = csv.writer(output)
    writer.writerow(['文件（相对项目根目录）', '类型', '职责', '对应关系'])
    writer.writerows(sorted(rows))
print(f'File inventory updated: {len(rows)} entries; installed dependencies excluded.')
