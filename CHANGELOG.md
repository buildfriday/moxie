# Changelog

## v2.0.0 -- 9 Sound Packs + Build Your Own (2026-02-15)

First npm release with the full sound system. 9 curated sound packs, custom pack scaffolding, comprehensive build-your-own guide, 2 new vibes, and massive package cleanup.

### Added
- **`moxie setup`** -- universal setup command: outputs daemon endpoint, curl examples, and a ready-to-paste AI prompt snippet for connecting any tool to Moxie's sound daemon
- **[Universal Setup guide](docs/universal-setup.md)** -- full docs for connecting Cursor, Copilot, Windsurf, or any AI tool with shell hooks to Moxie's daemon API
- **IDE Compatibility table** in README FAQ -- covers Claude Code, VS Code Copilot (native via shared `~/.claude/settings.json`), Copilot CLI, Cursor, JetBrains, Windsurf, and generic shell-hook tools
- **9 curated sound packs** -- warcraft, aoe, halo, glados, serious-sam, cnc, duke, unreal, doom
- **`moxie create <name>`** -- scaffold custom sound packs with template manifest
- **Build Your Own Pack guide** -- [`docs/build-your-own-pack.md`](docs/build-your-own-pack.md): sourcing, processing (ffmpeg pipeline), per-hook sound psychology, starter recipes for popular game themes, AI-assisted pack building prompt
- **Pack template** -- `examples/custom-pack/manifest.json` for custom pack starting point
- **Serious Sam vibe** -- Sam Stone, bombastic action hero personality
- **Chronically Online vibe** -- Unhinged, terminally internet-brained personality
- **Escalation pool support** -- `annoyedBarks` in UserPromptSubmit for rapid-fire submissions
- **Release checklist** -- `docs/release.md` reusable pre-publish verification

### Changed
- **14 vibes** (was 12) -- added serious-sam, chronically-online
- **9 sound packs** (was 12) -- curated down to 9
- **`sounds set` clean-install** -- cleans old files before copying to prevent stale WAV accumulation
- **README** -- sound pack listing table, build-your-own section, updated vibe tables, FAQ entry

## v2-dev-d -- Doubled Sound Fix + Polish (2026-02-12)

Fixes doubled stop sounds, adds cross-hook suppression, improves diagnostics.

### Fixed
- **Doubled stop sounds** -- per-hook default cooldowns based on max sound
  duration (Stop: 1500ms, Notification: 2000ms, SubagentStop: 1000ms,
  SessionStart: 3000ms). Packs without explicit cooldowns no longer default
  to 100ms for everything.
- **Notification + Stop pile-up** -- Stop suppressed within 1s of Notification
  (extends existing UserPromptSubmit suppression)
- **PID file race on reload** -- old daemon's exit handler deleted the PID
  file written by its replacement. `isReloading` flag skips PID cleanup
  during reload so the replacement's PID file survives.
- **`curl --connect-timeout 0.1` too tight via execSync** -- bumped to 0.5s
  in demo.js and moxie.js `daemon start/status`. Node's execSync→cmd.exe
  overhead made 100ms unreliable. Hook commands (via cmd.exe directly) keep 0.1s.
- **`moxie daemon status` reported "not running"** -- both the PID race and
  the connect-timeout caused false negatives. Both fixed.

### Added
- **`player` field in `/health`** -- reports `ffplay`, `afplay`, or Linux
  player name. Instant diagnostics.
- **Daemon auto-version check** -- `moxie set` compares running daemon version
  against source. If current, reloads manifest instead of full restart.
  Faster vibe switching, no audible gap.
- **`windowsHide: true` on build tools** -- process.js and audition-gen.js
  no longer flash terminal windows during sound remastering

## v2-dev-c -- ffplay Migration (2026-02-12)

mpv → ffplay. ffplay ships with ffmpeg (winget/scoop), reliably on PATH.
Sound Keeper eliminates ffplay's old DirectShow buffer concern.

### Changed
- **Audio player: mpv → ffplay** -- Windows and Linux now use ffplay.
  macOS unchanged (afplay). Linux fallback: aplay → paplay → ffplay.
- **ffplay flags**: `-nodisp -autoexit -vn -loglevel quiet`
- **All execSync() calls** now include `windowsHide: true` —
  fixes terminal window flash from SoundKeeper kill, curl health checks,
  and player detection (daemon.js, moxie.js, demo.js)
- **Install requirement**: ffmpeg (not mpv). `winget install ffmpeg` or
  `scoop install ffmpeg`

### Removed
- **mpv as audio player** -- removed from daemon.js, moxie.js, all docs.
  `daemon-mpv.js` stashed for reference.

## v2-dev-b -- Hardening (2026-02-12)

Crash fixes, race condition elimination, defense in depth. Carmack-style review surfaced 12 issues; 10 fixed here.

### Fixed
- **`/reload` port race (CRITICAL)** -- old daemon now calls `server.close()` before spawning replacement via `res.end()` callback. Eliminates EADDRINUSE on reload.
- **Windows exit cleanup** -- `process.on('exit')` handler ensures PID file cleanup on `process.exit()`, reload, and uncaught exceptions (SIGTERM doesn't fire on Windows `TerminateProcess`)
- **`playDirect` crash resilience** -- body wrapped in try/catch. Corrupt manifest JSON no longer hangs for 2s on safety timer.
- **EADDRINUSE losers retry via HTTP** -- cold-start race losers wait 200ms then route through the winning daemon (preserving cooldown, cross-hook suppression, history). Falls back to `playDirect` only on HTTP failure.
- **`stopDaemon` health check** -- queries `/health` first to get live PID. Falls back to PID file. Prevents killing innocent processes from recycled PIDs.
- **Sound Keeper restart backoff** -- exponential backoff (500ms → 1s → 2s). Three rapid failures (exit <5s) disables SK until daemon restart.
- **Path traversal belt-and-suspenders** -- `startsWith(SOUNDS_DIR)` check on resolved path in `/play-sound`, in addition to existing `..` string check

### Added
- **`version` field in `/health`** -- `DAEMON_VERSION` constant (`"4.1"`) in health response. Diagnoses stale daemon instantly.
- **Active child tracking** -- `playSound()` caps concurrent mpv processes at 10. Prevents fork-bomb from misconfigured `cooldown: 0`.
- **`/play-sound` history** -- direct file plays now appear in `moxie daemon status` history ring buffer

### Changed
- **`/play-file` → `/play-sound`** -- new `?pack=<name>&file=<filename>` API replaces raw filesystem paths. Path traversal rejected.
- **`playSound()` error handler** -- unhandled spawn errors (ENOENT when mpv missing) no longer crash the daemon
- **`moxie demo`** uses `http.request()` instead of `curl execSync` for sound playback
- **`moxie set` / `moxie sounds set`** bootstrap daemon for SessionStart instead of direct mpv spawn
- **`moxie daemon start`** adds `windowsHide: true` -- no console window flash
- **`hasAudioPlayer()`** cached at module level (was running `where mpv` 5 times)
- **`moxie test-sounds`** gutted to deprecation stub (3 lines → `moxie demo`)

## v2-dev-a -- Sound Engine v4 + Sound Packs (2026-02-12)

Full sound system: 8 sound packs, Sound Keeper for zero-clipping WASAPI playback, barks/clicks split, cross-hook suppression, demo mode, Linux native player support. Also: ccbridge merged into statusline, dead code cleanup, doc propagation.

### Added
- **`/play-sound` endpoint** -- play sound files by pack/filename through daemon (Sound Keeper warm)
- **`/status` alias** for `/health` endpoint
- **~~`moxie set` auto-removes `terminal_bell`~~** removed -- caused race conditions with Claude Code's concurrent writes to `~/.claude.json`
- **Sound packs** -- 5 initial packs (warcraft, aoe, glados, halo, serious-sam) with manifest.json + WAV files
- **Sound Keeper** -- 20KB binary keeps WASAPI warm, ~80ms playback latency vs ~200ms cold
- **Barks/clicks split** -- UserPromptSubmit supports voice barks (25% chance, 45s cooldown) + subtle clicks
- **Cross-hook suppression** -- Stop suppressed within 2s of UserPromptSubmit (prevents audio pile-up)
- **`moxie demo`** -- showcase mode: full session simulation, `--all` showreel, `--hook` taste test, `--record` clean output, `--list` dry run
- **Linux native players** -- `aplay` (ALSA) -> `paplay` (PulseAudio) -> `mpv` fallback chain, cached at startup
- **SessionStart on pack install** -- `moxie sounds set` and `moxie set` play a greeting immediately
- **`statusline.mjs --bridge`** -- ccstatusline integration via bridge flag (replaces standalone ccbridge.mjs)
- **Sound Keeper toggle** -- `moxie sounds keeper on|off` for systems that don't need WASAPI warming
- **Mute/unmute** -- `moxie sounds mute|unmute` silences playback without removing hooks
- **`MOXIE_SILENT`** -- env var suppresses all sounds in headless `claude -p` sessions
- **Serious Sam vibe** -- `vibes/serious-sam.json`
- **[`docs/sound-engine.md`](docs/sound-engine.md)** -- full v4 architecture, design decisions, troubleshooting
- **[`docs/sound-sourcing-guide.md`](docs/sound-sourcing-guide.md)** -- four-quadrant framework, variant guidance, pack building

### Changed
- **Bootstrap uses startup sound queue (`--play`)** -- Sound Keeper warms before first play, no WASAPI clipping
- **Hook `curl --connect-timeout`** reduced from 1s to 0.1s -- localhost is <1ms
- **`moxie demo` routes through daemon `/play-sound`** when available -- no direct mpv spawn
- **`daemon.js`** -- v4 engine: Sound Keeper + spawn-per-sound replaces v3 IPC/named-pipe approach
- **`moxie.js`** -- sound pack deployment, hook injection, daemon management, demo command, platform-aware player detection
- **`statusline.mjs`** -- absorbed ccbridge functionality via `--bridge` flag
- **`moxie set`** -- deploys daemon + Sound Keeper + sound pack, cleans up legacy scripts (ccbridge, old .ps1/.sh)
- **Hook commands** -- platform-aware `MOXIE_SILENT` guard (`cmd.exe` on Windows, `sh` on Unix); zero-overhead native shell syntax replaces `moxie-sound.mjs` Node.js wrapper
- **All manifests** -- normalized to version 4
- **STYLE_GUIDE.md** -- barks/clicks schema, sound categories, recommended cooldowns, pack building philosophy
- **CONTRIBUTING.md** -- sound pack section with category guidelines, barks/clicks guidance
- **README.md** -- sounds section, demo commands, silent mode, updated FAQ

### Removed
- **`scripts/ccbridge.mjs`** -- merged into `statusline.mjs --bridge`
- **`sounds/daemon-ipc.js`** -- archived v3 IPC daemon (in git history)
- **`cleanLegacyHooks()`** -- was a no-op (empty array)
- **Orphan files** -- `warcraft/working.wav`, `aoe/working.wav`, `serious-sam/_padded/`

## v1.5 — Node.js Unification + npm (2026-02-10)

Replaced 4 platform-split scripts with 2 cross-platform Node.js scripts. No more `jq` dependency. Faster Windows statusline (~30ms Node vs ~400ms PowerShell cold start). Now available via npm.

### Added
- **npm distribution** — `npx moxie-vibes set trail` for one-command install
- **`palette.worktree`** — optional color for worktree name display (falls back to accent)
- **Upgrade detection** — `moxie set` auto-updates moxie-owned statusLine commands (old `.ps1`/`.sh` → `.mjs`)
- **Old script cleanup** — removes leftover `.ps1`/`.sh` scripts from `~/.moxie/` on upgrade
- **ccstatusline warning** — detects ccstatusline and reminds to update widget commandPath

### Changed
- **`statusline.mjs`** replaces `statusline.ps1` + `statusline.sh` — single script, all platforms
- **`ccbridge.mjs`** replaces `ccbridge.ps1` + `ccbridge.sh` — single script, all platforms
- **`moxie.js`** — universal copy + settings injection, no platform branching
- **statusLine command** — now `node ~/.moxie/statusline.mjs` on all platforms
- **ccbridge commandPath** — now `node ~/.moxie/ccbridge.mjs`, 500ms timeout everywhere (no PowerShell cold start penalty)

### Removed
- `statusline.ps1`, `statusline.sh`, `ccbridge.ps1`, `ccbridge.sh`
- `jq` requirement for bash users

## v1.1 — Post-Install Fixes (2026-02-09)

Testing the full install flow (ccstatusline bridge, Windows, Mac/Linux) surfaced several issues. All fixed.

### Added
- **Quip layout option** — `layout.quipPosition` field in vibe JSON. `"right"` (default) for right-aligned quips, `"inline"` for compact quip-after-branch display. Implemented in both `statusline.ps1` and `statusline.sh`.
- **ccstatusline FAQ** in README
- **Hot-reload note** under "Switching Vibes" — settings.json changes apply without restarting

### Fixed
- **Bridge commandPath** — ccstatusline uses `execSync()`, so full command strings work. Windows: `pwsh -ExecutionPolicy Bypass -File ...` (no `.cmd` wrapper needed). Updated both bridge script headers and README.
- **Bridge maxWidth** — ANSI escape codes count against ccstatusline's character budget. Bumped recommended `maxWidth` from 60 to 120 in all docs and script comments.
- **Bridge timeout** — PowerShell cold start on Windows needs ~1-2s. Bumped recommended Windows timeout from 500ms to 3000ms.
- **Tag time ranges** — Docs said `late: 9pm-3am`, `morning: 3am-7am` but code does `late: 10pm-5am`, `morning: 5am-8am`. Fixed CONTRIBUTING.md and STYLE_GUIDE.md to match code.
- **`powershell` → `pwsh`** — statusline.ps1 header comment referenced old `powershell` executable. Updated to `pwsh`.

### Docs
- ccstatusline sequencing note: run ccstatusline first to generate config, then add moxie widget (it overwrites on first run)
- Layout option documented in README (schema example, How It Works section, Make Your Own) and STYLE_GUIDE.md

## v1.0 — Initial Release (2026-02-08)

12 built-in vibes, statusline scripts (PowerShell + bash), ccstatusline bridge, the interview flow.
