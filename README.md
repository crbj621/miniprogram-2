# 校园小程序 · 自建服务器版

微信开发者工具打开本目录的 `project.config.json`。页面与分包以 `miniprogram/app.json` 为准，当前 67 页。前端只连接自建服务器，不使用微信云回退。

## 目录

| 目录 | 用途 |
| --- | --- |
| miniprogram/ | 同学端、小程序管理端、页面、组件、图片、请求客户端 |
| server/ | Express API、22 个业务服务、MariaDB 数据层、部署与回归工具 |
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
- [食堂评分、评论、投稿补图与争议处理](docs/canteen.md)
- [四六级学习、挑战、商城与接口](docs/english.md)
- [祝福网站、自由排版、金币与全页分享](docs/gift-sites.md)
- [本次升级验收清单](docs/upgrade-checklist.md)
- [未来 Android / iOS 方案](docs/mobile-plan.md)
- [逐文件职责清单](docs/file-map.csv)
- [GitHub新手设置与维护](docs/github-guide.md)
- [代码公开审查与素材许可边界](docs/public-release-audit.md)
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

微信工具点击编译查看页面。管理员账号和密码在维护目录的账号说明中。当前验证与预览状态见 [界面规范](docs/ui.md)；安卓实体键盘、真实微信登录、手机定位和正式发布仍需实际客户端验证。界面图片保留原件，质量评分仅作建议。

祝福网站支持免费实时预览、可拖画布、署名／匿名留言、公示广场和超级管理员发放金币。首次2小时全特效免费，正式保留3天／7天／15天／1个月；背景与高级特效另计。EO泛域名回源已验证，原网站保留；当前部署和检查结果见[升级验收](docs/upgrade-checklist.md)。

## GitHub 维护

私有仓库：[crbj621/miniprogram-2](https://github.com/crbj621/miniprogram-2)，登录有访问权限的GitHub账号后查看。

自动检查与依赖更新配置见[GitHub维护指南](docs/github-guide.md)。当前尚未给完整项目声明开源许可；程序、真题和原图片的公开范围见[公开审查](docs/public-release-audit.md)。

仓库保存小程序、后端、网页后台、原图片、依赖锁文件、检查脚本和技术文档。`node_modules/`、Python缓存、真实`.env`和`maintenance/账号与连接/`仅保留本机，不提交账号或密钥。

GitHub是源码备份，不包含服务器实时数据库和用户上传图片；这些继续由服务器备份，见[运维说明](docs/operations.md)。换电脑后先安装依赖，运行配置以`server/.env.example`为模板另行填写，本机维护凭证需要自己单独保留。

以后在本项目目录更新仓库：

```powershell
git status
git add -A
git commit -m "说明这次修改"
git push
```

提交后打开GitHub仓库的“Code”页即可查看；“Code → Download ZIP”可下载当前源码。推送代码不会自动部署服务器或正式发布微信小程序。
