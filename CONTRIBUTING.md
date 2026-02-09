# Contributing to moxie

Want to add a vibe? Here's how.

## Adding a Vibe Pack

1. Copy `examples/custom-vibe.json` to `vibes/your-vibe-name.json`
2. Fill in the personality (see quality guidelines below)
3. Validate your JSON: `cat vibes/your-vibe.json | jq .`
4. Open a PR

## Vibe Quality Guidelines

### Minimum Requirements

- **15-25 spinner verbs** in `spinnerVerbs.verbs`
- **40-60 quips** spread across tag categories
- **20+ quips in `any`** — this is the default bucket, it needs depth
- **3-6 quips per context tag** — `hot`, `late`, `dirty`, `clean`, etc.
- **2-3 combo tags** — e.g. `"hot,late"` for when both conditions match
- **Valid JSON** — test it

### Writing Good Quips

**The sweet spot is 2-5 words.** Two feels abrupt, five feels right, eight is the max.

**What works:**
- Deadpan understatement — "Looking at this." is funny because the format is serious
- Mild absurdism — "Pretending to understand..." is relatable
- Self-deprecation of the tool — "Hoping for the best..." (not the user)
- Specificity — "Reading the fifteenth config file" beats "Reading files"

**What doesn't work:**
- Puns — status messages flicker by too fast for double-takes
- Meme references — they age like milk
- Excessive self-awareness — "Haha I'm an AI" gets old fast
- Anything mean toward the user — unless it's the `roast` vibe (opt-in)

### The 50-Read Test

Read each quip imagining you'll see it 100 times. If it grates at read 50, cut it. Randomization helps, but bad quips are bad quips.

### Comedy Levels

Know where your vibe sits:

| Level | Name | Example | Audience |
|-------|------|---------|----------|
| 1 | Professional | "Reviewing contents" | Enterprise-safe |
| 2 | Personality | "Studying the situation" | Most devs |
| 3 | Comedy | "Squinting at this" | People who want to smile |
| 4 | Unhinged | "Consuming your files for sustenance" | Opted-in chaos |

Most vibes should be Level 2-3. Mark your PR with the intended level.

### Thematic Consistency

Every quip should feel like the same character speaking. If your vibe is a pirate, don't drop in a zen quote. If it's a detective, keep the noir voice across all tags.

## Tag Reference

| Tag | When Active |
|-----|-------------|
| `any` | Always |
| `chill` | Context < 30% |
| `warm` | Context 30-70% |
| `hot` | Context > 70% |
| `late` | 9pm - 3am |
| `morning` | 3am - 7am |
| `friday` | It's Friday |
| `weekend` | Saturday or Sunday |
| `fresh` | Session < 5 minutes |
| `marathon` | Session > 60 minutes |
| `dirty` | Uncommitted changes |
| `clean` | Clean working tree |
| `behind` | Behind upstream |
| `worktree` | In a git worktree |

Combo tags (e.g. `"hot,late"`) match when ALL listed tags are active.

## Color Reference

Colors use 256-color ANSI codes. Some useful ranges:

- **16-21**: Blues
- **22-28**: Greens
- **124-131**: Reds/browns
- **136-143**: Yellows/olives
- **166-173**: Oranges
- **196-201**: Bright reds/pinks
- **202-214**: Oranges/ambers
- **220-226**: Golds/yellows
- **240-255**: Grays (240=dark, 255=bright)

Preview colors in your terminal: `printf '\033[38;5;44mThis is color 44\033[0m\n'`
