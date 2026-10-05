# 项目公开审查 · 2026-10-05

## 根因与结论

核心程序代码具备公开和继续维护的基础。当前仓库同时包含程序、第三方词库/真题、原始图片、个人站内容和运维验收记录；整个包不能在未核对来源的情况下统一声明为 MIT 开源项目。仓库继续保持私有，本次没有修改可见性或给未知权利的文件添加许可证。

审查覆盖已跟踪的1105个文件和全部3个现有提交的密钥扫描、两份 npm 锁文件漏洞审查、全量现有检查/测试，以及 HTTP身份边界、上传、初始化和数据访问的人工审查。新增维护文件与后续提交会再由 CI 扫描。未声称逐行人工审阅全部文件或证明不存在任何漏洞。

## 开源调研与选择

| 关键词 | 现成方案 | 选择与边界 |
| --- | --- | --- |
| Gitleaks git history secret scan | [gitleaks/gitleaks](https://github.com/gitleaks/gitleaks)；TruffleHog 可作为补充 | 本次使用8.30.1，下载核验SHA-256，扫描全部历史；不会把本机凭证发给第三方扫描服务 |
| npm audit dependency vulnerabilities | npm官方审计、GitHub Dependabot | 同时检查根目录与server；本机镜像不支持审计接口，改用官方registry执行审查 |
| file-type buffer image upload validation | [sindresorhus/file-type](https://github.com/sindresorhus/file-type)；Sharp可重编码 | 采用22.1.1检测真实字节和规范扩展名；无需为了四种图片引入整套图像处理管线。类型检测不是图片完整解码证明 |
| GitHub Actions Node CI | [actions/checkout](https://github.com/actions/checkout)、[actions/setup-node](https://github.com/actions/setup-node) | 使用官方组件，固定提交SHA、只读权限，不设置生产凭证 |

已检查用户要求的SkillHub，当前网页获取超时；使用本机已读的terminal技能和官方文档完成检查，没有安装未经核对的社区脚本。

## 已修正的实际问题

| 问题 | 根因 | 当前修改 |
| --- | --- | --- |
| 匿名读到完整用户、组队、跑步文档 | 通用public/database接口把只读当成可公开，未限定公开字段；当前前端并未使用它 | 移除该匿名通用接口；保留公开模块/状态及各业务接口；管理数据库仍要求管理员认证 |
| 伪装图片或指定其他人的上传路径 | 仅信任multipart MIME及客户端cloudPath/文件名 | file-type检测真实格式；普通图片使用服务端生成的“模块/所有者哈希/随机文件名”；祝福图片保留原有本人登记与清理规则 |
| 既有上传可能按HTML执行 | 静态上传目录没有独立文档执行限制 | /uploads响应带default-src 'none'及sandbox，保留已有图片URL；不是删除既有文件 |
| 空数据库管理员可被HTTP初始化 | initDatabase通过普通已登录用户的通用服务分发入口可达 | HTTP初始化被拒绝；初始管理员仍通过服务器本地bootstrap-app.js建立 |
| 小程序服务别名可绕过管理员登录/重置限流 | 专门认证接口与globalAdmin分发使用不同限流范围 | 认证接口和小程序兼容入口共用管理员登录/重置限流桶 |
| multer、qs存在已知漏洞 | 旧锁定版本分别受高/中危公告影响 | multer 2.2.0→2.4.0；qs更新至6.16.0；审计后0个已知漏洞 |

代码位置：server/src/app.js、server/src/image-upload.js、server/package.json和lock。新增server/scripts/test-http-security.js，44项真实本地HTTP回归覆盖匿名查询、普通用户越权、HTTP初始化、伪装/空图片、服务器文件名与真实下载、既有文件沙箱、登录/重置别名限流；祝福上传回归同步使用真实PNG/GIF，215项内存回归通过。

本次安全修复已随20261005-173247点餐移除发布，备份、隔离SQL和线上只读验证见operations.md。GitHub同步或CI通过本身不代表服务器已部署。

## 内容与许可要逐类处理

| 内容 | 当前证据 | 公开前处理 |
| --- | --- | --- |
| 原创程序 | 根目录无LICENSE，package.json的license为空 | 维护者选择代码许可证；MIT适合允许学习、修改和商业复用的原创代码，不能覆盖第三方内容 |
| Uiverse按钮及复制的原码 | docs/vendor/uiverse/LICENSE保留MIT文本和相关归属 | 保留作者和许可证，不删除归属 |
| 烟花、彩纸、蛋糕 | server/public/gifts/vendor保存各许可 | 按原MIT/公共领域声明分发 |
| 词库 | provenance指向KyleBing及BSD-3-Clause，同时注明kajweb来源 | 保留BSD声明；再核对例句/底层数据的再分发范围，仓库有许可证不证明所有上游数据都已授权 |
| 旧真题文本 | licenses/wamich-GPL-2.0.txt及来源记录 | 保留GPL归属，确认复制/改编内容边界，不自动改成MIT |
| 新增真题和图表 | HTML/PDF公开来源记录，未提供全面再分发许可 | 能公开访问不等于已获转载授权；确认许可后纳入，或公开题库结构/导入工具及可发布示例 |
| 原学习站示例 | provenance注明PROJECT-NONCOMMERCIAL-1.0 | 按其非商业条件处理，不能称为全部可商用 |
| 原背景、基础男女角色 | 项目保留原件；未发现覆盖全部原图的许可清单 | 明确原图来源、动漫角色和再分发权；可选择保留私有素材或换独立原创的公开示例，但本次不替换图片 |
| 本项目生成的风景/服装层 | 文档生成提示、脚本和来源记录 | 补齐对应清单，避免把所有未知原图归为原创 |
| 个人站和运维验收 | portfolio-content包含个人联系入口，旧提交有1个非noreply作者邮箱；运维包含源站IP/路径 | 核对是否愿意公开；这些不等于密码，但删除最新文件不会移除旧历史记录 |

本次未发现真实运行.env、maintenance凭证或私钥进入当前源码/提交历史。身份模式候选主要为微信官方类型示例、模拟手机号、磁盘字节和systemd服务名；没有把这些当作真实用户数据。图片没有经过逐张OCR认证，公开前仍需确认截图内容。

## 验证与真实边界

- 修改前/后npm run check与npm test均通过；新增npm run test:security通过。
- 官方npm registry审计：根目录0、server0个已知漏洞；Gitleaks完整历史0项命中。
- CI在GitHub使用Linux/Node24运行同一套检查；结果以Actions真实状态为准。它不连接生产SQL、不执行部署、不生成微信发布包。
- 真实微信登录、安卓/iPhone输入、GPS/后台跑步、生产并发和完整内容语义验收不能由这些测试替代。
- 其他兼容集合仍可能先加载集合再在JS筛选；跑步热点已有SQL聚合/索引。用户量扩大时，优先实测英语/论坛/评分列表并改为SQL分页与必要索引，避免无证据引入微服务。

完整全量源码适合继续私有开发。公开发行需要完成上表中许可证和素材确认；可以公开全部功能的程序、配置模板、数据结构、测试及可再分发的示例，不需要公开真实账户、用户数据库或运行文件。
