#!/usr/bin/env node
// moxie CLI — set vibes, configure Claude Code statusline + spinner verbs + sound hooks.
// Usage: moxie set <vibe> | moxie list | moxie sounds <on|off|set <pack>> | moxie test-sounds

const { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } = require('fs');
const { join, resolve, dirname } = require('path');
const { homedir } = require('os');
const { spawn, execSync } = require('child_process');

const MOXIE_DIR = join(homedir(), '.moxie');
const REPO_DIR = resolve(__dirname, '..');
const VIBES_DIR = join(REPO_DIR, 'vibes');
const SOUNDS_DIR = join(REPO_DIR, 'sounds');
const DAEMON_SRC = join(SOUNDS_DIR, 'daemon.js');
const DAEMON_DEST = join(MOXIE_DIR, 'sounds', 'daemon.js');
const CONFIG_FILE = join(MOXIE_DIR, 'config.json');
const PID_FILE = join(MOXIE_DIR, 'sounds', '.daemon-pid');
const CLAUDE_SETTINGS = join(homedir(), '.claude', 'settings.json');
const ACTIVE_JSON = join(MOXIE_DIR, 'active.json');
const DEFAULT_PORT = 17380;
const SOUND_HOOKS = ['SessionStart', 'Stop', 'Notification', 'SubagentStop', 'UserPromptSubmit'];

// --- Helpers ---

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) {
    console.error(`Warning: Could not parse ${path}: ${e.message}`);
    return {};
  }
}

function writeJSON(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

function getClaudeSettings() {
  if (!existsSync(CLAUDE_SETTINGS)) return {};
  return readJSON(CLAUDE_SETTINGS);
}

function saveClaudeSettings(settings) {
  ensureDir(dirname(CLAUDE_SETTINGS));
  writeJSON(CLAUDE_SETTINGS, settings);
}

function isMoxieStatusLine(sl) {
  if (!sl || !sl.command) return false;
  return sl.command.includes('statusline.ps1') ||
         sl.command.includes('statusline.sh') ||
         sl.command.includes('statusline.mjs');
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '_candidates' || entry.name === '_shelved') continue;
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function getDaemonPort() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).daemonPort || DEFAULT_PORT; }
  catch { return DEFAULT_PORT; }
}

function getSourceDaemonVersion() {
  try {
    const src = readFileSync(DAEMON_SRC, 'utf8');
    const m = src.match(/DAEMON_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  } catch { return null; }
}

function getRunningDaemonVersion() {
  try {
    const port = getDaemonPort();
    const res = execSync(`curl -s --connect-timeout 0.5 http://localhost:${port}/health`,
      { encoding: 'utf8', timeout: 2000, windowsHide: true });
    return JSON.parse(res).version || null;
  } catch { return null; }
}

function hookCommand(hook) {
  const daemon = DAEMON_DEST.replace(/\\/g, '/');
  const port = getDaemonPort();

  if (process.platform === 'win32') {
    // cmd.exe wrapper makes this shell-agnostic — works whether the parent
    // invokes via bash (Claude Code CLI) or PowerShell (Cursor, etc.)
    // curl.exe avoids PowerShell's curl→Invoke-WebRequest alias
    // No quotes around daemon path — inner quotes break cmd.exe /c parsing
    const curl = `curl.exe -s --connect-timeout 0.1 http://localhost:${port}/play/${hook}`;
    return `cmd.exe /d /q /c "if not defined MOXIE_SILENT (${curl} || node ${daemon} ${hook})"`;
  }
  const curl = `curl -s --connect-timeout 0.1 http://localhost:${port}/play/${hook}`;
  const fallback = `node "${daemon}" ${hook}`;
  return `[ -z "$MOXIE_SILENT" ] && { ${curl} || ${fallback}; } || true`;
}

function stopDaemon() {
  const port = getDaemonPort();
  let daemonPid = null;
  // Health check — more reliable than PID file (avoids stale PID killing innocent process)
  try {
    const res = execSync(`curl -s --connect-timeout 0.5 http://localhost:${port}/health`,
      { encoding: 'utf8', timeout: 2000, windowsHide: true });
    const health = JSON.parse(res);
    if (health.moxie) daemonPid = health.pid;
  } catch {}
  // Fall back to PID file
  if (!daemonPid) {
    try { daemonPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10) || null; } catch {}
  }
  if (daemonPid) {
    try { process.kill(daemonPid, 'SIGTERM'); } catch {}
  }
  try { unlinkSync(PID_FILE); } catch {}
  // Kill Sound Keeper — daemon's cleanup handler doesn't run on Windows TerminateProcess
  const skPath = join(MOXIE_DIR, 'lib', 'soundkeeper', 'SoundKeeper64.exe');
  if (existsSync(skPath)) {
    try { execSync(`"${skPath}" kill`, { stdio: 'ignore', timeout: 3000, windowsHide: true }); } catch {}
  }
}

let _audioPlayerCached;
function hasAudioPlayer() {
  if (_audioPlayerCached !== undefined) return _audioPlayerCached;
  if (process.platform === 'darwin') return (_audioPlayerCached = true);
  if (process.platform === 'linux') {
    for (const cmd of ['aplay', 'paplay', 'ffplay']) {
      try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return (_audioPlayerCached = true); } catch {}
    }
    return (_audioPlayerCached = false);
  }
  try { execSync(`where ffplay`, { stdio: 'ignore', windowsHide: true }); return (_audioPlayerCached = true); } catch {}
  return (_audioPlayerCached = false);
}

function isMoxieSoundHook(entry) {
  if (!entry || !entry.hooks) return false;
  return entry.hooks.some(h => h.command &&
    (h.command.includes('sounds/daemon.js') ||
     h.command.includes(`localhost:${getDaemonPort()}`)));
}

function soundHooksInstalled(settings) {
  if (!settings.hooks) return false;
  return SOUND_HOOKS.some(hook =>
    settings.hooks[hook] && settings.hooks[hook].some(isMoxieSoundHook)
  );
}

// Tool-specific hooks: matcher targets a specific tool, reuses another hook's sound.
const TOOL_HOOKS = [
  { event: 'PostToolUse', matcher: 'AskUserQuestion', sound: 'Notification' }
];

function injectSoundHooks(settings) {
  if (!settings.hooks) settings.hooks = {};

  for (const hook of SOUND_HOOKS) {
    if (!settings.hooks[hook]) settings.hooks[hook] = [];
    settings.hooks[hook] = settings.hooks[hook].filter(e => !isMoxieSoundHook(e));
    settings.hooks[hook].push({
      matcher: '*',
      hooks: [{ type: 'command', command: hookCommand(hook) }]
    });
  }
  for (const th of TOOL_HOOKS) {
    if (!settings.hooks[th.event]) settings.hooks[th.event] = [];
    settings.hooks[th.event] = settings.hooks[th.event].filter(e => !isMoxieSoundHook(e));
    settings.hooks[th.event].push({
      matcher: th.matcher,
      hooks: [{ type: 'command', command: hookCommand(th.sound) }]
    });
  }
  return settings;
}

function removeSoundHooks(settings) {
  if (!settings.hooks) return settings;

  for (const hook of SOUND_HOOKS) {
    if (settings.hooks[hook]) {
      settings.hooks[hook] = settings.hooks[hook].filter(e => !isMoxieSoundHook(e));
      if (settings.hooks[hook].length === 0) delete settings.hooks[hook];
    }
  }
  for (const th of TOOL_HOOKS) {
    if (settings.hooks[th.event]) {
      settings.hooks[th.event] = settings.hooks[th.event].filter(e => !isMoxieSoundHook(e));
      if (settings.hooks[th.event].length === 0) delete settings.hooks[th.event];
    }
  }
  return settings;
}

// --- Commands ---

function cmdList() {
  const vibes = readdirSync(VIBES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();

  console.log(`\nVibes (${vibes.length}):`);
  for (const v of vibes) {
    const data = readJSON(join(VIBES_DIR, v + '.json'));
    const agent = data.agent?.name || '--';
    const vibeSound = data.soundPack || data.name;
    const hasSounds = existsSync(join(SOUNDS_DIR, vibeSound, 'manifest.json'));
    const tag = hasSounds ? ' [sounds]' : '';
    console.log(`  ${v.padEnd(22)} ${agent}${tag}`);
  }

  // Sound packs
  if (existsSync(SOUNDS_DIR)) {
    const packs = readdirSync(SOUNDS_DIR)
      .filter(d => existsSync(join(SOUNDS_DIR, d, 'manifest.json')))
      .sort();
    if (packs.length > 0) {
      console.log(`\nSound packs (${packs.length}):`);
      for (const p of packs) {
        const manifest = readJSON(join(SOUNDS_DIR, p, 'manifest.json'));
        const count = Object.values(manifest.hooks || {})
          .reduce((sum, h) => sum + (h.files?.length || 0), 0);
        console.log(`  ${p.padEnd(22)} ${count} sounds`);
      }
    }
  }

  // Active
  if (existsSync(ACTIVE_JSON)) {
    const active = readJSON(ACTIVE_JSON);
    let str = active.name;
    if (active.soundPack) str += ` + ${active.soundPack} sounds`;
    console.log(`\nActive: ${str}`);
  }
  console.log();
}

function cmdSet(vibeName) {
  if (!vibeName) {
    console.error('Usage: moxie set <vibe>');
    process.exit(1);
  }

  const vibeFile = join(VIBES_DIR, vibeName + '.json');
  if (!existsSync(vibeFile)) {
    console.error(`Vibe not found: ${vibeName}`);
    console.error(`Run 'moxie list' to see available vibes.`);
    process.exit(1);
  }

  ensureDir(MOXIE_DIR);
  const vibe = readJSON(vibeFile);

  // Sound pack: check for matching pack in repo
  const vibeSound = vibe.soundPack || vibe.name || 'default';
  const soundPackDir = join(SOUNDS_DIR, vibeSound);
  const hasSoundPack = existsSync(soundPackDir) && existsSync(join(soundPackDir, 'manifest.json'));

  if (hasSoundPack) {
    const srcVer = getSourceDaemonVersion();
    const runVer = getRunningDaemonVersion();
    const daemonCurrent = srcVer && srcVer === runVer;
    if (!daemonCurrent) {
      stopDaemon(); // Kill daemon + Sound Keeper before overwriting binaries
    }
    const destDir = join(MOXIE_DIR, 'sounds', vibeSound);
    copyDirRecursive(soundPackDir, destDir);
    if (!daemonCurrent) {
      // Only copy binaries when daemon version changed (SK binary is locked while running)
      ensureDir(join(MOXIE_DIR, 'sounds'));
      copyFileSync(DAEMON_SRC, DAEMON_DEST);
      const skSrc = join(REPO_DIR, 'lib', 'soundkeeper');
      const skDest = join(MOXIE_DIR, 'lib', 'soundkeeper');
      if (existsSync(skSrc)) copyDirRecursive(skSrc, skDest);
    }
    if (daemonCurrent) {
      try {
        const port = getDaemonPort();
        execSync(`curl -s --connect-timeout 0.5 http://localhost:${port}/reload?mode=manifest`,
          { stdio: 'ignore', timeout: 2000, windowsHide: true });
        console.log('  Daemon up-to-date — manifest reloaded');
      } catch {}
    }
    vibe.soundPack = vibeSound;
    console.log(`Sound pack: ${vibeSound}`);
  } else {
    // Recommend sound pack if vibe declares one but it's not installed
    if (vibe.soundPack) {
      const installedDir = join(MOXIE_DIR, 'sounds', vibe.soundPack);
      if (existsSync(join(installedDir, 'manifest.json'))) {
        // Pack is already installed from a previous set — just use it
        console.log(`Sound pack: ${vibe.soundPack} (installed)`);
      } else {
        console.log(`Recommended: moxie sounds set ${vibe.soundPack}`);
      }
    }
    // Preserve existing soundPack from previous active if vibe doesn't declare one
    if (!vibe.soundPack && existsSync(ACTIVE_JSON)) {
      try {
        const prev = readJSON(ACTIVE_JSON);
        if (prev.soundPack) vibe.soundPack = prev.soundPack;
      } catch {}
    }
  }

  // Write active.json (with soundPack merged)
  writeJSON(ACTIVE_JSON, vibe);
  console.log(`Vibe set: ${vibeName} (${vibe.agent?.name || 'nameless'})`);

  // Copy statusline script (Node.js, cross-platform)
  const slSrc = join(REPO_DIR, 'scripts', 'statusline.mjs');
  if (existsSync(slSrc)) copyFileSync(slSrc, join(MOXIE_DIR, 'statusline.mjs'));

  // Clean up old/legacy scripts from ~/.moxie/
  for (const old of ['statusline.ps1', 'statusline.sh', 'ccbridge.ps1', 'ccbridge.sh', 'ccbridge.mjs']) {
    const p = join(MOXIE_DIR, old);
    if (existsSync(p)) { try { unlinkSync(p); } catch {} }
  }

  // Update Claude settings
  const settings = getClaudeSettings();
  settings.spinnerVerbs = vibe.spinnerVerbs;

  // Statusline
  if (!settings.statusLine || isMoxieStatusLine(settings.statusLine)) {
    const slPath = join(MOXIE_DIR, 'statusline.mjs').replace(/\\/g, '/');
    settings.statusLine = { type: 'command', command: `node ${slPath}` };
  } else {
    console.log(`Note: Custom statusLine detected, not modified.`);
    console.log(`  Moxie statusline available at: node ~/.moxie/statusline.mjs`);
  }

  // Sound hooks + daemon
  if (hasSoundPack || vibe.soundPack) {
    // Ensure daemon.js is up to date (Sound Keeper deployed via moxie set)
    if (!hasSoundPack && existsSync(DAEMON_SRC)) {
      const srcVer = getSourceDaemonVersion();
      const runVer = getRunningDaemonVersion();
      if (srcVer && srcVer === runVer) {
        // Daemon already running right version — skip restart
      } else {
        stopDaemon();
        ensureDir(join(MOXIE_DIR, 'sounds'));
        copyFileSync(DAEMON_SRC, DAEMON_DEST);
      }
    }
    injectSoundHooks(settings);
    if (!hasAudioPlayer()) {
      const hint = process.platform === 'linux'
        ? 'Install aplay (alsa-utils), paplay (pulseaudio), or ffmpeg'
        : 'Install ffmpeg: winget install ffmpeg (or scoop install ffmpeg)';
      console.log(`Note: No audio player found. ${hint}`);
    }
  }

  saveClaudeSettings(settings);

  // terminal_bell cleanup removed — was a one-time v1 migration that caused
  // race conditions with Claude Code's concurrent writes to ~/.claude.json

  console.log('Settings updated.');

  // Bootstrap daemon with SessionStart sound
  if (hasSoundPack || vibe.soundPack) {
    spawn(process.execPath, [DAEMON_DEST, 'SessionStart'], {
      detached: true, stdio: 'ignore', windowsHide: true
    }).on('error', () => {}).unref();
  }

  // ccstatusline integration hint
  const ccslConfig = join(homedir(), '.config', 'ccstatusline', 'settings.json');
  if (existsSync(ccslConfig)) {
    const bridgePath = join(MOXIE_DIR, 'statusline.mjs').replace(/\\/g, '/');
    console.log('\nccstatusline detected. To add moxie as a widget:');
    console.log(`  Add a "custom-command" widget to ${ccslConfig.replace(/\\/g, '/')}`);
    console.log(`  commandPath: "node ${bridgePath} --bridge"`);
    console.log('  timeout: 500, maxWidth: 120, preserveColors: true');
  }
}

function cmdSounds(action, arg) {
  const settings = getClaudeSettings();

  switch (action) {
    case 'on': {
      if (soundHooksInstalled(settings)) {
        console.log('Sound hooks already installed.');
        return;
      }
      if (existsSync(DAEMON_SRC)) {
        stopDaemon();
        ensureDir(join(MOXIE_DIR, 'sounds'));
        copyFileSync(DAEMON_SRC, DAEMON_DEST);
      }
      injectSoundHooks(settings);
      saveClaudeSettings(settings);
      console.log('Sound hooks enabled.');
      if (!hasAudioPlayer()) {
        const hint = process.platform === 'linux'
          ? 'Install aplay (alsa-utils), paplay (pulseaudio), or ffmpeg'
          : 'Install ffmpeg: winget install ffmpeg (or scoop install ffmpeg)';
        console.log(`Note: No audio player found. ${hint}`);
      }
      break;
    }

    case 'off': {
      removeSoundHooks(settings);
      saveClaudeSettings(settings);
      stopDaemon();
      console.log('Sound hooks removed.');
      break;
    }

    case 'set': {
      if (!arg) {
        console.error('Usage: moxie sounds set <pack>');
        process.exit(1);
      }
      const packDir = join(SOUNDS_DIR, arg);
      const installedDir = join(MOXIE_DIR, 'sounds', arg);

      if (existsSync(packDir) && existsSync(join(packDir, 'manifest.json'))) {
        // Clean old files before copying to prevent stale WAVs from accumulating
        if (existsSync(installedDir)) {
          for (const f of readdirSync(installedDir)) {
            const fp = join(installedDir, f);
            if (statSync(fp).isFile()) unlinkSync(fp);
          }
        }
        copyDirRecursive(packDir, join(MOXIE_DIR, 'sounds', arg));
      } else if (!existsSync(installedDir) || !existsSync(join(installedDir, 'manifest.json'))) {
        console.error(`Sound pack not found: ${arg}`);
        const available = [];
        if (existsSync(SOUNDS_DIR)) {
          readdirSync(SOUNDS_DIR)
            .filter(d => existsSync(join(SOUNDS_DIR, d, 'manifest.json')))
            .forEach(p => available.push(p));
        }
        if (existsSync(join(MOXIE_DIR, 'sounds'))) {
          readdirSync(join(MOXIE_DIR, 'sounds'))
            .filter(d => d !== 'daemon.js' && existsSync(join(MOXIE_DIR, 'sounds', d, 'manifest.json')))
            .forEach(p => { if (!available.includes(p)) available.push(p + ' (installed)'); });
        }
        if (available.length) {
          console.error('Available:');
          available.forEach(p => console.error(`  ${p}`));
        }
        process.exit(1);
      }

      if (existsSync(DAEMON_SRC)) {
        stopDaemon();
        ensureDir(join(MOXIE_DIR, 'sounds'));
        copyFileSync(DAEMON_SRC, DAEMON_DEST);
      }

      if (existsSync(ACTIVE_JSON)) {
        const active = readJSON(ACTIVE_JSON);
        active.soundPack = arg;
        writeJSON(ACTIVE_JSON, active);
      }

      injectSoundHooks(settings);
      saveClaudeSettings(settings);

      console.log(`\u{1F50A} Sound pack active: ${arg}`);
      if (!hasAudioPlayer()) {
        const hint = process.platform === 'linux'
          ? 'Install aplay (alsa-utils), paplay (pulseaudio), or ffmpeg'
          : 'Install ffmpeg: winget install ffmpeg (or scoop install ffmpeg)';
        console.log(`Note: No audio player found. ${hint}`);
      }
      spawn(process.execPath, [DAEMON_DEST, 'SessionStart'], {
        detached: true, stdio: 'ignore', windowsHide: true
      }).unref();
      console.log(`Run 'moxie demo' to hear the full pack.`);
      break;
    }

    case 'mute': {
      const pauseFile = join(MOXIE_DIR, 'sounds', '.paused');
      ensureDir(join(MOXIE_DIR, 'sounds'));
      writeFileSync(pauseFile, '');
      console.log('Sounds muted.');
      break;
    }

    case 'unmute': {
      const pauseFile2 = join(MOXIE_DIR, 'sounds', '.paused');
      if (existsSync(pauseFile2)) unlinkSync(pauseFile2);
      console.log('Sounds unmuted.');
      break;
    }

    case 'keeper': {
      if (!arg || (arg !== 'on' && arg !== 'off')) {
        console.error('Usage: moxie sounds keeper <on|off>');
        process.exit(1);
      }
      ensureDir(MOXIE_DIR);
      let cfg = {};
      try { cfg = readJSON(CONFIG_FILE); } catch {}
      cfg.soundKeeper = arg === 'on';
      writeJSON(CONFIG_FILE, cfg);
      console.log(`Sound Keeper ${arg === 'on' ? 'enabled' : 'disabled'}.`);
      if (arg === 'off') {
        console.log('Daemon will skip Sound Keeper on next restart. Run: moxie daemon stop && moxie daemon start');
      }
      break;
    }

    default:
      console.error('Usage: moxie sounds <on|off|set <pack>|mute|unmute|keeper <on|off>>');
      process.exit(1);
  }
}

function cmdDemo(demoArgs) {
  // Forward to demo.js with all args
  const demoScript = join(__dirname, 'demo.js');
  if (!existsSync(demoScript)) {
    console.error('demo.js not found. Re-run moxie set <vibe> to update.');
    process.exit(1);
  }
  const { execSync: exec } = require('child_process');
  try {
    exec(`node "${demoScript}" ${demoArgs.join(' ')}`, { stdio: 'inherit' });
  } catch {}
}

function cmdTestSounds() {
  console.log('test-sounds is deprecated. Use: moxie demo [pack]');
  process.exit(0);
}

function cmdDaemon(action) {
  const port = getDaemonPort();

  switch (action) {
    case 'start': {
      // Check if already running
      try {
        const res = require('child_process').execSync(
          `curl -s --connect-timeout 0.5 http://localhost:${port}/health`,
          { encoding: 'utf8', timeout: 3000, windowsHide: true }
        );
        const health = JSON.parse(res);
        if (health.moxie) {
          console.log(`Daemon already running (pid ${health.pid}, up ${health.uptime}s)`);
          return;
        }
      } catch {}

      // Spawn detached
      const child = spawn('node', [DAEMON_DEST, '--listen'], {
        detached: true,
        stdio: 'ignore',
        cwd: homedir(),
        windowsHide: true
      });
      child.on('error', () => {});
      child.unref();
      console.log(`Daemon starting on localhost:${port} (pid ${child.pid})`);
      break;
    }

    case 'stop': {
      stopDaemon();
      console.log('Daemon stopped.');
      break;
    }

    case 'status': {
      try {
        const res = require('child_process').execSync(
          `curl -s --connect-timeout 0.5 http://localhost:${port}/health`,
          { encoding: 'utf8', timeout: 3000, windowsHide: true }
        );
        const h = JSON.parse(res);
        console.log(`Daemon: running (pid ${h.pid})`);
        console.log(`Port: ${h.port}`);
        console.log(`Uptime: ${h.uptime}s`);
        console.log(`Pack: ${h.pack || 'none'}`);
        console.log(`Muted: ${h.muted}`);
        const playerOk = hasAudioPlayer();
        console.log(`ffplay: ${playerOk ? 'installed' : 'NOT FOUND'}`);
        // Sound Keeper status
        const skStatus = h.soundKeeper ? `active (pid ${h.soundKeeperPid})` : (h.soundKeeperEnabled ? 'not running' : 'disabled');
        console.log(`Sound Keeper: ${skStatus}`);
        if (h.history && h.history.length > 0) {
          console.log(`\nRecent plays (${h.history.length}):`);
          for (const e of h.history) {
            const status = e.fizzled ? 'skipped (cooldown)' : e.file;
            console.log(`  ${e.time}  ${e.hook.padEnd(18)} ${status}`);
          }
        }
      } catch {
        console.log('Daemon: not running');
      }
      break;
    }

    default:
      console.error('Usage: moxie daemon <start|stop|status>');
      process.exit(1);
  }
}

function cmdCreate(name) {
  if (!name) {
    console.error('Usage: moxie create <pack-name>');
    process.exit(1);
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    console.error('Pack name must be lowercase letters, numbers, and hyphens only.');
    process.exit(1);
  }
  const destDir = join(MOXIE_DIR, 'sounds', name);
  if (existsSync(join(destDir, 'manifest.json'))) {
    console.error(`Pack "${name}" already exists at ${destDir}`);
    process.exit(1);
  }

  // Copy template manifest
  const templateDir = join(REPO_DIR, 'examples', 'custom-pack');
  const templateManifest = join(templateDir, 'manifest.json');
  if (!existsSync(templateManifest)) {
    console.error('Template manifest not found. Re-install moxie.');
    process.exit(1);
  }
  ensureDir(destDir);
  const manifest = readJSON(templateManifest);
  manifest.pack = name;
  writeJSON(join(destDir, 'manifest.json'), manifest);

  console.log(`\nCreated sound pack: ${name}`);
  console.log(`  ${destDir.replace(/\\/g, '/')}/`);
  console.log('\nNext steps:');
  console.log(`  1. Add WAV files to the directory (44.1kHz, mono, 16-bit)`);
  console.log(`  2. Edit manifest.json — map your files to hooks`);
  console.log(`  3. Update durations for each file`);
  console.log(`  4. Activate: moxie sounds set ${name}`);
  console.log('\nSee docs/build-your-own-pack.md for the full guide.');
}

function cmdSetup() {
  const port = getDaemonPort();
  const base = `http://localhost:${port}`;
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';

  console.log('Moxie Universal Setup');
  console.log('\u2550'.repeat(27));
  console.log('');
  console.log('Moxie uses a local sound daemon. Any tool that can run');
  console.log('a shell command on events can trigger sounds via curl.');
  console.log('');
  console.log('Daemon endpoint:');
  console.log(`  ${base}/play/<event>`);
  console.log('');
  console.log('Events:');
  console.log('  SessionStart      Session begins');
  console.log('  Stop              Agent finishes a response');
  console.log('  UserPromptSubmit  User sends a message');
  console.log('  Notification      Agent needs attention');
  console.log('  SubagentStop      Subagent completes');
  console.log('');
  console.log('curl examples:');
  console.log(`  ${curl} -s ${base}/play/SessionStart`);
  console.log(`  ${curl} -s ${base}/play/Stop`);
  console.log(`  ${curl} -s ${base}/play/UserPromptSubmit`);
  console.log(`  ${curl} -s ${base}/play/Notification`);
  console.log(`  ${curl} -s ${base}/play/SubagentStop`);
  console.log('');
  console.log('Paste this into your AI tool to auto-configure:');
  console.log('\u2500'.repeat(50));
  console.log(`Add hooks that run "${curl} -s ${base}/play/<event>"`);
  console.log('for these events: SessionStart (session start),');
  console.log('Stop (response complete), UserPromptSubmit (user message),');
  console.log('Notification (needs attention), SubagentStop (subagent done).');
  console.log('Each hook should run the curl command in the background.');
  console.log('On failure, ignore silently (the daemon may not be running).');
  console.log('\u2500'.repeat(50));
  console.log('');
  console.log('Already using Claude Code CLI? Just run: moxie set <vibe>');
  console.log('Full guide: https://github.com/buildfriday/moxie/blob/main/docs/universal-setup.md');
  console.log('Diagnostics: moxie doctor');
}

function cmdDoctor() {
  const port = getDaemonPort();
  console.log('Moxie Doctor');
  console.log('\u2550'.repeat(27));

  // Check daemon
  let health = null;
  try {
    const res = execSync(`curl -s --connect-timeout 1 http://localhost:${port}/health`,
      { encoding: 'utf8', timeout: 3000, windowsHide: true });
    health = JSON.parse(res);
  } catch {}

  if (health && health.moxie) {
    console.log(`Daemon:        \u2713 Running (v${health.version}, PID ${health.pid}, uptime ${health.uptime}s)`);
  } else {
    console.log('Daemon:        \u2717 Not running');
  }

  // Audio player
  if (health && health.playerFound !== undefined) {
    if (health.playerFound) {
      console.log(`Audio Player:  \u2713 ${health.player} (${health.playerPath})`);
    } else {
      console.log(`Audio Player:  \u2717 NOT FOUND \u2014 sounds will not play`);
    }
  } else {
    // Fallback: check locally
    if (hasAudioPlayer()) {
      console.log(`Audio Player:  \u2713 ${process.platform === 'darwin' ? 'afplay' : 'ffplay'}`);
    } else {
      console.log('Audio Player:  \u2717 NOT FOUND \u2014 sounds will not play');
    }
  }

  // Sound Keeper
  if (health) {
    if (health.soundKeeper) {
      console.log(`Sound Keeper:  \u2713 Active (PID ${health.soundKeeperPid})`);
    } else if (health.soundKeeperEnabled) {
      console.log('Sound Keeper:  \u2717 Not running (enabled)');
    } else {
      console.log('Sound Keeper:  \u2014 Disabled');
    }
  }

  // Active pack
  if (health?.pack) {
    console.log(`Active Pack:   ${health.pack}`);
  } else if (existsSync(ACTIVE_JSON)) {
    try {
      const active = readJSON(ACTIVE_JSON);
      console.log(`Active Pack:   ${active.soundPack || active.name || 'none'}`);
    } catch {
      console.log('Active Pack:   none');
    }
  } else {
    console.log('Active Pack:   none');
  }

  // Muted
  const pauseFile = join(MOXIE_DIR, 'sounds', '.paused');
  console.log(`Muted:         ${health?.muted || existsSync(pauseFile) ? 'Yes' : 'No'}`);

  // Error info
  if (health?.moxie) {
    console.log(`Recent Errors: ${health.recentErrors || 0}`);
    if (health.lastError) {
      const ago = Math.round((Date.now() - health.lastError.time) / 1000);
      console.log(`Last Error:    ${health.lastError.message} (${ago}s ago)`);
    } else {
      console.log('Last Error:    None');
    }
    console.log(`Active Plays:  ${health.activeChildren || 0}/10`);
  }

  // Sound hooks
  const settings = getClaudeSettings();
  const hooksOk = soundHooksInstalled(settings);
  console.log(`Sound Hooks:   ${hooksOk ? '\u2713 Installed' : '\u2717 Not installed'}`);

  // Statusline
  const slOk = settings.statusLine && isMoxieStatusLine(settings.statusLine);
  console.log(`Statusline:    ${slOk ? '\u2713 Active' : '\u2717 Not configured'}`);
}

// --- Main ---

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'set':          cmdSet(args[0]); break;
  case 'list':         cmdList(); break;
  case 'sounds':       cmdSounds(args[0], args[1]); break;
  case 'daemon':       cmdDaemon(args[0]); break;
  case 'demo':         cmdDemo(args); break;
  case 'create':       cmdCreate(args[0]); break;
  case 'setup':        cmdSetup(); break;
  case 'doctor':       cmdDoctor(); break;
  case 'test-sounds':  cmdTestSounds(); break;
  default:
    console.log(`
moxie — personality for Claude Code

Usage:
  moxie set <vibe>           Set active vibe + statusline + sounds + settings
  moxie create <pack>        Scaffold a custom sound pack
  moxie list                 List available vibes and sound packs
  moxie demo [pack]          Showcase a sound pack (simulated session)
  moxie demo --all           Showreel of all installed packs
  moxie demo --hook <name>   Taste test: one hook across all packs
  moxie demo --list          Print demo sequence without playing
  moxie setup                Output universal setup instructions for any AI tool
  moxie doctor               Run diagnostics (daemon, player, hooks)
  moxie sounds on            Enable sound hooks in Claude settings
  moxie sounds off           Disable sound hooks
  moxie sounds set <pack>    Switch active sound pack
  moxie sounds mute          Silence sounds (hooks stay installed)
  moxie sounds unmute        Resume sound playback
  moxie sounds keeper on     Enable Sound Keeper (WASAPI warm, default)
  moxie sounds keeper off    Disable Sound Keeper (for drivers that don't need it)
  moxie daemon start         Start sound daemon in background
  moxie daemon stop          Stop sound daemon
  moxie daemon status        Show daemon health + recent plays
  moxie test-sounds          (deprecated — use moxie demo)
`);
}
