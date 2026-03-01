import os, urllib.request, json
secret = os.environ.get('WORKER_SECRET','')
data = json.dumps({'fonteId': 'd3c4659b-ac75-4bb5-9a0d-c095402d79ad'}).encode()
req = urllib.request.Request('http://localhost:3001/crawl', data=data, method='POST')
req.add_header('Content-Type', 'application/json')
req.add_header('Authorization', 'Bearer ' + secret)
with urllib.request.urlopen(req) as resp:
    print(resp.read().decode())
