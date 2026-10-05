# 食堂评价模块

本模块使用独立档口、菜品及评价集合，点餐功能已移除。使用自建Node.js服务和MariaDB。入口与五个页面注册在`miniprogram/app.json`，代码在`miniprogram/packageCanteen`；服务端入口`server/services/canteen_reviews/index.js`，请求由统一`api-client`经`/api/functions/canteen_reviews`发送。

## 本次改造根因

旧实现把每人的评分和评论放在同一条记录，重复发言只能覆盖，删除评论也会改变分数；档口直接新增，缺少同一身份和位置的并发检查。补图、本人修改、餐次和争议评分也缺少完整链路。

现在评论追加保存，评分按“学生＋菜品”独立唯一保存；目录、投稿、图片引用、评分和核查使用现有同连接事务及`canteen:write`业务锁。请求失败回滚，clientId重试不重复发布。

## 已发布旧版兼容

2026-10-05修复：此前服务端要求评论必须携带`clientId`，但正式旧版只发送`dishId / score / comment / images`，因此提示“请重新进入页面后发表评论”。重新进入页面不会补出新版字段，兼容必须由服务器处理。

- 旧版不带`clientId`时保留原1–5分必选契约；以当前独立评分所关联的评论为顺序锚点，对相同内容重试返回原结果，对变化内容追加评论并更新唯一评分。A→B→A、并发重试、旧／新版交替提交均保持最新评分，删除后的重发使用新记录。
- 新版继续用`clientId`防重复，可选择只交流、不评分；重试不能覆盖变化的请求或恢复已删除评论。
- 两种版本共用权限、图片校验、事务和争议评分限制。旧版评分处于核查／排除时仍不能改分绕过，恢复后可再次发表评论。
- 服务器修复即可恢复旧版发表评论，不要求先正式发布新版。旧版界面文案、评分预填和删除后的本地即时统计仍是旧实现，重新加载时以服务器最新结果为准；新版交互需另行发布。

## 当前规则

| 功能 | 规则 |
| --- | --- |
| 评论 | 可多次发言，展示头像、最新／热门、本人的删除操作；发言时选择是否更新评分 |
| 评分 | 每人每菜只计最新1–5分；删除评论不删除独立评分，纯交流不改分 |
| 热门 | 按“有用”数量再按发布时间排序；反馈不会直接增加菜品分数 |
| 存疑 | 一人一条互斥反馈，作者不能反馈自己；≥5位存疑且比例≥70%自动进入核查 |
| 暂停 | 仅暂停存疑评论所关联的当前最新评分；旧评分／纯交流评论不影响其他最新评分 |
| 核查 | 管理端“争议”可恢复或排除；核查期间能交流但不能改分绕过，下降到门槛以下不自动恢复 |
| 餐次 | 全部／早餐／午餐／晚餐；默认新投稿午晚共用，不复制菜品或分开计算同一份评分 |
| 查重 | 规范化档口名＋位置，或同档口内菜名；NFKC兼容全角，忽略大小写和空白。相近名称仅提示候选 |
| 档口补图 | 所有人可补已有档口；空封面用第一张档口实拍；已有封面由管理员选择，菜图不作档口封面 |
| 本人修改 | “我的投稿”进入编辑／补图；原菜品投稿人可修改菜名、价格、说明、图片、餐次，保持原菜品ID |
| 投稿图片标注 | 上传区、“我的投稿”和管理端按kind标为“档口投稿图片”／“菜品投稿图片”，档口补图另标“补图”；无kind的历史投稿标“旧版未分类”，不猜测归属 |
| 本人撤回 | 清除该投稿公开文字和图片引用；已有其他贡献或评论／评分的共享实体保留，无人使用且全部撤回的实体收起 |
| 举报 | ≥3位不同学生举报进入管理员核对，不自动下架；与存疑评分暂停分开处理 |
| 推荐／避雷 | 至少2份有效评分；均分≥4推荐，≤2.5避雷；随机候选采用相同规则和餐次过滤 |

旧菜品没有`meals`时按全天兼容。菜品显示不同评分人数，档口按各菜品有效评分汇总，显示“份评分”。旧评论只迁入缺失的独立评分，保留原评论及其状态，不重新导入腾讯云数据。

撤回和删评论不等于删除磁盘文件：本次清除公开内容和图片引用，没有新增食堂上传目录的孤儿文件清理。管理员管理过的共享实体不因原投稿撤回而自动删除。

## 页面与数据关系

| 页面／数据 | 用途 |
| --- | --- |
| pages/index | 餐次、档口／菜品排名、三种随机、投稿入口 |
| pages/stall | 档口介绍、实拍相册、补图／菜品、供应菜品 |
| pages/dish | 评分与聊天、晒图、头像、最新／热门、反馈和本人删除 |
| pages/submit | 投稿菜品／档口／补图，查重提示，我的投稿修改／撤回 |
| pages/admin | 档口、菜品、评价、旧投稿、举报、补图、争议；权限以服务器为准 |
| canteen_stalls / canteen_dishes | 共享档口与菜品、供应时间、封面与来源引用 |
| canteen_reviews / canteen_ratings | 可多条的评论／每学生每菜一条独立最新评分 |
| canteen_submissions | 投稿来源、作者、类型、图片与共享实体引用 |
| canteen_review_likes | 每学生每评论一条有用／存疑反馈，兼容旧点赞 |
| canteen_reports / canteen_report_cases | 用户举报和管理员核查记录 |

以上页面路径相对`miniprogram/packageCanteen`。集合是`app_documents`内的逻辑分组，不需要手工新建多张SQL表。人物、原背景和明文维护凭证未调整。评论奖励沿用既有每日上限和去重；存疑不计入点赞奖励。

## 调研与取舍

关键词：`Fuse.js fuzzy search exact matches scoring`、`MariaDB GET_LOCK unique constraints concurrency duplicate insert`。候选[Fuse.js](https://www.fusejs.io/)适合相近名称建议，[MariaDB GET_LOCK](https://mariadb.com/docs/server/reference/sql-functions/secondary-functions/miscellaneous-functions/get_lock)与已有文档主键适合并发唯一身份。

本次复用现有MariaDB数据层及事务锁，不新增搜索依赖或ORM；模糊相似度不能确认两个窗口是同一个档口。SkillHub未提供本次可核对匹配技能，未安装社区脚本。

旧版兼容检索关键词：`express backwards compatible API idempotency key middleware`、`api idempotent requests key parameters`。候选[express-idempotency](https://github.com/ccs-group/express-idempotency)依赖客户端请求键与缓存，[Stripe幂等请求规则](https://docs.stripe.com/api/idempotent_requests)提供重试及内容一致性参考。正式旧版无法补发请求键，因此复用当前数据库事务与评分顺序锚点，不引入缓存中间件。

## 验证与维护

- `npm run test:canteen`：内存业务回归、评论页面请求／草稿保护、投稿编辑／补图／账户切换。
- `server/scripts/test-canteen-interactions.js`：仅允许`campus_test_`独立库，43项真实MariaDB检查，覆盖并发同档口投稿、最新评分、暂停／恢复、补图、本人权限及正式旧版／新版交替评论。生产库不运行写入测试。
- 本机完整`npm test`、TS、67页结构、76个WXML、84个WXSS通过。
- [发布验证](ui-preview/canteen/release-verification.json)：真实HTTP、旧记录保留、评分迁移、源码哈希与原网站校验。当前部署点见[运维](operations.md)。
- [旧版兼容验证](ui-preview/canteen/compatibility-verification.json)：本次43项隔离MariaDB、公网只读复核、部署源码哈希与测试清理；没有正式发布新版小程序。
- [布局检查](ui-preview/canteen/layout-verification.json)：10种状态×320／390宽，共20个浏览器转换样例；展示数据为模拟，不冒充原生微信。
- [官方微信预览](ui-preview/canteen/preview-result.json)：编译与包体积；照片上传、安卓键盘、真实微信操作和正式发布仍需手机验收。
