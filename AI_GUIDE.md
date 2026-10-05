# 当前项目代码入口

本文件只描述当前实现；不要从历史备份恢复旧方案。开始先看 [架构](docs/architecture.md)，业务见 [规则](docs/business-rules.md)，界面见 [规范](docs/ui.md)，部署见 [运维](docs/operations.md)。

## 定位修改

| 需求 | 实际位置 |
| --- | --- |
| 页面注册 / 分包 | miniprogram/app.json |
| 登录 / 退出 | miniprogram/app.ts、pages/login、utils/api-client.ts |
| 首页 / 每日主题 / 随机问候 | pages/portal、utils/portal-daily.ts、utils/page-copy.ts |
| 首页折叠状态卡 / 主机与硬盘 / 每小时外网检测 | pages/portal、server/src/server-status.js；scripts/test-portal-status.js、server/scripts/test-server-status.js |
| 跑步 / 排行榜 | pages/index、pages/rank、server/services/saveRunData、getRankList、getUserRunStats |
| 好友 / 组队 | pages/friends、packageProfile/pages/team、server/services/teamManager 等 |
| 点餐 / 商家 | packageFood、server/services/food_manager、coupon_manager |
| 独立食堂评价 / 多次评论 / 餐次 / 投稿补图 / 争议评分 | packageCanteen、server/services/canteen_reviews；docs/canteen.md |
| 动态 / 私信 / 分区下拉 | packageForum、server/services/forum、notification |
| 安卓键盘 / 聊天评论输入 | utils/keyboard-viewport.ts、packageForum/pages/chat 和 detail；普通表单保持原生自动避让 |
| 四六级学习 / 挑战 / 试卷 / 英语管理 | packageEnglish、server/services/english_learning、server/src/english-content.js、english-fsrs.js、english-media.js |
| 四六级题目导入 / 来源与主观参考 | scripts/import-cet-nonlistening.py、cet-subjective-reference-cet4.json、cet-subjective-reference-cet6.json；server/data/english/nonlistening-coverage.json、exams |
| 校园伙伴 / 金币 / 衣橱 / 模块主题 | components/campus-companion、packageProfile/pages/wardrobe、utils/campus-theme.ts、server/data/english/shop.json |
| 祝福网站 / 可拖画布 / 自动上线 | packageGifts、server/services/gift_sites、server/src/gift-web.js；docs/gift-sites.md |
| 全页微信分享 | utils/page-share.ts、components/share-intro；私人页面只分享公开入口 |
| 小程序管理端 / 模块开关 | pages/admin、server/services/globalAdmin |
| 网页后台 | admin-web，仅在用户要求修改网页端时改 UI |
| HTTP / 权限 / 文件上传 | server/src/app.js |
| 数据库存储 / 事务 | server/src/data-store/index.js |

上述前端路径相对 miniprogram。修改餐饮时只用 app.json 已注册的下划线目录，不恢复旧路由、wx.cloud 或已移出的页面。

## 验证

`npm run check`、`npm test`、`npm run check:wxml`、`npm run check:wxss`；实际预览使用微信官方 CLI，需工具服务端口开启。TS 输出保持 ES2017，ES6 / 增强编译开启；不要让预览包重新保留不兼容的可选链。

本机67页结构、76个WXML/脚本、84个WXSS检查已通过，npm test全量回归通过。当前英语内存186项／隔离MariaDB193项，祝福内存214项／隔离MariaDB239项，小程序祝福78项通过。微信原生模拟器此前实际加载2019、2026四级／六级32题整卷，已复核画布和公开分享入口；本次6张风景JPEG及封面13项、本地两种答题音与地图状态7项通过。浏览器8模板、4免费静态插画、2真实视频已验证，英语20场景各两种视口共40个布局样例通过。最新官方预览体积见docs/ui-preview/canteen/preview-result.json；该记录不代表正式发布。安卓实体键盘、真实微信登录、手机发音、GPS／后台运动、真实好友／朋友圈及正式发布仍待真机验证。

服务使用自建Node.js＋MariaDB，当前部署加载22个服务；本次发布点与隔离SQL回归结果以 docs/operations.md 为准，不把本机完成写成已部署。实时模块值、用户和数据库条数必须从接口查询，不把文档快照当作固定状态。英语内容与接口见 docs/english.md；已发布2019年6月至2026年6月104份不含听力目录编排（52份／级），每份作文1＋阅读30＋翻译1，共3328条新记录，加原326条为3654条。12份共享阅读并非104份独立阅读；208道主观题为原创参考，客观新解析为程序生成定位说明，仍有1处参考答案争议。目录优先新nonlistening卷并去重，旧57题卷与阅读专项保留旧记录复盘。资料目录不等同逐题人工详解。不导入旧腾讯云数据；旧云环境未执行停用。

明文密钥副本在 maintenance/账号与连接，源站运行配置在 /etc/campus-api/app.env。普通 SSH 可用不代表 Codex 内置远程工作环境已连接。

最新服务部署20261005-121505，备份20261005-121359；当前验证见docs/operations.md。此前公网20素材哈希、4视频范围请求和6场景实际播放通过。EO泛域名HTTP回源／原Host已验证，gifts已启用，www原站保留；不要恢复旧隐藏入口描述。免费预览编辑中续期、离开2分钟回收，确认前不扣金币；first2h全效果免费，标准3天／7天／15天／1个月，背景／高级效果仍收费。公示默认关闭，广场只列正式有效的公示网站，任意模板可署名／匿名留言，super管理员可向指定同学发金币。到期内容／上传的并发清理规则与论坛存储边界见docs/gift-sites.md，实时发布／测试与真机边界见docs/operations.md。

食堂正式旧版与未上线新版并存：saveReview不可把clientId设为无条件必填。旧版必须带1–5分，以当前评分关联评论作顺序锚点兼容重试和最新评分；新版显式clientId可只交流。保持同连接事务、canteen:write锁、本人权限和争议限制。对应内存与隔离MariaDB43项回归见docs/canteen.md；后端修复不等于新版微信界面已正式发布。

祝福背景最终分类：草原星夜、森林月夜、晴空花野、极光海岸是免费静态插画，旧ID保留；收费动态区仅video-fire／video-stars的真实循环视频，各6金币。catalog的poster/widePoster/nativePoster/video定位竖横图片与视频，原生编辑与展示页现已实际播放视频，支持暂停、恢复和失败重试；完整网页特效在浏览器。旧WebGL/Starrysky/Vanta动效分支与无引用vendor已外置备份后移出，不能恢复为当前动态分类。素材见docs/gift-landscape-assets.md，生成原PNG／原MP4与处理清单位于Downloads，原小程序背景不换。

首页底部“校园守护站”默认收起，现有女生人物作装饰；展开才显示CPU、整机RAM、主机连续运行时长、根硬盘、网站总占用、有效／公示祝福总数和Google／YouTube状态。不列出现有网站名称与地址，个人主页另保留友情链接。接口/api/public/server-status：主机5秒采样、前端可见时10秒轮询、网站磁盘5分钟、外网1小时；未知不能补成0。网站占用为4个既有网站／服务／图片目录分配空间加业务库表与索引，不含备份；非root服务不得读取数据库私有目录。详见docs/operations.md。最新官方预览见docs/ui-preview/canteen/preview-result.json；折叠／展开4个浏览器转换布局通过，不能当作本次原生或真机验收。

代理当前保持Mihomo规则模式、原9263条规则与DNS；原生HTTP provider每6小时更新订阅，URLTest自动组筛选0.1倍节点并以HTTPS测速。当前主选组使用美国自动组，重启保留；国内百度日志确认为DIRECT，Google／YouTube两轮200。节点供应方的名字倍率不由本项目计费；配置与provider缓存明文副本在maintenance/账号与连接，维护脚本scripts/configure-mihomo-subscription.py，不另造订阅定时守护进程。

单词目标完成后每轮可加练1—100个新词或旧词；home.extraStudy.activeModes优先恢复当天等级已有轮次，不能用剩余新词数阻断错词复现。加练计入实际学习榜，原打卡时间、日目标／次日计划与每日奖励只结算一次。答题本地PCM提示音放英语分包，发音和提示音分上下文，切词／隐藏／卸载解绑并停止。跑步map运动时scale18、准备／结束16，显示比例尺，不改变GPS算法；实测距离和缩放不是同一概念。见docs/english.md及docs/ui-preview/english-extra。

食堂当前允许多次评论，只计算每人每菜最新评分；删评论保留独立canteen_ratings。至少5位存疑且占比≥70%自动暂停关联最新评分，管理员可恢复／排除，核查中不能改分绕过；纯交流和旧评分评论不影响其他最新评分。早餐／午餐／晚餐按供应时间筛选，午晚共用实体。投稿查重、本人修改、撤回共享内容、同学补图及管理员选封面见docs/canteen.md；不要恢复旧“一人一条评论”规则。npm run test:canteen、隔离MariaDB29项、20个小屏浏览器转换样例已通过；真实照片上传和手机操作仍需验收。
