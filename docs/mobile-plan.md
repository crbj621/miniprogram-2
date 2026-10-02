# Android / iOS 后续方案

当前是原生微信 TS/WXML/WXSS 项目，未生成或验证 APK/IPA。

保留的 project.miniapp.json、miniapp、i18n 是 Donut 预备配置，图标和原生资源仍有占位，不属于微信运行入口。先完成真实微信登录、上传与跑步真机回归，再评估 App。

| 方案 | 当前取舍 |
| --- | --- |
| Donut | 可先验证现有页面的试构建，需核验 SDK、授权、登录与后台定位 |
| [uni-app](https://github.com/dcloudio/uni-app) | 多端长期维护候选，需要把页面改写为 Vue |
| [Flutter](https://github.com/flutter/flutter) | 原生 App 候选，需另写界面，微信端仍单独维护 |
| [Capacitor](https://github.com/ionic-team/capacitor) | 适合已有网页前端，本项目没有可直接打包的学生网页 |

App 与小程序共享服务器、业务规则、图片与模块开关；各端定位、权限、登录、缓存各自适配。移动 OAuth code 与 wx.login code 不是同一登录方式，需独立认证入口和 userId / 外部身份关系。

Android 构建 APK/AAB；iOS 需要 Apple 工具链、开发者账号和签名证书。先验证跑步与评分两模块，不在界面整理时重写全端或安装新框架。
