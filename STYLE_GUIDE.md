# Vibe Style Guide

Formal schema spec for moxie vibe JSON files. All built-in vibes meet these requirements. Community contributions should too.

## Schema

```json
{
  "name": "vibe-name",
  "description": "3-8 words, in character voice",
  "version": "1.0",
  "agent": {
    "name": "CharacterName",
    "nameColor": "44"
  },
  "palette": {
    "primary": "44",
    "accent": "214",
    "warning": "204",
    "dim": "245",
    "worktree": "170",
    "directory": "117"
  },
  "spinnerVerbs": {
    "mode": "replace",
    "verbs": ["...15-20 verbs..."]
  },
  "quips": {
    "any": ["...20-25 quips..."],
    "chill": ["...3-5 quips..."],
    "...": "..."
  }
}
```

## Field Requirements

| Field | Type | Requirement |
|-------|------|-------------|
| `name` | string | Lowercase, hyphenated, matches filename (e.g. `my-vibe` → `my-vibe.json`) |
| `description` | string | 3-8 words, written in the character's voice |
| `version` | string | Semver (`"1.0"`) |
| `agent.name` | string | Character name, or empty string `""` for nameless vibes |
| `agent.nameColor` | string | Valid 256-color ANSI code (`"0"` - `"255"`) |
| `palette.primary` | string | 256-color ANSI code — bar fill, branch name |
| `palette.accent` | string | 256-color ANSI code — bar mid-range |
| `palette.warning` | string | 256-color ANSI code — bar high-range |
| `palette.dim` | string | 256-color ANSI code — separators, quip text |
| `palette.worktree` | string | *(optional)* 256-color ANSI code — worktree name. Falls back to `accent` |
| `palette.directory` | string | *(optional)* 256-color ANSI code — working directory path. Falls back to `accent` |
| `spinnerVerbs.mode` | string | Always `"replace"` |
| `spinnerVerbs.verbs` | string[] | 15-20 verbs |
| `quips.any` | string[] | 20-25 quips (always-active pool) |

## Quip Tag Requirements

### Required Single Tags (3-5 quips each)

| Tag | Condition | Min |
|-----|-----------|-----|
| `chill` | Context < 30% | 3 |
| `warm` | Context 30-70% | 3 |
| `hot` | Context > 70% | 3 |
| `late` | 10pm - 5am | 3 |
| `morning` | 5am - 8am | 3 |
| `friday` | It's Friday | 3 |
| `weekend` | Saturday or Sunday | 3 |
| `worktree` | In a git worktree | 3 |
| `marathon` | Session > 60 minutes | 3 |
| `fresh` | Session < 5 minutes | 3 |
| `dirty` | Uncommitted changes | 3 |
| `clean` | Clean working tree | 3 |
| `behind` | Behind upstream | 3 |

### Combo Tags (2-3 combos, 2 quips each)

Combo tags like `"hot,late"` fire when **all** listed tags are active. Pick 2-3 combos that make sense for your character. Common combos:

- `hot,late` — burning context at 2am
- `fresh,morning` — new session at dawn
- `dirty,hot` — lots of changes + high context

## Quality Checklist

- [ ] All quips pass the 50-read test (see [CONTRIBUTING.md](CONTRIBUTING.md))
- [ ] Every quip sounds like the same character
- [ ] No quip exceeds 8 words (2-5 is the sweet spot)
- [ ] Spinner verbs are thematic (not generic "Working", "Building")
- [ ] `name` matches the filename exactly
- [ ] JSON validates: `jq . vibes/your-vibe.json`
- [ ] Comedy level documented (see CONTRIBUTING.md for the 1-4 scale)

## Color Reference

Colors use 256-color ANSI codes. Preview in your terminal:

```bash
printf '\033[38;5;44mThis is color 44\033[0m\n'
```

Useful ranges: 16-21 (blues), 22-28 (greens), 124-131 (reds/browns), 166-173 (oranges), 196-201 (bright reds), 202-214 (oranges/ambers), 220-226 (golds), 240-255 (grays).

## Layout Options

Vibes can optionally include a `layout` object to control statusline rendering:

```json
{
  "layout": {
    "quipPosition": "right"
  }
}
```

| Field | Values | Default | Effect |
|-------|--------|---------|--------|
| `quipPosition` | `"right"` | `"right"` | Right-aligned quip with dynamic spacing (default) |
| | `"inline"` | | Quip appears inline after branch, bullet-separated |
| `showDirectory` | `true` / `false` | `true` | Show current working directory path (drive letter stripped) after git branch |

**Inline layout**: `Guide ██████░░░░ 60% · main · The trail grows steeper.`

**Right layout** (default): `Guide ██████░░░░ 60% · main                    The trail grows steeper.`

The `layout` field is entirely optional. Omitting it gives you the default right-aligned behavior.

## Sound Pack Schema

Sounds and vibes are **separate definitions, paired by default**. A vibe's `name` field maps to a sound pack of the same name. Override with `soundPack` in `active.json`.

### Vibe `soundPack` Field

```json
{
  "name": "glados",
  "soundPack": "souls",
  ...
}
```

If `soundPack` is absent, falls back to the vibe's `name`. This means:
- `pirate` personality + `pirate` sounds = default behavior
- `glados` personality + `souls` sounds = mix and match
- Sound packs can exist independently of vibes (e.g., `retro`, `ambient`)

### Sound Manifest (`sounds/{pack}/manifest.json`)

```json
{
  "pack": "pirate",
  "version": 4,
  "sources": {
    "ship-bell-1.wav": "_candidates/ship-bell-raw.ogg",
    "anchor-drop.wav": "_candidates/anchor-heavy.mp3"
  },
  "hooks": {
    "SessionStart": {
      "files": ["ship-bell-1.wav", "ship-bell-2.wav", "horn.wav"]
    },
    "UserPromptSubmit": {
      "files": ["wood-tap.wav"]
    },
    "Stop": {
      "files": ["anchor-drop.wav", "chest-open.wav"]
    },
    "Notification": {
      "files": ["ship-horn-distant.wav"]
    },
    "SubagentStop": {
      "files": ["wood-creak-1.wav", "wood-creak-2.wav"]
    }
  }
}
```

| Field | Type | Requirement |
|-------|------|-------------|
| `pack` | string | Matches directory name |
| `version` | number | Schema version (currently `4`) |
| `sources` | object | Maps output filenames → pristine candidate paths (for idempotent remastering) |
| `hooks` | object | Keys are hook names, values have `files` array |
| `hooks.*.files` | string[] | 3-5 sound files per hook (pool for random selection) |

### Barks/Clicks Split (UserPromptSubmit)

UserPromptSubmit supports a barks/clicks split for richer feedback. When both `clicks` and `barks` are present, the daemon uses probability-based selection:

```json
"UserPromptSubmit": {
  "clicks": ["anvil-tap-1.wav", "anvil-tap-2.wav"],
  "barks": ["zug-zug.wav", "yes-milord.wav", "whaddya-want.wav"],
  "barkChance": 0.25,
  "barkCooldown": 45000,
  "files": ["anvil-tap-1.wav", "anvil-tap-2.wav"]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `clicks` | string[] | -- | Short, low-character sounds (0.1-0.3s). Played most of the time. |
| `barks` | string[] | -- | Voice lines or characterful sounds (0.5-1.5s). Played with probability. |
| `barkChance` | number | 0.25 | Probability of bark vs click (0-1) |
| `barkCooldown` | number | 45000 | Minimum ms between barks |
| `files` | string[] | -- | Backward compat fallback (used when clicks/barks absent) |

When `clicks` and `barks` are absent, the engine falls through to `files` (current behavior unchanged).

### Supported Hooks

| Hook | Fires When | Frequency | Max Duration |
|------|-----------|-----------|-------------|
| `SessionStart` | New Claude Code session begins | Once per session | 3s |
| `UserPromptSubmit` | User sends a message | Every prompt | 0.1-1.5s |
| `Stop` | Claude finishes a response | Every turn | 1.5s |
| `Notification` | Agent sends a notification | Occasional | 2s |
| `SubagentStop` | A subagent completes | Per subagent (can batch) | 1s |

### Sound Categories

Every hook falls on two axes: frequency x character level.

| Hook | Category | Frequency | Character Level | Variants |
|------|----------|-----------|-----------------|----------|
| SessionStart | **Ceremony** | 1/session | Maximum | 3-5 |
| UserPromptSubmit | **Feedback** | 10-20/session | High (barks) / Low (clicks) | 3-5 barks + 2-3 clicks |
| Stop | **Wallpaper** | 50+/session | Minimal | 2-3 |
| SubagentStop | **Wallpaper** | Variable, bursts | Minimal, distinct from Stop | 2-3 |
| Notification | **Alert** | Rare | Sharpest | 3-5 |

**Key rule**: Fewer variants on high-frequency hooks = less cognitive load. More variants on low-frequency hooks = surprise and delight.

### Recommended Cooldowns

| Hook | Voice Packs | SFX Packs |
|------|-------------|-----------|
| SessionStart | -- | -- |
| UserPromptSubmit | 50 | 50 |
| Stop | 500 | 100 |
| SubagentStop | 2000 | 1000 |
| Notification | -- | -- |

### Pack Building Philosophy

1. **Match the action** -- Find sounds that naturally represent the hook's developer action (greeting, completion, alert, task done)
2. **Then pick iconic** -- Prefer the franchise's most recognizable version of that action
3. **Never chop** -- Find naturally short sounds. Don't trim longer ones to fit. If nothing fits, leave the hook empty (engine silently skips it)
4. **Pool size** -- 2-5 variants per hook (engine picks random, no consecutive repeats)

### Sound File Requirements

- **Format**: WAV only (44.1kHz, mono, 16-bit PCM). Use `node sounds/process.js {pack}` to convert and master.
- **Duration**: See max duration per hook above. Shorter is better for frequent hooks.
- **Loudness**: -18 LUFS (processed by `sounds/process.js`)
- **Naming**: Lowercase, hyphenated, descriptive (e.g., `ship-bell-1.wav`)
- **Pool size**: 2-5 variants per hook prevents repetition fatigue

### Engine Behavior

- Picks random file from the pool, no consecutive repeats
- Fire-and-forget -- sound plays in detached background process
- macOS: `afplay` (built-in), Windows/Linux: `ffplay` (via ffmpeg)
- Silent exit on any error (missing files, no ffplay, etc.)
