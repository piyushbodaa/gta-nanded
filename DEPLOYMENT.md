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
