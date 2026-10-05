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
    '.github/workflows/ci.yml': 'GitHub源码历史扫描、依赖审计、编译和业务自动回归',
    '.github/dependabot.yml': 'GitHub依赖和Actions每周更新提案；不自动部署',
    '.github/ISSUE_TEMPLATE/bug_report.yml': 'GitHub问题反馈的环境、步骤与证据表单',
    'SECURITY.md': '安全问题私下反馈规则与支持范围',
    'README.md': '使用入口、目录与文档导航',
    'AGENTS.md': '当前项目 AI 修改规则',
    'AI_GUIDE.md': '实际代码入口、修改范围与检查',
    'project.config.json': '微信项目 AppID、源码目录与编译设置',
    'project.private.config.json': '当前电脑的开发者工具设置',
    'project.miniapp.json': '未来 Donut App 占位配置，未验证构建',
    'tsconfig.json': 'TypeScript 检查与 ES2017 输出',
    'docs/architecture.md': '架构、目录、接口与数据层',
    'docs/github-guide.md': 'GitHub新手设置、术语、日常操作和公开流程',
    'docs/public-release-audit.md': '代码与历史审查、HTTP修复、内容许可与真实边界',
    'docs/business-rules.md': '权限、事务、评分、跑步与组队算法规则',
    'docs/canteen.md': '多次评论、最新独立评分、餐次、投稿查重、补图修改和争议评分核查',
    'docs/operations.md': 'SSH、明文凭证位置、服务器备份与部署',
    'docs/ui.md': '当前可爱界面、科技按钮、组件与布局预览',
    'docs/english.md': '四六级内容来源、学习计划、打卡、挑战、金币、伙伴及完整接口',
    'docs/gift-sites.md': '祝福模板、免费实时预览、画布、公示、朋友留言、金币发放、域名和清理',
    'scripts/test-gift-preview-ui.js': '预览串行最后一写、续期发布生命周期、匿名Cookie、价格、公示刷新和管理员发金币行为回归',
    'docs/upgrade-checklist.md': '本次升级验收与仍需用户操作的真实边界',
    'miniprogram/utils/page-share.ts': '全46页好友／朋友圈分享；公开路由参数过滤与单页隐私保护',
    'miniprogram/utils/gifts-api.ts': '祝福服务请求与创建幂等编号；经api-client',
    'server/src/campus-wallet.js': '英语和祝福网站共用钱包、用户锁与默认账户',
    'server/src/gift-layout.js': '自由画布坐标、元素类型和本人图片引用校验',
    'server/src/image-upload.js': 'file-type真实图片格式检测；服务端生成所有者随机上传路径',
    'server/scripts/test-http-security.js': '本地HTTP权限、上传、初始化与管理员限流安全回归',
    'server/src/gift-web.js': '公开祝福HTML、JSON、签名访客Cookie与留言接口',
    'docs/mobile-plan.md': '未来 Android/iOS 选型与验证条件',
    'docs/file-map.csv': '逐文件职责与对应关系，由本脚本生成',
    'miniprogram/app.ts': '应用启动、登录提交、退出与缓存版本',
    'miniprogram/app.json': '实际页面、分包、权限与组件加载',
    'miniprogram/app.wxss': '全局基础样式与 Uiverse 引用',
    'miniprogram/config/api.ts': '自建服务器地址与缓存版本',
    'miniprogram/utils/api-client.ts': '请求、身份、上传下载与组队轮询',
    'miniprogram/utils/portal-daily.ts': '北京时间按日轮换首页标题颜色',
    'miniprogram/utils/page-copy.ts': '问候、装饰标题和鼓励语；进页随机且同场景不连续重复',
    'miniprogram/utils/keyboard-viewport.ts': '聊天 / 评论键盘可视区域、安卓窗口变化与监听清理',
    'miniprogram/utils/english-api.ts': '英语服务请求、幂等编号与同域资料下载',
    'miniprogram/utils/campus-theme.ts': '读取个人已购主题，转换为页面配色类名',
    'miniprogram/styles/campus-theme.wxss': '伙伴商城主题的页面、卡片、按钮与装饰配色',
    'miniprogram/utils/run-metrics.ts': '跑步连续 GPS 路段、跳点 / 静止 / 折返过滤与归一化传感器计步',
    'scripts/test-keyboard.js': '键盘事件顺序、窗口双重避让、昵称草稿回归',
    'scripts/test-social-input.js': '私信 / 评论草稿、重复发送、迟到响应与键盘生命周期回归',
    'server/src/app.js': 'HTTP 路由、身份、文件上传和网页后台',
    'server/src/server-status.js': '主机CPU/RAM/连续开机、根盘、网站空间与祝福总数缓存；每小时直连/规则代理外网HEAD',
    'server/scripts/test-server-status.js': '真实指标计算、失败未知、SQL与存储缓存、小时探测、超时与关闭回归',
    'scripts/test-portal-status.js': '首页默认折叠、状态规范化、可见轮询、防重和迟到请求回归',
    'scripts/configure-mihomo-subscription.py': '服务器一次性接入原生HTTP订阅与0.1倍URLTest；备份校验和失败恢复，规则/DNS保留',
    'server/src/data-store/index.js': 'MariaDB 兼容层、事务、行锁与身份上下文',
    'server/src/portfolio-store.js': '当前 HTTP 路由使用的原个人网站内容存取',
    'server/src/run-records.js': '运动成绩校验、北京时间、SQL 历史分页 / 统计 / 榜单聚合',
    'server/src/we-run.js': '微信会话关联、微信运动数据解密校验与按用户按日保存',
    'server/src/english-content.js': '加载英语词库、题目、资料索引、商城与人物素材目录',
    'server/src/english-fsrs.js': 'ts-fsrs 按日复习调度与记忆卡片序列化',
    'server/src/english-media.js': '同域发音、PDF / 听力白名单下载、格式校验与缓存',
    'scripts/import-english-content.py': '导入指定网站原创内容、合并固定版本开源词库与生成来源清单',
    'scripts/build-companion-overlays.js': '将原创饰品、鞋子 SVG 渲染为固定画布 PNG；不修改人物原图',
    'scripts/render-english-preview.js': '真实 WXML/WXSS 浏览器转换与两种视口截图，非微信真机',
    'scripts/test-english-learning.js': '英语页面目标、提示、学习反馈、挑战、作答与重试回归',
    'scripts/test-english-whole-exam-ui.js': '完整四级／六级57题、单尝试交卷、跨题草稿、解析和自评回归；隔离内存数据',
    'scripts/import-cet-exams.py': '从外部来源缓存按SHA与审校记录重建已核验真题',
    'scripts/cet-exam-review.json': '真题逐题校验答案、原创提示解析及源文件SHA；由导入器使用',
    'server/src/campus-rewards.js': '读取有效校园任务来源、冻结每日跑步目标、共享金币流水与去重',
    'server/src/module-policy.js': '五模块统一默认值与旧格式兼容；供公开开关和英语门禁复用',
    'server/scripts/test-campus-rewards.js': '奖励并发、去重、目标冻结、回滚；真实SQL仅限隔离测试库',
    'scripts/test-canteen-review-ui.js': '食堂多次评论、可选评分、晒图、上传失败、草稿保护、独立删评及奖励失败回归',
    'scripts/test-canteen-submission-ui.js': '投稿查重迟到响应、补图编辑、幂等重试、本人撤回和账户切换回归',
    'server/scripts/test-canteen-interactions.js': '仅campus_test_库：真实MariaDB并发查重、评分暂停恢复、旧／新版评论兼容与本人权限回归',
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
        elif relative.startswith('miniprogram/packageEnglish/components/'):
            purpose = '英语子包原生组件：' + relative.split('/')[3] + ' / ' + extension
            relation = '英语四分区页面 JSON usingComponents；保留当前等级'
        elif relative.startswith('miniprogram/images/'):
            if file.stem == 'map-location-dot':
                purpose = '原创32px地图圆点；人物图片下载失败时的本地兜底'
                relation = 'pages/index/index.ts 的个人原生map marker'
            else:
                purpose = '原图片 / 导航图标；按用户要求保留'
                relation = 'login-bg 用于学生登录；图标见 app.json；未使用原图在 docs/assets/originals'
        elif relative.startswith('docs/assets/originals/'):
            purpose = '按用户要求保留的未使用原图；内容不变'
            relation = 'docs/assets/README.md；位于微信上传目录外，不计主包'
        elif not purpose:
            if relative.startswith('docs/vendor/'):
                purpose = '实际采用的 UI 原码、来源与许可'
                relation = 'docs/ui.md → miniprogram/styles 与 components'
            elif relative.startswith('docs/ui-preview/'):
                purpose = '当前布局预览 / 编译体积；浏览器样例，非真机数据'
                relation = 'docs/ui.md'
            elif relative.startswith('server/data/english/'):
                purpose = '英语词题、真题资源索引、商城或内容来源 / 许可'
                relation = 'english-content.js → english_learning；docs/english.md'
            elif relative.startswith('server/data/gifts/'):
                purpose = '祝福模板、背景、特效、推荐语与服务器价格'
                relation = 'gift_sites／packageGifts；docs/gift-sites.md'
            elif relative.startswith('server/public/gifts/'):
                purpose = '浏览器祝福交互、背景、开源特效原码／许可证或共享素材'
                relation = 'gift-web.js／gift-assets；docs/gift-sites.md'
            elif relative.startswith('server/public/english/'):
                purpose = '随后端发布的伙伴人物或原创配件；不进入微信主包'
                relation = 'english-media.js /english-assets → campus-companion / wardrobe'
            elif relative.startswith('docs/assets/campus-companions/'):
                purpose = '伙伴素材的原始设计说明与来源，运行版见 server/public/english'
                relation = 'docs/english.md；components/campus-companion'
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
