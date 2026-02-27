import urllib.request, json, os

data = json.dumps({"fonteId": "69101545-d4a0-46d1-90e7-935469cdf024"}).encode()
req = urllib.request.Request(
    "http://localhost:3001/crawl",
    data=data,
    headers={
        "Authorization": f"Bearer {os.environ['WORKER_SECRET']}",
        "Content-Type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(req) as resp:
    print(resp.status, json.loads(resp.read()))
