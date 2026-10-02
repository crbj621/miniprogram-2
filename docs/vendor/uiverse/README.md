# Uiverse 原码与许可

来源：[官方 Galaxy](https://github.com/uiverse-io/galaxy)，核对提交 adbd2adde0a299a3956ea288fb444ec01891ca41。原始 HTML 与完整 MIT 许可保留于本目录，不进入微信上传目录。

| 作者 / 组件 | 实际对应 |
| --- | --- |
| adamgiebl / curly-wombat-58 | styles/uiverse.wxss：斜向填充按钮 |
| adamgiebl / blue-mole-92 | styles/uiverse.wxss：首页与管理四色卡片 |
| adamgiebl / thin-lionfish-5 | styles/uiverse.wxss：次级列表脉冲加载 |
| adamgiebl / helpless-jellyfish-25 | styles/tech-ui.wxss：按钮轮廓与光晕 |
| mayurd8862 / bad-newt-60 | styles/tech-ui.wxss：按钮内外光影和按压 |
| vinodjangid07 / itchy-mule-52 | components/tech-switch：受控发光开关 |
| codebykay101 / dull-shrimp-28 | components/tech-loader：边缘流光与旋转方块 |
| Lakshay-art / curvy-earwig-22 | components/tech-search：用户指定紫粉旋转搜索框 |

上述实现路径相对 miniprogram。网页 span/div 改为 text/view，hover 改为原生 hover-class；保留来源和许可，按可爱页面选择浅色配色。

搜索 slot 保留真实 input 和原事件，宽度自适应，装饰层不遮挡点击或文字。开关只触发 change，父页面控制 checked / disabled；不绕过权限、读取失败与保存状态。循环动画支持减少动态设置。

当前规范见 [界面说明](../../ui.md)。
