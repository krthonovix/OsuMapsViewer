# osu! replay viewer

A browser viewer for osu!standard `.osr` replays. Upload only a replay file: the browser reads its movements, and the server looks up the exact beatmap by checksum.

## Features

- Reads LZMA-compressed `.osr` files, including player details, mods, score, judgments, life graph, and cursor frames.
- Finds a beatmap by MD5 checksum, verifies the exact `.osu` file, and retrieves audio and background artwork when available.
- Renders hit objects, the cursor, key presses, and hit results with sprites extracted from the supplied `Rafis +HDDT.osk` skin.
- Estimates the replay lead-in automatically and provides a manual sync adjustment when needed.
- Updates score, accuracy, combo, judgments, and the life bar during playback. The player supports seeking, volume, background dimming, speed controls, fullscreen, and jumps between results below 300.

The default provider is [Hinamizawa](https://mirror.hinamizawa.ai/docs/beatmap-download), which documents MD5 lookup and `.osz` downloads without an API key. Availability depends on that service.

## Requirements

- Node.js 24 or later
- npm
- Internet access from the server for automatic beatmap lookup and downloads

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173`. The API runs at `http://127.0.0.1:3001`.

### Automatic beatmap lookup

With empty osu! API credentials, the server uses [Hinamizawa's MD5 index](https://mirror.hinamizawa.ai/docs/beatmap-info) and its [download endpoint](https://mirror.hinamizawa.ai/docs/beatmap-download). It checks the downloaded `.osu` file against the replay checksum before showing the beatmap. Users only need to upload an `.osr` file.

For a public deployment, set `APP_CONTACT_URL` to a contact page or repository URL so the provider can identify the application's traffic through its User-Agent.

### Alternative provider

Set these values in `.env` when needed:

```text
OSU_CLIENT_ID=...
OSU_CLIENT_SECRET=...
OSZ_URL_TEMPLATE=https://authorized-provider.example/maps/{beatmapsetId}.osz
OSZ_AUTH_TOKEN=...
APP_CONTACT_URL=https://your-site.example/contact
```

`OSZ_AUTH_TOKEN` is optional. If present, the server sends it as a bearer token to the provider. The provider must return a ZIP `.osz` over HTTPS. The server operator controls the URL template; the browser cannot supply arbitrary URLs.

With `OSU_CLIENT_ID` and `OSU_CLIENT_SECRET`, checksum lookup uses the [official osu! API](https://osu.ppy.sh/docs/#lookup-beatmap). Downloads still use Hinamizawa unless `OSZ_URL_TEMPLATE` is set. The [official beatmapset download endpoint](https://osu.ppy.sh/docs/#get-api-v2-beatmapsets-beatmapset-download) documents `OAuth lazer` access and is not used here. A package without the exact `.osu` revision is rejected.

### Test with a local beatmap

Before accessing a provider, the server checks `maps/<replay-checksum>.osz`. The checksum must be the MD5 of the exact `.osu` file bytes. This supports local testing while keeping the user's upload flow limited to one `.osr`.

```powershell
npm test
npm run build
npm run smoke:local
```

`smoke:local` requires the development server to be running. It creates a temporary sample package, checks the API endpoints, and removes the package. Local `.osz` packages are ignored by Git.

To inspect a replay from the terminal, run `npm run inspect:replay -- path/to/replay.osr`.

## Player controls

- **Space:** play or pause.
- **Left / Right Arrow:** seek backward or forward five seconds.
- **Timeline:** drag to a position; video stays there while the audio seeks, then both resume together.
- **Sync:** view the detected offset and adjust it when the replay provides too little data for reliable automatic alignment.
- **Review hits:** jump to the previous or next result below 300, starting 450 ms before that result.

## API

- `GET /api/health`: provider configuration status.
- `GET /api/maps/:checksum/manifest`: resource links for the verified difficulty, audio, and background when available.
- `GET /api/maps/:checksum/osu`: the verified difficulty file.
- `GET /api/maps/:checksum/audio`: audio when available; supports byte ranges.
- `GET /api/maps/:checksum/background`: background image when available.

## Skin assets

The included sprites were extracted from `Rafis +HDDT.osk`, which was supplied for this project. Its `skin.ini` identifies the skin as “Prawilosc vJP without followpoints” by DDK RPK. `scripts/extract-rafis-skin.mjs` records which assets are used and can repeat the extraction. Review the authors' permissions before redistributing these resources elsewhere.

## Limits and validation

- Only osu!standard replays are supported.
- Downloads are limited to 80 MB; relevant extracted files are limited to 250 MB in total and 80 MB each.
- Private or deleted beatmaps and some older revisions may not be available from the configured provider.
- The `.osr` format stores final score, combo, and judgment totals, but not every per-object result. Intermediate values are **estimates** reconstructed from input frames and beatmap objects, constrained by the recorded totals. A particular 100, 50, or miss may appear on a different object than in osu!stable; the displayed final totals match the replay file.
- Sliders and spinners are visual approximations. Some short replays may need a manual sync adjustment. Approach circles remain visible with Hidden to make the beatmap easier to read.
- Replays are processed in the browser and are not stored by the server. Retrieved beatmaps stay in a small in-memory cache while the server runs.

The build, unit tests, local HTTP smoke test, and real replay loading have been verified. A public replay of “Gravity Falls Theme Song” matched 153 hit inputs after lead-in detection. The supplied HD/DT `SAVE (Encore)` replay resolved 306 objects with a 1,307 ms lead-in and ended with its recorded 295 300s, 11 100s, score, accuracy, and max combo. More beatmaps and mods should be compared visually with osu!stable before claiming full game fidelity.

The broader roadmap is in [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md).
