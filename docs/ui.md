# 当前界面规范与组件关系

## 用户确定的风格

可爱柔和页面和卡片背景，科技感按钮与美感光效，原图片保留。首页与四个模块主页面、小程序管理端统一；网页后台沿用现有界面。

- 首页等宽两列入口；头像圆形。utils/portal-daily.ts 提供 14 组原创文案、7 个颜色轮换；按北京时间日期更新，同一天稳定、相邻日不同，不依赖外部 API。
- 校园跑全屏地图、760rpx 浅色半透明准备卡片，按屏高限制，内区可滚动。开始收起、暂停展开、继续收起；独立运动按钮保留。
- 跑步准备卡片新增“今日微信运动”日步数、同步时间、同步按钮和授权失败提示；运动中隐藏。传感器估计步数与日步数分开；有步数估距时标明仅个人记录。
- 校园动态分区在栏下直接展开，完整单选列表、选中标记、内部滚动；选择、点击外部或离开时收起。读取中禁用，失败重试。
- 三种食堂随机规则显示依据；评分、空状态与投稿审核使用实际数据，不伪造人数。
- 管理首页保留常用四入口与折叠事务；开关读取、禁用权限和保存状态保持完整。
- 按钮有渐变、光晕、光泽扫过和按压反馈；减少动态设置下关闭循环，不遮挡文字与点击。

## 实现位置

| 文件 / 组件 | 职责 |
| --- | --- |
| styles/campus-ui.wxss / admin-ui.wxss | 同学端和管理端基础间距、浅色主题 |
| styles/uiverse.wxss | 原码适配卡片、斜向按钮、脉冲加载 |
| styles/tech-ui.wxss | 全页面操作控件、输入、大号透明运动卡片 |
| components/tech-search | Lakshay-art 紫粉旋转搜索外壳；slot 保留原 input 与事件 |
| components/tech-switch | 17 处开关，父页面控制 checked / disabled，只发送 change |
| components/tech-loader | 主要列表的沿边流动加载 |
| components/mahiro-scroll | 12 页真寻下拉刷新；蓄力、刷新、成功、失败、防重与销毁保护 |
| components/campus-sticker / run-tabbar | 原生可爱贴纸、跑步导航 |

[Uiverse 来源与许可](vendor/uiverse/README.md)；[刷新素材](assets/README.md)。原 hyj.png、hyjj.png、login-bg.png 保留在 miniprogram/images，两个登录页仍用本地原背景；前两张目前没有页面引用，但用户明确要求保留。

## 验证与当前预览

TypeScript、54 页结构、12 组本机回归、60 个 WXML/脚本与 65 个 WXSS 通过；微信官方实际预览成功，主包约 1.8 MB、总包约 2.2 MB。代码质量评分仅作建议，不为 1.5 MB 或单图 200 KB 建议牺牲原图。

375 宽核对主页面、圆形头像、今日 / 次日主题、直接下拉分区；320 短屏核对菜单宽度、运动卡片与按钮。以下是实际 WXML/WXSS 的浏览器转换预览，展示数据为样例，地图为示意，未写入线上数据库。

[首页](ui-preview/portal.png) · [校园跑](ui-preview/run.png) · [点餐](ui-preview/food.png) · [食堂评分](ui-preview/canteen.png) · [校园动态](ui-preview/forum.png) · [直接下拉](ui-preview/forum-dropdown.png) · [管理首页](ui-preview/admin.png) · [开关](ui-preview/module-settings.png) · [登录原图](ui-preview/login.png) · [跑步短屏](ui-preview/run-320x568.png)

微信原生手势与手机 GPS 仍需真机验证。官方预览不等于发布。

上述校园跑布局截图拍于独立日步数卡片加入前；最新代码与官方预览已包含该卡片，原地图、背景图片与运动控件位置保留。
