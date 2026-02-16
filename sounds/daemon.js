#!/usr/bin/env node
// Moxie sound daemon v4 — Sound Keeper + spawn-per-sound.
// Mode 1 (bootstrap): node daemon.js <hook>  — spawns daemon with --play <hook>, exits immediately
// Mode 2 (listen):    node daemon.js --listen [--play <hook>] — daemon mode, optional startup sound
//
// Sound Keeper keeps the Windows audio device warm (WASAPI stays in D0).
// Each hook spawns a fresh ffplay process — with WASAPI warm, ~80ms latency, zero clipping.
// Cross-hook overlap restored: separate ffplay processes play simultaneously.

const http = require('http');
const { readFileSync, writeFileSync, appendFileSync, existsSync, statSync, unlinkSync } = require('fs');
const { join } = require('path');
const { homedir, platform } = require('os');
const { spawn, execSync } = require('child_process');

const MOXIE_DIR = join(homedir(), '.moxie');
const SOUNDS_DIR = join(MOXIE_DIR, 'sounds');
const CONFIG_FILE = join(MOXIE_DIR, 'config.json');
const PID_FILE = join(SOUNDS_DIR, '.daemon-pid');
const LOG_FILE = join(SOUNDS_DIR, 'daemon.log');
const PAUSE_FILE = join(SOUNDS_DIR, '.paused');
const ACTIVE_FILE = join(MOXIE_DIR, 'active.json');
const SK_PATH = join(MOXIE_DIR, 'lib', 'soundkeeper', 'SoundKeeper64.exe');
const DEFAULT_PORT = 17380;
const MAX_LOG_LINES = 100;
const HISTORY_SIZE = 20;
const DEFAULT_COOLDOWNS = {
  SessionStart: 3000,
  UserPromptSubmit: 100,
  Stop: 1500,
  SubagentStop: 1000,
  Notification: 2000,
};
const DEFAULT_COOLDOWN = 100; // fallback for unknown hooks
const DAEMON_VERSION = '5.0';

// --- Shared state ---
let manifestCache = null; // { manifest, packDir, mtime }
let lastPick = {};        // { hook: lastFilename } — per-pool no-repeat
let lastPlay = {};        // { hook: timestamp } — per-hook cooldown
let lastPlayGlobal = {};  // { hook: timestamp } — cross-hook suppression
let lastBarkEnd = 0;      // timestamp when last bark finishes (now + duration)
const playHistory = [];   // ring buffer of last HISTORY_SIZE plays
const startTime = Date.now();
let isReloading = false;
const DEFAULT_BARK_CHANCE = 0.25;
const DEFAULT_BARK_COOLDOWN = 45000;

// --- Player health (Layer 1 — populated at startup) ---
let playerHealthy = true;
let playerPath = null;

// --- Error tracking (Layer 2) ---
let recentErrors = 0;
let lastError = null;

// --- Competitive features state ---
let lastRareBark = 0;     // timestamp of last rare bark
let lastRare = null;      // last rare bark filename (no-repeat)
let streaks = {};         // { hookName: { count, lastTime } } — escalation tracking
let promptTimes = [];     // circular buffer for annoyed ping detection
let lastAnnoyed = null;   // last annoyed bark filename (no-repeat)

// --- Tuning (loaded from config, overrides manifest defaults) ---
let TUNING = { barkChance: null, barkCooldown: null, stopSuppressionWindow: null };

// --- Sound Keeper state ---
let soundKeeperProc = null;
let skRestarting = false;
let skRestarts = 0;

// --- Config ---

function getPort() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).daemonPort || DEFAULT_PORT; }
  catch { return DEFAULT_PORT; }
}

function getSoundKeeperEnabled() {
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    return cfg.soundKeeper !== false; // default true
  } catch { return true; }
}

function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function loadTuning() {
  const config = loadConfig();
  TUNING = {
    barkChance: config?.tuning?.barkChance ?? null,
    barkCooldown: config?.tuning?.barkCooldown ?? null,
    stopSuppressionWindow: config?.tuning?.stopSuppressionWindow ?? null,
  };
}

function checkPlayerHealth() {
  const playerName = getPlayerName();
  try {
    const result = execSync(
      platform() === 'win32' ? `where ${playerName}` : `which ${playerName}`,
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    );
    playerPath = result.trim().split('\n')[0];
    playerHealthy = true;
    log(`Audio player found: ${playerPath}`);
  } catch {
    playerHealthy = false;
    playerPath = null;
    log(`[WARN] Audio player '${playerName}' not found in PATH — sounds will not play`);
  }
}

// --- Logging ---

function ts() { return new Date().toISOString().slice(11, 19); }

function log(msg) {
  try { appendFileSync(LOG_FILE, `[${ts()}] ${msg}\n`); } catch {}
}

function rotateLog() {
  try {
    const content = readFileSync(LOG_FILE, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    if (lines.length > MAX_LOG_LINES) {
      writeFileSync(LOG_FILE, lines.slice(-50).join('\n') + '\n');
    }
  } catch {}
}

// --- Sound Keeper ---

function startSoundKeeper() {
  if (platform() === 'darwin') return;
  if (soundKeeperProc) return;
  if (!getSoundKeeperEnabled()) { log('Sound Keeper disabled in config'); return; }
  if (!existsSync(SK_PATH)) { log(`Sound Keeper not found: ${SK_PATH}`); return; }

  // Kill orphans from crashed daemons
  try { execSync(`"${SK_PATH}" kill`, { stdio: 'ignore', timeout: 3000, windowsHide: true }); } catch {}

  soundKeeperProc = spawn(SK_PATH, ['fluctuate', 'primary'], {
    detached: true, stdio: 'ignore', windowsHide: true
  });
  const skStartedAt = Date.now();

  soundKeeperProc.on('error', (err) => {
    log(`Sound Keeper spawn error: ${err.message}`);
    soundKeeperProc = null;
  });

  soundKeeperProc.on('exit', (code) => {
    log(`Sound Keeper exited (code ${code})`);
    soundKeeperProc = null;
    if (!skRestarting) {
      if (Date.now() - skStartedAt < 5000) {
        skRestarts++;
        if (skRestarts >= 3) {
          log('Sound Keeper failed 3 times quickly — disabled until daemon restart');
          return;
        }
      } else {
        skRestarts = 0;
      }
      setTimeout(() => startSoundKeeper(), 500 * Math.pow(2, skRestarts));
    }
  });

  soundKeeperProc.unref();
  log(`Sound Keeper started (pid ${soundKeeperProc.pid})`);
}

function stopSoundKeeper() {
  skRestarting = true;
  if (soundKeeperProc) {
    try { soundKeeperProc.kill(); } catch {}
    soundKeeperProc = null;
  }
  // Clean kill via Sound Keeper's own command (catches orphans too)
  try { execSync(`"${SK_PATH}" kill`, { stdio: 'ignore', timeout: 3000, windowsHide: true }); } catch {}
}

// --- Manifest ---

function loadManifest() {
  if (!existsSync(ACTIVE_FILE)) return null;
  let active;
  try { active = JSON.parse(readFileSync(ACTIVE_FILE, 'utf8')); } catch { return null; }
  const pack = active.soundPack || active.name;
  if (!pack) return null;
  const packDir = join(SOUNDS_DIR, pack);
  const manifestFile = join(packDir, 'manifest.json');
  if (!existsSync(manifestFile)) return null;

  try {
    const mtime = statSync(manifestFile).mtimeMs;
    if (manifestCache && manifestCache.packDir === packDir && manifestCache.mtime === mtime) {
      return manifestCache;
    }
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    manifestCache = { manifest, packDir, pack, mtime };
    return manifestCache;
  } catch { return null; }
}

// --- Sound playback ---

// Linux player detection — cached at first call
let linuxPlayer = null;
let linuxPlayerChecked = false;

function getLinuxPlayer() {
  if (linuxPlayerChecked) return linuxPlayer;
  linuxPlayerChecked = true;
  for (const cmd of ['aplay', 'paplay', 'ffplay']) {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      linuxPlayer = cmd;
      log(`Linux player: ${cmd}`);
      return cmd;
    } catch {}
  }
  log('No audio player found on Linux');
  return null;
}

function getPlayerName() {
  const plat = platform();
  if (plat === 'darwin') return 'afplay';
  if (plat === 'linux') return getLinuxPlayer() || 'none';
  return 'ffplay';
}

let activeChildren = 0;
const MAX_CHILDREN = 10;

function playSound(fullPath) {
  if (activeChildren >= MAX_CHILDREN) {
    log('Too many active audio processes — skipping');
    return null;
  }
  const plat = platform();
  let child;
  if (plat === 'darwin') {
    child = spawn('afplay', ['-q', '1', fullPath], { detached: true, stdio: 'ignore' });
  } else if (plat === 'linux') {
    const player = getLinuxPlayer();
    if (!player) return null;
    let args;
    switch (player) {
      case 'aplay':  args = [fullPath]; break;
      case 'paplay': args = [fullPath]; break;
      case 'ffplay':  args = ['-nodisp', '-autoexit', '-vn', '-loglevel', 'quiet', fullPath]; break;
    }
    child = spawn(player, args, { detached: true, stdio: 'ignore' });
  } else {
    child = spawn('ffplay', ['-nodisp', '-autoexit', '-vn', '-loglevel', 'quiet', fullPath],
      { detached: true, stdio: 'ignore', windowsHide: true });
  }
  activeChildren++;
  child.on('error', (err) => {
    log(`Audio player error: ${err.message}`);
    activeChildren = Math.max(0, activeChildren - 1);
    recentErrors++;
    lastError = { message: err.message, time: Date.now() };
  });
  child.on('exit', () => { activeChildren = Math.max(0, activeChildren - 1); });
  child.unref();
  return child;
}

function pickSound(hook, files) {
  if (files.length === 1) return files[0];
  const pool = files.filter(f => f !== lastPick[hook]);
  if (pool.length === 0) return files[Math.floor(Math.random() * files.length)];
  return pool[Math.floor(Math.random() * pool.length)];
}

function handlePlay(hook) {
  if (existsSync(PAUSE_FILE)) return { muted: true };

  // Layer 2 — accurate response when player is missing
  if (!playerHealthy) return { played: false, error: 'player_not_found' };

  const m = loadManifest();
  if (!m) return { error: 'no manifest' };

  const hookCfg = m.manifest.hooks && m.manifest.hooks[hook];
  if (!hookCfg) return { error: 'no files for hook' };

  // Cross-hook suppression: Stop is wallpaper — suppress after higher-priority hooks
  const now = Date.now();
  if (hook === 'Stop') {
    // Bark-duration-aware: suppress until bark audio finishes playing
    const suppressionWindow = TUNING.stopSuppressionWindow ?? 2000;
    const suppressUntil = Math.max(
      lastPlayGlobal['UserPromptSubmit'] ? lastPlayGlobal['UserPromptSubmit'] + suppressionWindow : 0,
      lastBarkEnd
    );
    if (now < suppressUntil) {
      log(`${hook} → suppressed (UserPromptSubmit/bark within window)`);
      return { suppressed: true, reason: 'cross-hook' };
    }
    if (lastPlayGlobal['Notification'] && now - lastPlayGlobal['Notification'] < 1000) {
      log(`${hook} → suppressed (Notification within 1s)`);
      return { suppressed: true, reason: 'cross-hook' };
    }
  }

  // --- Rare barks (checked BEFORE regular bark roll) ---
  if (hookCfg.rareBarks?.length && hook === 'UserPromptSubmit') {
    const rareCooldown = hookCfg.rareCooldown ?? 300000; // 5 min default
    if ((!lastRareBark || now - lastRareBark > rareCooldown) && Math.random() < 0.05) {
      const pick = pickSound('rare', hookCfg.rareBarks);
      lastRare = pick;
      lastRareBark = now;
      const fullPath = join(m.packDir, pick);
      if (existsSync(fullPath)) {
        const child = playSound(fullPath);
        if (child === null) return { played: false, error: 'max_children' };
        const dur = m.manifest.durations?.[pick];
        if (dur) lastBarkEnd = now + Math.ceil(dur * 1000);
        lastPlay[hook] = now;
        lastPlayGlobal[hook] = now;
        const entry = { hook, file: pick, time: ts(), fizzled: false, pool: 'rare' };
        playHistory.push(entry);
        if (playHistory.length > HISTORY_SIZE) playHistory.shift();
        log(`${hook} → ${pick} (rare)`);
        return { played: true, file: pick, pool: 'rare' };
      }
    }
  }

  // --- Escalation mechanic (streaks, primarily SubagentStop) ---
  if (hookCfg.escalation?.length) {
    const streak = streaks[hook] || { count: 0, lastTime: 0 };
    const STREAK_WINDOW = 10000; // 10s
    if (now - streak.lastTime < STREAK_WINDOW) {
      streak.count++;
    } else {
      streak.count = 1;
    }
    streak.lastTime = now;
    streaks[hook] = streak;

    if (streak.count >= 2) {
      const idx = Math.min(streak.count - 2, hookCfg.escalation.length - 1);
      const pick = hookCfg.escalation[idx];
      const fullPath = join(m.packDir, pick);
      if (existsSync(fullPath)) {
        const child = playSound(fullPath);
        if (child === null) return { played: false, error: 'max_children' };
        lastPlay[hook] = now;
        lastPlayGlobal[hook] = now;
        const entry = { hook, file: pick, time: ts(), fizzled: false, pool: 'escalation', streak: streak.count };
        playHistory.push(entry);
        if (playHistory.length > HISTORY_SIZE) playHistory.shift();
        log(`${hook} → ${pick} (escalation x${streak.count})`);
        return { played: true, file: pick, pool: 'escalation', streak: streak.count };
      }
    }
  }

  // --- Annoyed ping (rapid prompt spam detection) ---
  if (hook === 'UserPromptSubmit' && hookCfg.annoyedBarks?.length) {
    promptTimes.push(now);
    if (promptTimes.length > 5) promptTimes.shift();
    const recentCount = promptTimes.filter(t => now - t < 30000).length;
    if (recentCount > 3) {
      const pick = pickSound('annoyed', hookCfg.annoyedBarks);
      lastAnnoyed = pick;
      const fullPath = join(m.packDir, pick);
      if (existsSync(fullPath)) {
        const child = playSound(fullPath);
        if (child === null) return { played: false, error: 'max_children' };
        const dur = m.manifest.durations?.[pick];
        if (dur) lastBarkEnd = now + Math.ceil(dur * 1000);
        lastPlay[hook] = now;
        lastPlayGlobal[hook] = now;
        const entry = { hook, file: pick, time: ts(), fizzled: false, pool: 'annoyed' };
        playHistory.push(entry);
        if (playHistory.length > HISTORY_SIZE) playHistory.shift();
        log(`${hook} → ${pick} (annoyed)`);
        return { played: true, file: pick, pool: 'annoyed' };
      }
    }
  }

  // Resolve which file pool to use (barks/clicks split or legacy files)
  let pool;
  let poolName = 'files';
  if (hookCfg.clicks || hookCfg.barks) {
    // Barks/clicks split — UserPromptSubmit gets probability-based bark or click
    const barkChance = TUNING.barkChance ?? hookCfg.barkChance ?? DEFAULT_BARK_CHANCE;
    const barkCooldown = TUNING.barkCooldown ?? hookCfg.barkCooldown ?? DEFAULT_BARK_COOLDOWN;
    const barkPool = hookCfg.barks || [];
    const clickPool = hookCfg.clicks || [];

    if (barkPool.length > 0 && Math.random() < barkChance &&
        (!lastPlay[hook + ':bark'] || now - lastPlay[hook + ':bark'] >= barkCooldown)) {
      pool = barkPool;
      poolName = 'bark';
    } else if (clickPool.length > 0) {
      pool = clickPool;
      poolName = 'click';
    } else {
      pool = hookCfg.files || [];
      poolName = 'files';
    }
  } else {
    pool = hookCfg.files || [];
  }

  if (pool.length === 0) return { error: 'no files for hook' };

  // Per-hook cooldown
  const cooldown = hookCfg.cooldown || DEFAULT_COOLDOWNS[hook] || DEFAULT_COOLDOWN;
  if (lastPlay[hook] && now - lastPlay[hook] < cooldown) {
    const entry = { hook, file: null, time: ts(), fizzled: true };
    playHistory.push(entry);
    if (playHistory.length > HISTORY_SIZE) playHistory.shift();
    log(`${hook} → skipped (cooldown ${cooldown}ms)`);
    return { skipped: true, cooldown };
  }

  const pickKey = `${hook}:${poolName}`;
  const pick = pickSound(pickKey, pool);
  lastPick[pickKey] = pick;
  const fullPath = join(m.packDir, pick);
  if (!existsSync(fullPath)) return { error: 'file not found', file: pick };

  const child = playSound(fullPath);
  if (child === null) return { played: false, error: 'max_children' };
  lastPlay[hook] = now;
  lastPlayGlobal[hook] = now;
  if (poolName === 'bark') {
    lastPlay[hook + ':bark'] = now;
    // Set bark end time from manifest durations for cross-hook suppression
    const dur = m.manifest.durations && m.manifest.durations[pick];
    if (dur) lastBarkEnd = now + Math.ceil(dur * 1000);
  }

  const entry = { hook, file: pick, time: ts(), fizzled: false, pool: poolName !== 'files' ? poolName : undefined };
  playHistory.push(entry);
  if (playHistory.length > HISTORY_SIZE) playHistory.shift();
  log(`${hook} → ${pick}${poolName !== 'files' ? ` (${poolName})` : ''}`);

  return { played: true, file: pick, pool: poolName !== 'files' ? poolName : undefined };
}

// --- HTTP server ---

function createServer(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] === 'play' && parts[1]) {
      const result = handlePlay(parts[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (parts[0] === 'health' || parts[0] === 'status') {
      const m = loadManifest();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        moxie: true,
        version: DAEMON_VERSION,
        player: getPlayerName(),
        playerFound: playerHealthy,
        playerPath: playerPath,
        pid: process.pid,
        port,
        uptime: Math.round((Date.now() - startTime) / 1000),
        pack: m ? m.pack : null,
        muted: existsSync(PAUSE_FILE),
        soundKeeper: !!soundKeeperProc,
        soundKeeperPid: soundKeeperProc?.pid || null,
        soundKeeperEnabled: getSoundKeeperEnabled(),
        recentErrors: recentErrors,
        lastError: lastError,
        activeChildren: activeChildren,
        skRestarts: skRestarts,
        history: playHistory.slice(-HISTORY_SIZE)
      }));
      return;
    }

    if (parts[0] === 'play-sound') {
      if (existsSync(PAUSE_FILE)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ muted: true }));
        return;
      }
      const pack = url.searchParams.get('pack');
      const file = url.searchParams.get('file');
      if (!pack || !file) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'pack and file required' }));
        return;
      }
      if (pack.includes('..') || file.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid file path' }));
        return;
      }
      const fullPath = join(SOUNDS_DIR, pack, file);
      if (!fullPath.startsWith(SOUNDS_DIR)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid file path' }));
        return;
      }
      if (!existsSync(fullPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'file not found' }));
        return;
      }
      playSound(fullPath);
      const entry = { hook: 'play-sound', file: `${pack}/${file}`, time: ts(), fizzled: false };
      playHistory.push(entry);
      if (playHistory.length > HISTORY_SIZE) playHistory.shift();
      log(`play-sound → ${pack}/${file}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ played: true, pack, file }));
      return;
    }

    if (parts[0] === 'reload') {
      const restartMode = url.searchParams.get('mode') || 'full';
      if (restartMode === 'manifest') {
        manifestCache = null;
        loadTuning();
        const m = loadManifest();
        log('Reloaded manifest cache + tuning');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reloaded: true, mode: 'manifest', pack: m ? m.pack : null }));
        return;
      }
      // Full reload — stop Sound Keeper, restart daemon
      log('Full reload requested — spawning replacement and exiting');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reloaded: true, mode: 'full', restarting: true }), () => {
        server.close();
        stopSoundKeeper();
        const replacement = spawn(process.execPath, [__filename, '--listen'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        replacement.on('error', () => {});
        replacement.unref();
        isReloading = true; // Skip PID cleanup — replacement will overwrite
        process.exit(0);
      });
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  server.listen(port, '127.0.0.1', () => {
    try { writeFileSync(PID_FILE, String(process.pid)); } catch {}
    rotateLog();
    log(`Daemon started on port ${port}`);

    startSoundKeeper();
    checkPlayerHealth();
    loadTuning();

    // Play startup-queued hook after Sound Keeper warms WASAPI
    const playIdx = process.argv.indexOf('--play');
    if (playIdx !== -1 && process.argv[playIdx + 1]) {
      setTimeout(() => {
        const result = handlePlay(process.argv[playIdx + 1]);
        log(`${process.argv[playIdx + 1]} → startup queue (${JSON.stringify(result)})`);
      }, 100);
    }

    if (process.argv.includes('--listen')) {
      const m = loadManifest();
      console.log(`Moxie sound daemon listening on localhost:${port} (pack: ${m ? m.pack : 'none'})`);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const pi = process.argv.indexOf('--play');
      const hook = pi !== -1 ? process.argv[pi + 1] : null;
      if (!hook) { process.exit(0); return; }
      // Give winner time to bind, then route through it
      setTimeout(() => {
        const req = http.request({
          hostname: '127.0.0.1', port,
          path: `/play/${hook}`,
          method: 'GET', timeout: 1000
        });
        req.on('response', () => setTimeout(() => process.exit(0), 300));
        req.on('error', () => playDirect(hook)); // winner not ready — fall back
        req.end();
      }, 200);
      return;
    }
    log(`Server error: ${err.message}`);
    process.exit(1);
  });

  return server;
}

// --- Direct playback (fallback when losing race) ---

function playDirect(hook) {
  setTimeout(() => process.exit(0), 2000); // hard timeout
  try {
    if (existsSync(PAUSE_FILE)) process.exit(0);
    if (process.env.MOXIE_SILENT) process.exit(0);
    const m = loadManifest();
    if (!m) process.exit(0);
    const hookCfg = m.manifest.hooks && m.manifest.hooks[hook];
    if (!hookCfg) process.exit(0);

    // Resolve pool — barks/clicks or legacy files
    let pool = hookCfg.files || [];
    if (hookCfg.clicks || hookCfg.barks) {
      const barkChance = hookCfg.barkChance ?? DEFAULT_BARK_CHANCE;
      const barkPool = hookCfg.barks || [];
      const clickPool = hookCfg.clicks || [];
      pool = (barkPool.length > 0 && Math.random() < barkChance) ? barkPool :
             (clickPool.length > 0) ? clickPool : pool;
    }
    if (pool.length === 0) process.exit(0);

    const pick = pickSound(hook, pool);
    const fullPath = join(m.packDir, pick);
    if (!existsSync(fullPath)) process.exit(0);

    playSound(fullPath);
    log(`${hook} → ${pick} (direct)`);
    setTimeout(() => process.exit(0), 500); // brief delay for sound to start
  } catch (err) {
    log(`playDirect error: ${err.message}`);
    process.exit(0);
  }
}

// --- Cleanup ---

function cleanup(signal) {
  log(`Daemon stopped (${signal})`);
  stopSoundKeeper();
  try { unlinkSync(PID_FILE); } catch {}
  process.exit(0);
}

process.on('SIGTERM', () => cleanup('SIGTERM'));
process.on('SIGINT', () => cleanup('SIGINT'));
process.on('exit', () => {
  if (!isReloading) try { unlinkSync(PID_FILE); } catch {}
});
process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err.message}`);
  stopSoundKeeper();
  try { unlinkSync(PID_FILE); } catch {}
  process.exit(1);
});

// --- Main ---

const args = process.argv.slice(2);

if (args.includes('--listen')) {
  // Daemon mode
  createServer(getPort());
} else if (args[0]) {
  // Bootstrap mode — spawn daemon with --play, let it play after SK warms
  const boot = spawn(process.execPath, [__filename, '--listen', '--play', args[0]], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  boot.on('error', () => {});
  boot.unref();
  process.exit(0);
} else {
  console.log('Usage: node daemon.js <hook> | node daemon.js --listen');
  process.exit(0);
}
