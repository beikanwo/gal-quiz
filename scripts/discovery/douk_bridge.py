"""Isolated GPL DouK process. Only sanitized metadata leaves stdout; no raw responses/logs.

Upstream: JoeanAmier/TikTokDownloader, pinned in config/discovery.json.
We import its API classes without modifying or vendoring the upstream source.
"""
import argparse
import asyncio
import contextlib
import datetime
import io
import json
import logging
import os
import sys


def extract(items):
    if isinstance(items, dict):
        if items.get("aweme_id") and "statistics" in items:
            yield items
        else:
            for key in ("aweme_info", "data", "items", "aweme_list"):
                if key in items:
                    yield from extract(items[key])
    elif isinstance(items, list):
        for item in items:
            yield from extract(item)


def nonnegative(value):
    return value if type(value) is int and 0 <= value <= 9007199254740991 else None


def normalize_item(item):
    stats = item.get("statistics", {})
    likes, timestamp = nonnegative(stats.get("digg_count")), item.get("create_time")
    post_id = str(item.get("aweme_id", ""))
    if likes is None or type(timestamp) is not int or not post_id.isdigit():
        return None
    kind = "image" if item.get("images") else "video"
    author = item.get("author") or {}
    uid, sec_uid = str(author.get("uid", "")), str(author.get("sec_uid", ""))
    safe_sec = sec_uid and all(c.isalnum() or c in "_-=" for c in sec_uid)
    metrics = {"favorites": nonnegative(stats.get("collect_count")), "comments": nonnegative(stats.get("comment_count")), "shares": nonnegative(stats.get("share_count")), "views": None, "coins": None}
    return {
        "platform": "douyin", "id": post_id, "title": str(item.get("desc", ""))[:4000], "description": "",
        "tags": [str(t.get("hashtag_name", "")) for t in item.get("text_extra", [])], "kind": kind,
        "url": "https://www.douyin.com/" + ("note/" if kind == "image" else "video/") + post_id,
        "publishedAt": datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).isoformat(), "likes": likes,
        "author": {"id": uid, "name": str(author.get("nickname", ""))[:100], "url": "https://www.douyin.com/user/" + sec_uid if safe_sec else None} if uid.isdigit() else None,
        "durationSeconds": nonnegative(item.get("duration")) / 1000 if kind == "video" and nonnegative(item.get("duration")) is not None else None,
        "metrics": metrics, "metricAvailability": {k: ("unsupported" if k in ("views", "coins") else "available" if v is not None else "missing") for k, v in metrics.items()},
        "collectedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


async def collect(args):
    sys.path.insert(0, args.repo)
    from src.testers.params import Params
    from src.interface.search import Search
    from src.interface.detail import Detail

    class EphemeralParams(Params):
        def read_ini(self):
            # Deliberately avoid the upstream on-disk cookie configuration.
            self.cookie_str = os.environ.get("DOUYIN_COOKIE", "")
            for entry in self.cookie_str.split(";"):
                key, _, value = entry.strip().partition("=")
                if key == "msToken":
                    self.ms_token = value
                elif key == "uifid":
                    self.uifid = value

    async with EphemeralParams() as params:
        params.max_retry = 1
        Search.params["msToken"] = params.ms_token
        Search.params["uifid"] = params.uifid
        if args.detail_ids:
            records, failed = [], []
            for post_id in args.detail_ids.split(",")[:20]:
                if not post_id.isdigit():
                    continue
                try:
                    raw = await Detail(params, cookie=params.cookie_str, detail_id=post_id).run()
                    normalized = [normalize_item(item) for item in extract(raw)]
                    normalized = [r for r in normalized if r and r["id"] == post_id]
                    if normalized:
                        records.extend(normalized)
                    else:
                        failed.append(post_id)
                except Exception:
                    failed.append(post_id)
                await asyncio.sleep(0.8)
            return {"status": "partial" if failed else "success", "records": records, "failedIds": failed}
        search = Search(params, cookie=params.cookie_str, keyword=args.keyword,
                        channel=0, pages=args.pages, sort_type=2, publish_time=0)
        partial = False
        try:
            raw = await search.run()
        except Exception:
            raw = search.response
            partial = True
        # Upstream appends an empty page for a valid no-results response.
        if not raw:
            return {"status": "failed", "error": "抖音未返回可验证的搜索结果，请更新 Cookie 或检查平台限制。"}
        records = []
        for item in extract(raw):
            record = normalize_item(item)
            if record:
                records.append(record)
        if not records and raw != [[]]:
            return {"status": "failed", "error": "抖音返回结构无法验证，未发布本轮数据。"}
        return {"status": "partial" if partial else "success", "records": records, "pages": args.pages}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--keyword", default="")
    parser.add_argument("--detail-ids", default="")
    parser.add_argument("--pages", type=int, default=3)
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = asyncio.run(collect(args))
    except Exception:
        result = {"status": "failed", "error": "抖音采集失败，可能需要有效 Cookie；请检查固定版本依赖与登录状态。"}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
