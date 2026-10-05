# GitHub 新手维护指南

仓库：[crbj621/miniprogram-2](https://github.com/crbj621/miniprogram-2)。当前默认分支是 master；master 和 main 都只是分支名称，不需要为了“规范”重命名。

## 先理解这几个词

| 名称 | 在本项目中是什么意思 |
| --- | --- |
| Git | 在电脑上记录文件修改和历史的工具 |
| GitHub / Repository | 存放项目历史的云端仓库 |
| Clone | 把仓库和历史下载到另一台电脑 |
| Commit | 保存一批修改，附一句说明；此时仍在本机 |
| Push / Pull | 把提交上传 / 取回别人或网页上的修改 |
| Branch | 为一项功能建立独立修改线路 |
| Pull request / PR | 请求把一个分支的修改合入主分支；先看改了什么和测试结果 |
| Merge | 合并已经检查过的修改 |
| Issue | 记录问题、需求和复现步骤 |
| Actions / CI | 每次上传后自动执行检查；红色失败需要打开日志查原因 |
| Tag / Release | 给某个稳定提交标记版本和发布说明；不等于部署服务器或发布微信小程序 |

## 本次补齐的维护基础

- `.github/workflows/ci.yml`：推送 master、提交 PR 或手动触发时，扫描完整提交历史，安装锁定依赖，检查 TypeScript/路由、HTTP 安全和业务回归，再检查 npm 漏洞。使用 Node.js 24 和 GitHub 官方 Actions，固定 Actions 提交号和 Gitleaks 下载校验值。
- `.github/dependabot.yml`：每周检查前端检查工具、服务器依赖和 Actions，创建更新提案。不会自动合并、部署或扣金币。
- `.github/ISSUE_TEMPLATE/bug_report.yml`：要求反馈者填写复现步骤、设备和报错。
- `SECURITY.md`：说明漏洞应该通过私下渠道报告。
- 根目录和 server 的 package-lock.json：复现依赖版本；新电脑使用 npm ci。
- `.gitignore`：真实环境文件、维护凭证、私钥、依赖与缓存留在本机。

CI 不要求生产密码，也不连接生产数据库。WXML/WXSS 的官方编译器和安卓/iPhone真机验收仍在本机进行。现有 npm test 默认使用内存回归；隔离 MariaDB 并发测试需要单独按运维流程执行。

GitHub 的 Security 页面查看 Dependabot alerts；自动安全修复只会提出 PR。是否成功执行看 Actions 的真实结果，不以“添加了配置文件”当作已经通过。

## 新手先设置什么

| 位置 | 建议 | 为什么 |
| --- | --- | --- |
| 头像 → Settings → Password and authentication | 开启两步验证或 Passkey，保留恢复码 | 防止账号被接管；需要本人完成 |
| 头像 → Settings → Emails | 开启邮箱隐私，用 noreply 邮箱提交 | 新提交不公开个人邮箱；不会修改旧提交的作者信息 |
| 仓库 Settings → Actions → General | 默认只读权限；关闭 Actions 创建/批准 PR | 本项目检查不需要写仓库权限 |
| 仓库 Security → Dependabot alerts | 开启并处理真实告警 | 自动通知依赖漏洞 |
| 仓库 Actions | 检查 Project checks 是否绿色 | 推送成功只表示文件上传成功 |
| 仓库 Settings → Collaborators | 只给实际合作者权限 | 同学使用小程序不需要加入源码仓库 |
| 仓库 Settings → General | 默认保留 Issues；多人合作时可选合并后自动删除功能分支 | 问题记录和分支管理更清楚 |
| 仓库 Settings → Pages | 当前无需开启 | Pages 不能运行本项目 Node.js/MariaDB 后端 |

公开之后还可以免费启用 CodeQL、Secret scanning / Push protection、Private vulnerability reporting 和主分支保护。对应入口通常在 Settings → Advanced Security 以及 Settings → Rules / Branches；以账号可用界面为准。GitHub Free 的部分安全和分支保护功能仅对公开仓库可用，当前私有仓库不能把缺少的入口当成配置错误。

主分支保护建议：要求通过 `checks`、禁止强制推送和删除主分支。一个人开发时不要强制“另一位审核者批准”，否则自己的 PR 无法自行批准。未获得部署授权时不要创建自动部署流程，不把服务器 root 私钥放进 CI。

## 不想先学命令行

可以使用免费的 [GitHub Desktop](https://desktop.github.com/)。安装后登录 crbj621，选择 File → Add Local Repository，把当前项目文件夹加进去；已经有本地 Git 仓库，不要重复创建。

日常操作：Fetch origin → 检查 Changes → 填写 Summary → Commit to 当前分支 → Push origin。点击 History 可以检查每次修改。复制 ZIP 只能获得当前文件，Clone 才包含提交历史。

## 每次修改的最小流程

先查看状态和实际差异；有未保存的修改时不要切分支或强行拉取。

```powershell
git status
git diff
git pull --ff-only
git switch -c codex/具体功能名称
```

修改之后：

```powershell
npm run check
npm run test:security
npm test
git diff
git add 指定文件或目录
git diff --cached
git commit -m "说明本次修改及原因"
git push -u origin 当前功能分支名称
```

再到 GitHub 创建 PR，查看 Files changed 和 Actions；检查通过后合并。以上中文占位需要替换成实际名称。小修改也可以直接提交 master，但多人或重要改动建议走分支和 PR。

推送被拒绝时先看报错；不要直接用 push --force。已经上传的错误提交通常用 git revert 生成反向提交保留历史。已泄露的凭证需要更换，后续删文件不能清除旧提交。

## 本项目公开之前

先阅读 [公开审查](public-release-audit.md)。代码与素材分开确认许可；尚未授权的图片、真题和个人运维资料不能由一个 MIT 文件自动变成可再分发内容。

完成来源、许可证和内容筛选之后，在 Settings → General → Danger Zone → Change repository visibility 选择 Public。公开会同时开放提交历史及 Actions 日志；切回 Private 不能收回已经被别人复制的内容。

## 官方资料

- [GitHub Desktop 入门](https://docs.github.com/en/desktop/overview/creating-your-first-repository-using-github-desktop)
- [GitHub 仓库安全设置](https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository)
- [主分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [安全使用 Actions](https://docs.github.com/en/actions/reference/security/secure-use)
- [修改仓库可见性](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
