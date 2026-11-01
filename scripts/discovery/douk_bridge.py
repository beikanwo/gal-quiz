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


async def collect(args):
    sys.path.insert(0, args.repo)
    from src.testers.params import Params
    from src.interface.search import Search

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
            likes = item.get("statistics", {}).get("digg_count")
            if not isinstance(likes, int) or not isinstance(item.get("create_time"), int):
                continue
            post_id = str(item["aweme_id"])
            if not post_id.isdigit():
                continue
            kind = "image" if item.get("images") else "video"
            records.append({
                "platform": "douyin", "id": post_id,
                "title": str(item.get("desc", ""))[:4000], "description": "",
                "tags": [str(t.get("hashtag_name", "")) for t in item.get("text_extra", [])],
                "kind": kind,
                "url": "https://www.douyin.com/" + ("note/" if kind == "image" else "video/") + post_id,
                "publishedAt": datetime.datetime.fromtimestamp(item["create_time"], datetime.timezone.utc).isoformat(),
                "likes": likes,
                "collectedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            })
        if not records and raw != [[]]:
            return {"status": "failed", "error": "抖音返回结构无法验证，未发布本轮数据。"}
        return {"status": "partial" if partial else "success", "records": records, "pages": args.pages}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--keyword", required=True)
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
