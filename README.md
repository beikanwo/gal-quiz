# 测测你适合哪部 Gal

闹游戏荒的时候用的：答 11 道题、勾一下雷点，从 VNDB 的高分作品里抽 3 部推荐给你，并说明为什么推荐。

网站：https://www.scurra.top/

推荐功能是静态网站，`site/` 推送到 `main` 后由 GitHub Actions 部署到 GitHub Pages。匿名反馈由 Cloudflare Worker 接收并写入私有 KV，访客无需登录。

域名由 Cloudflare 管理：`www` 和旧入口 `gal` 都指向 Cloudflare Pages 项目 `gal-quiz-edge.pages.dev`，两个自定义域均绑定在该项目。正式网址为 `https://www.scurra.top/`；旧 `gal.scurra.top` 通过 301 永久跳转到新网址，保留路径和查询参数。Cloudflare 提供 HTTPS 和边缘缓存，固定通过有效 HTTPS 连接读取 GitHub Pages 的静态文件。GitHub Pages 保留原生地址 `https://beikanwo.github.io/gal-quiz/`，Custom domain 必须留空，避免回源重定向循环。

加速入口的代码是 `cloudflare/worker.mjs`，以 Pages 高级模式的 `_worker.js` 部署；静态文件只接受固定文件的 GET/HEAD 请求，不转发 Cookie 或认证信息，匿名反馈另用同源 `POST /api/feedback`。边缘缓存 5 分钟，浏览器缓存 1 分钟，支持 ETag 复用；反馈不缓存。日常网页更新仍提交 `site/` 并推送到 `main`，不需要重新上传 Cloudflare 项目；边缘缓存到期后会获取新版本。

首页并行预加载模块、问卷和片库。小问卷就绪后即可开始答题，片库在后台下载；准备完毕后只更新当前题目的数量提示，不重置题号和答案。恢复推荐结果、想玩清单时仍等待片库，确保外链返回不会覆盖原记录。

只有修改加速代码时，才运行 `./scripts/package-edge.ps1`，把生成的 `design/gal-quiz-edge.zip` 上传到 Cloudflare 的 `gal-quiz-edge` 项目，选择生产部署。部署压缩包不进 Git。

搜索用的正式网址、网页简介在 `site/index.html`，抓取规则和站点地图分别在 `site/robots.txt`、`site/sitemap.xml`。换域名时需要一起更新；搜索引擎的站点验证和收录提交需单独在相应站长后台完成。

2026-10-24 搜索提交记录：旧 `gal` 入口的 Google 和必应验证、站点地图及首页已提交。切换 `www` 后，Google Search Console 新增并验证覆盖该网址的 `scurra.top` 网域资源，已成功处理 `https://www.scurra.top/sitemap.xml`（发现 1 个网页）；必应已验证 `https://www.scurra.top/` 并重新提交新首页及站点地图（处理中）。Cloudflare 中新旧 Google TXT 与必应验证 CNAME 均需保留。百度已完成实名认证和 `https://www.scurra.top/` 网站所有权验证，首页已通过普通收录手动提交，平台回执为“链接提交成功”；首页的百度验证标签需保留。百度 sitemap 当日提交配额为 0，尚未提交地图。提交不等于已收录，实际收录以站长后台为准。

浏览器的想玩清单、已玩记录和答题会话按域名隔离；旧 `gal` 或 `github.io` 入口中的记录不会自动迁移到 `www`。

Google 对新首页的单独优先抓取请求因 reCAPTCHA 服务连接失败，刷新重试后仍未完成；新站点地图已成功处理并发现首页，可等待常规抓取，或在 Google 服务恢复后重试首页索引请求。

## 数据

作品数据来自 [VNDB](https://vndb.org/)，遵循 [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/)。本站不提供任何资源下载，只链接到 VNDB 和 Bangumi 的作品页。

重新生成数据（需要 Node 24）：

```bash
node scripts/fetch-vndb.mjs      # 从 VNDB API 抓作品和发行版，约 10 分钟，支持断点续抓
node scripts/resolve-tags.mjs    # 把问卷里的标签名解析成 VNDB 标签 ID
node scripts/fetch-chinese-reception.mjs # 中文口碑快照；加 --refresh 更新缓存
node scripts/build-data.mjs      # 生成 site/data/vns.json 和 site/data/quiz.json
```

本地预览：

```bash
node scripts/serve.mjs
```

然后打开 http://localhost:8080 。

检查推荐结果：`node scripts/simulate.mjs`，结果写到 `data/test-runs.md`。

题目、标签和权重都在 `config/questions.json`，打分规则见 `CLAUDE.md`。

2026-10-25 问卷调整：第 6 题故事偏好最多选两项，每项附简短说明；第 8 题背景可多选，“不在意背景”与其他项互斥。多选确认后再进入下一题，每题取所选方向的最高分，权重只计一次。移除难以区分的主角题，现实生活改用写实日常、家庭关系和少量现代背景加分。旧单选会话、推荐结果和收藏继续保留。

`node scripts/check-questionnaire.mjs` 验证多选打分、选项互斥及旧会话迁移；[调整与多选测试报告](data/questionnaire-update-report.md) 记录标签核对和两组多选玩家各五次结果，原四位测试玩家结果在 `data/test-runs.md`。历史中文口碑报告保留原测试口径，可用 `node scripts/check-recommendations.mjs --check-only` 检查当前配置而不覆盖它。

中文口碑以 [Bangumi](https://bgm.tv/game/browser?sort=rank) 为主、[KUN 本站评分](https://www.kungal.com/doc/galgame-rating-guide) 为小幅补充，依据评分人数收缩加分。系数为 1–1.8，缺数据不降权；口味分、硬条件、雷点及 15 部候选规则保留。TouchGal 和 galgame吧因人数或完整榜单未能核实，不加入数值加分。原始 VNDB、Bangumi 评分分别展示，不混成伪平台评分。

2026-10-24 快照映射 470 部，193 部加分，其中 150 部是可直接推荐的非续作。完整来源、映射限制及 4 个测试玩家各 5 次的前后结果见 [调研与测试报告](data/chinese-reception-report.md)。运行 `node scripts/check-recommendations.mjs` 复现。

## 查看匿名反馈

网页页脚“有问题？提个建议”打开表单，联系方式选填；推荐结果可自愿附带当前作品 ID。失败保留文字，只有实际保存成功才提示收到。

Cloudflare → 存储和数据库 → Workers KV → `gal-quiz-feedback` → 搜索 `feedback:` → 查看条目值。后台仅管理员可读，不公开展示联系方式，没有自动通知。反馈不保存原始 IP、浏览器指纹或完整问卷记录。

部署时，在 `gal-quiz-edge` 的生产环境把 KV `gal-quiz-feedback` 绑定为 `FEEDBACK`，再上传新版 Worker。绑定缺失或存储失败会返回错误，不会显示假成功。原生 GitHub Pages 地址只用于静态源站，表单应在正式 `www` 网址使用。

运行 `node scripts/check-feedback.mjs` 检查校验、限流、重试和存储故障。本地静态预览不提供接收服务，最终需要在线提交并在 KV 确认。
