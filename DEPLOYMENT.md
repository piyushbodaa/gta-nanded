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

The Vercel project is connected to the GitHub repository
`piyushbodaa/gta-nanded`, so releases are automatic:

- **Every pull request and branch push** gets a preview deployment. Vercel
  posts its link on the pull request; previews sit behind Vercel login.
  Pull requests from forks build only after a maintainer authorises them in
  Vercel.
- **Every merge or push to `master`** deploys to production at
  `https://gta.nanded.fun` within about a minute.

Merge only after the checks in CONTRIBUTING.md pass and the preview has been
played. To deploy by hand (for example to redeploy without a new commit), use
the linked checkout. It is linked through ignored `.vercel/project.json`;
verify that the target is `piyushbodaa/nanded-street-stories` first:

```sh
npx --yes vercel@64.3.1 project inspect --non-interactive --scope piyushbodaa
npx --yes vercel@64.3.1 deploy --prod --yes --scope piyushbodaa
```

Keep `.vercel/` and `.env*` ignored. Linking downloads an authentication token
to `.env.local`; it must never enter source control or a shared archive.

After deployment, verify the real game page and JavaScript assets at
`https://gta.nanded.fun`, then perform a gameplay check on that domain.

## Current release — on-foot adventures, 17 October 2026 (India)

- Production deployment: `dpl_HdWWAczr62HxccwMYrhwnRWRem6B` (READY).
- Deployed source commit: `09a948d`.
- Primary URL: https://gta.nanded.fun
- Deployment URL: https://nanded-street-stories-k2am21hhc-piyushbodaa.vercel.app
- Story and free roam start on foot at Zenda Chowk. The untimed opening asks
  the player to talk to a friend, explore the nearby lane and take a photo.
  Cars are optional; Jump, Run and contextual Talk/Photo work on keyboard
  and the phone controls.
- The activity picker offers nine adventures: local conversations, photo
  walks, an on-foot sprint, a street circuit and an arcade pursuit.
- The landmark passport offers 17 stops among 133 researched places. Each
  new stamp earns ₹150 once; stamps and cash save together. The catalog has
  64 mapped places and 69 approximate area anchors, with 53 locality labels.
  Models are illustrations, not surveyed architectural replicas.
- Added distinct Hazur Sahib, Mal Tekdi, Kaleshwar, Vishnupuri Dam, ghat,
  Clock Tower and Nandgiri Fort details. Landmark visits arrive on foot,
  face the landmark and clear nearby vehicles from the arrival spot.
- Production build and all 66 tests pass. World verification covers all
  133 approaches and 409,253 road samples; activity checks cover nine starts,
  23 checkpoints and 5,410 route samples without physical obstructions.
- Local browser checks covered desktop, portrait 390×844 and landscape
  844×390: on-foot spawn, talk and walking progression, jump, activity
  switching, race/pursuit entry, landmark visits, photo rewards, duplicate
  reward prevention and save persistence after reload. Physical phone
  hardware has not been tested.
- Public HTTPS verification at 18:50 UTC on 16 October: all 17 files match
  `dist/` byte for byte (12,589,198 bytes), and media range requests return
  HTTP 206. Live story launch, Talk progression, all nine menu entries,
  Hazur Sahib arrival and its ₹150/one-stamp photo reward passed. Browser
  console warnings and errors were empty.
- Opening music remains the original track. The requested San Andreas
  theme is pending a user-provided audio file authorized for this website.
- Evidence: [release hashes](artifacts/verification/live-release.json),
  [live on-foot opening](artifacts/verification/live-on-foot-adventures.png),
  [live activity menu](artifacts/verification/live-adventure-menu.png),
  [live Hazur Sahib passport](artifacts/verification/live-hazur-passport.png),
  [landscape Clock Tower](artifacts/verification/clock-tower-landscape.png).

## Previous release — camera and map controls, 16 October 2026

- Production deployment: `dpl_68zr5tCjm9NLxniPUjy1pyEVUVLh` (READY).
- Deployed source commit: `3f76a68`.
- Primary URL: https://gta.nanded.fun
- Deployment URL: https://nanded-street-stories-gadgj386h-piyushbodaa.vercel.app
- Drag or swipe the open street to orbit and tilt. The Center camera button or
  C restores the chase view; walking follows the view. Driving recenters after
  two seconds without a camera gesture. Pointer ownership permits looking
  while another finger holds a driving button, and releases cleanly on cancel,
  pause, map, blur and visibility changes.
- The camera shortens its distance before buildings, roofs and elevated signs,
  including during interpolation. Signs only obstruct the camera at their
  actual height; physical movement colliders are unchanged.
- Player arrows on both north-up maps now match world facing. The GPS-card
  arrow responds to the destination bearing relative to the camera.
- Production build and all 54 tests pass, including 10 camera gesture/lifecycle
  tests, 11 obstruction tests and 5 map/GPS direction tests.
- Browser checks covered desktop 1576×807, portrait 390×844 and landscape
  844×390: drag/tilt, reset, walking after orbit, street-control focus, sign
  clearance and GPS bearing updates. Physical iOS/Android multitouch has not
  been tested; simultaneous pointer ownership is covered by automated tests.
- Public HTTPS verification at 18:00 UTC: all 17 files match `dist/` byte for
  byte (12,547,899 bytes), and media range requests return HTTP 206. Production
  gameplay, mouse orbit, reset, guide selection and GPS rotation passed with
  no browser console warnings or errors.
- Evidence: [release hashes](artifacts/verification/live-release.json),
  [live camera and GPS](artifacts/verification/live-camera-controls.png),
  [landscape controls](artifacts/verification/camera-phone-landscape.png),
  [camera sign clearance](artifacts/verification/camera-wall-clearance.png).

## Previous release — comic entrance, 16 October 2026

- Production deployment: `dpl_6QXNDNadnRrVE19i8LxS8pWQPbvE` (READY).
- Deployed source commit: `eb238e4`.
- Primary URL: https://gta.nanded.fun
- Deployment URL: https://nanded-street-stories-fekgtfzkq-piyushbodaa.vercel.app
- Four original comic illustrations, a split-panel cover, outlined GTA NANDED
  title, Marathi banner and a four-choice game menu replace the earlier poster.
- The opening now uses a responsive 12-second animated panel sequence with
  diagonal scene transitions, a Marathi character scene, title assembly and
  a 400 ms curtain into gameplay. The old MP4 remains an archived asset.
- Sound starts off. The optional original soundtrack is AAC 48 kHz, 12 seconds,
  195,380 bytes, fades before gameplay and passes a full decode check.
- Build and all 28 tests pass: 14 gameplay/navigation checks plus 14 intro
  lifecycle checks for skip, replay, focus, visibility, failure and cleanup.
- Browser verification covered 1576×807 desktop, 390×844 and 320×568 portrait,
  and 844×390 landscape. Story Drive naturally enters Zenda Chowk; Escape skips
  into Free Roam without opening Pause; City Guide opens after Skip; Replay
  returns to the menu. These are browser viewport checks, not physical devices.
- Public HTTPS verification at 17:28 UTC: all 17 files match `dist/` byte for
  byte (12,543,155 bytes), with HTTP 206 range support for both audio and the
  archived MP4. The live phone opening, opt-in sound, title reveal, Zenda spawn
  and post-opening driving were checked with no browser console errors.
- Evidence: [release hashes](artifacts/verification/live-release.json),
  [live cover](artifacts/verification/live-comic-entrance.png),
  [phone opening](artifacts/verification/comic-phone-launch.png),
  [portrait menu](artifacts/verification/comic-phone-portrait.png),
  [landscape menu](artifacts/verification/comic-phone-landscape.png).
- [Artwork prompts and saved paths](research/launch-art-prompts.json) record
  the built-in image-generation mode and the four original illustrations.

## Previous release — 16 October 2026, 17:02 UTC

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
