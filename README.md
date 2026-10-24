# 测测你适合哪部 Gal

闹游戏荒的时候用的：答 12 道题、勾一下雷点，从 VNDB 的高分作品里抽 3 部推荐给你，并说明为什么推荐。

网站：https://gal.scurra.top/

纯静态网站，没有后端。`site/` 文件夹就是整个网站，推送到 `main` 后由 GitHub Actions 自动部署到 GitHub Pages。

域名由 Cloudflare 管理：`gal` 指向 Cloudflare Pages 项目 `gal-quiz-edge.pages.dev`，并在该项目绑定自定义域 `gal.scurra.top`。Cloudflare 提供 HTTPS 和边缘缓存，固定通过有效 HTTPS 连接读取 GitHub Pages 的静态文件。GitHub Pages 保留原生地址 `https://beikanwo.github.io/gal-quiz/`，Custom domain 必须留空，避免回源重定向循环。

加速入口的代码是 `cloudflare/worker.mjs`，以 Pages 高级模式的 `_worker.js` 部署；只接受固定文件的 GET/HEAD 请求，不转发 Cookie 或认证信息。边缘缓存 5 分钟，浏览器缓存 1 分钟，支持 ETag 复用。日常网页更新仍提交 `site/` 并推送到 `main`，不需要重新上传 Cloudflare 项目；边缘缓存到期后会获取新版本。

首页并行预加载模块、问卷和片库。小问卷就绪后即可开始答题，片库在后台下载；准备完毕后只更新当前题目的数量提示，不重置题号和答案。恢复推荐结果、想玩清单时仍等待片库，确保外链返回不会覆盖原记录。

只有修改加速代码时，才运行 `./scripts/package-edge.ps1`，把生成的 `design/gal-quiz-edge.zip` 上传到 Cloudflare 的 `gal-quiz-edge` 项目，选择生产部署。部署压缩包不进 Git。

搜索用的正式网址、网页简介在 `site/index.html`，抓取规则和站点地图分别在 `site/robots.txt`、`site/sitemap.xml`。换域名时需要一起更新；搜索引擎的站点验证和收录提交需单独在相应站长后台完成。

## 数据

作品数据来自 [VNDB](https://vndb.org/)，遵循 [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/)。本站不提供任何资源下载，只链接到 VNDB 和 Bangumi 的作品页。

重新生成数据（需要 Node 24）：

```bash
node scripts/fetch-vndb.mjs      # 从 VNDB API 抓作品和发行版，约 10 分钟，支持断点续抓
node scripts/resolve-tags.mjs    # 把问卷里的标签名解析成 VNDB 标签 ID
node scripts/build-data.mjs      # 生成 site/data/vns.json 和 site/data/quiz.json
```

本地预览：

```bash
node scripts/serve.mjs
```

然后打开 http://localhost:8080 。

检查推荐结果：`node scripts/simulate.mjs`，结果写到 `data/test-runs.md`。

题目、标签和权重都在 `config/questions.json`，打分规则见 `CLAUDE.md`。
