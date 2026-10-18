# CiteMind GitHub Pages 发布说明

此发布包已为 GitHub 账号 xf-png 准备，尚未上传到 GitHub，也没有创建新的公网地址。建议仓库名为 citemind，实际仓库名以授权后的检查或你的选择为准。

## 通过授权继续发布

在 Codex 中安装并授权 GitHub 连接后，可继续创建仓库、推送本发布包并启用 Pages。不要在聊天或代码中提供账号密码。本包不包含登录凭据、原 Sites 项目标识或用户导入资料。

GitHub Free 的 Pages 使用公开仓库，因此此方案会公开这些项目源码。应用的访客资料仍保存在访客自己的浏览器，不会随发布上传到仓库。

## 手动发布步骤

1. 登录 xf-png，创建公开仓库 citemind；若仓库已存在，先检查内容，选择新的仓库名，避免覆盖其他项目。
2. 解压本包，将完整文件结构提交到 main 分支。保留 .github/workflows/deploy-pages.yml 和 dist 目录，不能只上传 ZIP 文件本身。
3. 打开仓库 Settings → Pages，在 Build and deployment 的 Source 中选择 GitHub Actions。
4. 打开 Actions → Deploy CiteMind to GitHub Pages。首轮若因尚未启用 Pages 而失败，在完成上一步后手动选择 Run workflow。
5. 工作流先运行 24 项本地模块检查，成功后上传 dist 并部署。最终地址以工作流环境或 Settings → Pages 显示的实际结果为准。
6. 使用未登录浏览器核对首页、示例提问、原文引用、PDF 导入、AI 模型加载以及保存恢复，确认通过后再将链接写入简历。

如果使用建议仓库名，预计地址格式为 https://xf-png.github.io/citemind/ 。这是待发布地址，不代表已经可以访问；改名后路径也会变化。

## 这个方案解决什么

部署后使用 GitHub Pages 的托管域名，不再依赖原来的 chatgpt.site 入口。不过实际网络可达性仍需验证，不能保证所有网络都不会拦截。首次 PDF 和 AI 仍需访问 jsDelivr 与 Hugging Face，首页可打开也不等于外部组件已加载成功。

## 目录

- dist：九个实际网站文件，Pages 只发布这个目录。
- tests：16 项检索与 8 项存储检查，无需安装 npm 依赖。
- .github/workflows/deploy-pages.yml：测试与发布流程。
- docs：项目使用手册。
- tools/serve.py 与启动应用.cmd：本地体验入口，需要 Python 3。

## 官方依据

https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
