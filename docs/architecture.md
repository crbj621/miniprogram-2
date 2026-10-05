# 架构、目录与接口

## 当前实现

```text
小程序页面 → utils/api-client.ts → HTTPS /campus-api
         → server/src/app.js → server/services → campus-server-sdk → MariaDB
                                      文件上传 → /www/campus-data/uploads
网页管理后台 admin-web → 同一服务器 API
```

小程序入口为根目录 project.config.json；miniprogramRoot 是 miniprogram/。app.json 是唯一实际页面清单。当前 67 页，main + packageFood / packageCanteen / packageForum / packageProfile / packageRider / packageEnglish / packageGifts 分包。

## 页面四文件

| 文件 | 职责 |
| --- | --- |
| *.wxml | 内容、数据绑定、控件与事件 |
| *.wxss | 配色、布局与交互状态 |
| *.ts 或 *.js | setData、加载请求、点击事件与跳转；同一页面不保留重复 TS/JS |
| *.json | 标题、页面配置、usingComponents |

app.ts 管理启动、登录状态与退出；config/api.ts 维护地址与缓存版本；utils/api-client.ts 负责请求、身份、上传下载与组队轮询。首次切换后端清理旧身份 / 业务缓存，但保留各账号 pending_runs_* 和 active_run_*；同一后端正常重启保留新缓存。

## HTTP 与业务映射

地址前缀：`https://www.crbuj.icu/campus-api`。

| 接口 / 功能 | 实现 |
| --- | --- |
| GET /health | 数据库与服务健康 |
| GET /api/public/modules | 无需登录的公开模块开关 |
| POST /api/auth/wechat | 验证 wx.login code，签发 token 并关联微信会话 |
| POST /api/we-run | 身份及微信运动凭证校验，按用户按日保存步数 |
| GET /api/english/audio、resource | 同域发音 / 真题资料按需下载缓存与来源校验 |
| /gift-assets/、/gifts/:id、/gift-domain | 共享祝福网页素材、公开网页与Host识别；见gift-sites.md |
| /api/gifts/:id、/api/gifts/:id/messages | 公开网站数据和有界留言墙 |
| /english-assets/ | 人物、饰品、鞋子的服务器静态素材 |
| POST /api/auth/admin | 管理员身份认证 |
| POST /api/functions/:name | 调用 server/services 中已加载业务 |
| POST /api/files/upload、GET /uploads/... | 图片上传与文件读取 |
| /admin/ | admin-web 静态后台 |
| 登录 / 学生资料 | login、saveUserInfo、getOpenid |
| 跑步 / 统计 / 排行 | saveRunData、getUserRunStats、getRankList |
| 好友 / 组队 | addFriend、deleteFriend、getFriends、searchUser、teamManager |
| 点餐 / 券 / 骑手 | food_manager、coupon_manager、rider |
| 独立评分 / 多次评论 / 餐次 / 投稿补图 / 争议核查 | canteen_reviews；接口与集合关系见canteen.md |
| 动态 / 通知 | forum、notification |
| 管理 / 公告 / 设置 | globalAdmin |
| 四六级 / 打卡 / 挑战 / 金币 / 装扮 | english_learning；接口见 english.md |
| 祝福网站 / 域名 / 金币 / 到期清理 | gift_sites、campus-wallet、gift-layout、gift-web |
| 文件地址 / 二维码 | getTempFileURL、getQrCode |

这些仍保留在本地，供维护和发布；原微信云函数业务已转为服务器模块，并非无用残留。服务依赖统一由 server/package.json 管理。

2026-10-05本机安全检查移除了未被当前客户端使用的匿名通用/api/public/database。图片上传使用file-type检测真实格式和服务端生成的所有者/随机路径；旧图片URL保留，静态上传文档受CSP sandbox限制。初始管理员只能经本地bootstrap脚本创建，登录/重置服务别名共享限流。代码与验证见public-release-audit.md；尚未部署生产服务器。

## 数据层

server/src/data-store 是本地 campus-server-sdk，使用 mysql2 连接池与事务。当前业务集合以 app_documents 的 `(collection_name, document_id)` 主键和 JSON 数据保存。SQL 初始化在 server/sql/schema.sql。图片保存在服务器文件目录。

跑步热点查询使用 JSON 虚拟列 doc_openid / record_date 与索引，历史分页、个人统计和榜单聚合在 SQL 完成；其他部分兼容查询仍在 JS 筛选。server/src/run-records.js 定义共享的成绩规则；server/src/we-run.js 处理独立日步数集合 wechat_steps，日步数不混入 runRecords。未新增 ORM、微服务或消息队列。

server/src/portfolio-store.js 与 server/data/portfolio-content.json 仍被当前 HTTP 路由使用，用于保留原个人网站业务；不能在目录清理时删除。

## 文件清单与项目配置

[逐文件清单](file-map.csv)排除自动安装的 node_modules 内部文件。通过 `python scripts/update-file-map.py` 更新。

project.private.config.json 只作用于当前开发工具；根目录 package 锁定本机检查依赖，server/package 锁定部署依赖。typings 为微信 TS 声明，scripts 为本机维护，server/scripts 为服务端部署和真实数据库回归。

[微信官方示例](https://github.com/wechat-miniprogram/miniprogram-demo)、[TDesign 小程序](https://github.com/Tencent/tdesign-miniprogram)用于对照标准入口与组件结构。本项目保留现有 Express + mysql2，不为一次目录整理增加框架。
