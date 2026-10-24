# 测测你适合哪部 Gal

## 项目是什么

一个帮 Galgame 玩家解决"游戏荒"的网站：玩家答 12 道题，再勾一道雷点多选，网站从符合条件的作品里随机抽 3 部推荐，并说明为什么推荐。

- **目标用户**：中文玩家，从完全新人到老资历都有。
- **核心取向**：准确优先。目标是"真的帮人找到下一部"，不是做成娱乐测试。
- **随机性**：保留。同样的答案每次抽到的结果不同，但都必须在高匹配范围内。

## 已经定下来的决策（改之前先和我讨论）

1. **不让玩家输入自己喜欢过的作品**，纯问卷 + 雷点排除。
2. **纯静态网站**：没有后端。数据预先生成成 JSON，前端负责答题、打分和抽取。
3. **部署**：GitHub Pages（或 Vercel），免费托管。
4. **数据来源**：VNDB（主）。中文标题优先用 VNDB 里的 zh-Hans/zh-Hant 标题，缺的以后再考虑从 Bangumi 补。
5. **不放任何资源下载链接**，只链接到 VNDB / Bangumi 的作品页。
6. 页面底部注明数据来自 VNDB，遵循 Open Database License（ODbL）。

## 工作方式

- 我（用户）说"我想做 X"或只是提个想法时，**先讨论、确认方案再动手**，不要直接写一大堆代码。
- 小改动、明确的修改可以直接做。
- 页面文案要口语化、自然，避免 AI 腔和模板化表达。

## 目录结构

```
gal/
├─ CLAUDE.md
├─ scripts/
│  ├─ fetch-vndb.mjs      # 从 VNDB API 抓作品和发行版，输出 data/raw/vns/（断点续抓）
│  ├─ resolve-tags.mjs    # 把问卷里的标签名解析成 VNDB 标签 ID（含子标签），输出 config/tag-ids.json 和 data/tag-report.md
│  ├─ build-data.mjs      # 清洗、筛选，生成 site/data/vns.json 和 site/data/quiz.json
│  └─ serve.mjs           # 本地预览：node scripts/serve.mjs，打开 http://localhost:8080
├─ config/
│  ├─ questions.json      # 题目、选项、标签映射、权重（唯一的手写配置来源）
│  └─ tag-ids.json        # resolve-tags 生成，不要手改
├─ data/
│  ├─ raw/                # 抓下来的原始数据（不提交到 git）
│  └─ tag-report.md       # 标签核对表
└─ site/                  # 静态网站，部署这个文件夹
   ├─ index.html
   ├─ engine.js           # 纯逻辑：筛选、打分、抽取、推荐理由、玩家类型（浏览器和 Node 共用）
   ├─ app.js              # 页面渲染、交互、localStorage
   ├─ style.css
   └─ data/
      ├─ vns.json         # 片库
      └─ quiz.json        # 问卷配置（标签名已换成 ID）
```

环境：Windows，Node v24，用 PowerShell 跑命令。

## 数据管线

### VNDB API

- 接口：`https://api.vndb.org/kana`，POST 请求，文档在同一地址。
- 限速：每 5 分钟最多 200 次请求，单次请求超过 3 秒会被中止。每页最多 100 条。脚本要加延时，并支持断点续抓。
- 免费，仅限非商业用途。

### 抓取哪些作品（初始门槛，之后可调）

- 投票数 ≥ 50，贝叶斯评分（`rating`）≥ 65。
- 开发状态为已完成（`devstatus` = 0）。
- **不在抓取阶段按中文过滤**：把 `languages` 字段存下来，由前端根据第 1 题决定。

### 每部作品需要的字段

`id, title, alttitle, titles{lang,title,official,main}, released, length, length_minutes, rating, votecount, languages, image{url,sexual}, tags{id,rating,spoiler,lie}, developers{name}, relations{relation,relation_official}`

`relations` 用来处理两件事（在 build-data 里）：
- **续作 / 外传 / FD 不直接推荐**：作品有 `preq`（对方是我的前作）、`par`（对方是我的本篇）、`orig`（对方是我的原作，我是 FD）关系的，标 `sequel: true`，前端直接排除。比如 Kud Wafter、海猫散、樱之刻。
- **同一作品的不同版本合并**：`alt` 关系（重制版、移植版）连在一起的只保留投票最多的条目，"有中文 / 有全年龄版 / 语音"取所有版本里最好的，其他版本 ID 存在 `altIds`。比如时空轮回和 Ever17（2011）。

另外通过 `/release` 查询每部作品的**官方、非补丁**发行版，汇总成：
- `allAges`：是否存在 `minage` < 18 的发行版。
- `voiced`：各发行版里最高的语音档位（1 无语音，2 仅 H 场景，3 部分，4 全语音；null 未知）。

### 标签

- `config/questions.json` 里写标签的英文名，`resolve-tags.mjs` 用 VNDB 官方每日标签导出（`https://dl.vndb.org/dump/vndb-tags-latest.json.gz`，和 `/tag` 接口同源，但带父子关系）解析成 ID。
- **新加或修改标签名时一定要跑一遍 resolve-tags 并看核对表。** 查不到或含义不符的，列出来给我确认，不要自己随便替换。
- **VNDB 作品上只记直接打的标签，不含子标签。** 所以每个问卷标签都要连同子标签一起算：
  - 口味打分：子标签分数 × 0.7 后和父标签取最大，H 类（ero）子标签不算。
  - 雷点和硬条件：子标签全额算。
- `lie` = true 的标签（被投票判为错误的）丢掉。
- 每部作品只保留问卷和雷点用到的标签（已经按上面的规则合并好），减小 JSON 体积。

### 输出 `site/data/vns.json`

每条大致是：

```json
{
  "id": "v2002",
  "title": "命运石之门",
  "orig": "Steins;Gate",
  "length": 4,
  "mins": 2700,
  "year": 2009,
  "rating": 89,
  "votes": 12000,
  "zh": true,
  "allAges": true,
  "voiced": 4,
  "tags": {"g123": [2.8, 0], "g456": [1.9, 2]},
  "dev": "5pb.",
  "img": "https://..."
}
```

`tags` 的值是 `[标签分数, 剧透等级]`，键是问卷里那个标签的 ID（子标签已经合并进来）。

**封面只保留露骨程度为 0 的**（VNDB `image.sexual` 是投票平均：0 安全，1 擦边，2 露骨）。其余作品 `img` 为 null，连图片地址都不写进数据。原因是国内展示露骨图片有法律风险，模糊处理照样会加载原图，挡不住。按 2026-10 数据，可推荐作品里约 54% 有封面。

## 问卷（定稿）

具体的标签和权重以 `config/questions.json` 为准，下面是概要。所有题目都可以跳过。

### 一、硬条件（不符合直接筛掉）

| # | 题目 | 选项 → 处理方式 |
|---|---|---|
| 1 | 你只能玩中文的吗？ | 只要有官中或汉化 → `languages` 含 zh-Hans 或 zh-Hant ／ 日文也行 → 不限 |
| 2 | 一部 gal 你能接受玩多久？ | 一个周末（10 小时内）／两三周（10–30 小时）／越长越好（30 小时以上）／无所谓。优先用 `length_minutes`，没有就用 `length` 档位 |
| 3 | 推荐范围？ | 只要全年龄版 → `allAges` = true ／ 不限 |
| 4 | 你想看什么样的恋爱组合？ | 男主角和女孩子们 → 排除 Otome Game、Boy x Boy Romance、Girl x Girl Romance Only ／ 乙女向 → 必须有 Otome Game ／ 百合 → 必须有 Girl x Girl Romance ／ 都可以 |
| 5 | 你玩过多少 gal？ | 见下方"人气权重" |

第 4 题是因为片库里约 7% 是乙女向、2.5% 是 BL，不问的话新人很容易抽到乙女游戏。

**第 5 题：人气权重**

"大热" = 投票数排在片库前 5% 的作品。"冷门佳作" = 投票数低于片库中位数，且评分 ≥ 75。

| 选项 | 处理方式 | 人气系数的 α |
|---|---|---|
| 这是第一部 | 只从投票数前 20% 的作品里抽 | 0.15 |
| 玩过几部 | 不调整 | 0.15 |
| 已经玩过很多 | 大热作品得分 × 0.6 | 0.05 |
| 老资历了 | 大热作品得分 × 0.3，冷门佳作额外加分 | 0 |

人气系数 = （投票数 ÷ 可推荐作品的投票中位数）^α，第 5 题跳过时 α 按 0.15。原因：只答了一两道口味题时，会有上百部作品口味分几乎打平（只答"伏笔"时有 137 部和第 1 名相差不到 0.1），谁进候选基本随机，冷门作品就会混进来。加了以后，只答"伏笔"时候选的投票中位数从 715 变成约 9000；口味分区分得开时影响很小，真正对口的冷门作品（比如推理组的 12RIVEN，178 票）照样留在候选里。

这些倍数都是初始值，测试时再调。

### 二、口味（打分用）

括号里是全库明显命中（该题得分 ≥ 0.33）的比例（2026-10 数据，任一命中计法）。

| # | 题目 | 选项 → 标签 |
|---|---|---|
| 6 | 通关后你最想留下什么感觉？ | 哭到停不下来 → Nakige、Life and Death Drama（13%）／ 回头发现处处是伏笔 → Mystery、Multiple Route Mystery、Suspense、Unreliable Narrator（25%）／ 很久缓不过来 → Utsuge、Desperation、Psychological Trauma（9%）／ 甜到嘴角压不住 → Slice of Life、Only Good Endings（22%）／ 燃 → Action、Fighting Protagonist、War（20%）／ 想了很多 → Philosophy、Existential Crisis、Mind Screw、Identity Crisis、Coming-of-Age Drama、Metafiction、Dystopia、Surreal、Religion/Faith（9%） |
| 7 | 你更喜欢哪种故事结构？ | 一条主线讲到底 → Linear Plot ／ 好几条线，自己选走哪条 → Branching Plot ／ 好几个主角，视角来回切换 → Multiple Protagonists、Non-Chronological ／ 无所谓 |
| 8 | 舞台选哪里？ | 校园 → School ／ 科幻、时间线 → Science Fiction ／ 魔法、异能、异世界 → Fantasy ／ 现实社会 → Modern Day Earth（权重只给 0.3，否则现代背景的校园作品也会算"现实社会"）、Adult Protagonist、Crime ／ 和风、历史 → Past Japan、Japanese Mythology ／ 不挑 |
| 9 | 你希望主角是什么样的人？ | 普通的学生 → Student Protagonist、Gentle Protagonist ／ 已经工作的大人 → Adult Protagonist ／ 能打 → Fighting Protagonist、Superpowers、Hotblooded Protagonist ／ 头脑派 → Genius Protagonist、Pragmatic Protagonist、Detective Work ／ 有阴暗面 → Antihero Protagonist、Protagonist with Psychological Problems ／ 无所谓 |
| 10 | 恋爱在故事里占多少？ | 恋爱就是核心 → Romance ／ 恋爱是调味 → 不处理 ／ 没恋爱也行 → Romance 减分，No Romance Plot 加分 |
| 11 | 想要多少笑点？ | 越多越好 → Comedy、Tsukkomi Protagonist ／ 有就行 → 不处理 ／ 严肃一点 → Comedy 减分 |
| 12 | 除了读，还想要点玩法吗？ | 只想读 → 玩法类标签（Other Gameplay Elements 及子标签）减分 ／ 来点战斗、策略或解谜 → 玩法类标签加分 ／ 无所谓 |

**删掉的题和选项，以及原因**（VNDB 没有对应标签，留着也不起作用）：
- "开头日常能忍多久"：没有节奏类标签，最接近的 Long Common Route 只覆盖 3.5%。
- "文学性强"：VNDB 不给文笔打标签。
- 主角性格类（温柔、冷静、中二）：每个标签只覆盖 1–2%，所以改成按身份和能力分。
- Love Overcomes All（原来在"甜"和"恋爱核心"里）：打得太泛，推荐理由里几乎每部甜文都是"两个人一起跨过难关"。

### 三、雷点（多选，命中就排除）

| 雷点 | 对应标签 | 全库排除比例 |
|---|---|---|
| NTR | Netorare、Netori（主角抢别人的伴侣，寝取り） | 约 12% |
| 猎奇、血腥 | Gore、Guro | 2.8% |
| 恐怖 | Horror | 5.7% |
| 以悲剧为主 | Utsuge、Bad True End | 3.1% |
| 后宫结局 | Harem Ending | 21% |
| 拔作 | Nukige | 32% |
| 没有角色语音 | 用发行版的 `voiced` 字段判断（1 = 无语音） | 11% |

- 不用 Bad Ending(s)：它的意思是"至少有一个坏结局"，会误杀一大片。
- VNDB 没有"后宫向"标签，只能抓"有后宫结局"的。
- "主角没有立绘和语音"这个雷点已经删掉。

## 打分与抽取规则

1. **硬条件筛选**（第 1–4 题，以及第 5 题"第一部"的人气限制）。
2. **雷点排除**：作品带有对应标签且分数 ≥ 1.5 就排除。**任何剧透等级都算**，因为玩家宁可被少推荐，也不想踩雷。
3. **口味打分**：
   - 每题得分 = 加分部分 − 减分部分，落在 -1 到 1，题和题之间平等。标签分数在 0–3 之间。
   - 加分部分按"任一命中"：1 − Π（1 − 权重 / 该选项最大正权重 × 标签分数 / 3）。命中任意一个标签就能拿高分，多命中只是锦上添花，所以给选项多挂几个标签不会把分数摊薄。（原来是加权和 ÷ 正权重之和，测试发现给"想了很多"补标签后分数反而被稀释：30 小时以上的作品里口味分 ≥ 0.3 的从 23 部掉到 7 部；改成任一命中后是 101 部。）
   - 减分部分 = Σ（|权重| × 标签分数 / 3）÷ 负权重绝对值之和，比如"只想读"给玩法标签减分。
   - 口味分 = Σ（题目权重 × 每题得分）。题目权重默认 1，"通关感觉"是 1.5。
4. **人气权重**：（投票数 ÷ 投票中位数）^α，再按第 5 题调整（大热 × 0.6 或 × 0.3，冷门佳作 × 1.3），见上面第 5 题的表。
5. **质量兜底**：乘上一个和评分挂钩的小系数 `0.8 + 0.2 × (rating − 65) / 35`，避免高匹配但质量一般的作品排太前。
6. **拔作、Netori 默认降权**：玩家没勾对应雷点（"拔作" ／ "NTR"）时，总分 × (1 − 0.9 × 标签分数 / 3)，用的是 Nukige ／ Netori 标签。勾了就直接排除。（0.6 试过，口味分放大后压不住，满分拔作仍能排第 1。Netorare 没有默认降权，只在勾了 NTR 时排除）
7. **总分** = e^(2 × 口味分) × 人气系数 × 质量系数 × 拔作降权。用指数是为了总分永远为正（口味分可能是负的，负数乘人气系数会反着来），而且一题都不答时退化成按人气和评分推荐。系数 2（`matchSharpness`）让口味分主导排序，抽取时也更集中在高匹配的作品上。
8. **口味分门槛**：答了口味题时，口味分 < 0.15（`minMatch`）的作品整体排在达标作品后面，避免人气、评分加成把不对口的作品顶进候选。
9. **抽取**：取总分最高的 15 部（`poolSize`，不足 15 部就全取；原来是 25，测试时发现会抽到只沾一个标签的作品），按总分加权随机抽 3 部。续作 / 外传 / FD 不进候选。
10. **"为什么推荐"**：取该作品对得分贡献最大的 2–3 个标签（正权重、标签分数 ≥ 1），用 `questions.json` 里的 `tagText` 短语拼成一句话。**只用剧透等级为 0 的标签**，绝对不能剧透。
11. 如果筛完剩下不到 3 部，把每个硬条件和雷点分别拿掉重算，告诉玩家是哪个条件太严，并提供"放宽时长"之类的一键放宽按钮。

## 结果页

- 3 部作品：中文标题 + 原名、封面（只显示露骨程度为 0 的；没有封面的用标题首字做文字卡片，不做模糊、不提供点击查看）、时长、评分、命中标签、推荐理由、VNDB 和 Bangumi 链接。
- **换一批**：同样的条件重新抽，尽量不重复已经抽过的。
- 每部下面有 **玩过了 ／ 不感兴趣 ／ 想玩**：
  - "玩过了"和"不感兴趣"会立刻换掉这一部，并且以后不再出现。
  - 这些都只存在浏览器的 localStorage 里，读写要包 try/catch，读不到也要能正常用。
- 给出玩家类型（例如"伏笔收集癖"），根据第 6 题和得分最高的口味维度生成。

## 开发顺序

1. ~~写 `fetch-vndb.mjs`，先抓 100 部试跑，确认字段都拿得到。~~
2. ~~写 `resolve-tags.mjs`，核对所有标签，把核对结果给我看。~~
3. ~~全量抓取，生成 `vns.json`，报告：作品总数、有中文的数量、全年龄的数量、JSON 文件大小。~~
4. ~~做网页：先把功能做通，再做视觉。~~
5. ~~用下面的测试用例走一遍，把结果给我看。~~（`node scripts/simulate.mjs`，结果在 `data/test-runs.md`）
6. ~~部署到 GitHub Pages。~~

## 部署

- 仓库：https://github.com/beikanwo/gal-quiz （公开），正式域名：https://www.scurra.top/；原 Pages 地址：https://beikanwo.github.io/gal-quiz/。
- 域名解析在 Cloudflare：`www` 和 `gal` 指向 Pages 项目 `gal-quiz-edge.pages.dev`，由该项目绑定自定义域 `www.scurra.top`、`gal.scurra.top`，均启用有效 HTTPS。`www` 提供网站和边缘缓存，旧 `gal` 入口由 Worker 301 永久跳转至 `https://www.scurra.top`，保留路径及查询参数；根域名 `scurra.top` 保留。
- GitHub Pages 仍由 Actions 发布 `site/`，源站地址为 `https://beikanwo.github.io/gal-quiz/`。GitHub Pages 的 Custom domain 留空，不要绑定任何 Cloudflare 入口域名，否则会造成回源重定向循环。入口从 Cloudflare 到 GitHub 也通过有效 HTTPS 连接，不关闭证书验证。
- 加速代码见 `cloudflare/worker.mjs`，以 Pages 高级模式 `_worker.js` 部署。只允许固定站点文件的 GET/HEAD，不转发 Cookie/认证；边缘缓存 5 分钟、浏览器缓存 1 分钟，支持 ETag。修改入口代码时运行 `scripts/package-edge.ps1`，在 Cloudflare 项目中上传生成的生产包；日常网页更新仍只需 Git 推送。
- 首页预加载问卷、片库和入口模块，减少启动时的串行请求。小问卷就绪后即可开始答题，片库后台下载；数据到齐后只更新当前题目的数量提示，不重置答案、焦点和动画。恢复结果/想玩清单时，先等片库，再恢复并保存会话，防止首页覆盖旧记录。canonical、Open Graph、`robots.txt`、`sitemap.xml` 使用 `https://www.scurra.top/`；搜索引擎的站点验证和收录提交需单独操作。
- 浏览器收藏、已玩记录和答题会话按域名隔离，旧 `gal` 和 `github.io` 域名里的本地记录不会自动迁移到 `www`。
- 搜索提交进度（2026-10-24）：Google Search Console 已验证 `gal.scurra.top` 网域资源；`https://gal.scurra.top/sitemap.xml` 已成功处理，发现 1 个网页；首页已请求编入索引，进入优先抓取队列。提交时首页状态为“已发现 - 尚未编入索引”，不能把提交成功写成已经收录。
- 必应站长工具已验证 `https://gal.scurra.top/`，已提交同一站点地图（处理中）及首页 URL，后台提交列表已确认收到 1 条。Cloudflare 的 `gal` TXT（Google 验证）和 `80a3de274eddf2fcbb6d47c7b5b84fd0.gal` CNAME（指向 `verify.bing.com`，仅 DNS）是所有权验证记录，需保留；网站入口原有的 `gal` CNAME 仍指向 Cloudflare Pages。
- 同日切换 `www` 后，Google Search Console 新增并验证 `scurra.top` 网域资源（覆盖 `www`），根域 TXT 为新的 Google 所有权验证记录；新站点地图 `https://www.scurra.top/sitemap.xml` 已成功处理，发现 1 个网页。必应已验证 `https://www.scurra.top/` 并提交新首页及新站点地图（处理中），验证 CNAME 为 `fd32e114b1837c8bf184e1ed8d814a9b.scurra.top` → `verify.bing.com`（仅 DNS）。新旧验证记录均需保留，旧域名的提交记录仅作为迁移历史。
- `www` 首页的 Google 单独“请求编入索引”在刷新重试后仍因“无法连接到 reCAPTCHA 服务”失败，尚未完成该优先抓取请求；不要沿用旧 `gal` 入口的成功回执。新站点地图已成功处理，Google 已通过它发现新首页，检查状态为“已发现 - 尚未编入索引”。
- 百度搜索资源平台已登录，站主已完善账户资料并完成滑块验证，但平台仍要求账号实名认证才能添加站点。站主于 2026-10-24 决定先跳过百度；百度站点验证和收录提交暂缓，尚未完成，不可记为已提交。Google 和必应的已完成提交记录保留。
- 推送到 `main` 后，`.github/workflows/pages.yml` 自动把 `site/` 发布到 GitHub Pages，约 1 分钟生效。
- 更新数据：重跑 fetch → resolve-tags → build-data，提交 `site/data/` 后推送。
- `design/`（视觉稿和截图，含 VNDB 封面）和 `data/raw/` 不进仓库。
- 本机已装 GitHub CLI（`C:\Program Files\GitHub CLI\gh.exe`），以 beikanwo 登录。

## 验证用的测试玩家

用这几种答法各跑 5 次，把抽到的结果列出来，由我判断准不准。恋爱组合都选"男主角和女孩子们"。

- **纯新人**：只玩中文、10–30 小时、全年龄、第一部、想哭、校园。
- **推理爱好者**：只玩中文、不限时长、玩过几部、想要伏笔反转、科幻、头脑派主角，雷点选恐怖。
- **老资历文学党**：日文也行、30 小时以上、不限范围、老资历、想了很多、笑点选严肃一点，雷点选 NTR 和拔作。（原来的"文学性强"已删，用"严肃一点"代替）
- **甜文党**：只玩中文、一个周末、玩过很多、甜、恋爱核心，雷点选以悲剧为主和猎奇。

## 参考

- 之前做过一个 45 部手工片库的草图原型，只作为界面参考，不沿用它的数据和打分逻辑。
- VNDB API 文档：https://api.vndb.org/kana
