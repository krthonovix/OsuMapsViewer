# Implementation plan: osu!standard replay viewer

> Current state: an initial browser viewer and beatmap lookup service are implemented. A public replay resolved its exact beatmap through Hinamizawa, and the supplied `SAVE (Encore)` replay has been used to check synchronization and progressive statistics. The build, tests, and local API smoke test pass. See [README.md](./README.md) for setup and current limitations.

## 1. Goal

Build a page where someone can drop or select **one `.osr` file** and watch an osu!standard replay in the browser. The app identifies and retrieves the matching beatmap, synchronizes playback with audio, and draws the cursor, key presses, and hit objects.

The main flow does not ask the user to upload an `.osu` or `.osz` file.

### Expected experience

1. The user uploads an `.osr` replay.
2. The page reports beatmap lookup and preparation progress.
3. The player opens with audio, controls, and play statistics.
4. If the exact beatmap revision cannot be found, the page explains why.

## 2. Scope

### Initial release

- One **osu!standard** replay (`mode = 0`) at a time.
- Beatmap identification using the checksum stored in the `.osr`.
- Automatic retrieval of the exact `.osu`, audio, and background when the configured provider has them.
- Rendering of circles, sliders, spinners, cursor movement, two key indicators, and hit results.
- Play, pause, seeking, playback speed, volume, background dimming, and fullscreen controls.
- Player, beatmap, difficulty, mods, score, accuracy, combo, judgments, and life graph.
- Clear errors for invalid files, unsupported modes, missing revisions, and provider failures.
- Responsive layout, with smooth desktop playback as the priority.

### Beyond the initial release

- Taiko, catch, and mania.
- Exact reconstruction of each historical judgment, combo change, and score increment.
- A beatmap editor, video recording, replay comparison, and user accounts.
- Full osu! client fidelity, including storyboards, videos, arbitrary skins, and all hitsounds.

These can be added without changing the one-file upload flow.

## 3. Format constraint

The `.osr` contains play metadata, the difficulty's MD5 checksum, mods, and compressed frames with time, cursor coordinates, and key state. **It does not contain beatmap objects or music.** The `.osu` defines objects and timings; an `.osz` usually includes the `.osu`, audio, and other resources. The viewer must obtain the exact difficulty elsewhere.

The checksum connects the replay to its beatmap. A beatmapset ID alone is not enough: an old `.osu` revision may be unavailable even when a newer revision exists. Never silently use a different revision.

The replay also records final score, max combo, and judgment counts, but not a per-object judgment history. Intermediate results therefore require reconstruction and must be presented as estimates.

## 4. User flow

```text
User drops an .osr
        │
        ▼
Browser reads metadata, checksum, and replay frames
        │
        ▼
Server checks its cache and looks up the checksum
        │
        ▼
Beatmap provider returns the beatmapset package
        │
        ▼
Server extracts the exact .osu and verifies its MD5
        │
        ▼
Browser loads beatmap, audio, and background
        │
        ▼
Player aligns audio, objects, cursor, and keys
```

A cached beatmap avoids repeated lookup and download. If lookup fails, show the replay metadata and a useful error instead of displaying it against an unrelated map.

## 5. Architecture

### Browser client

- **TypeScript** for the app and file readers.
- **React** for upload, state, controls, and panels; **Canvas 2D** for gameplay rendering. Consider WebGL only if measured performance requires it.
- An LZMA worker when available so decompression does not block the interface.
- Local `.osr` processing. The browser sends only the beatmap checksum to the server.
- One gameplay timeline. When audio is available, its playback time drives rendering. During seeking, freeze the selected frame until audio finishes moving, then resume them together.
- Replay-to-beatmap offset detection based on key presses and object positions, with a manual adjustment for uncertain cases.

### Beatmap service

- A small **Node.js and TypeScript** API in the same repository.
- Optional official osu! API authentication on the server; secrets never go to the browser.
- MD5 lookup through the configured source, followed by a configurable `.osz` provider.
- Package extraction, exact `.osu` MD5 verification, and delivery of only the needed resources.
- Size, timeout, and request-rate limits, plus a small in-memory cache and deduplication of simultaneous downloads.

### Current API contract

```text
GET /api/health
  → provider configuration status

GET /api/maps/{checksum}/manifest
  → verified difficulty, audio, and background resource URLs

GET /api/maps/{checksum}/osu
GET /api/maps/{checksum}/audio
GET /api/maps/{checksum}/background
  → verified resources, when available
```

The manifest and resource URLs must refer to the same verified beatmap. Distinct error codes include `NOT_FOUND`, `VERSION_UNAVAILABLE`, and `PROVIDER_UNAVAILABLE`.

## 6. Phase 0: verify one-file feasibility

This phase establishes that common replays can resolve without asking for an `.osz` upload.

1. Gather representative `.osr` files: ranked and loved maps, an old replay, an updated map, and an invalid file.
2. Extract each checksum and try beatmap lookup.
3. Check permitted access to packages with audio. Do not assume the official `GET /api/v2/beatmapsets/{beatmapset}/download` endpoint is available to an external web app; its documentation specifies `OAuth lazer` access.
4. Evaluate an alternative provider or an authorized private catalog, including availability, limits, terms, and cache policy.
5. Download a package and compare each extracted `.osu` MD5 against the replay checksum.
6. Record successful and unavailable cases, especially older revisions.

**Exit criterion:** at least one provider can retrieve exact beatmaps and audio for common test cases under acceptable terms. If this cannot be met, do not promise universal one-file playback.

The current initial integration uses Hinamizawa. Provider availability remains an operational dependency.

## 7. Implementation phases

### Phase 1: project foundation and `.osr` reader

- Set up the browser app, service, and development commands in one repository.
- Implement bounded binary parsing for mode, version, checksum, player, result counts, score, combo, mods, and timestamp.
- Decompress LZMA and convert frames to absolute time, coordinates, and key state.
- Ignore the special RNG seed frame when present.
- Reject unsupported modes and damaged files with specific messages.
- Build the upload screen and an initial replay data view.

**Acceptance:** real `.osr` files show correct metadata and movement; invalid files fail cleanly.

### Phase 2: beatmap lookup, download, and verification

- Implement checksum lookup and the configured package provider.
- Cache verified packages and deduplicate concurrent requests.
- Extract `.osu`, audio, and background with compressed and extracted size limits.
- Check the exact `.osu` checksum before declaring it available.
- Report recoverable errors to the client.

**Acceptance:** uploading only an `.osr` resolves a known beatmap and provides the correct difficulty and audio. A package with a different checksum is rejected.

### Phase 3: `.osu` reader and gameplay rendering

- Read metadata, difficulty, relevant events, timing points, and hit objects.
- Calculate slider duration from timing points, slider multiplier, and inherited velocity.
- Draw circles, sliders, and spinners on the 512 × 384 osu!standard playfield.
- Render approach circles and visibility based on approach rate and mods. The current viewer keeps approach circles visible with Hidden for readability.
- Apply relevant spatial and difficulty effects, starting with HR, EZ, and HD.

**Acceptance:** objects appear at the expected positions and times on test maps with different slider shapes and timing changes.

### Phase 4: synchronized replay playback

- Draw interpolated cursor motion and its trail.
- Show K1 and K2 without duplicating the mouse alias bits stored with keyboard input.
- Integrate audio, pause, seeking, volume, and speed controls.
- Handle DT, NC, and HT playback rates.
- Handle slow audio loading and repeated seeks without cumulative drift.
- Show player, beatmap, mods, and progressive estimated statistics.

**Acceptance:** playback, pause, and seeking keep audio, cursor, and objects at the same moment. Verify normal and speed-mod replays.

### Phase 5: quality and publication

- Improve long-map performance and avoid drawing objects outside the visible time window.
- Provide clear loading and unavailable-map states.
- Check keyboard use and smaller screens.
- Add operational logging without storing the user's `.osr`.
- Deploy the app and service with secrets, domain, limits, and basic metrics.

**Acceptance:** the one-file flow works with real files in a published environment, and common failures are understandable in the UI. Source publication alone does not complete service deployment.

## 8. Essential tests

- **`.osr` format:** normal, DT/NC, HR/HD, old, unsupported mode, and damaged files.
- **`.osu` format:** circles, varied slider curves, spinners, and timing or slider-velocity changes.
- **Matching:** correct map, different revision under the same beatmapset ID, and packages without the required difficulty.
- **Synchronization:** start, pause, seek to the beginning/middle/end, rapid repeated seeks, and full speed-mod playback.
- **Service:** cache, concurrent downloads, provider outage, oversized package, and extraction failure.

Use real replays authorized for the project alongside small focused fixtures. Compare the rendered replay visually with osu! to catch differences that automated tests cannot detect.

## 9. Risks and responses

| Risk | Response |
| --- | --- |
| Official downloads are unavailable to an external website. | Validate in phase 0; use an alternative source only when access and terms allow it. |
| An old replay checksum no longer matches a published revision. | Look for the exact copy; otherwise return `VERSION_UNAVAILABLE`. |
| A map is private, deleted, or never published. | Show replay metadata and explain that the map is unavailable. |
| The provider returns an incorrect or modified package. | Compare the `.osu` MD5 with the `.osr` checksum. |
| Large packages or high traffic increase cost and latency. | Apply cache, size limits, deduplication, and cache-hit metrics. |
| Audio or skin resources have distribution conditions. | Review their terms before hosting or redistributing them. |
| Game versions and mods behave differently. | State supported cases, maintain test fixtures, and identify unsupported ones. |
| Intermediate judgments cannot be read directly from `.osr`. | Mark them as estimates and preserve the recorded final totals. |

## 10. Delivery order and estimates

| Milestone | Contents | Rough estimate |
| --- | --- | --- |
| Feasibility | Automatic identification and download checked with real replays. | 2–4 days |
| Technical viewer | `.osr` reader, beatmap resolution, and basic rendering. | 1–2 weeks |
| Playable MVP | Audio, controls, cursor, keys, and major mods. | 2–3 additional weeks |
| Initial deployment | Error handling, performance, deployment, and final review. | 3–5 additional days |

These are planning estimates for one person working continuously. If provider access requires negotiation or a private catalog, revisit the schedule.

## 11. MVP completion criteria

A user can open the site, upload **only an osu!standard `.osr`**, wait for automatic lookup, and watch the replay with the matching beatmap and synchronized audio when that revision is available. The site clearly identifies unavailable cases and never substitutes a different beatmap revision.

## 12. References

- [`.osr` format — osu! wiki](https://osu.ppy.sh/wiki/en/Client/File_formats/osr_%28file_format%29)
- [`.osu` format — osu! wiki](https://osu.ppy.sh/wiki/en/Client/File_formats/osu_%28file_format%29)
- [Beatmaps and `.osz` package content — osu! wiki](https://osu.ppy.sh/wiki/en/Beatmap)
- [osu! API v2: lookup by checksum](https://osu.ppy.sh/docs/#lookup-beatmap)
- [osu! API v2: beatmapset download](https://osu.ppy.sh/docs/#get-api-v2-beatmapsets-beatmapset-download)
