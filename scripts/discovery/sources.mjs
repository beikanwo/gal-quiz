import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pause, failure } from './io.mjs';
import { canonicalEvidenceUrl } from './core.mjs';
const execute = promisify(execFile);
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").slice(0, 4000);
const iso = (seconds) => Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? new Date(Number(seconds) * 1000).toISOString() : null;
export async function fetchJson(url, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25000) });
      if (response.status === 412 && new URL(url).hostname === 'api.bilibili.com') {
        const root = path.resolve(process.env.DOUK_ROOT ?? '.cache/douk');
        const python = process.env.DOUK_PYTHON ?? path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
        try {
          const result = await execute(python, [path.resolve('scripts/discovery/http_bridge.py'), String(url)], { timeout: 35000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, DISCOVERY_BILI_COOKIE: options.headers?.Cookie ?? '' } });
          const data = JSON.parse(result.stdout);
          if (!data.transportError) return data;
        } catch { /* Report the actual platform failure after bounded retries. */ }
      }
      if (!response.ok) throw failure(`上游接口返回 HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 2) throw error;
      await pause(1500 * (attempt + 1));
    }
  }
}
const mixinTable = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
export function signWbi(params, imageKey, subKey, timestamp = Math.floor(Date.now() / 1000)) {
  const key = mixinTable.map((i) => (imageKey + subKey)[i]).join('').slice(0, 32);
  const input = { ...params, wts: timestamp };
  const query = Object.keys(input).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(input[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${createHash('md5').update(query + key).digest('hex')}`;
}
export class BilibiliSource {
  constructor() { this.cookie = process.env.BILIBILI_COOKIE ?? ''; this.keys = null; this.details = new Map(); this.bootstrapped = false; }
  headers() { return { 'User-Agent': ua, Referer: 'https://www.bilibili.com/', ...(this.cookie ? { Cookie: this.cookie } : {}) }; }
  async search(keyword, pages = 3, period) {
    const records = [];
    if (!this.bootstrapped) {
      if (!this.cookie) {
        try {
          const spi = await fetchJson('https://api.bilibili.com/x/frontend/finger/spi', { headers: this.headers() });
          if (spi.code === 0 && spi.data?.b_3) this.cookie = `buvid3=${spi.data.b_3}; buvid4=${spi.data.b_4 ?? ''}`;
        } catch { /* Public search may still work without guest identifiers. */ }
      }
      this.bootstrapped = true;
    }
    let fetched = 0;
    for (let page = 1; page <= pages; page++) {
      const params = { search_type: 'video', keyword, order: 'click', page, page_size: 20, pubtime_begin_s: Math.floor(Date.parse(period.start) / 1000), pubtime_end_s: Math.floor(Date.parse(period.end) / 1000) - 1 };
      let result = await fetchJson(`https://api.bilibili.com/x/web-interface/search/type?${new URLSearchParams(params)}`, { headers: this.headers() });
      if (result.code !== 0) {
        if (!this.keys) {
          const nav = await fetchJson('https://api.bilibili.com/x/web-interface/nav', { headers: this.headers() });
          const wbi = nav.data?.wbi_img;
          if (wbi) this.keys = [wbi.img_url, wbi.sub_url].map((u) => u.split('/').pop().split('.')[0]);
        }
        if (!this.keys) throw failure('B站搜索需要有效登录状态或请求签名。');
        result = await fetchJson(`https://api.bilibili.com/x/web-interface/wbi/search/type?${signWbi(params, ...this.keys)}`, { headers: this.headers() });
      }
      if (result.code !== 0 || !Array.isArray(result.data?.result) && Number(result.data?.numResults) !== 0) throw failure(`B站搜索未返回可靠数据（接口代码 ${Number.isFinite(result.code) ? result.code : '未知'}）。`);
      fetched++;
      const items = result.data.result ?? [];
      if (!items.length) break;
      for (const item of items) {
        if (!iso(item.pubdate) || Date.parse(iso(item.pubdate)) < Date.parse(period.start) || Date.parse(iso(item.pubdate)) >= Date.parse(period.end)) continue;
        // Search results do not reliably expose likes; always fetch actual detail statistics.
        let detail = this.details.get(item.bvid);
        if (!detail) {
          await pause(850);
          detail = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(item.bvid)}`, { headers: this.headers() });
          this.details.set(item.bvid, detail);
        }
        if (detail.code !== 0 || !Number.isInteger(detail.data?.stat?.like)) throw failure('B站视频详情未返回可靠点赞数，本轮未发布。');
        const d = detail.data;
        records.push({ platform: 'bilibili', id: d.bvid, title: clean(d.title), description: clean(d.desc), tags: String(item.tag ?? '').split(','), url: canonicalEvidenceUrl('bilibili', d.bvid), publishedAt: iso(d.pubdate), likes: d.stat.like, collectedAt: new Date().toISOString(), keyword });
      }
      await pause(1300);
    }
    return { records, pages: fetched };
  }
}
export class DouyinSource {
  async search(keyword, pages = 3) {
    const root = path.resolve(process.env.DOUK_ROOT ?? '.cache/douk');
    const python = process.env.DOUK_PYTHON ?? path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
    let result;
    try {
      result = await execute(python, [path.resolve('scripts/discovery/douk_bridge.py'), '--repo', root, '--keyword', keyword, '--pages', String(pages)], { timeout: 150000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: process.env });
    } catch { throw failure('抖音采集进程未就绪或请求超时；请安装固定版本的 DouK 并配置登录状态。'); }
    let data;
    try { data = JSON.parse(result.stdout); } catch { throw failure('抖音采集进程未返回有效数据。'); }
    if (data.status !== 'success') throw failure(data.error ?? '抖音采集失败，请更新登录状态。');
    return { records: data.records.map((r) => ({ ...r, keyword })), pages: data.pages };
  }
}
