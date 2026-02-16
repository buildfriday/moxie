#!/usr/bin/env node
// moxie demo — showcase sound packs with simulated coding session
//
// Usage:
//   moxie demo [pack]              Full session simulation (~18s)
//   moxie demo --all               Showreel of all installed packs (~8s each)
//   moxie demo --hook <name>       Taste test: one hook across all packs
//   moxie demo --record            Clean output for screen recording
//   moxie demo --list              Print sequence without playing

const { readFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } = require('fs');
const { join, resolve } = require('path');
const { homedir } = require('os');
const { spawn, execSync } = require('child_process');

const MOXIE_DIR = join(homedir(), '.moxie');
const REPO_DIR = resolve(__dirname, '..');
const SOUNDS_DIR = join(REPO_DIR, 'sounds');
const INSTALLED_SOUNDS_DIR = join(MOXIE_DIR, 'sounds');
const ACTIVE_JSON = join(MOXIE_DIR, 'active.json');

// --- ANSI helpers ---
const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const c256 = (n) => `${ESC}[38;5;${n}m`;
const GREEN = c256(78);
const GRAY = c256(245);
const WHITE = c256(255);

// --- Args ---
const args = process.argv.slice(2);
const flagAll = args.includes('--all');
const flagRecord = args.includes('--record');
const flagList = args.includes('--list');
const hookIdx = args.indexOf('--hook');
const flagHook = hookIdx !== -1 ? args[hookIdx + 1] || null : null;
const packArg = args.find(a => !a.startsWith('-') && a !== flagHook);

// --- Sleep (cross-platform) ---
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// --- Daemon-routed playback ---
const DAEMON_PORT = (() => {
  try { return JSON.parse(readFileSync(join(homedir(), '.moxie', 'config.json'), 'utf8')).daemonPort || 17380; }
  catch { return 17380; }
})();
let daemonAvailable = false;
const playbackWarnings = new Set();

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(srcPath, destPath);
    else copyFileSync(srcPath, destPath);
  }
}

function ensureDaemon() {
  try {
    execSync(`curl -s --connect-timeout 0.5 http://localhost:${DAEMON_PORT}/health`,
      { stdio: 'ignore', timeout: 2000, windowsHide: true });
    return true;
  } catch {}
  const daemonPath = join(homedir(), '.moxie', 'sounds', 'daemon.js');
  if (!existsSync(daemonPath)) return false;
  spawn(process.execPath, [daemonPath, '--listen'],
    { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
  sleep(500);
  try {
    execSync(`curl -s --connect-timeout 0.5 http://localhost:${DAEMON_PORT}/health`,
      { stdio: 'ignore', timeout: 2000, windowsHide: true });
    return true;
  } catch { return false; }
}

function playSound(pack, file) {
  if (flagList || !daemonAvailable) return;
  try {
    const out = execSync(
      `curl -s "http://127.0.0.1:${DAEMON_PORT}/play-sound?pack=${encodeURIComponent(pack)}&file=${encodeURIComponent(file)}"`,
      { encoding: 'utf8', timeout: 1000, windowsHide: true }
    );
    const res = JSON.parse(out);
    if (res?.error) {
      const key = `${pack}:${res.error}`;
      if (!playbackWarnings.has(key)) {
        playbackWarnings.add(key);
        line(`  ${GRAY}Warning: failed to play ${pack}/${file} (${res.error})${RESET}`);
      }
    }
  } catch {}
}

// --- Pack discovery ---
function findPacks() {
  const packs = new Map(); // name → dir (installed takes precedence)

  // Repo packs
  if (existsSync(SOUNDS_DIR)) {
    for (const d of readdirSync(SOUNDS_DIR)) {
      const mf = join(SOUNDS_DIR, d, 'manifest.json');
      if (existsSync(mf)) packs.set(d, join(SOUNDS_DIR, d));
    }
  }

  // Installed packs (override repo)
  if (existsSync(INSTALLED_SOUNDS_DIR)) {
    for (const d of readdirSync(INSTALLED_SOUNDS_DIR)) {
      const mf = join(INSTALLED_SOUNDS_DIR, d, 'manifest.json');
      if (existsSync(mf)) packs.set(d, join(INSTALLED_SOUNDS_DIR, d));
    }
  }

  return packs;
}

function ensurePackInstalled(packName, sourceDir) {
  const installedDir = join(INSTALLED_SOUNDS_DIR, packName);
  if (existsSync(join(installedDir, 'manifest.json'))) return installedDir;
  if (!existsSync(join(sourceDir, 'manifest.json'))) return sourceDir;
  try {
    copyDirRecursive(sourceDir, installedDir);
    return installedDir;
  } catch (e) {
    line(`  ${GRAY}Warning: could not install pack ${packName} for demo (${e.message})${RESET}`);
    return sourceDir;
  }
}

function loadPackManifest(packDir) {
  const mf = join(packDir, 'manifest.json');
  if (!existsSync(mf)) return null;
  try { return JSON.parse(readFileSync(mf, 'utf8')); } catch { return null; }
}

function getActivePack() {
  if (!existsSync(ACTIVE_JSON)) return null;
  try {
    const active = JSON.parse(readFileSync(ACTIVE_JSON, 'utf8'));
    return active.soundPack || active.name || null;
  } catch { return null; }
}

// --- Vibe colors ---
function loadVibeColors(packName) {
  // Try to find a matching vibe for colors
  const vibeFile = join(REPO_DIR, 'vibes', packName + '.json');
  if (existsSync(vibeFile)) {
    try {
      const v = JSON.parse(readFileSync(vibeFile, 'utf8'));
      return {
        primary: v.palette?.primary || '44',
        accent: v.palette?.accent || '214',
        warning: v.palette?.warning || '204',
        dim: v.palette?.dim || '245',
        name: v.agent?.name || packName,
        nameColor: v.agent?.nameColor || '44'
      };
    } catch {}
  }
  return { primary: '44', accent: '214', warning: '204', dim: '245', name: packName, nameColor: '44' };
}

// --- Output helpers ---
function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function countSounds(manifest) {
  let total = 0;
  for (const [, hookCfg] of Object.entries(manifest.hooks || {})) {
    total += (hookCfg.files?.length || 0) + (hookCfg.barks?.length || 0) + (hookCfg.clicks?.length || 0);
  }
  return total;
}

function clearScreen() {
  if (flagRecord || flagList) return;
  process.stdout.write(`${ESC}[2J${ESC}[H`);
}

function line(text = '') {
  process.stdout.write(text + '\n');
}

function hookLabel(name, filename) {
  return `  ${GREEN}\u25B6${RESET} ${WHITE}${name}${RESET}${GRAY} \u2192 ${filename}${RESET}`;
}

// --- Title card ---
function titleCard(packName, manifest, colors) {
  const count = countSounds(manifest);
  const hookCount = Object.keys(manifest.hooks || {}).length;
  const nameC = c256(colors.nameColor);
  const dimC = c256(colors.dim);
  const accentC = c256(colors.accent);

  line();
  line(`  ${dimC}\u250C${''.padEnd(40, '\u2500')}\u2510${RESET}`);
  line(`  ${dimC}\u2502${RESET}  ${nameC}${BOLD}${packName}${RESET}${''.padEnd(Math.max(0, 40 - packName.length - 2))}${dimC}\u2502${RESET}`);
  line(`  ${dimC}\u2502${RESET}  ${accentC}${count} sounds${RESET} ${dimC}\u00B7${RESET} ${accentC}${hookCount} hooks${RESET}${''.padEnd(Math.max(0, 40 - `${count} sounds \u00B7 ${hookCount} hooks`.length - 2))}${dimC}\u2502${RESET}`);
  line(`  ${dimC}\u2514${''.padEnd(40, '\u2500')}\u2518${RESET}`);
  line();
}

// --- End card ---
function endCard(packName) {
  line();
  line(`  ${GRAY}Install: ${WHITE}moxie sounds set ${packName}${RESET}`);
  line(`  ${GRAY}All packs: ${WHITE}moxie demo --all${RESET}`);
  line();
}

// --- Simulated prompt divider ---
function prompt(text) {
  line();
  line(`  ${DIM}>${RESET} ${WHITE}${text}${RESET}`);
}

function working(verb) {
  line(`  ${GRAY}\u23F3 ${verb || 'Working'}...${RESET}`);
}

function subagentDone(label) {
  line(`  ${GREEN}\u2713${RESET} ${GRAY}${label || 'subagent complete'}${RESET}`);
}

// --- Get all files for a hook (clicks + barks + files merged) ---
function getHookFiles(hookCfg) {
  if (!hookCfg) return [];
  const files = [...(hookCfg.files || [])];
  if (hookCfg.barks) files.push(...hookCfg.barks);
  if (hookCfg.clicks) files.push(...hookCfg.clicks);
  return files;
}

// --- Full demo sequence ---
function fullDemo(packName, manifest) {
  const colors = loadVibeColors(packName);
  const hooks = manifest.hooks || {};

  // 1. Title card
  titleCard(packName, manifest, colors);
  sleep(2000);

  // 2. SessionStart
  const ssFile = pickRandom(hooks.SessionStart?.files);
  if (ssFile) {
    line(hookLabel('SessionStart', ssFile));
    playSound(packName, ssFile);
    sleep(2000);
  }

  // 3. First prompt
  prompt('Fix the auth bug in login.ts');

  // 4. UserPromptSubmit
  const upsFiles = getHookFiles(hooks.UserPromptSubmit);
  const upsFile = pickRandom(upsFiles);
  if (upsFile) {
    line(hookLabel('UserPromptSubmit', upsFile));
    playSound(packName, upsFile);
    sleep(800);
  }

  // 5. Working
  working('Investigating');
  sleep(1000);

  // 6. SubagentStop x2
  const saLabels = ['Read src/auth.ts', 'Grep for handleAuth'];
  for (let i = 0; i < 2; i++) {
    const saFile = pickRandom(hooks.SubagentStop?.files);
    if (saFile) {
      subagentDone(saLabels[i]);
      line(hookLabel('SubagentStop', saFile));
      playSound(packName, saFile);
      sleep(800);
    }
  }

  // 7. Stop
  const stopFile1 = pickRandom(hooks.Stop?.files);
  if (stopFile1) {
    line(hookLabel('Stop', stopFile1));
    playSound(packName, stopFile1);
    sleep(1500);
  }

  // 8. Second prompt
  prompt('Add rate limiting to the API');

  // 9. UserPromptSubmit
  const upsFile2 = pickRandom(upsFiles);
  if (upsFile2) {
    line(hookLabel('UserPromptSubmit', upsFile2));
    playSound(packName, upsFile2);
    sleep(800);
  }

  // 10. Working
  working('Implementing');
  sleep(1000);

  // 11. SubagentStop
  const saFile2 = pickRandom(hooks.SubagentStop?.files);
  if (saFile2) {
    subagentDone('Edit src/middleware/ratelimit.ts');
    line(hookLabel('SubagentStop', saFile2));
    playSound(packName, saFile2);
    sleep(800);
  }

  // 12. Stop
  const stopFile2 = pickRandom(hooks.Stop?.files);
  if (stopFile2) {
    line(hookLabel('Stop', stopFile2));
    playSound(packName, stopFile2);
    sleep(1200);
  }

  // 13. Notification
  const notifFile = pickRandom(hooks.Notification?.files);
  if (notifFile) {
    line(`  ${GREEN}\u{1F4CB}${RESET} ${GRAY}Tests passed (12/12)${RESET}`);
    line(hookLabel('Notification', notifFile));
    playSound(packName, notifFile);
    sleep(2000);
  }

  // 14. End card
  endCard(packName);
}

// --- Abbreviated demo for showreel ---
function shortDemo(packName, manifest) {
  const colors = loadVibeColors(packName);
  const hooks = manifest.hooks || {};
  const hookOrder = ['SessionStart', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'Notification'];

  titleCard(packName, manifest, colors);
  sleep(1000);

  for (const hookName of hookOrder) {
    const allFiles = getHookFiles(hooks[hookName]);
    const file = pickRandom(allFiles);
    if (file) {
      line(hookLabel(hookName, file));
      playSound(packName, file);
      sleep(hookName === 'SessionStart' ? 1500 : 800);
    }
  }

  line();
  sleep(800);
}

// --- Taste test: one hook across all packs ---
function tasteTest(hookName, packs) {
  line();
  line(`  ${WHITE}${BOLD}Taste test: ${hookName}${RESET}`);
  line(`  ${GRAY}${''.padEnd(40, '\u2500')}${RESET}`);
  line();

  for (const [name, dir] of packs) {
    const manifest = loadPackManifest(dir);
    if (!manifest) continue;
    const allFiles = getHookFiles(manifest.hooks?.[hookName]);
    const file = pickRandom(allFiles);
    if (!file) {
      line(`  ${GRAY}${name.padEnd(16)} (no ${hookName} sounds)${RESET}`);
      continue;
    }
    line(`  ${WHITE}${name.padEnd(16)}${RESET} ${GRAY}${file}${RESET}`);
    playSound(name, file);
    sleep(1500);
  }
  line();
}

// --- Main ---
const packs = findPacks();

if (packs.size === 0) {
  console.error('No sound packs found. Run: moxie sounds set <pack>');
  process.exit(1);
}

if (!flagList) {
  daemonAvailable = ensureDaemon();
  if (!daemonAvailable) {
    console.log('Warning: Sound daemon not available. Showing visual output only.');
    console.log('  Run: moxie daemon start');
    console.log();
  }
}

if (flagHook) {
  // Taste test mode
  const validHooks = ['SessionStart', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'Notification'];
  if (!validHooks.includes(flagHook)) {
    console.error(`Unknown hook: ${flagHook}`);
    console.error(`Valid hooks: ${validHooks.join(', ')}`);
    process.exit(1);
  }
  if (daemonAvailable) {
    for (const [name, dir] of packs) packs.set(name, ensurePackInstalled(name, dir));
  }
  tasteTest(flagHook, packs);
  process.exit(0);
}

if (flagAll) {
  // Showreel mode
  const packNames = [...packs.keys()].sort();
  if (daemonAvailable) {
    for (const name of packNames) packs.set(name, ensurePackInstalled(name, packs.get(name)));
  }
  line();
  line(`  ${WHITE}${BOLD}moxie showreel${RESET} ${GRAY}\u00B7 ${packNames.length} packs${RESET}`);
  line();
  sleep(1000);

  for (const name of packNames) {
    clearScreen();
    const dir = packs.get(name);
    const manifest = loadPackManifest(dir);
    if (!manifest) continue;
    shortDemo(name, manifest);
  }

  // Summary
  clearScreen();
  line();
  line(`  ${WHITE}${BOLD}All packs${RESET}`);
  line(`  ${GRAY}${''.padEnd(40, '\u2500')}${RESET}`);
  for (const name of packNames) {
    const dir = packs.get(name);
    const manifest = loadPackManifest(dir);
    if (!manifest) continue;
    const count = countSounds(manifest);
    line(`  ${WHITE}${name.padEnd(16)}${RESET} ${GRAY}${count} sounds${RESET}`);
  }
  line();
  line(`  ${GRAY}Install: ${WHITE}moxie sounds set <pack>${RESET}`);
  line(`  ${GRAY}Full demo: ${WHITE}moxie demo <pack>${RESET}`);
  line();
  process.exit(0);
}

// Single pack demo
let targetPack = packArg || getActivePack();
if (!targetPack) {
  console.error('No pack specified and no active pack. Run: moxie demo <pack>');
  process.exit(1);
}

if (!packs.has(targetPack)) {
  console.error(`Pack not found: ${targetPack}`);
  console.error(`Available: ${[...packs.keys()].sort().join(', ')}`);
  process.exit(1);
}

const packDir = packs.get(targetPack);
if (daemonAvailable) {
  packs.set(targetPack, ensurePackInstalled(targetPack, packDir));
}
const resolvedPackDir = packs.get(targetPack);
const manifest = loadPackManifest(resolvedPackDir);
if (!manifest) {
  console.error(`Could not load manifest for: ${targetPack}`);
  process.exit(1);
}

fullDemo(targetPack, manifest);
