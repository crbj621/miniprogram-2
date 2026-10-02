# 校园小程序 · 自建服务器版

微信开发者工具打开本目录的 `project.config.json`。页面与分包以 `miniprogram/app.json` 为准，当前 54 页。前端只连接自建服务器，不使用微信云回退。

## 目录

| 目录 | 用途 |
| --- | --- |
| miniprogram/ | 同学端、小程序管理端、页面、组件、图片、请求客户端 |
| server/ | Express API、20 个业务服务、MariaDB 数据层、部署与回归工具 |
| admin-web/ | 访问同一 API 的网页管理后台 |
| scripts/ | 本机编译、回归、SSH 与文件清单生成 |
| typings/ | 微信 TypeScript 类型声明 |
| docs/ | 当前技术说明、素材来源、当前布局预览 |
| maintenance/账号与连接/ | 用户要求保留的明文账号、微信密钥、SSH 私钥与配置副本 |
| miniapp/、i18n/、project.miniapp.json | 未来 Donut App 的占位配置，未验证构建 |

`node_modules/` 为安装依赖，不手动编辑。微信上传目录只有 `miniprogram/`。

## 技术文档

- [架构、文件与接口关系](docs/architecture.md)
- [业务与算法规则](docs/business-rules.md)
- [服务器连接、凭证与部署](docs/operations.md)
- [当前界面规范](docs/ui.md)
- [未来 Android / iOS 方案](docs/mobile-plan.md)
- [逐文件职责清单](docs/file-map.csv)
- [AI 修改入口](AI_GUIDE.md)

## 使用与检查

```powershell
npm ci
npm run check
npm test
npm run check:wxml
npm run check:wxss
```

服务器依赖独立安装：`npm --prefix server ci`。检查工具需本机微信开发者工具；其他电脑可指定 `WXML_COMPILER` / `WXSS_COMPILER`。

微信工具点击编译查看页面。管理员账号和密码在维护目录的账号说明中。官方预览已成功；真实微信登录、手机定位和正式发布仍需实际客户端验证。界面图片保留原件，质量评分仅作建议。
