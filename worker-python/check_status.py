import urllib.request, json, os
req = urllib.request.Request(
    "http://localhost:3001/status",
    headers={"Authorization": f"Bearer {os.environ['WORKER_SECRET']}"},
)
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())
    print(json.dumps(data, indent=2, ensure_ascii=False))
