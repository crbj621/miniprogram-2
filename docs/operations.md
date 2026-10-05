# 服务器、账号与部署

## 当前连接

| 项目 | 值 |
| --- | --- |
| SSH 别名 | campus-server |
| 主机 / 用户 / 端口 | 111.228.16.165 / root / 22（本机维护本次经备用SSH监听2222并核验同一保存的主机公钥） |
| 系统 / 运行时 | Ubuntu 22.04 / Node.js 24.21.0 / MariaDB 10.6.23 |
| 服务 / 本机 API | campus-api / 127.0.0.1:3100 |
| 源码当前链接 | /opt/campus-api/current |
| 已部署发布点 | 20261005-173247（以后以服务器 current 为准） |
| 数据库 / 监听 | campus_app / 127.0.0.1:3306 |
| 运行配置 / 图片 | /etc/campus-api/app.env / /www/campus-data/uploads |

公网 API 根路径 https://www.crbuj.icu/campus-api/；/health、/api/public/modules、/admin/分别为健康、公开模块与网页后台。2026-10-04实时查询DNS已回腾讯DNSPod：pansy.dnspod.net、marina.dnspod.net；www和泛域名通过EO CNAME接入，源站仍是111.228.16.165。不能恢复旧京东委派描述；后续改动先查询实时配置。

这里的 **API 是“数据接口”的简称，不是正在使用的域名名称**。当前原网站用 `https://www.crbuj.icu/`，小程序用同一域名下的 `https://www.crbuj.icu/campus-api/`。前端地址见 `miniprogram/config/api.ts`；`api.crbuj.icu` 是未来可选方案，本次没有切换地址，不需要为这次升级新增解析。

www原个人网站位于/www/wwwroot/crbuj.icu，Nginx配置/www/server/panel/vhost/nginx/crbuj.icu.conf。API只占/campus-api路径。现在公网经过EO，微信合法域名和前端地址保持www；需要区分访客到EO的HTTPS与EO到源站的回源协议。

微信 request / uploadFile / downloadFile 合法域名使用 https://www.crbuj.icu，不带路径。用户已确认设置。AppSecret 已验证，真实客户端登录与正式发布仍待完成，不执行旧云数据导入或自动停用云环境。

## 明文维护文件

全部位于 `maintenance/账号与连接/`，按用户要求保存明文，继续保留：

| 文件 | 内容 / 对应 |
| --- | --- |
| ssh.json / ssh.pem / known_hosts | 主机、SSH 私钥、已核验的服务器公钥 |
| wechat.env | 小程序 AppID 与 AppSecret |
| admin.json / 账号说明.txt | 管理员账号、登录密码及验证密码 |
| server.env | 服务器运行环境的本机副本 |
| mihomo-config.yaml / mihomo-subscription-url.txt | 当前服务器规则代理配置与订阅链接的明文副本 |
| mihomo-providers.yaml / mihomo-selection.json | 原生订阅缓存与已验证选组、倍率筛选、更新时间；不代替实时配置 |

编辑本机副本不会自动更新服务器。上传目录只有 miniprogram；服务端发布只包含 server 和 admin-web。

```powershell
python scripts/campus-server.py 'systemctl is-active campus-api'
& 'C:/Program Files/OpenSSH/ssh.exe' -o StrictHostKeyChecking=yes campus-server 'campus-api-status'
```

SSH 配置 C:/Users/Administrator/.ssh/config。Python 维护脚本优先读取项目明文副本，并校验主机公钥。普通 SSH 可用不代表 Codex 内置远程环境已连接；服务器 Codex CLI 仍未验证登录。

## 备份与部署

- 服务端备份：campus-api-backup；每日 03:17，包含数据库、图片和配置。
- 状态：campus-api-status；配置：campus-api-configure。
- 部署前先单独运行 campus-api-backup，再运行 campus-api-deploy /tmp/campus-api-release.tar.gz。部署脚本安装依赖、切 current、重启与健康检查，失败自动回退代码。
- 发布包只含 server / admin-web，排除 node_modules、.env、PEM 和 maintenance。
- 单纯前端 UI 改动不部署服务器。服务器源码必须保留 services 与 data-store。
- 历史备份在 /www/backup/campus-api，本次旧版兼容修复前备份为20261005-121359；容量不足时按实际策略处理。

## 检查

本机：npm run check、npm test、npm run check:wxml、npm run check:wxss。最新官方preview已成功，见[预览体积](ui-preview/package-size/preview-result.json)；此前跑步／输入／英语记录是历史验证。

服务器真实回归需读取运行 env 并在当前 server 下执行 scripts/test-selfhost.js 或对应专项脚本。测试包含数据写入与 finally 清理，不能在活跃运营库盲目反复执行；详见 [业务规则](business-rules.md)。

## 2026-10-05 点餐模块已移除

部署点`20261005-173247`，部署前备份`/www/backup/campus-api/20261005-172922`。当前源码46页、19个业务服务；删除packageFood、packageRider、优惠券及对应管理页面、food_manager/coupon_manager/rider服务、globalAdmin点餐动作、后台订单/菜单页面和关联跳转。食堂评价使用独立canteen_*集合，保留评分、评论、投稿及补图。组队跑仍需每人已保存有效里程≥500米才完成；移除点餐券发放，现有每日跑步金币奖励不变。

根因是入口、页面注册、个人中心、管理端、服务器服务与组队发券相互关联，只隐藏首页会留下可调用业务。调研关键词`wechat miniprogram subpackages app.json`，对照[微信官方示例](https://github.com/wechat-miniprogram/miniprogram-demo)与[WeUI小程序](https://github.com/wechat-miniprogram/weui-miniprogram)；本次沿用原生分包和现有Express，不新增依赖。SkillHub检索未发现需要安装的专用移除技能。

公开模块接口为已发布旧版保留固定false的food/rider字段，防止旧版七字段格式校验失败；后台模块列表仅剩running/canteen/forum/english/gifts，移除的模块不能重新开启。前端public-modules只返回当前五项。匿名通用数据库移除及真实图片/管理员限流安全修复也已随本次后端发布。

本机`npm run check`、完整`npm test`、49项真实HTTP安全回归通过；微信官方55个WXML/脚本、63个WXSS编译通过。隔离MariaDB组队19项、管理概览5项通过，临时库和账号在EXIT清理；不在生产库写测试数据。线上健康、模块关闭、删除接口/后台页面404、食堂查询、6份后端源码SHA与本机一致及www原个人网站SHA未改变均通过。

本机完整备份`C:/Users/Administrator/Downloads/campus-before-ordering-removal-20261005-171448/`含working-files.tar.gz、Git历史bundle和移出的文件。发布包仅server/admin-web，270文件、25,126,186字节，SHA256`5c416782a16a504eac75ef9fbba0c8d8de031980ac0bd5ca95b29ae3a0d86049`。历史订单及用户图片没有清空；移除功能不等于删除用户数据或历史备份。

小程序源码已更新，微信正式版本尚未上传/发布；已发布旧版重新进入首页读取到关闭值后隐藏旧点餐入口。真机登录、GPS、分享等不能由本次编译或接口检查替代。下方旧发布点与67页/22服务记录为历史快照，不恢复点餐功能。

## 本次目录整理恢复

### 2026-10-05 已发布旧版发表评论兼容

部署点`20261005-121505`，备份`/www/backup/campus-api/20261005-121359`。根因是新版服务器要求`clientId`，正式旧版不会发送该字段；已由服务器兼容原`dishId / score / comment / images`提交格式，旧版不需要等待新版发布。新版显式提交编号、可选评分和纯交流契约保留；两版同时使用最新单人评分、本人权限及争议评分限制。

发布包仅server/admin-web，274文件、25,152,275字节，SHA256为`1bd9293a235c0391cd6b75c2b307713f4adf3a2de4b466e26b88305cbe197843`。本机`npm run test:canteen`三组专项及`npm run check`通过，独立MariaDB43项通过，包含旧版并发重试、A→B→A、旧／新版交替、删后重发、存疑暂停及恢复；未在生产库创建测试用户或评论。

服务active、MariaDB正常、22个服务，5份部署源码哈希与本机一致。公网只读复核时保留3档口、4菜品、11评论、9独立评分；这些是12:16快照而非固定数量。测试库／临时数据库账号已清理，上传部署包校验哈希后移除，发布点与备份保留。证据见[旧版兼容验证](ui-preview/canteen/compatibility-verification.json)。

本次不更改小程序界面、DNS／EO、API地址或原个人网站。旧版发表评论由服务器恢复；新版UI功能需要单独正式发布，手机真实登录与评论仍需客户端确认。兼容契约见[食堂模块](canteen.md)。

### 2026-10-05 食堂评论、投稿、餐次与争议评分

部署点`20261005-053554`，备份`/www/backup/campus-api/20261005-053536`。发布包只含server/admin-web，共274文件、25,151,403字节，SHA256为`946a35b1c4de326e317d067a82c95425657b39f882402934deb0b05b05cc9e0d`；5份部署源码SHA与本机一致。服务active、MariaDB正常、22个服务，www原站SHA保留，DNS／EO和API地址未改。

真实HTTP复核保留3档口、4菜品、9评论、3投稿；现有9组评分已幂等迁入canteen_ratings。公网list、reviews、三种随机、早餐／午餐／晚餐和个人信息过滤检查通过；未创建生产测试账户或评论。此处数量为05:40前后只读快照，以实时接口为准，见[发布验证](ui-preview/canteen/release-verification.json)。迁移只增加独立评分，不导入旧云数据，不删除原评论。

本机完整npm test、TS／67页结构、76WXML／84WXSS通过；三个食堂本机测试和真实隔离MariaDB29项通过，临时库、账号和解压目录已清理。数据库写入测试只允许campus_test_库，脚本server/scripts/test-canteen-interactions.js，不在生产库运行。10种状态×320／390宽共20个浏览器转换样例通过，展示数据为模拟，不冒充微信原生。

本节当时的官方预览与包体积见[食堂预览](ui-preview/canteen/preview-result.json)，二维码`C:/Users/Administrator/Downloads/campus-canteen-preview-20261005.png`。最新包体积以[主包修复记录](ui-preview/package-size/preview-result.json)为准；真实上传、安卓键盘和正式发布仍需客户端验收。改造契约见[食堂模块](canteen.md)。

### 2026-10-05 主机状态、可折叠装饰卡与规则代理

该次后端发布点`20261005-035635`，部署备份`/www/backup/campus-api/20261005-035525`。发布包仅server/admin-web，25,144,262字节，SHA256为`f20ad7c1c7d1607839c4f0c1e096eae6c44d493f620dac2096891c4c48cf1071`。campus-api以原非root用户运行、22个服务、数据库正常；6份部署源码哈希与本机一致，www原站index SHA仍为`3044d274ff336c8cb5fe6dc87b6fca840e92b9ca3b695acfb4b2953c4e03d8a5`。本次首页折叠样式只改小程序，无需再发布或重启后端，DNS／EO／API地址未改。

`GET /api/public/server-status`在原campus-api路径下，无需登录。后端`server/src/server-status.js`用Node原生os、statfs、HTTPS Agent，Linux内存读取MemAvailable。调研关键词：`Node os uptime statfs MemAvailable proxyEnv`、`systeminformation`、`mihomo http proxy-provider interval url-test filter`；候选[systeminformation](https://github.com/sebhildebrandt/systeminformation)、[Mihomo](https://github.com/MetaCubeX/mihomo)、[Sub-Store](https://github.com/sub-store-org/Sub-Store)。单张状态卡用现有Node接口；单个订阅复用已装Mihomo原生更新，无需引入完整监控或订阅管理服务。

频率：主机5秒采样，前端可见时10秒请求，离页停止且重复请求合并；数据库／祝福数量30秒缓存；网站占用5分钟；Google／YouTube启动时及每小时HEAD检测，页面刷新不会额外探测外网。失败显示未确认／横线，禁止伪造0%或全部模块关闭。状态服务显式配置`SERVER_STATUS_PROXY_URL=http://127.0.0.1:7890`，小时检测同时保留直连与代理结果；手动运维诊断不属于状态卡周期。

根盘总容量41,849,925,632字节，约41.85GB或38.98GiB，符合约40GB硬盘的预期。“硬盘已用／总量”与“网站占用”分开；文件系统保留块导致已用＋普通用户可用不一定等于总量，df使用率分母也可能不同。网站占用为`du -s -B1`统计`/www/wwwroot/crbuj.icu`、`/www/wwwroot/galaxy-heart`、`/opt/campus-api`、`/www/campus-data`四个目录分配空间，加业务库information_schema中表数据／索引大小，不含备份、系统日志、数据库全局日志。包含保留的旧后端版本；这是网站相关占用估算，不是数据库物理目录完整大小，未给非root服务开放/var/lib/mysql。

03:58只读快照：[发布验证](ui-preview/server-status/release-verification.json)11项通过，整机RAM约30.2%、硬盘已用约17.86GiB、网站相关占用约951MiB、连续开机4天4小时51分钟、有效祝福2／公示0；数量实时变化，以接口为准。接口和小程序已移除原有网站名称与URL；友情链接单独保留用户指定的个人主页。首页默认只展示“校园守护站”、在线状态和原女生素材，点开展开全部指标。

MariaDB未使用的MyISAM key_buffer_size从128MiB改为8MiB，持久文件`/etc/mysql/mariadb.conf.d/70-campus-myisam-cache.cnf`，备份`/www/backup/campus-api/memory-20261004-154918`。这是缓存额度减少120MiB，不能冒充进程实际内存即时下降120MiB；未改InnoDB、重启数据库或清理业务数据，SQL正常。见[内存记录](ui-preview/server-status/memory-optimization.json)。

代理原来只有静态导入节点，未配置订阅自动更新；服务本身未掉线，上游节点曾出现HTTPS EOF。现Mihomo1.19.32的原生HTTP provider `campus-subscription`每21600秒（6小时）更新，缓存`/etc/mihomo/proxy_providers/campus-subscription.yaml`，更新失败保留原生缓存。URLTest组筛选名称`0.1倍`，以HTTPS gstatic每5分钟测速；四个自动组当前30／9／5／16个候选。手动组保留全部真实节点；倍率由供应方标注，本项目不能核实其实际扣费。

04:17原生强制更新成功（68节点），重启后`🚀节点选择 → 🇺🇸美国节点`、`🎬媒体解锁 → 🚀节点选择`保留，当前自动组选择美国01的0.1倍节点。原9263条规则、DNS、mode rule、TUN关闭及127.0.0.1监听未改变；Google／YouTube／百度两轮200，百度日志为DIRECT。见[订阅与规则验证](ui-preview/server-status/proxy-subscription-verification.json)。程序需使用本机7890代理才进入规则，当前可用不代表所有进程透明接管或供应方永不故障。

配置源码`scripts/configure-mihomo-subscription.py`，服务器副本`/usr/local/sbin/campus-mihomo-subscription-configure.py`；先备份和校验，失败恢复，由Mihomo自己定时更新，不另建cron／常驻服务。成功备份`/etc/mihomo/backup-subscription-20261005-041558`；配置、订阅URL、provider缓存、选组记录已明文同步maintenance/账号与连接。此前两次适配控制接口字段失败已恢复，当前以最终验证为准。

67页TS结构、76WXML、84WXSS、188项后端状态与前端生命周期检查通过。[4个布局样例](ui-preview/server-status/layout-verification.json)是320／390宽浏览器转换的收起／展开，不冒充微信原生。最新官方预览主包2,008,725字节、英语133,756、祝福67,076、总包2,680,628；二维码`C:/Users/Administrator/Downloads/campus-status-collapsed-preview-20261005.png`。本次原生自动化连接不可用，不能用此前视频13项记录代替新卡片验收；实体手机与正式发布仍待验证。

### 2026-10-04 视频背景、学习加练与跑步近景

当前发布点`20261004-223617`，部署前备份`/www/backup/campus-api/20261004-223558`。发布包仅server/admin-web，25,132,926字节，SHA256为`e15cf5013af7a971d6ad50843254701db4e728f2a3e4f1e16eee45ca5018e77f`。current、服务active、数据库正常、22服务；6份部署源码哈希与本机一致。www原个人网站index.html的SHA256仍为`3044d274ff336c8cb5fe6dc87b6fca840e92b9ca3b695acfb4b2953c4e03d8a5`。没有修改DNS、EO回源、API地址或生产钱包，未创建线上测试用户。

英语每日目标完成后可选择本轮1—100个新词或旧词加练，计入实际今日数量与排行榜；原打卡时间、今日／次日计划和一次性每日奖励保留。首页优先恢复未完成轮次，解决最后一个新词答错后词量为零、无法返回错词复现的问题。内存186项、隔离MariaDB193项通过；独立测试库、临时数据库账号与解压测试目录已清理。后端验证见[发布记录](ui-preview/english-extra/release-verification.json)。

四张动漫风景归入免费静态背景，旧ID保留；动态区为两种6金币的真实循环视频，手机／电脑各一版，4个MP4共5,655,460字节，所有用户共用素材。此前视频发布点`20261004-172950`、备份`/www/backup/campus-api/20261004-172924`；网站内存214项、隔离MariaDB239项通过，涵盖上传归属、到期图片回收与发布／清理竞争。信封、信纸半透明，蛋糕／蜡烛等实体保留不透明。移除小程序排版预览按钮，保留编辑画布、更新免费网页预览与复制链接。12个无引用WebGL vendor文件共704,290字节已核对哈希并备份到本机Downloads后移出源码。

视频公网20资源SHA、4个MP4范围请求、2视频×320／390／1440视口的实际播放、开信和蜡烛交互通过；本机另核对隐藏／恢复、减少动态偏好与到期资源释放。原生模拟器6张JPEG解码、两列缩略图、封面展示共13项通过。结果见`ui-preview/gifts/videos`与`ui-preview/gifts/landscapes/native-verification.json`。小程序展示图片／视频封面，完整视频在浏览器；没有业务域名时不嵌入web-view。

2026-10-04 22:39只读快照：业务333条文档、43个已有集合；正式祝福2个、临时预览0个，到期站点／预览各0个，站点域名2、留言7、访客计数4、上传资格2。数量随使用变化。08:57的完整文件审计无旧孤儿图片、缺失文件或残留空目录，详见`ui-preview/gifts/storage-verification.json`；它是当时快照，不冒充22:39文件扫描。预览访问到期立即失效、30秒清理；正式到期内容15分钟清理，未引用图片有24小时保护期。钱包流水、首次体验标记、审计和备份按各自规则保留。论坛图片不能照搬祝福到期删除，当前草稿孤儿图片清理及用户总量配额尚未完善，见[gift-sites.md](gift-sites.md)。

本机67页、76WXML、84WXSS及英语／音频／跑步对应回归通过；英语40个320／390布局样例无横向溢出、断图或脚本错误。微信原生fixture确认本地答对0.28秒／答错0.24秒音频实际播放结束，地图准备16→运动18、暂停／恢复18、结束16；地图缩放不改变距离算法，真实比例尺受设备和纬度影响。最新官方预览主包1,984,620字节、英语分包133,756字节、总包2,648,771字节，二维码`C:/Users/Administrator/Downloads/campus-extra-preview-20261004.png`。原生记录见`ui-preview/english-extra/native-verification.json`；不等于Android／iOS真机发声、GPS、锁屏运行或正式微信发布。

### 2026-10-04 动态风景背景

以下是155832历史版本；当前四图已归静态背景，旧WebGL动效已移出，不能据此恢复旧分类。

最新发布点`20261004-155832`，部署前备份`/www/backup/campus-api/20261004-155147`。只发布server/admin-web，发布包16,787,673字节，SHA256为`e51cdf9a356769a97eb79ce5097e46dcb392589081b29a0fb934488202e5cc5d`。current与服务状态、服务器源码语法检查通过；公网健康检查数据库正常、22服务。www原个人站index.html在发布前后SHA256一致，未改变DNS或API地址。

动态背景原ID和4／6／5／6金币价格保留，分别升级为草原星夜、森林月夜、晴空花野、极光海岸。8张WebP共3,221,606字节放在server/public/gifts/backgrounds，网页按竖／横视口加载；原PNG和提示词保存在本机Downloads，见[gift-landscape-assets.md](gift-landscape-assets.md)。没有新建用户网站、改钱包或清空数据库。

本机TS／结构、76WXML、84WXSS通过，网站内存135项、原生UI逻辑78项、67页分享通过。浏览器8模板及原预览／匿名留言回归通过；专项20个场景检查真实像素、渲染帧、320／390／1440适配、隐藏与恢复、缓存页面事件、运行中减少动态偏好和WebGL失败。公网只读验证8图片SHA与本机一致，4演示页面打开和交互成功，记录在`ui-preview/gifts/landscapes/public-verification.json`；本机专项在同目录verification.json。GPU通过软件渲染器验证，模拟缓存事件不代表实体浏览器必定命中bfcache。


### 2026-10-04 祝福网站、预览与公示升级

发布点`20261004-073355`，部署前备份`/www/backup/campus-api/20261004-071648`。发布包仅server/admin-web，SHA256为`cdf2844bddf18922fe2a02de42b76920c16147b194e79856949f71cbd114e7d4`，大小13,559,681字节。健康检查数据库正常、22服务；未替换www个人网站或修改小程序API域名。

独立MariaDB最终网站147项通过，英语136项、奖励58项、食堂24项通过；随后删除测试库和临时账号。网站内存135项，小程序预览、匿名Cookie、价格、公示刷新和管理员发金币73项行为通过。补测并修正了旧留言滚出40条导致次数重置、UTC每天08:00重置的问题：独立访客计数按北京时间午夜重置，与留言保存同站点锁事务，随站点到期清理。预览上传资格与图片清理采用一致锁顺序。

当前网站规则：首次2小时全特效体验免费，标准3天0金币／7天5／15天10／1个月15；背景和高级效果、定制子域名另计。预览先不收费，编辑中45秒续期，离开后2分钟访问失效，30秒周期清理临时内容。正式到期网站和图片引用仍按15分钟清理任务。详情见[gift-sites.md](gift-sites.md)。

EO泛域名已修正回源HTTP、HOST使用加速域名：源站泛域名只监听HTTP80，已有网站目录优先，其他根路径走/gift-domain，/gift-assets和/api/gifts由当前Node服务处理。公网HTTPS未知子域名410，实际生日／墙网站HTTPS创建、修改与删除通过，动态页面和API无缓存；love原站、sqyz原跳转及www保留。源站crbuj.icu／www证书不是泛域名证书，访客HTTPS由EO处理。无需再次改DNS。

实时模块快照：running=true、canteen=true、english=true、gifts=true；food=false、forum=false、rider=false。模块只以接口实时值为准；此前临时隐藏祝福的措施已解除，不能恢复旧隐藏描述。维护变更有原设置副本和日志，不清空其他开关。

微信官方最新预览主包1,976,940字节，总包2,609,972字节；二维码`C:/Users/Administrator/Downloads/campus-preview-final-20261004.png`，元数据`ui-preview/祝福升级微信预览结果.json`。原生模拟器复核新版编辑画布、两列按钮、拖动和朋友圈介绍卡；此前已真实加载2019、2026四级与六级32题整卷。本机浏览器8模板、390／320宽度、4动态背景、匿名留言、实时文字／布局、换效果保留蜡烛状态、410停止轮询通过，记录在`ui-preview/gifts`。

公网本次临时预览与正式试用验证记录见`ui-preview/gifts/public-preview-verification.json`；临时测试内容、钱包和流水清理后再验收。完整发布证据集中在`ui-preview/gift-release-verification.json`。预览成功不等于正式微信发布，安卓GPS、锁屏、真实微信好友／朋友圈仍需手机验证。

### 服务器规则代理

下文是2026-10-04初次收回公网监听的记录；当前订阅自动更新与0.1倍自动组以本页2026-10-05章节为准。

Mihomo1.19.32已运行且开机启用，`mode: rule`，TUN未启用。当前监听127.0.0.1:7890代理与127.0.0.1:9090控制接口；仅收回公网监听，订阅节点、规则、分组和DNS保持原配置。修改前备份`/etc/mihomo/config.yaml.backup-20261004-local`。运行配置`/etc/mihomo/config.yaml`，订阅链接`/etc/mihomo/subscription-url.txt`，原订阅配置`/etc/mihomo/subscription-original.yaml`；明文维护副本已同步本机。

配置校验与重启通过；经本机7890代理访问gstatic成功，服务器直接访问GitHub/gstatic也成功。这不是全部进程已透明接管的证明，程序需要使用本机代理端口才按Mihomo规则转发。不要为小程序网络问题盲目修改订阅规则、开放代理端口或把规则模式改全局。

### 2026-10-03 英语整卷与伙伴更新

发布点 `20261003-215659`，部署前备份 `/www/backup/campus-api/20261003-211810`。发布包仅包含 server/admin-web，SHA256为 `292e4910c73e6b2ceb2b6a4d4236db0ae5fde73096ec89917331716ac2591e40`。

独立MariaDB测试库通过英语136项、奖励58项、食堂评论13项（本人权限、并发点赞/删除、重复删除及重发时间保留）回归，随后删除测试库与临时数据库账号；生产库没有写入测试用户或假排行榜。公网健康检查数据库正常、21服务，原网站、衣服PNG、真题图表和单词音频均响应成功；匿名学习请求返回401。只读服务目录核实104套不含听力整卷、每套32题，范围2019年6月至2026年6月。完整验证数据见 `ui-preview/cet-release-verification.json`。

微信官方预览已生成，主包1964027字节，总包2528968字节；预览成功不代表微信正式发布或安卓真机通过。

整理前完整备份（排除依赖内部文件）：C:/Users/Administrator/Downloads/campus-before-cleanup-20261002-002638.tar.gz。清理明细和源码哈希对照在同一 Downloads 目录保存，历史设计过程不放回当前源码树。

## 服务器目录详解

以下代码入口于**2026-10-05 03:58通过SSH核实**：current指向20261005-035635，campus-api正常，www公网HTTPS健康检查返回数据库正常、22个业务服务。业务库只读查询347条文档、43个已有集合；上传目录58文件属于此前2026-10-04 08:57快照。数量随使用变化，不能当作固定值。

Linux 的 `/` 相当于整个服务器文件系统的起点，路径使用 `/`，没有 Windows 的 C:、D: 盘符。`/root` 是 root 用户的个人目录，与根目录 `/` 不同。

```text
/
├── opt/
│   ├── node/                         Node.js 运行环境
│   └── campus-api/
│       ├── current -> releases/20261005-121505
│       └── releases/                 按发布时间保存后端版本
│           └── 20261005-035635/
│               ├── server/           小程序后端源码及运行依赖
│               │   ├── src/          HTTP 入口、数据库适配层
│               │   ├── services/     22 个业务服务
│               │   ├── sql/          建表 SQL
│               │   ├── scripts/      部署、初始化、验证脚本
│               │   ├── deploy/       服务安装配置
│               │   ├── data/         随代码发布的网站内容默认文件
│               │   ├── public/       英语人物、祝福背景与开源特效素材
│               │   └── node_modules/ 后端依赖库
│               └── admin-web/        网页管理后台
├── etc/
│   ├── campus-api/app.env            正在使用的账号、密钥、运行配置
│   ├── mihomo/                       规则代理配置、订阅与原配置副本
│   ├── systemd/system/campus-api.service
│   ├── cron.d/campus-api-backup       每日备份时间
│   └── letsencrypt/live/www.crbuj.icu/ HTTPS 证书入口
├── var/
│   ├── lib/mysql/campus_app/         MariaDB 管理的业务库文件
│   └── log/                          系统日志、备份日志
├── www/
│   ├── wwwroot/crbuj.icu/            原有个人网站
│   ├── wwwroot/galaxy-heart/         既有独立站点；祝福网站不逐人建目录
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
- `current` 是软链接，也就是指向当前版本的快捷入口；本次目标为 `/opt/campus-api/releases/20261005-121505`。releases内其他目录是历史代码版本，不是同时运行的后端。
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
| 食堂评分、菜品、评论、投稿 | canteen_reviews |
| 英语学习、挑战、金币、衣橱与每日任务 | english_learning |
| 祝福网站、域名、发布与到期清理 | gift_sites |
| 校园动态、消息 | forum、notification |
| 管理员、模块开关 | globalAdmin |
| 文件链接、二维码 | getTempFileURL、getQrCode |

这些是原云函数迁移后的服务器业务源码，仍然需要保留；有 `getOpenid` 等名称不代表仍在调用微信云开发。

### 数据库、图片和配置

数据库名 `campus_app`，仅监听 `127.0.0.1:3306`。数据目录 `/var/lib/mysql/`，本业务库目录 `/var/lib/mysql/campus_app/`。其中 `.frm`、`.ibd` 是数据库内部文件，应通过数据库或管理功能读写，不能当文本编辑。

| 数据表 | 用途 |
| --- | --- |
| app_documents | 按业务集合名存放JSON文档；本次查询281条 |
| file_mappings | 旧文件标识与新地址的映射兼容表 |
| migration_log | 数据导入记录；本次未导入旧微信云数据 |

`app_documents`中的`collection_name`区分业务，`document_id`标识记录，`document_data`保存内容。用户在users，跑步在runRecords，组队在teams，微信日步数在wechat_steps；点餐food_*、食堂评价canteen_*、动态forum_*、学习／打卡／钱包english_*分别存放。模块设置在global_settings，管理员与日志在global_admin／global_admin_log。祝福网站生成后保存为gift_sites／gift_domains／gift_uploads／gift_messages集合；gift_previews存临时内容，gift_message_visitors存当前日访客额度。本次最终只读查询已有3个其他正式网站（包含旧3天体验和旧1个月站点），保留原到期时间，不把旧体验标成2小时；验收临时账户的网站、钱包和流水均单独清理，不删除其他用户内容。集合共用此表，不需要逐一手工建SQL表。迁移记录为空不能单独证明每条业务记录的来源。

上传文件位于`/www/campus-data/uploads/`，本次盘点58个文件。avatars等保存用户图片，english-cache是按需下载的词音与原卷资料；祝福图片创建后按gift-sites/所有者哈希/文件保存。数据库保存地址与资格，文件本体在此目录，发布新代码不会自动清空。旧regression目录不因本次盘点被删除；祝福清理只处理无引用且超过24小时的本模块图片。

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
| `https://www.crbuj.icu/campus-api/gifts/demo/birthday` | 生日网站公开模板演示 |
| `https://名字.crbuj.icu/` | 正式祝福内容或有效临时预览；公网EO回源已验证 |

EO接收访客HTTPS后向源站回源。www的Nginx配置在`/www/server/panel/vhost/nginx/crbuj.icu.conf`，`/campus-api/`转发给`127.0.0.1:3100`并去掉前缀，其他请求由原网站目录处理。HTTPS证书入口在`/etc/letsencrypt/live/www.crbuj.icu/`，不含泛域名。泛域名配置在既有`wildcard.crbuj.icu.conf`的HTTP80，先匹配原站目录，其他根路径交给gift-domain；具体EO待配置项见上文。

一次食堂评分的流程：小程序 → HTTPS/Nginx → app.js → canteen_reviews → data-store → MariaDB；上传图片另存 uploads，数据库关联图片 URL。SSH 使用 22 端口，数据库与 Node 服务使用服务器内部端口，不需要客户端直接连接数据库。

原网站目录还存在 `campus/`（校园网页、教程等）、`campus-map-review/`（地图预览文件）、`articles/`、`personal-assets/` 等。这些属于网站文件，不能仅因名称包含 campus 就当作小程序后端。

### 日志与备份

- 后端日志由 systemd 收集：`journalctl -u campus-api -n 50 --no-pager`。
- 网站日志：`/www/wwwlogs/crbuj.icu.log`、`/www/wwwlogs/crbuj.icu.error.log`。
- 备份日志：`/var/log/campus-api-backup.log`；计划在 `/etc/cron.d/campus-api-backup`，每天北京时间 03:17。
- `/www/backup/campus-api/`保存历次时间戳备份及Nginx配置副本；本次数据备份20261004-035854，路由备份gift-routing-20261004-040833。
- 数据备份包括database.sql（数据库）、uploads.tar.gz（图片）、app.env（配置）、portfolio-content.json（网站内容）和SHA256SUMS（校验）。代码历史在releases，二者不是同一类文件。
- 这不是整个服务器所有系统文件的完整备份；数据库目录大小也包含运行开销，不能等同业务记录的纯内容大小。

### 日常如何维护

新增菜品、评分、帖子、用户和开关，应通过小程序或管理端操作；后台业务代码改动才需要部署 server，网页后台改动部署 admin-web，小程序 UI 改动使用微信开发者工具编译、预览、上传。数据库、上传文件、运行配置与代码版本分开放，便于更新和回退。

查看状态可从本机运行 `python scripts/campus-server.py 'campus-api-status'`。手动数据备份使用 `campus-api-backup`，发布使用 `campus-api-deploy`。`/www/server/` 是宝塔与 Web 软件，`/usr`、`/lib`、`/boot` 等是系统软件；维护业务通常不需要手动改这些目录。

## 历史部署：跑步升级（2026-10-02 02:31）

- 当时发布点为`/opt/campus-api/releases/20261002-023132`，20个业务服务；新增`/api/we-run`为HTTP路由，不额外增加服务目录。当前发布点见文首。
- 发布前备份 `/www/backup/campus-api/20261002-023131`；database.sql、uploads.tar.gz、app.env、portfolio-content.json 的 SHA256 校验均通过。
- 业务文档发布前后均为 29 条。app_documents 增加 doc_openid / record_date 虚拟列及两个索引，没有复制或迁移原文档。
- 本机编辑前备份 `C:/Users/Administrator/Downloads/campus-before-running-upgrade-20261002-015702.tar.gz`；Linux `.sh` 保持 LF 换行，避免 Windows CRLF 导致部署或每日备份失败。
- 真实 SQL、组队和模拟 HTTP 只在临时 `campus_run_review_20261002` 测试库执行；清理后文档数为 0，随后删除测试库与临时权限。未来运行 test-run-http.js 要新建以 campus_run_review_ 开头的测试库，设置 DB_NAME / NODE_PATH；不可用生产库替代。
- 默认运行登录仍为微信；测试 HTTP 中的微信上游替身只存在于测试子进程，不发布到正常 API 逻辑。
- 后台定位平台资格 / 隐私配置和微信运动真实授权继续按真机验证，不把测试密文当作微信实测结果。


## 历史部署：英语学习与伙伴（2026-10-03）

- 当时发布点`/opt/campus-api/releases/20261003-055438`，21个业务服务。发布前备份`/www/backup/campus-api/20261003-055438`；原网站目录与Nginx路径保留。当前发布点见文首。
- 本机编辑前备份 `C:/Users/Administrator/Downloads/campus-before-english-upgrade-20261003-045516.tar.gz`；发布包仅含 server、admin-web，不含维护凭证、微信源码或依赖目录。
- 新业务目录 `/opt/campus-api/current/server/services/english_learning`。词库、题目、解析、商城和来源文件在 `server/data/english/`；人物素材在 `server/public/english/companions/`，随代码发布。
- 同域人物地址 `/campus-api/english-assets/companions/…`；发音、试卷与听力通过 `/campus-api/api/english/audio`、`resource` 获取。持久下载缓存在 `/www/campus-data/uploads/english-cache/`，每日上传目录备份会包含它。
- 个人学习 / 打卡 / 复习卡片 / 挑战 / 钱包 / 装备仍在 MariaDB `campus_app.app_documents`，以 `english_*` 集合区分；具体字段和接口见 [英语模块](english.md)。全局模块开关仍为 global_settings。
- 首次建档并发通过英语下一事务 READ COMMITTED 修复；同用户命名锁、行锁、同连接回滚保持。其他服务默认隔离与服务器全局配置未修改。
- 117 项内存、122 项真实 MariaDB 回归和两新账号并发建档均通过。真实 SQL 测试只使用专用隔离库，未在生产库注入学习或榜单样例。
- 该次微信预览主包1,954,982字节、英语分包74,393字节，总包2,462,719字节。历史预览码在`C:/Users/Administrator/Downloads/campus-english-preview-20261003.png`；最新结果见文首，正式发布与手机登录／键盘／发音等仍需实际客户端操作。

新增目录对应关系：

```text
/opt/campus-api/current/server/
├── services/english_learning/index.js      学习、挑战、金币、装扮业务
├── src/english-content.js                  发布内容读取
├── src/english-fsrs.js                     按日复习调度
├── src/english-media.js                    同域媒体来源校验、格式与缓存
├── data/english/                           词题、资料、商城与许可
└── public/english/companions/              人物与配件 PNG / SVG
/www/campus-data/uploads/english-cache/     下载文件缓存，与代码版本分开
/var/lib/mysql/campus_app/                  学习数据实际数据库目录
```

发布后公网核对：health 与数据库正常、21 服务；英语开关为开启，原 running/food/canteen/forum/rider 值保留。原网站、真寻 PNG、发音 MP3、原卷 PDF 返回 200；听力 M4A 缓存为 17,129,758 字节，公网与本机 Range 均返回 206 / audio/mp4。首次完整听力下载探测遇到 50 秒超时，缓存已完整，手机实际播放仍待确认。无身份学习请求返回 401。生产文档发布前后均为 70 条。专用隔离库清理后 0 条，随后测试库及临时权限已删除，临时代码目录与上传压缩包已清理。

## 历史部署：英语与校园任务（2026-10-03 11:07）

2026-10-03 11:07（北京时间）发布 /opt/campus-api/releases/20261003-110753；部署前备份 /www/backup/campus-api/20261003-110752。21个服务和MariaDB健康，www原网站200。发布包仅server/admin-web。英语8352词、326题、8真题（2完整卷+6阅读专项），资料与人物由同域API提供。

隔离数据库英语132项、校园奖励58项通过，测试库与专属权限已删除；未创建生产测试榜单。两卷原听力的公网Range均206，四级实际M4A/audio/mp4、六级MP3/audio/mpeg；缓存分别约17.4MB和25MB。不能仅按文件.mp3扩展名判定格式。
