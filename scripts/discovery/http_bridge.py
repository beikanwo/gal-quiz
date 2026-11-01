"""Read only public Bilibili endpoints with curl_cffi's browser HTTP transport.
No browser session extraction; user cookies come only from the configured secret.
"""
import json
import os
import sys
from urllib.parse import urlparse
from curl_cffi import requests

ALLOWED = {
    "/x/web-interface/search/type", "/x/web-interface/wbi/search/type",
    "/x/web-interface/view", "/x/web-interface/nav", "/x/frontend/finger/spi",
}
try:
    target = sys.argv[1]
    url = urlparse(target)
    if url.scheme != "https" or url.hostname != "api.bilibili.com" or url.path not in ALLOWED:
        raise ValueError("not a public metadata endpoint")
    cookie = os.environ.get("DISCOVERY_BILI_COOKIE", "")
    response = requests.get(target, impersonate="chrome", timeout=25,
                            headers={"Referer": "https://www.bilibili.com/", **({"Cookie": cookie} if cookie else {})})
    if response.status_code != 200:
        print(json.dumps({"transportError": response.status_code}))
    else:
        print(json.dumps(response.json(), ensure_ascii=False))
except Exception:
    print(json.dumps({"transportError": "unavailable"}))
