# Changelog

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
