# Deployment

The game uses Vercel project `nanded-street-stories` in the `piyushbodaa` team.
Its production domain is `gta.nanded.fun`.

- Project ID: `prj_HYjBOpkXRMYsOgftLSgI2FDMRv5I`
- Team ID: `team_e0sJjNMQndZdaCpKL27DwSMg`
- Build: `npm ci` followed by `npm run build`
- Published directory: `dist`
- Framework: Vite

## Domain

Keep the existing Hostinger nameservers and apex website. The new subdomain
requires this record in the `nanded.fun` DNS zone:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| CNAME | `gta` | `5322b10ae5c74cf1.vercel-dns-016.com.` | 300 |

The Vercel domain attachment is ownership-verified. DNS must also resolve to
Vercel before the public HTTPS address works. Do not change the separate
`counterstrike.nanded.fun` project.

## Release

The checkout is linked through ignored `.vercel/project.json`. Verify that
the target is `piyushbodaa/nanded-street-stories`, then publish only after the
game's build and browser checks pass:

```sh
npx --yes vercel@64.3.1 project inspect --non-interactive --scope piyushbodaa
npx --yes vercel@64.3.1 deploy --prod --yes --scope piyushbodaa
```

Keep `.vercel/` and `.env*` ignored. Linking downloads an authentication token
to `.env.local`; it must never enter source control or a shared archive.

After deployment, verify the real game page and JavaScript assets at
`https://gta.nanded.fun`, then perform a gameplay check on that domain.

## Published release — 16 October 2026, 16:51 UTC

- Production deployment: `dpl_AqGxGLJVM325Yv42vTQnjg5GZmfB` (READY)
- Deployed source commit: `34e0f16`
- Primary URL: https://gta.nanded.fun
- Deployment URL: https://nanded-street-stories-cjlv5zus9-piyushbodaa.vercel.app
- The custom hostname resolves normally, with valid HTTPS and no sign-in required.
- All 12 production files checked against the local build match byte for byte:
  HTML, five JS/CSS bundles, two map datasets and four media/provenance files
  (11,184,227 bytes). Video byte-range requests return HTTP 206.
- Evidence and file hashes: [live-release.json](artifacts/verification/live-release.json).
- 129 places, 64 mapped locations and 65 area anchors; 53 locality labels.
- Starts on the street beside the public Zenda Chowk pin in Taroda Khurd.
- Original illustrated entrance and an 18-second opening film, with skip,
  replay, optional sound and a reduced-motion/video-error fallback.
- Mobile minimap and job detail toggles, touch controls, portrait and landscape
  layouts, and best-effort fullscreen/orientation support.
- Fourteen mechanics, data, spawn, routing and collision tests passed.
  The geometry smoke checked all 129 approaches and 409,253 samples along
  26,252 road edges without a road obstruction.
- Chrome checks on the production build covered 390×844 portrait and 844×390
  landscape, film playback/replay/skip/sound, entering a car, touch acceleration,
  map toggling, searchable places and setting a GPS route. Desktop entrance and
  the opening were also checked directly on the custom production hostname.
  A final keyboard guard fix was verified with W acceleration in preview,
  arrow-key acceleration on production, M map search and Escape close/pause.
  No new console errors appeared after that fix.
  These are browser viewport checks, not physical iOS/Android device testing.
- Film verification: 540 frames, 18.00 seconds, 1280×720, H.264 yuv420p,
  AAC 48 kHz, faststart, 4,304,203 bytes; full audio/video decode passed.

The earlier 16 October release (`dpl_4uUyJLjHhHTNydxf3ARdzkggoFkB`, source
`2e274eb`) was the initial smaller city. Its temporary local DNS cache issue is
resolved and does not apply to this release.
