// moxie bridge for ccstatusline custom-command widget (Node.js, cross-platform)
// Returns: AgentName · "contextual quip" with ANSI colors
//
// ccstatusline pipes Claude Code JSON to stdin and displays the output.
// This script reads the active vibe + stdin context to pick a quip.
//
// ccstatusline widget config:
//   { "type": "custom-command", "commandPath": "node ~/.moxie/ccbridge.mjs", "maxWidth": 120, "timeout": 500, "preserveColors": true }

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

const MOXIE_DIR = join(homedir(), '.moxie');
const VIBE_FILE = join(MOXIE_DIR, 'active.json');

// --- Load vibe ---
let vibe = null;
try { vibe = JSON.parse(readFileSync(VIBE_FILE, 'utf8')); } catch {}

let agentName = 'Claude';
let nameColorCode = '44';
let dimColor = '245';

if (vibe) {
  if (vibe.agent?.name) agentName = vibe.agent.name;
  if (vibe.agent?.nameColor) nameColorCode = vibe.agent.nameColor;
  if (vibe.palette?.dim) dimColor = vibe.palette.dim;
}

const cName = `\x1b[38;5;${nameColorCode}m`;
const cQuip = `\x1b[38;5;${dimColor}m`;
const cDim = `\x1b[38;5;${dimColor}m`;
const cReset = '\x1b[0m';

// --- Read stdin JSON from ccstatusline ---
let inputJson = null;
try {
  const raw = readFileSync(0, 'utf8');
  if (raw) inputJson = JSON.parse(raw);
} catch {}

// --- Parse context ---
let contextPct = 0;
if (inputJson?.context_window?.used_percentage != null) {
  contextPct = Math.floor(Number(inputJson.context_window.used_percentage));
}
contextPct = Math.max(0, Math.min(100, contextPct));

let sessionMs = 0;
if (inputJson?.cost?.total_duration_ms != null) {
  sessionMs = Number(inputJson.cost.total_duration_ms);
}
const sessionMin = Math.floor(sessionMs / 60000);

// --- Git state (reuse moxie's statusline cache) ---
const projectDir = inputJson?.workspace?.project_dir || null;
const cacheSlug = projectDir ? projectDir.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+$/, '') : '_default';
const cacheFile = join(tmpdir(), `moxie-git-${cacheSlug}.json`);
let gitDirty = false;
let gitBehind = 0;

if (existsSync(cacheFile)) {
  try {
    const cacheAge = (Date.now() - statSync(cacheFile).mtimeMs) / 1000;
    if (cacheAge < 60) {
      const gitInfo = JSON.parse(readFileSync(cacheFile, 'utf8'));
      gitDirty = !!gitInfo.dirty;
      gitBehind = Number(gitInfo.behind) || 0;
    }
  } catch {}
}

// --- Build active tags ---
const activeTags = ['any'];
const now = new Date();
const hour = now.getHours();
const dow = now.getDay(); // 0=Sun, 6=Sat

if (contextPct < 30) activeTags.push('chill');
else if (contextPct <= 70) activeTags.push('warm');
else activeTags.push('hot');

if (hour >= 22 || hour < 5) activeTags.push('late');
if (hour >= 5 && hour < 8) activeTags.push('morning');
if (dow === 5) activeTags.push('friday');
if (dow === 0 || dow === 6) activeTags.push('weekend');
if (sessionMin > 60) activeTags.push('marathon');
if (sessionMin < 5) activeTags.push('fresh');
if (gitDirty) activeTags.push('dirty'); else activeTags.push('clean');
if (gitBehind > 0) activeTags.push('behind');

// --- Select quip (cached 45s) ---
const quipCacheFile = join(tmpdir(), `moxie-bridge-quip-${cacheSlug}.json`);
const quipTTL = 45;
let quip = '';
let quipCacheValid = false;

if (existsSync(quipCacheFile)) {
  try {
    const quipAge = (Date.now() - statSync(quipCacheFile).mtimeMs) / 1000;
    if (quipAge < quipTTL) {
      const cached = JSON.parse(readFileSync(quipCacheFile, 'utf8'));
      quip = cached.quip || '';
      quipCacheValid = true;
    }
  } catch {}
}

if (!quipCacheValid && vibe?.quips) {
  const eligible = [];

  for (const tag of activeTags) {
    const tagQuips = vibe.quips[tag];
    if (Array.isArray(tagQuips)) eligible.push(...tagQuips);
  }

  for (const key of Object.keys(vibe.quips)) {
    if (!key.includes(',')) continue;
    const comboTags = key.split(',').map(t => t.trim());
    if (comboTags.every(t => activeTags.includes(t))) {
      const comboQuips = vibe.quips[key];
      if (Array.isArray(comboQuips)) eligible.push(...comboQuips);
    }
  }

  if (eligible.length === 0 && Array.isArray(vibe.quips.any)) {
    eligible.push(...vibe.quips.any);
  }

  if (eligible.length > 0) {
    quip = eligible[Math.floor(Math.random() * eligible.length)];
  }

  try { writeFileSync(quipCacheFile, JSON.stringify({ quip })); } catch {}
}

// --- Output: AgentName · "quip" ---
const bullet = `${cDim}\u00B7${cReset}`;
process.stdout.write(`${cName}${agentName}${cReset} ${bullet} ${cQuip}${quip}${cReset}\n`);
