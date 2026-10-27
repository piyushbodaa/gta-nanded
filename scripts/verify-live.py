#!/usr/bin/env python3
"""Compare the public release to the build: every built file, and the cache rules that let a
release reach returning players."""
from pathlib import Path
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://gta.nanded.fun'
# Files that keep their name across releases must be revalidated, or browsers keep the old copy.
FRESH = {'sw.js': 'no-cache', 'data/world.json': 'max-age=0'}
paths = sorted(p.relative_to(ROOT / 'dist') for p in (ROOT / 'dist').rglob('*') if p.is_file())
verified = []
for path in paths:
    local = (ROOT / 'dist' / path).read_bytes()
    request = urllib.request.Request(BASE + ('/' if str(path) == 'index.html' else '/' + path.as_posix()), headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=45) as response:
        remote = response.read()
        assert response.status == 200, path
        rule = FRESH.get(path.as_posix())
        assert not rule or rule in (response.headers.get('Cache-Control') or ''), f'Cache rule missing: {path}'
    assert hashlib.sha256(remote).digest() == hashlib.sha256(local).digest(), f'Build mismatch: {path}'
    verified.append({'path': path.as_posix(), 'bytes': len(remote), 'sha256': hashlib.sha256(remote).hexdigest()})
range_results = []
for media, content_types in [('launch-theme.m4a', {'audio/mp4', 'audio/x-m4a'})]:
    request = urllib.request.Request(BASE + '/media/' + media, headers={'Range': 'bytes=0-1023'})
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.status == 206, f'Media range requests must work: {media}'
        assert response.headers.get_content_type() in content_types, media
        assert len(response.read()) == 1024
    range_results.append({'path': 'media/' + media, 'status': 206})
print(json.dumps({'url': BASE, 'result': 'PASS', 'mediaRangeRequests': range_results, 'verifiedFiles': verified}, indent=2))
