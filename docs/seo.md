# 搜索优化与提交状态

目标是让搜索者从Galgame推荐、抖音/B站片段找游戏，以及具体作品和创作者的查询进入对应页面。没有查询量或排名后台数据时，不宣称某个词具有高流量。

| 页面 | 对应查询与信息 |
| --- | --- |
| 首页 | Galgame推荐、热门作品、抖音/B站片段找游戏 |
| 作品页 | 作品中文名/原名、故事简介、评分、发行和制作资料 |
| 创作者/制作商 | 姓名/品牌名、参与作品或开发作品 |
| 作品库及分页 | Galgame作品库、剧本家、原画师、制作商 |
| 新手指南/问卷 | 新手Gal推荐、第一部Galgame、Galgame推荐测试 |

标题与描述按真实资料生成；缺少中文介绍时不编造摘要。作品结构化数据采用WebPage + VideoGame，创作者采用Person/Organization，首页建立WebSite实体；不把数据库评分伪装成本站用户评分。面包屑包含真实站内链接，分页各用独立规范网址。保留原百度校验标签，Google/Bing的站长校验码可填config/seo.json。

站内搜索页和未形成正式影子期次的滚动调试页采用noindex,follow，仍允许爬虫读取规则。站点地图只列可索引规范网址，lastmod由主要正文与元数据哈希维护：相同内容不因每天运行而刷新时间。seo-state.json需随自动生成任务一并提交。

Bing采用IndexNow：部署后才检查正式域名校验文件并通知新增、变更和撤回的网址。200表示收到通知，202表示收到通知、待校验文件核验，两者都不等于已收录。公开校验文件不是账户密码；不得替换成任何私有API凭据。Google通过robots.txt中的Sitemap地址发现站点地图；账户内提交与覆盖率检查需要登录Search Console。百度后台提交和抓取诊断也需要用户登录，保留原有验证并不代表已在后台核实所有权。

检查命令：node scripts/discovery/validate.mjs（含SEO全站校验）、node --test scripts/discovery/test/*.test.mjs。IndexNow手动重试：node scripts/discovery/submit-indexnow.mjs --force；只在需要重试时使用，日常部署按内容变更自动通知。

2026-11-05：浏览器中的Google、Bing、百度站长平台均显示未登录，无法核实账户内的所有权、站点地图接收和真实索引覆盖。这不是“站点尚未收录”的判定。需由用户登录自己的账户后继续检查。统一提交的站点地图为 https://www.scurra.top/sitemap.xml 。

参考：[Google标题与摘要](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)、[Google站点地图](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[Bing站长指南](https://www.bing.com/webmasters/help/bing-webmaster-guidelines-30fba23a)、[IndexNow协议](https://www.indexnow.org/documentation)、[百度标题规范](https://ziyuan.baidu.com/college/articleinfo?id=2726)。
