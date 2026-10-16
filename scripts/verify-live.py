#!/usr/bin/env python3
"""Compare the public release to the build, including media and derived map data."""
from pathlib import Path
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://gta.nanded.fun'
paths = [Path('index.html')]
paths += sorted(p.relative_to(ROOT / 'dist') for folder in ['assets', 'media', 'data'] for p in (ROOT / 'dist' / folder).rglob('*') if p.is_file())
verified = []
for path in paths:
    local = (ROOT / 'dist' / path).read_bytes()
    request = urllib.request.Request(BASE + ('/' if str(path) == 'index.html' else '/' + path.as_posix()), headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=45) as response:
        remote = response.read()
        assert response.status == 200, path
    assert hashlib.sha256(remote).digest() == hashlib.sha256(local).digest(), f'Build mismatch: {path}'
    verified.append({'path': path.as_posix(), 'bytes': len(remote), 'sha256': hashlib.sha256(remote).hexdigest()})
request = urllib.request.Request(BASE + '/media/nanded-opening.mp4', headers={'Range': 'bytes=0-1023'})
with urllib.request.urlopen(request, timeout=30) as response:
    assert response.status == 206, 'Video range requests must work'
    assert response.headers.get_content_type() == 'video/mp4'
    assert len(response.read()) == 1024
print(json.dumps({'url': BASE, 'result': 'PASS', 'videoRangeRequests': 'PASS', 'verifiedFiles': verified}, indent=2))
