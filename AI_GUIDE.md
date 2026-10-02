# 当前项目代码入口

本文件只描述当前实现；不要从历史备份恢复旧方案。开始先看 [架构](docs/architecture.md)，业务见 [规则](docs/business-rules.md)，界面见 [规范](docs/ui.md)，部署见 [运维](docs/operations.md)。

## 定位修改

| 需求 | 实际位置 |
| --- | --- |
| 页面注册 / 分包 | miniprogram/app.json |
| 登录 / 退出 | miniprogram/app.ts、pages/login、utils/api-client.ts |
| 首页 / 每日主题 | pages/portal、utils/portal-daily.ts |
| 跑步 / 排行榜 | pages/index、pages/rank、server/services/saveRunData、getRankList、getUserRunStats |
| 好友 / 组队 | pages/friends、packageProfile/pages/team、server/services/teamManager 等 |
| 点餐 / 商家 | packageFood、server/services/food_manager、coupon_manager |
| 独立食堂评价 / 投稿 | packageCanteen、server/services/canteen_reviews |
| 动态 / 私信 / 分区下拉 | packageForum、server/services/forum、notification |
| 小程序管理端 / 模块开关 | pages/admin、server/services/globalAdmin |
| 网页后台 | admin-web，仅在用户要求修改网页端时改 UI |
| HTTP / 权限 / 文件上传 | server/src/app.js |
| 数据库存储 / 事务 | server/src/data-store/index.js |

上述前端路径相对 miniprogram。修改餐饮时只用 app.json 已注册的下划线目录，不恢复旧路由、wx.cloud 或已移出的页面。

## 验证

`npm run check`、`npm test`、`npm run check:wxml`、`npm run check:wxss`；实际预览使用微信官方 CLI，需工具服务端口开启。TS 输出保持 ES2017，ES6 / 增强编译开启；不要让预览包重新保留不兼容的可选链。

当前 54 页、12 组本机回归、60 个 WXML/脚本、65 个 WXSS 通过，官方实际预览成功。布局截图是浏览器转换样例。真实微信登录、手机定位 / 后台运动及正式微信发布待真机验证。

服务器源码已部署至自建 Node.js + MariaDB，20 个服务加载。实时模块值、用户和数据库条数必须从接口查询，不把文档快照当作固定状态。不导入旧腾讯云数据；旧云环境未执行停用。

明文密钥副本在 maintenance/账号与连接，源站运行配置在 /etc/campus-api/app.env。普通 SSH 可用不代表 Codex 内置远程工作环境已连接。
