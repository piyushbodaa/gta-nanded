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

## Release log

- **2.0 — the rewrite (October 2026).** A new engine from first principles:
  generated city on the real street map, vehicle physics, traffic and
  pedestrians, police and wanted levels, an eight-mission story, side jobs,
  procedural audio and radio, touch and gamepad controls. The service worker
  now fetches pages and data network-first, so a release reaches returning
  players on their next visit.
- Releases before 2.0 (the first edition: comic entrance, on-foot adventures,
  landmark passport) are recorded in this file's git history.

After each production deploy, open https://gta.nanded.fun in a fresh window,
start a New Story and drive the first mission, and check the console is clean.
