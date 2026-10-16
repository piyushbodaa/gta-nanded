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
range_results = []
for media, content_types in [('nanded-opening.mp4', {'video/mp4'}), ('launch-theme.m4a', {'audio/mp4', 'audio/x-m4a'})]:
    request = urllib.request.Request(BASE + '/media/' + media, headers={'Range': 'bytes=0-1023'})
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.status == 206, f'Media range requests must work: {media}'
        assert response.headers.get_content_type() in content_types, media
        assert len(response.read()) == 1024
    range_results.append({'path': 'media/' + media, 'status': 206})
print(json.dumps({'url': BASE, 'result': 'PASS', 'mediaRangeRequests': range_results, 'verifiedFiles': verified}, indent=2))
