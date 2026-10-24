# 测测你适合哪部 Gal

闹游戏荒的时候用的：答 12 道题、勾一下雷点，从 VNDB 的高分作品里抽 3 部推荐给你，并说明为什么推荐。

网站：https://gal.scurra.top/

纯静态网站，没有后端。`site/` 文件夹就是整个网站，推送到 `main` 后由 GitHub Actions 自动部署到 GitHub Pages。

域名由 Cloudflare 管理：`gal` 的 CNAME 指向 `beikanwo.github.io`，使用「仅 DNS」模式；GitHub Pages 的 Custom domain 设为 `gal.scurra.top`，证书就绪后开启 Enforce HTTPS。本站使用 Actions 发布，域名配置保存在 Pages 设置中，不需要 `CNAME` 文件。

首次绑定域名时，可手动运行 Actions 中的 `Enable custom-domain HTTPS`：仅对 `gal.scurra.top` 等待证书，最多一小时，签发后开启强制 HTTPS；不是定时任务。若超时，先检查 Pages 的域名诊断，再重新运行。

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
