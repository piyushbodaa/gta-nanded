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

## Published release — 16 October 2026, 17:02 UTC

- Public branding: **GTA NANDED**.
- Production deployment: `dpl_8PK9pxG4KX2WAgVdKyxh8QLLLTvb` (READY).
- Deployed source commit: `6447dda`.
- Primary URL: https://gta.nanded.fun
- Deployment URL: https://nanded-street-stories-9j83j3jsx-piyushbodaa.vercel.app
- Custom hostname resolves normally with valid HTTPS and no sign-in required.
- All 12 production files match the local build byte for byte: HTML, five JS/CSS
  bundles, two map datasets and four media/provenance files (11,179,140 bytes).
  Video byte-range requests return HTTP 206.
- Evidence: [release hashes](artifacts/verification/live-release.json),
  [live entrance](artifacts/verification/gta-marathi-entrance.png),
  [Marathi film frame](artifacts/verification/gta-marathi-film.jpg).
- Entrance and opening film display **“उगं नव्हं मय, नांदेड हाय नांदेड!”**.
  Marathi greeting and fictional coaching, chai, station and college dialogue
  accompany English controls and mission directions.
- Browser checks covered desktop, 390×844 portrait and 844×390 landscape:
  title/branding, Marathi layout, film completion, spawn greeting and expanded
  mission dialogue. A shorter laptop layout keeps the footer clear. The custom
  production hostname rendered correctly with no console errors.
- Updated film: 18.00 seconds, 540 frames, 1280×720 H.264 yuv420p,
  AAC 48 kHz, faststart, 4,295,984 bytes. Full decode passed; Devanagari
  conjuncts and vowel marks were visually checked using Noto Sans Devanagari
  Bold with HarfBuzz shaping.

The city still contains 129 researched places (64 mapped locations, 65 area
anchors), 53 locality labels and the public Zenda Chowk starting point in
Taroda Khurd. The previous mechanics verification covered 14 tests, all 129
approaches and 409,253 samples along 26,252 road edges with no obstruction.
Keyboard driving, touch driving, GPS, guide search and map toggles were
verified in the preceding city release; this update changes branding, copy,
typography and film titles. Responsive checks use browser viewports, not
physical iOS/Android devices.

Previous city release: `dpl_AqGxGLJVM325Yv42vTQnjg5GZmfB`, source `34e0f16`.
The original smaller-city release was `dpl_4uUyJLjHhHTNydxf3ARdzkggoFkB`,
source `2e274eb`; its temporary local DNS cache issue is resolved.
