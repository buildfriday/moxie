#!/usr/bin/env node
// moxie CLI — set vibes, configure Claude Code statusline + spinner verbs.
// Usage: moxie set <vibe> | moxie list

const { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } = require('fs');
const { join, resolve, dirname } = require('path');
const { homedir } = require('os');

const MOXIE_DIR = join(homedir(), '.moxie');
const REPO_DIR = resolve(__dirname, '..');
const VIBES_DIR = join(REPO_DIR, 'vibes');
const CLAUDE_SETTINGS = join(homedir(), '.claude', 'settings.json');
const ACTIVE_JSON = join(MOXIE_DIR, 'active.json');

// --- Helpers ---

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
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
    console.log(`  ${v.padEnd(22)} ${agent}`);
  }

  // Show active
  if (existsSync(ACTIVE_JSON)) {
    const active = readJSON(ACTIVE_JSON);
    console.log(`\nActive: ${active.name}`);
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

  // 1. Copy vibe JSON to active.json
  ensureDir(MOXIE_DIR);
  const vibe = readJSON(vibeFile);
  writeJSON(ACTIVE_JSON, vibe);
  console.log(`Vibe set: ${vibeName} (${vibe.agent?.name || 'nameless'})`);

  // 2. Copy statusline + ccbridge scripts (Node.js, cross-platform)
  const slSrc = join(REPO_DIR, 'scripts', 'statusline.mjs');
  if (existsSync(slSrc)) copyFileSync(slSrc, join(MOXIE_DIR, 'statusline.mjs'));
  const cbSrc = join(REPO_DIR, 'scripts', 'ccbridge.mjs');
  if (existsSync(cbSrc)) copyFileSync(cbSrc, join(MOXIE_DIR, 'ccbridge.mjs'));

  // 3. Clean up old scripts from ~/.moxie/
  for (const old of ['statusline.ps1', 'statusline.sh', 'ccbridge.ps1', 'ccbridge.sh']) {
    const oldPath = join(MOXIE_DIR, old);
    if (existsSync(oldPath)) { try { unlinkSync(oldPath); } catch {} }
  }

  // 4. Update Claude settings
  const settings = getClaudeSettings();

  // Spinner verbs
  settings.spinnerVerbs = vibe.spinnerVerbs;

  // Statusline (update moxie-owned commands, don't overwrite custom ones)
  if (!settings.statusLine || isMoxieStatusLine(settings.statusLine)) {
    const slPath = join(MOXIE_DIR, 'statusline.mjs').replace(/\\/g, '/');
    settings.statusLine = { type: 'command', command: `node ${slPath}` };
  } else {
    console.log(`Note: Custom statusLine detected, not modified.`);
    console.log(`  Moxie statusline available at: node ~/.moxie/statusline.mjs`);
  }

  saveClaudeSettings(settings);
  console.log('Settings updated.');

  // ccstatusline integration hint
  const ccslConfig = join(homedir(), '.config', 'ccstatusline', 'settings.json');
  if (existsSync(ccslConfig)) {
    const bridgePath = join(MOXIE_DIR, 'ccbridge.mjs').replace(/\\/g, '/');
    console.log('\nccstatusline detected. To add moxie as a widget:');
    console.log(`  Add a "custom-command" widget to ${ccslConfig.replace(/\\/g, '/')}`);
    console.log(`  commandPath: "node ${bridgePath}"`);
    console.log('  timeout: 500, maxWidth: 120, preserveColors: true');
    console.log('  (ANSI escapes count against maxWidth — 120 prevents truncation)');
  }
}

// --- Main ---

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'set':       cmdSet(args[0]); break;
  case 'list':      cmdList(); break;
  default:
    console.log(`
moxie — personality for Claude Code

Usage:
  moxie set <vibe>           Set active vibe (copies vibe + statusline + settings)
  moxie list                 List available vibes
`);
}
