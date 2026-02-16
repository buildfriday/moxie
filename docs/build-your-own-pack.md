# Build Your Own Sound Pack

Moxie ships with 9 curated sound packs, but the real power is building your own. This guide covers everything: where to find sounds, how to process them, what makes a pack feel *right*, and starter recipes for themes you can build from games you own.

## Quick Start

```bash
# Scaffold a new pack
moxie create my-pack

# Add WAV files to ~/.moxie/sounds/my-pack/
# Edit manifest.json to map files to hooks
# Activate it
moxie sounds set my-pack
```

That's the three-step loop. The rest of this guide is about doing each step well.

---

## Audio Spec

All sound files must be:
- **Format**: WAV (16-bit PCM)
- **Sample rate**: 44,100 Hz
- **Channels**: Mono
- **Duration**: See per-hook guidelines below

---

## Finding Sounds

### Free / CC0 Sources

| Source | What You Get | URL |
|--------|--------------|-----|
| **Freesound.org** | Massive CC0/CC-BY library, API access | freesound.org |
| **OpenGameArt** | Game-oriented SFX, mostly CC0 | opengameart.org |
| **jfxr** | Browser-based synth, generate from scratch | jfxr.frozenfirefly.net |
| **Pixabay** | Royalty-free SFX | pixabay.com/sound-effects |

### Game Audio (Personal Use)

| Source | What You Get |
|--------|--------------|
| **The Sounds Resource** | Extracted game SFX, organized by game |
| **GitHub game audio repos** | Community-maintained collections |
| **Modding communities** | Game-specific wikis often have sound dumps |
| **Game files directly** | Extract from games you own using tools like VGMStream, foobar2000 + vgmstream plugin |

**Search strategy**: Start with `"[game name] sound effects"`, filter by format and duration. For specific sounds: `"[game] [sound name] wav"` or check the game's modding wiki.

### Licensing Reality Check

| Source Type | Can You Use It? |
|-------------|----------------|
| CC0 / Public Domain | Yes, anything |
| CC-BY | Yes, credit the author |
| Game-extracted | Personal use only — don't redistribute |
| Generated (jfxr, etc.) | Yes, you made it |

Moxie packs live in `~/.moxie/sounds/` on your machine. Personal use. If you're distributing a pack publicly, stick to CC0/CC-BY sources.

---

## Processing Sounds

### The Pipeline

Every sound file should go through this 5-step ffmpeg pipeline. Each step is a standalone command you can copy-paste.

**1. Trim silence** — remove dead air from start and end:
```bash
ffmpeg -i input.wav -af "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse" trimmed.wav
```

**2. Normalize** — target -18 LUFS (loud enough to hear, not so loud it startles):
```bash
ffmpeg -i trimmed.wav -af loudnorm=I=-18:LRA=7:TP=-2 normalized.wav
```

**3. Fade edges** — 10ms fade-in, 20ms fade-out (prevents clicks):
```bash
ffmpeg -i normalized.wav -af "afade=t=in:d=0.01,afade=t=out:st=<duration-0.02>:d=0.02" faded.wav
```
Replace `<duration-0.02>` with the file duration minus 0.02s.

**4. Convert to spec** — 44.1kHz, mono, 16-bit:
```bash
ffmpeg -i faded.wav -ar 44100 -ac 1 -sample_fmt s16 -c:a pcm_s16le output.wav
```

**5. Verify**:
```bash
ffprobe -v quiet -show_entries stream=sample_rate,channels,bits_per_sample,duration -of csv=p=0 output.wav
# Should show: 44100,1,16,<duration>
```

### One-Liner (All Steps)

```bash
ffmpeg -i input.wav \
  -af "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse,loudnorm=I=-18:LRA=7:TP=-2,afade=t=in:d=0.01,afade=t=out:d=0.02" \
  -ar 44100 -ac 1 -sample_fmt s16 -c:a pcm_s16le output.wav
```

### Common Problems

| Problem | Fix |
|---------|-----|
| Clipping / distortion | Lower the LUFS target to -20 or -22 |
| Stereo-to-mono sounds thin | Use `-af "pan=mono\|c0=0.5*c0+0.5*c1"` instead of `-ac 1` |
| Silence gaps between sounds | Re-run trim step with lower threshold (-40dB) |
| File too long | Trim in Audacity first, then run pipeline |

---

## Sound Design: What Makes a Pack Feel Right

Each hook fires at a specific moment. The psychology of that moment determines what sounds work.

### Per-Hook Guide

#### Stop — The Heartbeat
**Fires**: Every time Claude finishes a response (~50-100x per session)
**Duration**: 0.3-1.5s (shorter is better)
**Pool size**: 2-4 files

This is the most important hook. It's the sound you'll hear hundreds of times. It must be:
- **Short** — under 1s ideally. Long sounds become grating.
- **Non-verbal** — no voice lines. Imagine hearing "Job's done!" 80 times in an hour.
- **Satisfying on repeat** — the 50th play test: if it annoys you on the 50th listen, it'll annoy you on the 500th.
- **Low cognitive load** — shouldn't demand attention, just confirm "done."

Best picks: UI confirmations, coin/item collects, soft chimes, mechanical clicks.

#### SessionStart — The Ceremony
**Fires**: Once, when a new session begins
**Duration**: 1-3s (can be longer — it only plays once)
**Pool size**: 2-4 files

This sets the tone. It's your pack's identity moment. Can be a voice line, a fanfare, a dramatic sting — anything that says "we're here."

#### UserPromptSubmit — Clicks + Barks
**Fires**: Every time the user sends a message

**Clicks** (every submission):
- Duration: 0.05-0.3s
- Subtle, mechanical, satisfying. Keyboard taps, UI bleeps, soft pops.
- Must be near-silent — they fire constantly.

**Barks** (15-25% chance, 45s+ cooldown):
- Duration: 0.3-1.5s
- Voice lines, reactions, flavor. The personality amplifiers.
- Optional — a pack can have zero barks and still work.

**Annoyed Barks** (fires after rapid consecutive sends):
- Escalation pool. Same spec as barks but with an edge.
- Great for packs with character voice lines.

#### Notification — The Alert
**Fires**: When Claude sends a notification (needs attention)
**Duration**: 0.5-2s
**Pool size**: 2-4 files

Should feel distinct from Stop. Alert stings, warning sounds, attention-getters. Can be more dramatic than Stop — it's infrequent.

#### SubagentStop — The Report
**Fires**: When a subagent completes work
**Duration**: 0.3-1.5s
**Pool size**: 2-3 files

Lighter than Stop. Background task completing. Should feel like a small acknowledgment, not a celebration.

### The 50th Play Test

Before finalizing any sound, especially Stops:
1. Play it 50 times in a row
2. If you want to mute it by play 30, it's wrong
3. Shorter and softer almost always wins over longer and louder

### Emotional Coherence

A great pack isn't a random collection of sounds from the same game. It has an emotional logic:
- Every sound supports the same **feeling** (clinical, warm, chaotic, serene)
- The **Stop sound anchors the identity** — everything else orbits it
- Voice lines (barks) are seasoning, not the main course

---

## Manifest Reference

```json
{
  "pack": "my-pack",
  "version": 1,
  "hooks": {
    "SessionStart": {
      "files": ["session-start-1_greeting.wav"]
    },
    "UserPromptSubmit": {
      "clicks": ["send-1_tap.wav"],
      "barks": ["bark-1_reaction.wav"],
      "barkChance": 0.15,
      "barkCooldown": 45000,
      "annoyedBarks": ["annoyed-1_sigh.wav"]
    },
    "Stop": {
      "files": ["stop-1_done.wav"],
      "cooldown": 500
    },
    "Notification": {
      "files": ["notification-1_alert.wav"]
    },
    "SubagentStop": {
      "files": ["subagent-stop-1_complete.wav"],
      "cooldown": 2000
    }
  },
  "durations": {
    "session-start-1_greeting.wav": 1.5,
    "stop-1_done.wav": 0.8
  }
}
```

### File Naming Convention

```
{hook}-{number}_{description}.wav
```

Examples: `stop-1_ring-collect.wav`, `bark-2_hmm.wav`, `send-1_tap.wav`

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `pack` | Yes | Pack name (lowercase, hyphens) |
| `version` | Yes | Manifest version (use 1 for new packs) |
| `hooks` | Yes | Map of hook names to sound config |
| `durations` | No | Map of filename to duration in seconds. Used by the daemon for cooldown calculation. |
| `cooldown` | No | Per-hook minimum ms between plays (prevents audio pile-up) |
| `barkChance` | No | Probability (0-1) that a bark plays on UserPromptSubmit |
| `barkCooldown` | No | Minimum ms between barks |

---

## Starter Recipes

These recipes are for packs we designed but shelved from distribution. If you own the games, here's exactly what to source and why. The curation is the value — search terms, hook mapping, and the emotional logic that makes each theme cohere.

### Sonic the Hedgehog

**Design anchor**: Ring collect (Stop)
**Emotional tone**: Bright, energetic, FM-synthesis sparkle

| Hook | Sounds | Why |
|------|--------|-----|
| **Stop** | Ring collect chime (0.3-0.4s), S1 ring collect, checkpoint | The ring sound IS Sonic. Short, bright, infinitely repeatable. |
| **SessionStart** | Origins fanfare, RSDK transform | The iconic intro stings — ceremony without the trademark chant. |
| **Notification** | Invincibility pickup, drowning alert, hyper ring | Alert sounds that feel urgent but themed. |
| **Clicks** | Origins cursor, RSDK menu bleep, shield pickup | FM-synth bleeps — small, satisfying, fast. |
| **Barks** | Spindash release, ring scatter | Rare flavor bursts — the kinetic energy moments. |
| **SubagentStop** | Spring bounce, item box break, S3K checkpoint | Light mechanical sounds — background task done. |

**Search terms**: `sonic sound effects wav`, `sonic ring collect`, `sonic the hedgehog SFX`, check The Sounds Resource for organized dumps. Look for Sonic 1, Sonic 3 & Knuckles, and Sonic Origins specifically — the classic FM-synth era sounds are the ones that work.

### The Legend of Zelda

**Design anchor**: Puzzle solved chime (Stop)
**Emotional tone**: Crystalline wonder, discovery

| Hook | Sounds | Why |
|------|--------|-----|
| **Stop** | Puzzle solved 6-note chime (0.56-1.0s) | The most satisfying "done" sound in gaming. Perfect for task completion. |
| **SessionStart** | Chest open fanfare, fairy fountain intro | The discovery moment — something good is happening. |
| **Notification** | Navi "Hey! Listen!", guardian piano sting | Alert sounds — Navi is literally an alert system. |
| **Clicks** | Menu cursor, item select | Clean UI sounds from the pause screen. |
| **Barks** | Navi "Hello", fairy sparkle | Rare character flavor (use Navi sparingly — she's polarizing for a reason). |
| **SubagentStop** | Small item get, rupee collect | Light reward sounds — task acknowledged. |

**Search terms**: `zelda sound effects`, `zelda puzzle solved chime`, `ocarina of time SFX`, `breath of the wild sound effects`. The puzzle chime is from Ocarina/Majora era. Breath of the Wild's guardian sting is perfect for notifications.

### Metal Gear Solid

**Design anchor**: Codec hangup (Stop)
**Emotional tone**: Clinical, surveillance, deliberate

| Hook | Sounds | Why |
|------|--------|-----|
| **Stop** | Codec hangup/power-down (0.55-0.73s) | The codec closing is the definitive "conversation over" sound. Clean, short, professional. |
| **SessionStart** | Codec ring, alert discovery | The codec ring says "incoming mission." |
| **Notification** | Alert sound (!), codec incoming | The exclamation mark alert is one of the most recognizable sounds in gaming. Use it. |
| **Clicks** | Codec blip, menu select | Sterile, precise UI sounds that fit the surveillance aesthetic. |
| **Barks** | None | MGS is sterile by design. No voice barks — the clinical silence IS the personality. |
| **SubagentStop** | Codec blip variant, item pickup | Quiet acknowledgment sounds. |

**Search terms**: `metal gear solid codec sound`, `mgs alert sound effect`, `metal gear solid SFX`. The codec sounds are from MGS1-3. The alert (!) is universal across all MGS games.

---

## AI-Assisted Pack Building

Give this section to your AI coding assistant (Claude Code, Cursor, etc.) along with a theme idea. It has everything needed to build a complete pack end-to-end.

### Prompt Template

Copy this into a conversation with your AI assistant:

---

**Build me a moxie sound pack: [THEME NAME]**

Read the pack-building guide at `docs/build-your-own-pack.md` in the moxie repo (or this document if you have it). Then:

1. **Source sounds** — Search Freesound.org (API: `https://freesound.org/apiv2/search/text/?query=TERM&filter=duration:[0 TO 3]&fields=id,name,duration,previews&token=YOUR_TOKEN`), The Sounds Resource, or other sources. If the user names a game, check if a starter recipe exists in this guide.

2. **Download and process** — Run each file through the ffmpeg pipeline:
   ```bash
   ffmpeg -i input.wav \
     -af "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse,loudnorm=I=-18:LRA=7:TP=-2,afade=t=in:d=0.01,afade=t=out:d=0.02" \
     -ar 44100 -ac 1 -sample_fmt s16 -c:a pcm_s16le output.wav
   ```

3. **Build the manifest** — Follow the per-hook guidelines:
   - Stop: 2-4 files, 0.3-1.5s, non-verbal, satisfying on repeat
   - SessionStart: 2-4 files, 1-3s, sets the tone
   - UserPromptSubmit clicks: 1-3 files, <0.3s, subtle
   - UserPromptSubmit barks: 0-4 files, 0.3-1.5s, 15-25% chance
   - Notification: 2-4 files, 0.5-2s, attention-getting
   - SubagentStop: 2-3 files, 0.3-1.5s, light acknowledgment

4. **Install** — Place files in `~/.moxie/sounds/[pack-name]/` with manifest.json

5. **Test** — `moxie sounds set [pack-name] && moxie demo`

Key principle: **Stop is the heartbeat.** It plays 50-100x per session. Choose it first, make everything else orbit it. Apply the 50th play test.

---

### Tips for AI Assistants

- The Freesound API needs a token. Ask the user for one, or use `jfxr` to generate synthetic sounds.
- Prefer shorter sounds over longer ones. When in doubt, trim more.
- Test the pack after building: `moxie demo [pack]` plays through all hooks.
- If the user names a game from the starter recipes, those recipes include search terms and sound selection rationale — use them.
- Don't forget `durations` in the manifest. Measure with: `ffprobe -v quiet -show_entries stream=duration -of csv=p=0 file.wav`
