# 祝福小站：制作、上线与维护

## 当前实现

同学从首页“祝福小站”进入，按“选模板 → 写祝福 → 预览发布”三步制作。从模板库选好模板后直接进入第2步，只需填写收件人与祝福语；标题自动带入，推荐祝福可选。默认自动排版，标题、署名、背景、特效和自由拖动画布收进“更多设置”。已有网站直接进入第2步，保留原模板、排版与已购项目。

图片与视频共用一个背景预览框，选择后切换对应媒体；播放器支持暂停、恢复、失败重试，返回上一步不会重置视频或草稿。第3步自动生成免费网页预览，保留“更新免费预览”和“复制网站预览链接”，长文只显示摘要。发布前选择时长、查看费用明细与余额，再确认上线；广场公示和自定义域名放在折叠的“分享设置”中。完整拆信、蛋糕及组合特效通过浏览器链接体验。

修改内容仍自动同步免费预览，确认前不扣金币；编辑中续期、离开2分钟回收的规则保留。服务器事务保存并立即上线，不为每个用户安装一套依赖或启动一份进程。

**域名状态（2026-10-04）：** EO泛域名回源HTTP、HOST使用加速域名已修正，公网HTTPS创建、读取、修改和删除验证通过，祝福入口已启用；www原网站保留。最新发布版本、验证记录和备份见[运维](operations.md)。

| 内容 | 实现 |
| --- | --- |
| 8类模板 | 生日、祝福信、星空许愿、情书、告白／祝福墙、日常幸运签、轻松恶搞、纪念庆祝 |
| 静态背景 | 14种，含粉彩、日出、四季及4幅动漫风景，全部免费 |
| 动态背景 | 夜晚篝火、星河夜幕2种真实循环视频，各6金币；手机与电脑分别加载竖版、横版 |
| 特效 | 10种；气球、闪光免费；彩纸2、爱心3、烟花5、樱花2、落叶1、飘雪1、星星爆发3、彩带3 |
| 自由排版 | 拆信后的画布可拖动标题、姓名、正文、署名；添加文字、贴纸、本人上传的图片；最多12元素，画布高度500—1600 |
| 交互 | 打开信封；生日7根蜡烛，点击吹灭；星空点亮星光；日常抽签；恶搞按钮躲3次后可正常打开；所有模板可署名或匿名留言 |
| 编辑 | 姓名、文案、排版、静态背景免费；本网站已购背景和特效免费再次使用，新增收费项目只扣一次 |

正文最多1200字，姓名／署名24字、标题40字，附加文本每元素300字。画布保存百分比坐标，网页按实际内容宽度缩放文字，移动端和桌面同一布局。画布不接收HTML、脚本或任意CSS，文本按文本显示。

### 金币与数量

| 正式网站时长 | 基础价格 | 背景／特效 |
| --- | --- | --- |
| 首次2小时体验，每账号一次 | 0金币，随机域名 | 全部免费开放，体验期间修改仍免费 |
| 3天 | 0金币 | 静态背景、气球和闪光免费，其他按选择计费 |
| 7天 | 5金币 | 同上 |
| 15天 | 10金币 | 同上 |
| 1个自然月 | 15金币 | 同上；北京时间月末按末日截取 |

新建网站没有额外创建费，最长1个月；已有网站保留原到期时间和已购项目，不按新规则强制缩短。自定义子域名另加5金币。视频背景和高级特效依旧收费，所有选择都可以先免费预览。例：1个月、星河视频、烟花、自定义域名共`15＋6＋5＋5＝31`金币。首次体验资格只在确认正式创建时写入共享钱包，预览不消耗，删除或到期不会恢复已用资格。

每人最多**同时上线3个**，服务器校验并发请求。创建用请求编号防重，钱包扣款、域名占用、网站保存和金币流水在同连接事务内完成，失败不扣金币。金币与英语、跑步、食堂任务、衣橱共用`english_profiles`和`english_coin_ledger`。

### 免费预览与公示

每个账号同时保留1份临时预览，全部背景与特效可以试看。原生编辑画布即时显示文本、图片和位置；临时网页约每2.5秒读取最新内容，编辑保存采用500毫秒串行合并，避免后发请求被旧请求覆盖。编辑器可见时45秒续期；离开停止续期，2分钟后访问立即失效，30秒清理任务移除临时文档和留言。确认正式发布后在同一事务移除临时站，预览不占3个正式名额。

“公示到祝福广场”默认关闭。打开后，正式上线且有效的网站显示在模块下方的公开列表，每页12项；临时预览、到期和下架网站不进入列表。关闭只是不在广场列出，拿到链接的朋友仍可以查看和留言，不是密码保护的私人站点。公开数据不含用户openid、钱包或管理员身份。

没有配置微信业务域名时，不用无法打开的web-view。小程序原生画布可直接编辑排版；编辑器和展示页顶部使用原生video预览真实循环视频，完整网页特效使用复制的浏览器预览链接。复制、分享后的网址依旧遵守预览有效期。

### 公开网站与到期

默认地址`https://g-随机标识.crbuj.icu/`；自定义如`https://xiaoyu.crbuj.icu/`。名字3—32位，以字母开头，允许小写英文字母、数字、短横线，最后需字母或数字。www、api、love、sqyz等保留；服务器已存在的网站目录也不可占用。

到期或管理员下架的网页/API立即拒绝访问；后台每15分钟清理到期网站、域名和留言。删除本人网站立即失效，不退还金币。图片上传先登记所有者，存在引用的图片保留；无引用且超过24小时的祝福图片清理，草稿图片有24小时保留期。其他模块图片不在清理范围。

2分钟指临时内容访问有效期，不是全部照片立即物理删除。正式网站、临时预览、域名占用、留言和访客计数按各自清理周期回收；无引用照片经过24小时草稿保留期才回收。金币流水、已用首次资格和独立运维备份保留。删除数据库记录可复用空间，不保证MariaDB数据文件立刻缩小。

所有模板支持朋友留言，不要求校园账号；可署名或勾选匿名，匿名只保存“匿名朋友”作为展示名字。每站最多保存40条，每位访客每个北京时间自然日3条，次数独立于40条展示记录，不因旧留言被挤出而重置；网站到期一起清理。按浏览器签名Cookie区分访客，小程序api-client也保存和发送该访客Cookie，避免同一宿舍公网IP的朋友被当成同一人。

### 管理员金币

小程序管理端“祝福网站与金币管理”可查站、下架；超级管理员还可搜索昵称、选定同学，填写1至1000000的整数金币和说明，确认发放。普通审核员不显示发放区，也无服务端发放权限。钱包、金币流水、管理员日志同连接事务提交；请求编号防止重试重复到账，日志写入失败时余额和流水一起回滚。

## 路由与文件关系

| 路径 | 职责与关系 |
| --- | --- |
| miniprogram/packageGifts/pages/index | 高级效果模板库、钱包、已创建网站、祝福广场 |
| miniprogram/packageGifts/pages/editor | 三步制作、折叠高级设置、图片／视频统一预览、计价、可选拖动画布、免费同步预览、确认发布 |
| miniprogram/packageGifts/pages/view | 小程序公开展示、生日互动、链接复制、微信分享；完整版特效在浏览器网页运行 |
| miniprogram/packageGifts/pages/admin | 查站、下架、超级管理员选人分发金币；首页管理端模块开关控制是否开放 |
| miniprogram/utils/gifts-api.ts | 通过唯一api-client调用gift_sites |
| miniprogram/packageGifts/utils/layout.ts | 默认画布与元素文本映射 |
| miniprogram/packageGifts/utils/video.ts | 两页共用原生视频，源／节点事件校验、播放、暂停、重试与离页停止 |
| server/services/gift_sites/index.js | 金币／域名事务、本人权限、发布、编辑、删除、到期和图片清理 |
| server/src/campus-wallet.js | 英语、网站共用钱包加载与同用户锁 |
| server/src/gift-layout.js | 服务端画布校验与本人图片路径限制 |
| server/src/gift-web.js | HTML、安全文本嵌入、静态素材、公开详情与留言路由 |
| server/public/gifts | 网页交互、背景、开源特效、许可证；不进入微信主包 |
| server/data/gifts/catalog.json | 模板、推荐语、背景、特效、服务器价格 |
| server/scripts/configure-gift-domain.py | 备份并接入现有泛域名Nginx；现有网站目录优先，保留www和独立站点 |
| server/scripts/test-gift-sites.js | 内存／独立SQL事务、并发、防重、价格、权限、布局、清理回归 |
| scripts/test-gift-web.js | 8模板、2视频背景／4静态风景、交互、移动端溢出、浏览器访客隔离与CSP实际验证 |

数据库集合：`gift_sites`正式网站；`gift_previews`临时内容及续期时间；`gift_domains`正式域名唯一占用；`gift_uploads`图片引用资格；`gift_messages`留言；`gift_message_visitors`访客当前北京时间日期与已用次数，随网站清理。系统清理网站不删除历史金币流水和已用免费资格。预览域名使用保留前缀`p-`，正式随机域名用`g-`，用户自定义名称不可占用这两个前缀。

HTTP：`/gifts/demo/:template`模板预览、`/gifts/:id`网站、`/gift-domain`原始Host识别、`/gift-assets`共享素材、`/api/gifts/:id`公开数据、`/api/gifts/:id/messages`留言。www入口均带`/campus-api`前缀，泛域名入口由现有Nginx代理。站点HTML和数据源站使用no-store，EO需保持动态内容不缓存；不能把DNS泛解析已存在当作回源协议、Host和缓存也已正确。

## 开源调研与选择

检索关键词：`birthday cake CSS interactive Unlicense`、`fireworks-js canvas-confetti`、`Three.js volumetric fire MIT`、`Vanta clouds halo`、`starrysky meteors`、`interact.js drag resize`、`GrapesJS editor storage autosave`、`lodash debounce cancel flush`、`anime landscape background CC0`。

| 实际复用 | 版本／许可 | 取舍 |
| --- | --- | --- |
| [fireworks-js](https://github.com/crashmax-dev/fireworks-js) | 2.10.8，MIT | 直接采用浏览器发行版，烟花按需启动，隐藏页面停止 |
| [canvas-confetti](https://github.com/catdad/canvas-confetti) | 1.9.4，ISC | 彩纸、星星、彩带；允许其同源blob工作线程 |
| [birthday-cake](https://github.com/ololx/birthday-cake) | Unlicense | 保留蛋糕、蜡烛和火焰CSS，隔离舞台尺寸；交互接入现有模板 |
| [Morning Sunrise](https://opengameart.org/content/morning-sunrise-background) | quantumelle，CC0 | 日出风景背景，不替换原小程序图片 |

候选[interact.js](https://github.com/taye/interact.js)适用于浏览器DOM拖动；小程序采用微信原生movable-area，减少DOM适配层。Video.js、Vanta、Three.js、Starrysky均作为候选评估：短视频背景只需原生video，不引入播放器或用粒子模拟动态风景。本次打开SkillHub首页未返回可核对的技能内容；使用已安装imagegen技能，未安装社区脚本。

三步制作调研关键词：`WeChat miniprogram native form video steps`、`TDesign miniprogram steps`、`miniprogram-component-plus video-swiper`。复用[微信官方原生视频示例](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/miniprogram/packageComponent/pages/media/video/video.wxml)的组件方式及项目现有视频生命周期、计价和串行预览同步；步骤只需三个本地状态，不引入整套UI依赖。候选[TDesign](https://github.com/Tencent/tdesign-miniprogram)更适合整体组件库统一；[video-swiper](https://github.com/wechat-miniprogram/miniprogram-component-plus/blob/master/docs/video-swiper.md)要求多视频轮播，仓库已归档，不适合此处单一背景预览。

[GrapesJS](https://github.com/GrapesJS/grapesjs)提供成熟的DOM网站编辑器和存储管理；当前只编辑既有祝福模板和12个受限元素，采用原生画布与共享JSON可覆盖需求，未引入整套DOM框架或任意HTML。参考[Lodash](https://github.com/lodash/lodash)合并延迟调用的行为，串行提交保留最后一次编辑；这里只有一处同步，不新增依赖。

现用特效许可证位于`server/public/gifts/vendor`，视频来源见`server/public/gifts/videos/SOURCES.md`。减少动态设置及页面隐藏释放视频；自动播放受限时保持封面，点击开信尝试播放。实体设备播放能力仍需真机验证。

### 静态风景与真正的视频背景

用户最新确认：风景画面本身运动才归动态，静态插画叠少量粒子不能当作收费动态。草原星夜、森林月夜、晴空花野、极光海岸归入免费静态背景；原ID保留且不再加载WebGL／Starrysky。替换后无引用的12个引擎文件先备份到Downloads/campus-gift-retired-webgl-20261004并核对SHA后移出，减少704,290字节。

动态区为video-fire「夜晚篝火」、video-stars「星河夜幕」，各6金币，首次体验免费。2场景各有手机720×1280、电脑1280×720视频和对应JPEG封面，静音循环，4个共享MP4共5,655,460字节；模板示例默认真实视频。检索关键词：`free stock night campfire video license`、`Mixkit stars Free License`、`HTML video muted playsinline background`、`video.js background video`。素材来自Pexels与Mixkit各作品许可核对，FFmpeg开源转码，未购买素材或复制无许可动漫视频。

正文信封、信纸与画布使用低透明度面板和轻量玻璃模糊；蛋糕、蜡烛、封蜡、照片及留言便签保留实体外观。网页按视口只选择一个视频源，后台／减少动态／到期释放媒体，恢复或旋转重新选源，拒绝播放或失败保留封面，不能把封面当作已播放证据。视频每次新访问有流量及解码耗电；已下载的循环不会每圈重新创建用户副本。

小程序制作页用同一个框显示静态图片或实际原生视频，加载／暂停／失败状态明确；不把封面视为视频已播放。制作页保留更新免费预览与复制网站预览链接，完整网页效果在浏览器体验。模板列表直接复制完整模板网页链接；发布后的微信公开展示与分享入口保留。自由拖动画布作为可选高级编辑功能保留。

专项`node scripts/test-gift-landscapes.js`验证4静态风景×320／390／1440的实际像素、构图与无动画引擎；`node scripts/test-gift-videos.js`验证2视频实际解码播放、切换构图、循环、资源释放与回退。来源、大小及生成静态图见[gift-landscape-assets.md](gift-landscape-assets.md)。

## 存储复用与校园动态的边界

祝福站共用Node服务、模板和视频，只在数据库保存文案、布局及素材编号。共享视频不会按用户重复保存，也不属于到期用户内容；访问仍有下载流量、解码耗电和手机自动播放限制。单文件上传上限10MB，当前未设每用户累计字节配额，24小时未引用图片保留期内仍可能暂时增长。

校园动态可以沿用共用服务、数据库和图片目录的架构，不能直接套用祝福2分钟／到期删除策略：论坛帖子有长期保存、举报及共享图片引用。当前论坛删除多为status标记；cleanDeletedPosts仍查询isDeleted，cleanOrphanImages未完成实际回收。用户上传后移除草稿缩略图也不会同步删文件。后续论坛清理需要按真实删除字段、全部引用和保留期限单独实现，本次没有更改论坛业务或删除其图片。

## 全页微信分享

`miniprogram/utils/page-share.ts`包装全部67个已注册页面，开启好友和朋友圈菜单。公开内容只保留白名单路由参数；答题记录、聊天、订单、管理等私人页面分享对应公开入口。朋友圈单页模式先显示`components/share-intro`，跳过原私密生命周期请求；进入完整小程序后再使用正常登录。浏览器网站链接可直接复制发给朋友。

## 验证和真实边界

2026-10-06三步制作：`npm run check`、全量`npm test`、微信官方55个WXML／63个WXSS编译通过；祝福服务内存215项、前端148项回归通过，覆盖默认自动布局、步骤返回保留草稿、模板切换保留自写文案与自选媒体、预览失败重试、图片失败重试、计价明细、确认前不扣币、已有网站排版、视频切换／暂停／释放与同步发布顺序。320×568及390×844共16个浏览器转换布局没有脚本错误、断图或横向溢出，见[布局记录](ui-preview/gift-editor/layout-report.json)。最新[微信官方预览](ui-preview/gift-editor/preview-result.json)与浏览器转换均不代表手机原生播放、键盘／拖动或正式发布。本次仅改前端，未重启服务器。

对应回归覆盖时长价格、首次权益、预览续期与到期、并发／防重、钱包事务回滚、金币发放、公开列表过滤、本人权限、匿名留言和图片清理。8种模板、2种视频及4种静态风景、自由画布、实时内容同步及移动端溢出由浏览器检查；结果在`docs/ui-preview/gifts`。最终通过项和数量见`upgrade-checklist.md`，不能使用旧版本的53／62项数字代表新功能已验证。全67页分享结构和隐私参数也有专项回归。

服务器发布点、官方微信预览、原生模拟器与EO实际状态以`operations.md`和`upgrade-checklist.md`为准。原生模拟器、浏览器转换和二维码成功均不能替代安卓真实拖动、微信好友／朋友圈实际转发、弱机型表现或微信正式发布。
