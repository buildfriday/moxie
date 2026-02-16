# Sound Engine v4 -- Sound Keeper + Spawn

## Overview

Moxie's sound engine plays audio on Claude Code lifecycle events (session start, stop, notifications, subagent completion). v4 replaces the persistent mpv IPC system with Sound Keeper + spawn-per-sound. Sound Keeper (20KB binary) keeps the WASAPI audio device warm. Each hook spawns a fresh ffplay process -- ~80ms latency, zero clipping, cross-hook overlap for free.

## Architecture

```
Hook fires (Claude Code lifecycle event)
    |
    v
curl --connect-timeout 0.1 localhost:17380/play/Stop
    |
 +--+--+
 | up? |
 +-YES-+-> spawn ffplay with sound file             -> ~80ms (WASAPI warm)
 +-NO--+-> || node daemon.js Stop                 -> exits immediately
              +- spawns daemon with --listen --play Stop
              +- daemon starts, Sound Keeper warms, plays after 100ms
              +- stays alive as daemon for future hooks
```

**One playback path:**

| Path | Latency | When |
|------|---------|------|
| Spawn (WASAPI warm) | ~80ms | Daemon up, Sound Keeper running |
| Bootstrap (`--play` queue) | ~200ms | Daemon down — spawns daemon, SK warms 100ms, then plays |
| Spawn (SK disabled) | ~150-200ms | Sound Keeper disabled in config |

**Two modes, one file:**

| Mode | Invocation | Behavior |
|------|-----------|----------|
| Bootstrap | `node daemon.js <hook>` | Spawn daemon with `--listen --play <hook>`, exit immediately. Daemon plays after SK warms. |
| Listen | `node daemon.js --listen` | Daemon mode. Start Sound Keeper, serve HTTP. |

### Hook Command Format

Claude Code runs hook commands through the platform's shell. On Windows, the invoking shell varies by client -- Claude Code CLI uses bash, Cursor uses PowerShell. `moxie set` generates shell-agnostic commands per platform:

**Windows:**
```
cmd.exe /d /q /c "if not defined MOXIE_SILENT (curl.exe -s --connect-timeout 0.1 http://localhost:17380/play/Stop || node "C:/Users/chris/.moxie/sounds/daemon.js" Stop)"
```

The `cmd.exe` wrapper ensures the inner command always runs in cmd.exe context regardless of the parent shell (bash, PowerShell, etc.). `curl.exe` avoids PowerShell's `curl` alias (`Invoke-WebRequest`). `/d` disables AutoRun, `/q` suppresses echo.

**Unix (sh):**
```bash
[ -z "$MOXIE_SILENT" ] && { curl -s --connect-timeout 0.1 http://localhost:17380/play/Stop || node ~/.moxie/sounds/daemon.js Stop; } || true
```

The `MOXIE_SILENT` guard skips the entire sound chain when set. See [Headless / Silent Mode](#headless--silent-mode) under Configuration.

**Daemon up**: curl succeeds in ~10ms, daemon spawns ffplay, sound plays in ~80ms.
**Daemon down**: curl fails instantly (ECONNREFUSED), bootstrap spawns daemon with `--play`, exits. Sound plays after 100ms SK warm-up. Subsequent hooks hit the daemon.
**Race (EADDRINUSE)**: When multiple bootstraps race on cold start, one wins the port. Losers wait 200ms then retry via HTTP through the winner -- preserving cooldown, cross-hook suppression, and history. Falls back to `playDirect()` only if the HTTP request fails.

### Sound Keeper

Sound Keeper (`SoundKeeper64.exe`, [veg.by/projects/soundkeeper/](https://veg.by/projects/soundkeeper/)) generates the smallest non-zero audio samples to keep the WASAPI device awake. 20KB binary, MIT-licensed.

**Why Sound Keeper over mpv silence loop:** Purpose-built for exactly this job. ~20KB memory vs ~30MB for an idle mpv. 0.004% CPU vs 0.1%. No named pipe, no IPC surface, no crash recovery complexity.

**Runtime args:** `SoundKeeper64.exe fluctuate primary` -- `fluctuate` generates minimal non-zero samples (avoids digital silence detection), `primary` targets the default audio device.

**Bundled at:** `lib/soundkeeper/SoundKeeper64.exe` + `License.md`
**Deployed to:** `~/.moxie/lib/soundkeeper/` via `moxie set`

### Sound Keeper Lifecycle

| Event | Behavior |
|-------|----------|
| Daemon starts (`--listen`) | Spawns Sound Keeper if enabled in config |
| Daemon stops | Kills Sound Keeper by PID |
| `/reload` | Stops Sound Keeper, restarts with daemon |
| Sound Keeper crashes | Auto-restart with exponential backoff (3 rapid failures → disabled) |
| Daemon startup | Orphan cleanup via `SoundKeeper64.exe kill` before spawning new instance |

### Spawn-per-Sound

Every `/play` request spawns a fresh `ffplay` process with the sound file. No IPC, no named pipe, no persistent mpv process. With Sound Keeper keeping WASAPI warm, spawn latency is ~80ms -- fast enough for short sounds without clipping.

**Cross-hook overlap:** Separate ffplay processes means hooks that fire in quick succession play simultaneously instead of one replacing the other. This was lost in v3's `loadfile replace` mode.

### WASAPI and Why This Matters

Windows Audio Session API (WASAPI) powers down idle audio devices after a timeout. First sound after idle pays ~50-200ms device initialization -- enough to clip short sounds entirely. Sound Keeper prevents this by keeping the device in an active state.

Without Sound Keeper, each spawned ffplay process would hit cold WASAPI. With it, the device is already open and playback starts immediately after process startup.

## Design Decisions

### Sound Keeper over mpv silence loop

v3 kept a persistent `mpv --idle` process to hold the audio device open. This worked but carried 30MB RAM, a named pipe IPC surface, crash recovery logic, and reconnection polling. Sound Keeper is a 20KB binary built specifically to keep WASAPI warm. It does one thing and does it at near-zero cost.

### Spawn-per-sound over IPC

v3's IPC gave <5ms playback latency but brought complexity: named pipe management, connection state, fallback paths, replace-mode semantics. With WASAPI warm, spawn latency is ~80ms -- well within acceptable for lifecycle sounds. Simpler architecture, fewer failure modes, and cross-hook overlap as a bonus.

### Startup sound queue (`--play`)

v3 used `--initial=<hook>`. v4.0 used v2's approach (bootstrap plays directly via spawn). v4.1 combines the best of both: bootstrap spawns the daemon with `--listen --play <hook>` and exits immediately. The daemon starts Sound Keeper, waits 100ms for WASAPI warm-up, then plays via `handlePlay()`. First sound after daemon start plays clean — no clipping, no cold WASAPI. Bootstrap is faster too (no playDirect, no 2s safety timeout).

### Config toggle for Sound Keeper

Not every system needs it. Some audio drivers don't have aggressive idle timers. USB DACs and professional audio interfaces often keep the device permanently warm. `soundKeeper: false` in config disables it. Sounds still play -- just with potential WASAPI cold-start latency on the first hit.

### curl over node

Same as v3. `curl` is ~10ms vs `node` at ~80ms on the hook critical path. curl is built into Win10+, macOS, and Linux.

### Timestamp cooldown

Same as v3. Simple per-hook timestamp comparison, no duration tracking.

### ffplay over mpv

ffplay ships with ffmpeg, which is available through standard package managers (`winget install ffmpeg`, `scoop install ffmpeg`). mpv had persistent PATH issues on Windows -- `choco install mpvio.install` doesn't create shims, requiring manual PATH configuration. With Sound Keeper keeping WASAPI warm, ffplay's old DirectShow buffer concern no longer applies -- the audio device is already active and playback starts immediately.

### macOS unchanged

`afplay` stays as-is. macOS doesn't have the WASAPI cold-start problem.

### Linux native players

Linux now uses a fallback chain: `aplay` (ALSA, almost always present) → `paplay` (PulseAudio) → `ffplay`. Player detection is cached at first call. macOS stays `afplay`. Windows stays `ffplay`.

## Endpoints

### `GET /play/:hook`

Play a sound for the given hook name.

**Response** (200):
```json
// Played
{"played": true, "file": "anvil-1.wav"}

// Cooldown skip
{"skipped": true, "cooldown": 100}

// Muted
{"muted": true}

// No sounds configured for hook
{"error": "no files for hook"}
```

### `GET /play-sound?pack=<name>&file=<filename>`

Play a sound file from a pack directory (`~/.moxie/sounds/<pack>/<file>`). Respects global mute (PAUSE_FILE). Rejects path traversal (`..` in pack or file parameter).

**Response** (200):
```json
// Played
{"played": true, "pack": "warcraft", "file": "jobs-done.wav"}

// Muted
{"muted": true}
```

**Response** (400):
```json
{"error": "pack and file required"}
{"error": "invalid file path"}
```

**Response** (404):
```json
{"error": "file not found"}
```

Used by `moxie demo` to route all audio through the daemon instead of spawning ffplay directly.

### `GET /health` (alias: `/status`)

Daemon status and recent play history.

**Response** (200):
```json
{
  "moxie": true,
  "version": "4.4",
  "player": "ffplay",
  "pid": 12345,
  "port": 17380,
  "uptime": 3600,
  "pack": "warcraft",
  "muted": false,
  "soundKeeper": true,
  "soundKeeperPid": 67890,
  "soundKeeperEnabled": true,
  "history": [
    {"hook": "Stop", "file": "shotgun.wav", "time": "12:34:05", "fizzled": false}
  ]
}
```

### `GET /reload`

Full daemon restart (default) or manifest-only refresh.

**Response** (200):
```json
// Full restart
{"reloaded": true, "mode": "full", "restarting": true}

// Manifest refresh
{"reloaded": true, "mode": "manifest", "pack": "warcraft"}
```

`?mode=manifest` refreshes the manifest cache without restarting. Full reload stops Sound Keeper, spawns a replacement daemon, and exits.

## Cooldown

Simple timestamp-based. Per-hook `cooldown` in manifest controls minimum time between plays:

```
Per-hook state: { lastPlay: timestamp }
Per-hook config: cooldown (from manifest, or per-hook default based on max sound duration)

On new /play/:hook:
  1. now - lastPlay[hook] < cooldown? → skip
  2. Otherwise → play, update lastPlay
```

**Default cooldowns** (when manifest doesn't specify):

| Hook | Default Cooldown | Rationale |
|------|-----------------|-----------|
| SessionStart | 3000ms | 3s max duration |
| UserPromptSubmit | 100ms | Clicks are short (0.1-0.3s) |
| Stop | 1500ms | 1.5s max duration |
| SubagentStop | 1000ms | 1s max duration |
| Notification | 2000ms | 2s max duration |

Manifest `cooldown` overrides the default. Unknown hooks fall back to 100ms.

**Examples:**
- `SubagentStop` with `cooldown: 500` won't re-trigger within 500ms (overrides 1000ms default)
- `UserPromptSubmit` with `cooldown: 50` allows rapid re-trigger

## Cross-Hook Suppression

The daemon tracks play timestamps globally across all hooks (`lastPlayGlobal`). This enables cross-hook coordination:

Stop is wallpaper — it yields to higher-priority hooks:

| Rule | Window | Rationale |
|------|--------|-----------|
| Stop suppressed after UserPromptSubmit | 2000ms | Bark/click already covered the beat |
| Stop suppressed after Notification | 1000ms | Alert is the important signal |

Response when suppressed:
```json
{"suppressed": true, "reason": "cross-hook"}
```

This is daemon-level logic (not configurable per-pack). It prevents audio pile-up when hooks fire in quick succession.

## Barks/Clicks Protocol

UserPromptSubmit supports a split between characterful "barks" (voice lines) and subtle "clicks" (UI sounds). The daemon resolves the pool on each play:

1. If `barks` and `clicks` arrays are present in the hook config:
   - Roll against `barkChance` (default 0.25)
   - If bark: check `barkCooldown` (default 45000ms) since last bark
   - If bark cooldown passed: play from barks pool
   - Otherwise: play from clicks pool
2. If only `files` array is present: play from files (backward compat)

No-repeat tracking is per-pool (`lastPick` keyed by `hook:poolName`), so barks and clicks each maintain their own no-consecutive-repeat state.

History entries include a `pool` field when barks/clicks are active:
```json
{"hook": "UserPromptSubmit", "file": "zug-zug.wav", "time": "14:23:05", "fizzled": false, "pool": "bark"}
```

## Configuration

### Port

Stored in `~/.moxie/config.json`:
```json
{"daemonPort": 17380}
```

Default 17380 if no config. Both daemon and CLI read from same file. Changing port requires re-running `moxie set <vibe>` to regenerate hook commands with the new port.

### Sound Keeper

```json
{"soundKeeper": true}
```

Default `true`. Toggle via CLI: `moxie sounds keeper on|off`. Takes effect on next daemon start or `/reload`.

### Headless / Silent Mode

Set `MOXIE_SILENT=1` in the environment to suppress all sound playback. The hook command uses a platform-native guard (`if not defined` on Windows, `[ -z ]` on Unix) -- if the variable is set, the entire curl/bootstrap chain is skipped. `playDirect()` also checks `process.env.MOXIE_SILENT` as belt-and-suspenders for the EADDRINUSE fallback path.

**Why not daemon-side?** The daemon is a long-running process with its own `process.env`. When a caller sets `MOXIE_SILENT=1` before `claude -p`, the daemon (already running) never sees it. Only the hook process inherits the caller's env. The check must live in the hook command. The daemon's `PAUSE_FILE` (`.paused`) handles a different use case: global mute via `moxie sounds mute`.

**Use case:** Headless Claude Code sessions (`claude -p`) running scheduled tasks (vigil, sleep, brief) shouldn't play sounds. The task runner sets `$env:MOXIE_SILENT = '1'` before invoking Claude, and all hooks silently no-op.

**Note:** Claude Code hooks don't expose whether the session is interactive or headless. There's no `session_type` or `permission_mode` in the hook stdin JSON that reliably distinguishes them. `MOXIE_SILENT` is the convention -- callers of `claude -p` are responsible for setting it.

> **Double notification sounds?** Claude Code's built-in `terminal_bell` notification plays alongside moxie's Notification hook. Edit `~/.claude.json` and remove `"preferredNotifChannel": "terminal_bell"` to fix. Alternatively, suppress bell audio in your terminal emulator (Windows Terminal: Bell style "None"; iTerm2: uncheck "Audible bell").

### Per-hook cooldown

In the sound pack's `manifest.json`:
```json
{
  "hooks": {
    "SubagentStop": {
      "files": ["done-1.wav", "done-2.wav"],
      "cooldown": 500
    },
    "UserPromptSubmit": {
      "files": ["click-1.wav", "click-2.wav"],
      "cooldown": 50
    }
  }
}
```

Default cooldown is 100ms if not specified.

## Operational

### Daemon Log

`~/.moxie/sounds/daemon.log` -- append-only, rotated to last 50 lines at startup when >100:
- Startup: `Daemon started on port 17380`
- Sound Keeper: `Sound Keeper spawned (pid 1234)`, `Sound Keeper exited, restarting in 500ms`
- Each play: `[12:34:05] Stop → shotgun.wav`
- Each skip: `[12:34:05] Stop → skipped (cooldown 500ms)`
- Errors: spawn failures, uncaught exceptions

### Daemon Lifecycle

| Command | Effect |
|---------|--------|
| `moxie daemon start` | Spawn daemon detached, confirm via /health |
| `moxie daemon stop` | Kill daemon + Sound Keeper by PID |
| `moxie daemon status` | curl /health, display pack/muted/uptime/Sound Keeper status/history |
| `moxie set <vibe>` | Copy new daemon.js + Sound Keeper binary, kill old daemon. Next hook bootstraps. |
| `moxie sounds off` | Remove hooks, stop daemon + Sound Keeper |
| `moxie sounds keeper on\|off` | Toggle Sound Keeper in config. Takes effect on restart/reload. |

### Crash Recovery

Daemon crashes → PID file becomes stale. Next hook: curl fails, bootstrap spawns new daemon. Self-healing.

Sound Keeper crashes → daemon detects exit, auto-restarts with exponential backoff (500ms, 1s, 2s). If Sound Keeper fails 3 times within 5 seconds of start, it's disabled until daemon restart. Daemon startup runs orphan cleanup (`SoundKeeper64.exe kill`) to prevent stale processes from previous daemon instances.

### Mute/Unmute

`moxie sounds mute` creates `~/.moxie/sounds/.paused`. Daemon checks this file on every `/play` request. `moxie sounds unmute` removes it. No daemon restart needed.

## Troubleshooting

**Sounds clipping:**
1. Check Sound Keeper: `moxie daemon status` -- verify Sound Keeper is running
2. Check config: `soundKeeper` should be `true` in `~/.moxie/config.json`
3. If Sound Keeper is running and sounds still clip, the pack's sounds may be too short for spawn latency (~80ms minimum)

**No sound playing:**
1. Check mute: `moxie sounds unmute`
2. Check ffplay: `ffplay -version` (install via `winget install ffmpeg` on Windows; macOS uses built-in `afplay`)
3. Check daemon: `moxie daemon status`
4. Check log: `cat ~/.moxie/sounds/daemon.log`
5. Check sound pack: `cat ~/.moxie/active.json` -- does `soundPack` match an installed pack?

**Sound Keeper not starting:**
1. Check binary exists: `ls ~/.moxie/lib/soundkeeper/SoundKeeper64.exe`
2. Re-deploy: `moxie set <vibe>` copies Sound Keeper binary to `~/.moxie/lib/soundkeeper/`
3. Check config: `soundKeeper` must be `true` (or absent -- defaults to `true`)

**Port conflict:**
- Another process on 17380: set `{"daemonPort": 17381}` in `~/.moxie/config.json`, re-run `moxie set <vibe>`

**Stale daemon (old code running):**
- `moxie daemon stop` then `moxie daemon start`, or `moxie set <vibe>` (handles it automatically)

## v3 → v4 Migration

No user action required. `moxie set <vibe>` deploys the new daemon code and Sound Keeper binary. Old mpv IPC processes are cleaned up on daemon stop. The hook command format is unchanged -- existing hooks work without modification.

Removed from v4:
- `net` module (no more named pipe IPC)
- `--initial` flag (v2-style bootstrap instead)
- `mpvIpc` / `mpvPid` from health endpoint
- `ipc` field from play responses and history entries
- WASAPI pre-warm via silent WAV (Sound Keeper replaces this)
- `loadfile replace` semantics (each sound is its own process)
