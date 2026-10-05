# 英语与伙伴界面：浏览器转换样例

这些图片是当前 WXML/WXSS 在浏览器中的转换样例，**不是微信真机或微信开发者工具截图**。每张图片带有同样的标记。

执行 `node scripts/render-english-preview.js` 可重建 HTML、PNG 与 `english-layout-report.json`。脚本复用本机 Playwright 和系统 Edge，不向业务接口发请求，也不新增业务依赖。

## 来源与场景

- 首页：`miniprogram/pages/portal`，使用长昵称、每日文案和真寻基础人物。
- 衣橱：`miniprogram/packageProfile/pages/wardrobe`，男生学院套装、女生古风与男生校园透明服装层、真寻喂食反馈，以及热力榜和空榜。
- 单词首页：`miniprogram/packageEnglish/pages/index`，四分区底栏、双列目标、新词／复习、收起或展开计划与个人工具，待生效目标明确标注；新增已打卡后的1–100个新词／旧词加练输入、剩余词量与实际额外数量。
- 真题、挑战、榜单：三个分区各有当前等级和固定底栏；真题使用真实完整卷列表，排名是展示数据。
- 学习卡：`miniprogram/packageEnglish/pages/study`，作答前4个选项，答后完整释义、例句与译文，以及固定下一词按钮；新增加练答对状态，切词复位 enter、正确 correct、错词 retry。
- 整卷作答：`miniprogram/packageEnglish/pages/attempt`，不含听力的写作、阅读、翻译共32题，展示真实写作题、阅读选项、32个导航题号及2021年6月六级原卷图表作文。作答状态是样例，没有新建服务器尝试。
- 人物与配件：直接加载 `server/public/english/companions` 中的本地PNG，原基础人物未替换；图表加载 `server/public/english/exams` 中的原卷图片。
- 商品名称和价格来自 `server/data/english/shop.json`；金币、进度、账号和学习内容使用明确的静态展示数据，不代表真实用户状态。

20种场景各有320×568与390×844两种视口，共40个布局检查；新增 home-extra 和 study-extra-correct。带`-full`的图片展示完整长页，`-bottom`展示滚至页末时固定按钮的位置；对应HTML也放在本目录，场景以 `english-layout-report.json` 的reports为准。

## 转换边界

| 当前浏览器转换 | 微信原生仍需确认 |
| --- | --- |
| 按 750rpx 设计宽度缩放实际 WXSS；递归展开原样式导入 | 微信文字度量、系统字体、设备像素比与安全区 |
| 注入 style:v2 的按钮默认 184px 宽、左右自动外边距；页面原规则继续覆盖 | 微信原生按钮、按压反馈及辅助功能语义 |
| 渲染 WXML 条件、列表、属性和已有自定义组件；组件样式使用浏览器 `@scope` 隔离 | 微信组件样式隔离、原生滚动与刷新控件、事件分发 |
| 图片按照原 `aspectFit`/`aspectFill` 绘制 | 微信图片解码、网络加载与失败恢复 |
| 使用普通 HTML 数字输入框；减少动态模式下捕获静态喂食反馈 | 手机数字键盘、候选栏、光标和页面避让；真实喂食时序 |

转换器仅覆盖这批模板用到的标签和表达式，不是完整小程序运行器；导航栏和状态栏未模拟。所有原生组件行为、真实登录、服务端请求以及真机点击仍须单独验证。

## 本次复查

最新报告40项的断图、脚本错误与横向溢出均为0，两种宽度下页面未被内容撑开。普通学习卡和阅读卡均为4个选项，学习答后隐藏旧选项并显示全部释义；加练输入与实际额外数量、答对状态各有两种视口样例。不含听力整卷导航包含32个题号，图表作文保留原图与文字说明。学习下一词栏、试卷操作栏及四分区导航在两种视口下都有对应固定位置记录。首页长昵称自然折行，衣橱在320px切换为纵排角色卡；新增服装层和热力榜覆盖有记录与空榜状态。超出卡片的流动装饰仍由 `overflow:hidden` 裁切，报告单列为clippedDecorations。

这些检查验证页面结构、图表显示、服装叠加与留白；点击后的滚动复位、自动读音取消与离页清理、三部分草稿及32题交卷另有行为回归。加练前端回归覆盖按 home.extraStudy.activeModes 优先恢复原轮次，恢复不受新增数量和剩余词量阻断；英语服务内存186项与隔离MariaDB193项覆盖实际数量、榜单、错词复现和重复请求，不重复发放每日奖励，保留原打卡时间。

微信开发者工具[原生本地fixture](english-extra/native-verification.json)分别成功播放正确0.28秒与错误0.24秒提示音并正常结束；地图准备16、运行18、暂停／恢复18、结束16。学习页采用独立的词音与提示音上下文，提示音结束或失败后才续播拼写答后词音；切词／隐藏停止并解除旧监听，卸载销毁，迟到回调检查版本和页面状态。fixture跳过业务生命周期，仅验证原生本地音频与地图状态，未请求GPS、登录、学习接口或奖励写入。

2026-10-04[微信官方预览](加练与跑步微信预览结果.json)成功，主包1,984,620字节、英语分包133,756字节、总包2,648,771字节；二维码 C:/Users/Administrator/Downloads/campus-extra-preview-20261004.png。浏览器样例与原生fixture均不能确认手机实际听音、音频网络、微信原生输入、真实登录、GPS／锁屏运动与交卷，也不代表正式发布。

## 开源调研

检索词：`wechat-miniprogram miniprogram-simulate`、`microsoft playwright browser screenshot`。参考[微信 miniprogram-simulate](https://github.com/wechat-miniprogram/miniprogram-simulate)的 DOM 模拟边界；它面向组件测试且内置组件只做普通渲染。本次复用[Playwright 截图](https://github.com/microsoft/playwright/blob/main/docs/src/screenshots.md)进行截图，保留精简模板转换器，不新增完整运行时依赖。

提示音检索 `miniprogram-demo createInnerAudioContext audio`，参考[微信官方音频示例](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/miniprogram/packageAPI/pages/media/audio/audio.js)，使用原生API、项目既有生命周期与原创本地PCM WAV。
