# Gal 热门发现：运行与维护

网站、采集和资料补全均在本仓库。访客不需要登录。Cookie 只供离线采集使用，不会进入网站文件。

## 当前入口

- `/`：热门发现，按平台展示。
- `/quiz/`：原口味问卷；`galquiz.*` 存储键未改，原结果会恢复到这里。
- `/works/v…/`、`/staff/s…/`、`/producers/p…/`：作品与关系资料。
- `/periods/`：往期；`/library/`：作品库；`/search/`：搜索；`/about/`：公开收录标准。

所有发现页面由脚本生成，不要直接修改生成的 HTML。原问卷的首页源文件为 `site/quiz/index.html`。

故事区优先展示带来源的中文简介。KUN 资料通过明确的 VNDB ID 对应；Bangumi 成人条目在公开接口不可读时使用注明来源的 KUN 镜像，机器翻译保留标记。缺少中文时显示待补全，不回退成英文正文。评分侧栏分别列出 Bangumi（10分）、VNDB（10分）和批评空间（100分），包括人数、口径、采集日期及来源链接；没有可靠数据时显示横线。

游戏画面统一收起，用一个“查看全部画面”按钮展开整排，可左右滚动。打开前不加载截图；打开后点击某张图可以查看原图。

## 本地构建与检查

需要 Node 24。普通网站构建不依赖 Python，也不需要安装 npm 包。

```powershell
node scripts/discovery/build.mjs
node --test scripts/discovery/test/*.test.mjs
node scripts/discovery/validate.mjs
node scripts/check-questionnaire.mjs
node scripts/check-feedback.mjs
node scripts/serve.mjs 8080
```

然后打开 `http://localhost:8080/`。新站与问卷共用同一域名存储，不复制、删除或重命名原有收藏记录。

更新既有资料的中文简介及评分：`node scripts/discovery/refresh-community.mjs`，然后重新构建。它会批量读取 VNDB 原站分数，并刷新当前热门及完整详情作品的 KUN / Bangumi 资料。`config/discovery-community.json` 只保存核实过的作品对应关系。

`targetWorksPerPlatform` 默认 10；主题搜索不足时按 `discoveryQueries` 补搜作品。保持15天窗口，单条点赞门槛为1000，候选不足时展示真实数量，不使用旧视频或占位数据凑数。搜索中途受限时保留已验证的内容，并继续标注部分采集。

## 首次设置抖音登录状态

1. 在自己的电脑浏览器登录抖音网页版，搜索 `galgame`。
2. 按 F12，选择“网络 / Network”，刷新一次。
3. 选择地址中含 `search` 的搜索请求。在“标头 / Headers”下找到“请求标头 / Request Headers”中的 `Cookie`，复制它的值。不要复制完整请求或响应。
4. 打开 <https://github.com/beikanwo/gal-quiz/settings/secrets/actions>，点击 **New repository secret**。
5. **Name** 填 `DOUYIN_COOKIE`，**Secret** 填刚才的值，点击 **Add secret**。
6. 在 Actions 中打开 **Collect Galgame discovery**，选择 **Run workflow**，先用 `probe` 验证。

Cookie 相当于该站的登录凭据：不要贴到聊天、Issue、公开配置或截图中。失效时在同一 Secret 中更新即可。B站可先不配 Cookie；受限时按同样方法配置 `BILIBILI_COOKIE`。

云端安装的抖音采集项目和 commit 固定在 `config/discovery.json`，通过独立 Python 进程调用。原始依赖位于运行时 `.cache/douk`，不提交到本仓库。Cookie 从环境变量读取，不写入上游配置，也不输出上游日志。

## 采集与发布

GitHub Actions 工作流：`.github/workflows/discovery.yml`。

- `probe`：各平台取一个主题词、一页，验证真实日期、点赞数和作品匹配；不更新热榜。
- `publish`：执行全部主题词、明确作品名称补搜、资料补全，构建并校验后保存快照。
- `review`：用本期已保存且成功采集的内容重新应用人工核对，不重新抓取平台。
- `force`：重跑已成功的本期，保留相同的时间窗口。

`main` 上的正式采集保存后显式调用 Pages 部署工作流，并传入刚生成的准确提交 SHA，避免部署回任务启动时的旧快照。数据变化来自 `GITHUB_TOKEN` 时，也不会依赖“自动提交触发 push”这条不可靠的链路。失败不提交半截构建；部署状态可以在 Actions 查看。

每天北京时间 09:17 检查，`scheduleEnabled: true` 后才进行定期采集。`data/discovery/periods.json` 中的首次发布日作为锚点，每15天一期，不使用月内 `*/15`。同一期已成功的平台默认复用，不因另一平台失败而重复抓取。缺少登录状态的平台会保留失败状态，不能声称已经跑通。

首次启用：先完成一次 `publish`，确认报告和正式域名，再将 `config/discovery.json` 的 `scheduleEnabled` 改为 `true`。GitHub 的计划任务可能延迟；长期无仓库活动也可能被平台暂停。需要时可以手动运行。

部分搜索词成功、部分受限时记为 `partial`，不视为完整采集。没有完整旧期时只展示已经核实的片段，并显示完成的搜索次数；有完整旧期时继续保留旧期。只有 `success` 才标记该平台本期已经完成，`partial` 和 `failed` 都会在下一次日常检查时重试。

验证报告位于工作流的 **discovery-verification** Artifact，保留30天。报告只包含清理过的公开内容元数据、范围与状态，不包含 Cookie。平台搜索受排序、页数、网络和登录状态限制；成功不等于全平台全量覆盖。

## 核对不明确的内容

```powershell
node scripts/discovery/review.mjs
```

用浏览器打开生成的 `design/discovery/review.html`。它会列出待核对原因、原链接、候选游戏和可复制的配置片段。

修改 `config/discovery-overrides.json`，例如：

```json
{
  "aliases": { "某部游戏的常用简称": "v123" },
  "evidence": {
    "bilibili:BV实际内容ID": { "workId": "v123", "confirmedGame": true },
    "douyin:实际数字ID": { "exclude": true }
  },
  "works": {
    "v123": { "description": "核实过的中文简介", "descriptionSource": "https://官网或资料来源/" }
  },
  "screenshots": {
    "sf实际截图ID": { "spoiler": false, "source": "VNDB", "credit": "画面版权归原游戏权利人所有" }
  }
}
```

`confirmedGame` 必须在确认原画面来自对应游戏后使用；游戏名被提到或出现在标签里，不足以证明动画、二创和联动视频的来源。未确认的截图保持折叠，展开后才加载。

没有 VNDB 条目时，`works` 可使用 `manual-英文数字短名` ID，至少填写 `title` 和 HTTPS `source`；简介仍需 `descriptionSource`。人工条目默认没有图片，避免未经核实的图片直接公开。

本地可执行 `node scripts/discovery/run.mjs --review-only --force`，或提交配置后运行 Actions 的 `review`。改错了就修正映射并再次运行，不新增同一期次。

## 资料补全

`data/discovery/catalog.json` 保存已核实的作品、人员、制作商及来源，和问卷片库分开。不会继承问卷的评分、票数或续作排除条件。

作者与制作商作品列表按 VNDB API 的 `more` 完整分页，保留参与角色；不递归抓取每个关联作品的全部同事，防止关系图无限扩张。关联作品进入独立补全队列，分批取得完整详情。中文介绍优先从明确对应的中文资料补充；原文仅保留用于溯源，页面缺少中文时显示采集状态，不自动编写简介。

## Cloudflare 入口更新

日常更新仍走 GitHub Pages。首次新增路由时需部署新的 `cloudflare/worker.mjs`：

```powershell
./scripts/package-edge.ps1
```

产物为 `design/gal-quiz-edge.zip`，上传到现有 Cloudflare Pages 项目 `gal-quiz-edge` 的生产环境。保留现有自定义域名和 `FEEDBACK` KV 绑定，不能新建同名独立服务替代它。

也可以使用官方 Wrangler 部署 `design/edge-upload`，但应先核对现有项目配置，保留远程绑定。不要上传 `data/raw`、`.cache`、`.env` 或任何 Cookie。

## 回滚

GitHub Pages 可以重新运行前一版部署；Cloudflare 项目可以恢复上一条成功的生产部署。若需整体回滚，在 Git 中还原对应变更并重新发布。`galquiz.*` 原数据一直保留，不需要清空浏览器。

封面修复：`node scripts/discovery/refresh-covers.mjs` 优先补齐总览、热门和已完善详情的缺图作品；`--all` 可检查全部缺图作品。默认封面不符合原有图片标准时，查询同一作品明确关联的正式发行版本，仅选择包盒正面或数字封面，排除照片和无法区分作品的合集图片，保留发行 ID 与来源。缩略图加载失败时尝试原图；没有可核实图片时显示“暂无封面”。

## 目录与分页

`/library/` 为总览，宽屏显示两行作品，剧本家、原画师和制作商有独立入口。`/library/works/` 每页25部，`/library/writers/`、`/library/artists/`、`/library/producers/` 每页12项；第二页起使用 `/2/` 等静态路径，全部页面写入站点地图。岗位数量按该岗位参与的作品ID去重。

目录支持搜索全量名称/别名、排序、页码跳转和左右方向键翻页；搜索与排序参数随分页链接保留。输入框、下拉框、输入法组合输入及打开反馈弹窗时不触发方向键翻页。无需JavaScript也可沿静态分页浏览全部条目。

## 全库资料补全队列

`node scripts/discovery/backfill.mjs --limit 120 --minutes 18 --cover-limit 100` 独立于热榜采集运行。先按100部一批获取全量VNDB详情，再逐部核对KUN的明确VNDB关联、Bangumi原站及适合公开展示的正式发行封面；不递归扩展全部同事，不改热榜的点赞和时间门槛。

每部作品的 `metadataStatus` 保存各来源的最后尝试、最后成功、下次重试和连续失败次数，随catalog原子保存；批次过程中每5部保存社区断点、每10部保存其他来源断点。失败按5分钟起指数退避，最长1天；成功查询和确认暂无对应资料的条目30天复查。保留已取得的简介、评分和图片，不因本次失败清空。

`.github/workflows/metadata.yml` 每6小时运行一次（北京时间约08:43、14:43、20:43、次日02:43），也可手动指定批量。与热榜任务共用并发锁，避免两项任务同时修改资料库。校验、构建成功后保存断点，并显式调用GitHub Pages部署；公开页面区分尚未采集、采集失败、所查来源暂无数据。全库轮询需要多轮，中文资料与图片有无数据仍以来源实际返回为准。报告保存在 `data/discovery/enrichment.json`，不含Cookie或登录信息。
