# Changelog

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
