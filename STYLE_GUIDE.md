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
    "dim": "245"
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

**Inline layout**: `Guide ██████░░░░ 60% · main · The trail grows steeper.`

**Right layout** (default): `Guide ██████░░░░ 60% · main                    The trail grows steeper.`

The `layout` field is entirely optional. Omitting it gives you the default right-aligned behavior.
