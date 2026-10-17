# Contributing to GTA Nanded

Thanks for helping build Nanded in the browser. Bug fixes, new places, activities, performance work and better phone controls are all welcome.

## Get the game running

You need Node.js 20.19+ or 22.12+ (Python 3 only if you regenerate the city data).

```sh
git clone https://github.com/piyushbodaa/gta-nanded.git
cd gta-nanded
npm ci
npm run dev
```

Open the URL Vite prints (normally http://localhost:5173). On a phone on the same Wi-Fi network, use your computer's network address; the dev server listens on all interfaces.

## Before you open a pull request

Run the same checks the maintainer runs before every release:

```sh
npm test                        # unit tests (node --test)
node scripts/verify-world.mjs   # city geometry and collision smoke test
npm run build                   # production build
```

All three must pass. If you changed anything visible, play it in the browser too, on desktop and in a phone-sized window (portrait and landscape), and include a screenshot or short clip in the pull request.

If you edit anything in `research/` or `research/placement-overrides.json`, regenerate the city data with `python scripts/build-city-data.py` and commit the regenerated files alongside your change.

## Pull request guidelines

- Fork the repository, branch from `master` and keep each pull request to one focused change.
- Describe what changed and how you tested it. Link the issue if there is one.
- Add or update tests in `tests/` for game logic (physics, missions, navigation, traffic, controls).
- Match the surrounding code: its naming, comment density and compact style. Comments explain *why*, not *what*.
- Keep the game working with only a keyboard, only touch, and with sound off.
- Never commit secrets, `.env*` files or the `.vercel/` folder.

## Content guidelines

- Art, models, audio and text must be original or under a licence that allows redistribution. Say where any asset came from.
- Real places must link to a public source, as the existing records in `research/` do. Do not add private homes, people's names or contact details.
- Stories and activities are fictional; keep them friendly and local.
- Street data from OpenStreetMap stays under the ODbL (see `LICENSE`).

## Releases

The maintainer reviews and merges pull requests and deploys the live game at https://gta.nanded.fun. Contributors don't need deployment access.

By contributing, you agree that your contribution is licensed under the MIT License in `LICENSE`.
