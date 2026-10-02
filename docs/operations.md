# 服务器、账号与部署

## 当前连接

| 项目 | 值 |
| --- | --- |
| SSH 别名 | campus-server |
| 主机 / 用户 / 端口 | 111.228.16.165 / root / 22 |
| 系统 / 运行时 | Ubuntu 22.04 / Node.js 24.21.0 / MariaDB 10.6.23 |
| 服务 / 本机 API | campus-api / 127.0.0.1:3100 |
| 源码当前链接 | /opt/campus-api/current |
| 已部署发布点 | 20261002-023132（以后以服务器 current 为准） |
| 数据库 / 监听 | campus_app / 127.0.0.1:3306 |
| 运行配置 / 图片 | /etc/campus-api/app.env / /www/campus-data/uploads |

公网 API 根路径 https://www.crbuj.icu/campus-api/；/health、/api/public/modules、/admin/ 分别为健康、公开模块与网页后台。DNS 委派已统一京东 freens1/freens2.jdgslb.com，www A 指向上述 IP；正常 HTTPS 已验证。若以后改 DNS，先查询实时委派，不恢复历史腾讯 / 京东混合记录。

这里的 **API 是“数据接口”的简称，不是正在使用的域名名称**。当前原网站用 `https://www.crbuj.icu/`，小程序用同一域名下的 `https://www.crbuj.icu/campus-api/`。前端地址见 `miniprogram/config/api.ts`；`api.crbuj.icu` 是未来可选方案，本次没有切换地址，不需要为这次升级新增解析。

www 原个人网站位于 /www/wwwroot/crbuj.icu，Nginx 配置 /www/server/panel/vhost/nginx/crbuj.icu.conf。API 只占 /campus-api 路径，不覆盖网站。当前直连不经 EO；启用加速需单独核对 HTTPS 和 API 缓存规则。

微信 request / uploadFile / downloadFile 合法域名使用 https://www.crbuj.icu，不带路径。用户已确认设置。AppSecret 已验证，真实客户端登录与正式发布仍待完成，不执行旧云数据导入或自动停用云环境。

## 明文维护文件

全部位于 `maintenance/账号与连接/`，按用户要求保存明文，继续保留：

| 文件 | 内容 / 对应 |
| --- | --- |
| ssh.json / ssh.pem / known_hosts | 主机、SSH 私钥、已核验的服务器公钥 |
| wechat.env | 小程序 AppID 与 AppSecret |
| admin.json / 账号说明.txt | 管理员账号、登录密码及验证密码 |
| server.env | 服务器运行环境的本机副本 |

编辑本机副本不会自动更新服务器。上传目录只有 miniprogram；服务端发布只包含 server 和 admin-web。

```powershell
python scripts/campus-server.py 'systemctl is-active campus-api'
& 'C:/Program Files/OpenSSH/ssh.exe' -o StrictHostKeyChecking=yes campus-server 'campus-api-status'
```

SSH 配置 C:/Users/Administrator/.ssh/config。Python 维护脚本优先读取项目明文副本，并校验主机公钥。普通 SSH 可用不代表 Codex 内置远程环境已连接；服务器 Codex CLI 仍未验证登录。

## 备份与部署

- 服务端备份：campus-api-backup；每日 03:17，包含数据库、图片和配置。
- 状态：campus-api-status；配置：campus-api-configure。
- 部署：campus-api-deploy /tmp/campus-api-release.tar.gz。先备份、安装依赖、切 current、重启与健康检查，失败自动回退。
- 发布包只含 server / admin-web，排除 node_modules、.env、PEM 和 maintenance。
- 单纯前端 UI 改动不部署服务器。服务器源码必须保留 services 与 data-store。
- 历史备份在 /www/backup/campus-api，当前迁移发布前备份为 20261001-203002；容量不足时按实际策略处理。

## 检查

本机：npm run check、npm test、npm run check:wxml、npm run check:wxss。官方实际 preview 已成功，结果见 [预览体积](ui-preview/微信预览结果.json)。

服务器真实回归需读取运行 env 并在当前 server 下执行 scripts/test-selfhost.js 或对应专项脚本。测试包含数据写入与 finally 清理，不能在活跃运营库盲目反复执行；详见 [业务规则](business-rules.md)。

## 本次目录整理恢复

整理前完整备份（排除依赖内部文件）：C:/Users/Administrator/Downloads/campus-before-cleanup-20261002-002638.tar.gz。清理明细和源码哈希对照在同一 Downloads 目录保存，历史设计过程不放回当前源码树。

## 服务器目录详解

以下目录、数量和运行状态于 **2026-10-02 00:52（北京时间）通过 SSH 只读核实**。数量是当时快照，会随使用变化。Ubuntu 22.04.5 LTS，磁盘约 39 GB、已用 15 GB、可用 22 GB；campus-api 正常运行，本机与服务器发起的公网 HTTPS 健康检查均返回数据库正常、20 个业务服务。

Linux 的 `/` 相当于整个服务器文件系统的起点，路径使用 `/`，没有 Windows 的 C:、D: 盘符。`/root` 是 root 用户的个人目录，与根目录 `/` 不同。

```text
/
├── opt/
│   ├── node/                         Node.js 运行环境
│   └── campus-api/
│       ├── current -> releases/20261001-203002
│       └── releases/                 按发布时间保存后端版本
│           └── 20261001-203002/
│               ├── server/           小程序后端源码及运行依赖
│               │   ├── src/          HTTP 入口、数据库适配层
│               │   ├── services/     20 个业务服务
│               │   ├── sql/          建表 SQL
│               │   ├── scripts/      部署、初始化、验证脚本
│               │   ├── deploy/       服务安装配置
│               │   ├── data/         随代码发布的网站内容默认文件
│               │   └── node_modules/ 后端依赖库
│               └── admin-web/        网页管理后台
├── etc/
│   ├── campus-api/app.env            正在使用的账号、密钥、运行配置
│   ├── systemd/system/campus-api.service
│   ├── cron.d/campus-api-backup       每日备份时间
│   └── letsencrypt/live/www.crbuj.icu/ HTTPS 证书入口
├── var/
│   ├── lib/mysql/campus_app/         MariaDB 管理的业务库文件
│   └── log/                          系统日志、备份日志
├── www/
│   ├── wwwroot/crbuj.icu/            原有个人网站
│   ├── campus-data/
│   │   ├── uploads/                  用户上传的图片
│   │   └── portfolio-content.json    网站内容接口实际使用的持久文件
│   ├── backup/campus-api/            数据库、图片、配置备份
│   ├── wwwlogs/                      网站访问与错误日志
│   └── server/                       宝塔面板、Nginx 等软件
├── usr/local/sbin/                   campus-api-* 维护命令
├── root/                            root 用户目录，含 .ssh、.codex 等
└── tmp/                             临时文件、待部署压缩包
```

### 代码和版本

- 实际启动文件：`/opt/campus-api/current/server/src/app.js`。
- `current` 是软链接，也就是指向当前版本的快捷入口；当前目标为 `/opt/campus-api/releases/20261001-203002`。11 个发布目录是历史代码版本，不是 11 个同时运行的后端。
- `server/src/data-store/index.js` 把业务服务的数据操作接到 MariaDB；本机对应路径相同。
- `server/sql/schema.sql` 是建表说明；真实业务数据在数据库中，不写回这份 SQL。
- `server/node_modules` 是运行依赖，不手工编辑；`server/scripts` 是维护工具，不等于每个脚本都持续运行。
- 网页后台来自 `/opt/campus-api/current/admin-web/`；微信界面源码仍在本机 `miniprogram/`，编译上传微信，当前服务器发布目录只有后端和网页后台。

| 业务 | `server/services/` 下对应目录 |
| --- | --- |
| 登录和用户 | login、getOpenid、saveUserInfo、searchUser |
| 跑步、个人统计、排行榜 | saveRunData、getUserRunStats、getRankList |
| 好友 | addFriend、getFriends、deleteFriend |
| 搭子、情侣、组队 | teamManager |
| 点餐、优惠券、配送 | food_manager、coupon_manager、rider |
| 食堂评分、菜品、评论、投稿 | canteen_reviews |
| 校园动态、消息 | forum、notification |
| 管理员、模块开关 | globalAdmin |
| 文件链接、二维码 | getTempFileURL、getQrCode |

这些是原云函数迁移后的服务器业务源码，仍然需要保留；有 `getOpenid` 等名称不代表仍在调用微信云开发。

### 数据库、图片和配置

数据库名 `campus_app`，仅监听 `127.0.0.1:3306`。数据目录 `/var/lib/mysql/`，本业务库目录 `/var/lib/mysql/campus_app/`。其中 `.frm`、`.ibd` 是数据库内部文件，应通过数据库或管理功能读写，不能当文本编辑。

| 数据表 | 用途 | 核实数量 |
| --- | --- | --- |
| app_documents | 按业务集合名存放 JSON 文档 | 29 条 |
| file_mappings | 旧文件标识与新地址的映射兼容表 | 0 条 |
| migration_log | 数据导入记录 | 0 条 |

`app_documents` 中的 `collection_name` 区分业务，`document_id` 标识一条记录，`document_data` 保存具体内容。当前分布：users 5、runRecords 4、teams 1、global_admin 1、global_admin_log 7、global_settings 1、canteen_stalls 1、canteen_dishes 1、canteen_reviews 1、canteen_submissions 1、food_shop 1、food_dish 3、food_shop_user 1、forum_user 1。没有列出的集合可能尚未产生记录。模块设置在 global_settings；迁移记录为空不能单独证明每条业务记录的来源。

上传文件位于 `/www/campus-data/uploads/`，当时有 8 个文件（5 JPG、3 PNG），约 3.4 MB，现有子目录 avatars、regression。数据库通常保存图片地址，图片本体在此目录；发布新代码不会自动清空它。regression 是回归验证相关目录，当前说明只做盘点，没有清理。

`/etc/campus-api/app.env` 是服务器正在读取的配置，包含数据库连接、JWT 会话密钥、微信 AppID/AppSecret、API 地址、上传目录等。项目 `maintenance/账号与连接/` 是本机维护副本，修改副本不会自动同步服务器。

网站内容接口实际通过 `PORTFOLIO_CONTENT_FILE` 使用 `/www/campus-data/portfolio-content.json`。发布目录的 `server/data/portfolio-content.json` 是默认文件，当前配置覆盖了默认路径。

### 网站入口与请求流程

| 地址 | 对应内容 |
| --- | --- |
| `https://www.crbuj.icu/` | 原网站 `/www/wwwroot/crbuj.icu/` |
| `https://www.crbuj.icu/campus-api/health` | 后端健康检查 |
| `https://www.crbuj.icu/campus-api/api/public/modules` | 小程序模块开关 |
| `https://www.crbuj.icu/campus-api/admin/` | 网页后台 |
| `https://www.crbuj.icu/campus-api/uploads/…` | 上传图片 |

Nginx 接收公网 80/443 请求，配置在 `/www/server/panel/vhost/nginx/crbuj.icu.conf`。`/campus-api/` 转发给 `127.0.0.1:3100` 并去掉这个前缀，其他网站请求由原网站目录处理。HTTPS 证书入口在 `/etc/letsencrypt/live/www.crbuj.icu/`。

一次食堂评分的流程：小程序 → HTTPS/Nginx → app.js → canteen_reviews → data-store → MariaDB；上传图片另存 uploads，数据库关联图片 URL。SSH 使用 22 端口，数据库与 Node 服务使用服务器内部端口，不需要客户端直接连接数据库。

原网站目录还存在 `campus/`（校园网页、教程等）、`campus-map-review/`（地图预览文件）、`articles/`、`personal-assets/` 等。这些属于网站文件，不能仅因名称包含 campus 就当作小程序后端。

### 日志与备份

- 后端日志由 systemd 收集：`journalctl -u campus-api -n 50 --no-pager`。
- 网站日志：`/www/wwwlogs/crbuj.icu.log`、`/www/wwwlogs/crbuj.icu.error.log`。
- 备份日志：`/var/log/campus-api-backup.log`；计划在 `/etc/cron.d/campus-api-backup`，每天北京时间 03:17。
- `/www/backup/campus-api/` 当时有 14 个时间戳备份目录，另有迁移前的 Nginx 配置副本。
- 核实的 `20261001-203002/` 内有 `database.sql`（数据库导出）、`uploads.tar.gz`（图片）、`app.env`（配置）、`SHA256SUMS`（完整性校验）。这是数据备份，代码历史另外放在 releases。
- 上述 00:52 快照的旧备份脚本尚未包含网站内容；02:31 发布已修复，当前备份同时含 portfolio-content.json。它仍不是整个服务器所有系统文件的完整备份。
- 占用快照：后端历史版本 129 MB、原网站 78 MB、MariaDB 全数据目录 126 MB、项目备份 3.6 MB、系统 `/var/log` 约 3.6 GB，其中 journal 约 3.0 GB。MariaDB 目录大小包含数据库运行开销，不等于 29 条记录的纯内容大小。

### 日常如何维护

新增菜品、评分、帖子、用户和开关，应通过小程序或管理端操作；后台业务代码改动才需要部署 server，网页后台改动部署 admin-web，小程序 UI 改动使用微信开发者工具编译、预览、上传。数据库、上传文件、运行配置与代码版本分开放，便于更新和回退。

查看状态可从本机运行 `python scripts/campus-server.py 'campus-api-status'`。手动数据备份使用 `campus-api-backup`，发布使用 `campus-api-deploy`。`/www/server/` 是宝塔与 Web 软件，`/usr`、`/lib`、`/boot` 等是系统软件；维护业务通常不需要手动改这些目录。

## 跑步升级部署（2026-10-02 02:31 核实）

- 当前 `/opt/campus-api/current` 指向 `/opt/campus-api/releases/20261002-023132`，20 个业务服务；新增 `/api/we-run` 为 HTTP 路由，不额外增加服务目录。
- 发布前备份 `/www/backup/campus-api/20261002-023131`；database.sql、uploads.tar.gz、app.env、portfolio-content.json 的 SHA256 校验均通过。
- 业务文档发布前后均为 29 条。app_documents 增加 doc_openid / record_date 虚拟列及两个索引，没有复制或迁移原文档。
- 本机编辑前备份 `C:/Users/Administrator/Downloads/campus-before-running-upgrade-20261002-015702.tar.gz`；Linux `.sh` 保持 LF 换行，避免 Windows CRLF 导致部署或每日备份失败。
- 真实 SQL、组队和模拟 HTTP 只在临时 `campus_run_review_20261002` 测试库执行；清理后文档数为 0，随后删除测试库与临时权限。未来运行 test-run-http.js 要新建以 campus_run_review_ 开头的测试库，设置 DB_NAME / NODE_PATH；不可用生产库替代。
- 默认运行登录仍为微信；测试 HTTP 中的微信上游替身只存在于测试子进程，不发布到正常 API 逻辑。
- 后台定位平台资格 / 隐私配置和微信运动真实授权继续按真机验证，不把测试密文当作微信实测结果。
