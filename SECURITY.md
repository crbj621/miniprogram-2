# 安全问题反馈

本项目仍在开发，当前支持默认分支的最新版本。发现漏洞请不要在公开 Issue 中提交可用密码、密钥、真实用户记录或针对线上服务的攻击步骤。

仓库公开后，维护者应在 Settings → Advanced Security 中开启 Private vulnerability reporting；报告者通过 Security → Advisories → Report a vulnerability 私下提交。私有仓库或该入口尚未开放时，通过现有私下联系方式通知维护者。

请说明源码提交号、受影响接口、在隔离测试环境中的复现方法和影响范围。不要对真实用户或生产数据库进行破坏性验证。

真实环境配置和维护凭证保留本机及服务器，Git 仓库只保存配置模板。上传检查与自动测试不等于已部署修复；部署状态以 docs/operations.md 为准。
