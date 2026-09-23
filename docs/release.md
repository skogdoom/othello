# Release: browsers, devices, profiling, deploy

Needed in S7. What CI checks on every push, what only a real device can
check, how to profile on a phone, and how the build gets deployed.

## What CI covers

`.github/workflows/ci.yml` runs on every push:

- **Typecheck, unit tests, build.** The three `tsc` programs (app, worker,
  e2e), all of Vitest, and `vite build`.
- **Browsers.** `npm run e2e` against the production build, served from a
  subdirectory (`/othello/`) the way GitHub Pages serves it. Five Playwright
  projects: desktop Chromium, Firefox and WebKit, plus Pixel 7 (Chromium) and
  iPhone 12 (WebKit) emulation.
- **Deploy**, on `master` only, and only once both jobs above pass.

The browser tests cover: boot with no sound files and no console errors, a move
and the AI's reply, undo, resume and difficulty after a reload, both HUD
layouts at the 390 px baseline plus a 265 px-tall landscape (an iPhone 13 mini
with Safari's tab bar showing), with 44 px tap targets and nothing overflowing,
rotating during a search and a flip, no drawing at all while the board is
idle, a lost and restored WebGL context redrawn with no input, the
2D-canvas fallback when WebGL is unavailable, the main-thread fallback when
the AI worker cannot load, and the error message when nothing can draw.

Emulation is not a device. It says nothing about audio, real touch, or
performance.

## What needs real devices

Latest two versions of each desktop browser, plus the two phones. Tick each
row before a release.

| Check | Desktop Chrome | Desktop Edge | Desktop Firefox | Desktop Safari | iPhone 12 or equivalent, Safari | Android, Chrome |
|---|---|---|---|---|---|---|
| Boots, full game to the game-over panel | | | | | | |
| Sound: first tap unlocks audio, mute persists across a reload | | | | | | |
| iOS: silent switch silences the game (expected) | — | — | — | — | | — |
| Touch: corner and edge squares hit reliably, no double-tap zoom, no scroll bounce | — | — | — | — | | |
| Rotate mid-search and mid-flip: nothing resets | — | — | — | — | | |
| Safe areas: nothing under the notch or home indicator, both orientations | — | — | — | — | | |
| Landscape with several tabs open (Safari's tab bar showing): whole HUD visible | — | — | — | — | | |
| Background the app for a minute, come back: board still drawn, game intact | | | | | | |
| Close the tab mid-game, reopen: game resumes | | | | | | |
| `?perf`: see below | | | | | | |

Edge shares Chromium's engine, so CI covers it only indirectly. Check it by
hand.

For a phone on the same network, `npm run serve -- --host` serves a plain
bundle on the LAN. Better still, use the deployed build, since that is what
ships.

## Profiling with `?perf`

Add `?perf` to the URL (for example `https://…/othello/?perf`). A panel in the
top-left corner shows:

```
60 fps  p95 16.9 ms  max 18.2 ms  long 0  frames 214
webgl  dpr 3  res 2  780x1500  cores 6
hard   12e  d16 solved  612/800 ms   94k 154k/s
hard   14e  d11         803/800 ms  121k 150k/s
medium 40e  d7          251/250 ms   38k 151k/s
```

- **Line 1, the render loop.** The board draws on demand, so the loop runs
  only while something animates. While it does, you see the frame rate and
  the 95th-percentile and worst frame times over the last two seconds; the
  rest of the time it says `idle`. `long` counts frames over 50 ms since
  load; watch it during flip cascades, where it should stay at 0. `frames`
  counts frames drawn since load. It must not climb while nothing moves.
  A frame just after a WebGL context restore can be long while shaders
  recompile. That one is expected.
- **Line 2, the renderer.** `webgl` is expected. `canvas` means WebGL was
  unavailable and Pixi fell back to a 2D canvas. `res` is the capped device
  pixel ratio.
- **One line per AI search, newest first.** The level, the number of empty
  squares, the depth of the last completed iteration (`solved` if the search
  reached the end of every line), time taken against the level's budget,
  nodes searched, and nodes per second. `forced` means only one move was
  legal.

What to look for:

- **`OVER`**: a search ran more than 10% past its budget. The deadline is
  checked every 1024 nodes, so a slow device overshoots by more.
- **An endgame that doesn't say `solved`.** Hard solves exactly from 12 empty
  squares and medium from 8. A line at or below that count without `solved`
  means the solve didn't finish in the budget, and the move came from a
  shallow disc-count search instead. That is the concrete signal CLAUDE.md
  names for considering bitboards.
- **Midgame depth.** Hard should reach roughly depth 8 or more, and medium
  about 6 or more. Much less means the eval or move generation is too slow on
  that device.

### Numbers from the development sandbox

These are not device numbers. They come from a cloud container, not a phone,
and are recorded here only as a baseline to compare against.

- Node, one core: about 150k–180k nodes/s. Exact solves take about 50 ms at 9
  empty squares, but 0.6–2.8 s at 12 in four sample positions. So hard's
  12-square solve usually does not finish within 800 ms here.
- Headless Chromium worker: about 50k–80k nodes/s. Hard's opening move
  reached depth 9 in its 800 ms.

If a real phone is similar, cheaper options come before bitboards: a hash key
that isn't a 64-character string per node, endgame move ordering by the
opponent's mobility, and skipping the shallow iterations when solving.

## Deploy

The build is static files with relative URLs, so `dist/` runs from a domain
root or any subdirectory without being rebuilt.

**GitHub Pages (the default).** The `deploy` job in CI publishes `dist/` on
every push to `master` that passes all tests. One-time setup:

1. Repository **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
2. GitHub Pages on a private repository needs a paid plan (Pro, Team or
   Enterprise). On a free plan, either make the repository public or use
   another host.

**Any other static host.** Run `npm run build` and upload `dist/`. There is
nothing to configure: no rewrites, no headers, no server. The host only needs
to serve `.js` files as JavaScript, which module workers require.
