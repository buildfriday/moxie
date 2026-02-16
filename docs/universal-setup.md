# Universal Setup — Connect Any AI Tool to Moxie

Moxie's sound system works with any AI tool that can run shell commands on events, not just Claude Code.

## How Moxie Works

Moxie runs a lightweight HTTP daemon on localhost that plays sounds when hit with a GET request. The daemon manages sound packs, cooldowns, and audio playback. Any tool that can `curl` a URL can trigger Moxie sounds.

## Daemon API Reference

Default endpoint: `http://localhost:17380`

| Endpoint | Description |
|----------|-------------|
| `GET /play/<event>` | Trigger a sound for an event |
| `GET /health` | Daemon status (version, uptime, pack, muted) |
| `GET /play-sound?pack=<pack>&file=<file>` | Play a specific sound file |
| `GET /reload?mode=manifest` | Hot-reload the active sound pack |

### Events

| Event | When It Fires |
|-------|---------------|
| `SessionStart` | A new coding session begins |
| `Stop` | The AI finishes a response (fires every turn) |
| `UserPromptSubmit` | User sends a message |
| `Notification` | AI needs your attention |
| `SubagentStop` | A subagent/subtask completes |

### curl Examples

**Windows** (use `curl.exe` to avoid PowerShell's alias):
```
curl.exe -s http://localhost:17380/play/SessionStart
curl.exe -s http://localhost:17380/play/Stop
curl.exe -s http://localhost:17380/play/UserPromptSubmit
curl.exe -s http://localhost:17380/play/Notification
curl.exe -s http://localhost:17380/play/SubagentStop
```

**macOS / Linux**:
```
curl -s http://localhost:17380/play/SessionStart
curl -s http://localhost:17380/play/Stop
curl -s http://localhost:17380/play/UserPromptSubmit
curl -s http://localhost:17380/play/Notification
curl -s http://localhost:17380/play/SubagentStop
```

## Setup for Any AI Tool

Most AI tools have a hook or event system that runs shell commands on certain events. The setup is the same for all of them:

1. **Install Moxie and a sound pack**: `npx moxie-vibes set duke` (or any vibe)
2. **Start the daemon**: `npx moxie-vibes daemon start`
3. **Add hooks in your AI tool** that curl the daemon endpoints

### Ready-to-Paste Prompt

Give this to your AI tool and it will configure itself:

> Add shell hooks that trigger Moxie sound events via HTTP. For each event below, add a hook that runs the curl command in the background. On failure, ignore silently (the daemon may not be running).
>
> - **Session start**: `curl -s http://localhost:17380/play/SessionStart`
> - **Response complete**: `curl -s http://localhost:17380/play/Stop`
> - **User sends message**: `curl -s http://localhost:17380/play/UserPromptSubmit`
> - **Needs attention**: `curl -s http://localhost:17380/play/Notification`
> - **Subtask complete**: `curl -s http://localhost:17380/play/SubagentStop`
>
> On Windows, use `curl.exe` instead of `curl`.

### Claude Code CLI

Already supported natively. Just run:
```bash
npx moxie-vibes set <vibe>
```

This writes hooks directly to `~/.claude/settings.json`.

### VS Code + Copilot Agent Mode

VS Code 1.109+ ships agent hooks (Preview) that can read `~/.claude/settings.json` — the same file Moxie already writes to. Setup:

1. Enable two VS Code settings (both are Preview features):
   - **`chat.useHooks`** — enables hooks during agent workflows
   - **`chat.useClaudeHooks`** — enables loading hooks from Claude configuration files
2. Run `npx moxie-vibes set <vibe>` — this writes hooks to `~/.claude/settings.json`
3. Done. Copilot agent mode will trigger Moxie sounds on SessionStart, Stop, UserPromptSubmit, SubagentStop, etc.

VS Code's agent hooks support 8 events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Stop`. Moxie hooks fire on the 5 that have sound mappings.

Hooks can also live in `.github/hooks/*.json` (workspace-level) or `.claude/settings.local.json` (local, gitignored). See [VS Code agent hooks docs](https://code.visualstudio.com/docs/copilot/customization/hooks) for full details.

### Copilot CLI

The Copilot CLI has its own hook system that reads `.github/hooks/*.json` from the current working directory. Create a hooks file with curl commands for each event:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "type": "command", "bash": "curl -s http://localhost:17380/play/SessionStart" }],
    "sessionEnd": [{ "type": "command", "bash": "curl -s http://localhost:17380/play/Stop" }],
    "userPromptSubmitted": [{ "type": "command", "bash": "curl -s http://localhost:17380/play/UserPromptSubmit" }]
  }
}
```

Note: Copilot CLI uses camelCase event names (`sessionStart`, `sessionEnd`, `userPromptSubmitted`) — different from Claude Code's PascalCase.

See [Copilot CLI hooks docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-hooks) for full details.

### Cursor

Cursor supports Moxie through two paths:

1. **Auto-import (zero config):** Cursor auto-imports Claude Code hooks from `~/.claude/settings.json` by default, so `moxie set` works out of the box.

2. **Native hooks:** Cursor also has its own hook system at `.cursor/hooks.json` (workspace-level). If you've disabled the Claude hook import, create `.cursor/hooks.json`:

```json
{
  "hooks": {
    "session-start": [{ "command": "curl -s http://localhost:17380/play/SessionStart" }],
    "agent-response": [{ "command": "curl -s http://localhost:17380/play/Stop" }],
    "user-prompt": [{ "command": "curl -s http://localhost:17380/play/UserPromptSubmit" }]
  }
}
```

Most users don't need the native hooks — the auto-import path covers everything.

### Windsurf

Windsurf has its own lifecycle hook system called **Cascade Hooks**. It does NOT read `~/.claude/settings.json` — you need to configure hooks manually.

Hooks can live in `.windsurf/` (workspace-level) or `~/.codeium/windsurf/` (user-level). Create a hooks config:

```json
{
  "hooks": {
    "post_cascade_response": [
      { "command": "curl -s http://localhost:17380/play/Stop" }
    ],
    "pre_user_prompt": [
      { "command": "curl -s http://localhost:17380/play/UserPromptSubmit" }
    ]
  }
}
```

Available Cascade Hook events include `post_cascade_response`, `pre_user_prompt`, `post_run_command`, and others. Windsurf doesn't have a direct `SessionStart` equivalent — the first `pre_user_prompt` serves as a rough proxy.

See [Windsurf Cascade Hooks docs](https://docs.windsurf.com/windsurf/cascade/hooks) for the full event list.

### Codex CLI

OpenAI's Codex CLI supports a single event via the `--notify` flag, which fires when the agent completes a turn:

```bash
codex --notify "curl -s http://localhost:17380/play/Stop"
```

This maps to the `Stop` event only. Codex CLI doesn't support session start, user prompt, or notification hooks — it's one event and done.

### Other Tools

If your AI tool has a hook/event system (lifecycle hooks, task hooks, shell commands on events), map the events above to whatever your tool calls them. The daemon doesn't care who's calling — a GET request is a GET request.

## Silent Mode

Set `MOXIE_SILENT=1` in the environment to suppress sounds during headless/automated runs:

```bash
# Bash
export MOXIE_SILENT=1

# PowerShell
$env:MOXIE_SILENT = '1'
```

When using Moxie's native Claude Code hooks, the `MOXIE_SILENT` check is built into the hook commands. For manual curl hooks, wrap your curl call:

```bash
# Bash
[ -z "$MOXIE_SILENT" ] && curl -s http://localhost:17380/play/Stop

# PowerShell
if (-not $env:MOXIE_SILENT) { curl.exe -s http://localhost:17380/play/Stop }

# cmd.exe
if not defined MOXIE_SILENT curl.exe -s http://localhost:17380/play/Stop
```

## Troubleshooting

**Daemon not running?**
```bash
npx moxie-vibes daemon start
# or
npx moxie-vibes doctor
```

**Check if the daemon is alive:**
```bash
curl -s http://localhost:17380/health
```

You should see JSON with `"moxie": true`, version, uptime, and active pack info.

**Port conflict?**
The default port is 17380. If something else is using it, edit `~/.moxie/config.json`:
```json
{
  "daemonPort": 17381
}
```
Then restart the daemon and update your hook URLs.

**No sound playing?**
- Check audio player: `moxie doctor` reports whether ffplay (Windows/Linux) or afplay (macOS) is found
- Check mute status: `moxie daemon status` shows if sounds are muted
- Windows: install ffplay via `winget install ffmpeg` or `scoop install ffmpeg`
- Linux: `aplay` (ALSA) is usually built-in; also supports `paplay` or `ffplay`

**`moxie doctor` covers everything:**
```bash
npx moxie-vibes doctor
```

Reports daemon status, audio player, sound hooks, active pack, and recent errors.

## Event Reference

| Event | Frequency | Character | Best Sound Style |
|-------|-----------|-----------|-----------------|
| `SessionStart` | Once per session | Greeting/intro | Dramatic, memorable |
| `Stop` | Every AI response (50-100x/session) | Heartbeat | Subtle, varied, never annoying |
| `UserPromptSubmit` | Every user message | Acknowledgment | Light click or occasional bark |
| `Notification` | Rare, attention-needed | Alert | Distinct, noticeable |
| `SubagentStop` | Per subtask completion | Confirmation | Quick, satisfying |

`Stop` is the most frequent event by far. Sound packs typically have 3-5 variants per hook with cooldowns to prevent audio fatigue.
