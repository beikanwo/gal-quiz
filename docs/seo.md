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

2026-11-05实测（使用用户授权的Chrome现有登录）：

- Google：现有DNS自动验证www主站资源，重新提交sitemap.xml成功；后台当日已读取新版地图，状态“成功”，发现2,655个网页。这是地图发现数量，不是全部已编入索引的数量。效果及覆盖报表仍在处理。
- Bing：已有主站资源与历史搜索数据，主站sitemap.xml重新提交后状态Processing，等待重新抓取；不把旧的2条发现数当成新地图处理结果。IndexNow首次HTTP403，校验文件传播后重试HTTP200，已接收2,655个网址；部署脚本已加入403的两次短暂重试，最终失败仍会明确报告。
- 百度：已有www主站资源，sitemap提交额度和存量文件额度均为0；尝试手动提交首页、目录、新手指南、问卷及10部真实热榜作品，共20页。由用户完成人机验证后，平台返回“您今日的链接提交量已达上限，请改天提交”，本轮未被接受。没有改动准入密钥，没有将其存入代码或GitHub。robots.txt继续公开规范地图，正常抓取无需这次主动推送成功。

统一站点地图为 https://www.scurra.top/sitemap.xml ，HTTP200，2,655条可索引规范网址；站内搜索和滚动调试两页排除。首页/index.html及目录index.html均跳转到规范网址，已保留推广参数。基础SEO是后续收录与观察的条件，不代表排名提升已经发生。验证凭证位于本地design/seo/（不随公开仓库发布）。

参考：[Google标题与摘要](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)、[Google站点地图](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[Bing站长指南](https://www.bing.com/webmasters/help/bing-webmaster-guidelines-30fba23a)、[IndexNow协议](https://www.indexnow.org/documentation)、[百度标题规范](https://ziyuan.baidu.com/college/articleinfo?id=2726)。
