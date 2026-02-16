// moxie statusline for Claude Code (Node.js, cross-platform)
// Reads personality from ~/.moxie/active.json, shows metrics + git info + rotating quip
//
// Usage: Set in ~/.claude/settings.json:
//   "statusLine": { "type": "command", "command": "node ~/.moxie/statusline.mjs" }
//
// Bridge mode (for ccstatusline widget):
//   node ~/.moxie/statusline.mjs --bridge
//   Outputs: AgentName · "quip" (no git info, reads cache only)
//
// Input: JSON on stdin from Claude Code (context_window.used_percentage, etc.)
// Output: Single-line ANSI status bar

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { execSync } from 'child_process';

const MOXIE_DIR = join(homedir(), '.moxie');
const VIBE_FILE = join(MOXIE_DIR, 'active.json');

// --- Load vibe config ---
let vibe = null;
try { vibe = JSON.parse(readFileSync(VIBE_FILE, 'utf8')); } catch {}

let agentName = 'Claude';
let nameColorCode = '44';
let primaryColor = '44';
let accentColor = '214';
let warningColor = '204';
let dimColor = '245';

if (vibe) {
  if (vibe.agent?.name) agentName = vibe.agent.name;
  if (vibe.agent?.nameColor) nameColorCode = vibe.agent.nameColor;
  if (vibe.palette?.primary) primaryColor = vibe.palette.primary;
  if (vibe.palette?.accent) accentColor = vibe.palette.accent;
  if (vibe.palette?.warning) warningColor = vibe.palette.warning;
  if (vibe.palette?.dim) dimColor = vibe.palette.dim;
}

let worktreeColor = accentColor;
if (vibe?.palette?.worktree) worktreeColor = vibe.palette.worktree;

// --- ANSI Colors (256-color) ---
const C = {
  Name:    `\x1b[38;5;${nameColorCode}m`,
  Primary: `\x1b[38;5;${primaryColor}m`,
  BarLow:  `\x1b[38;5;${primaryColor}m`,
  BarMid:  `\x1b[38;5;${accentColor}m`,
  BarHigh: `\x1b[38;5;${warningColor}m`,
  Quip:    `\x1b[38;5;${dimColor}m`,
  Dim:     `\x1b[38;5;${dimColor}m`,
  Accent:  `\x1b[38;5;${accentColor}m`,
  Worktree: `\x1b[38;5;${worktreeColor}m`,
  Reset:   '\x1b[0m',
};

// --- Read stdin JSON ---
let inputJson = null;
try {
  const raw = readFileSync(0, 'utf8');
  if (raw) inputJson = JSON.parse(raw);
} catch {}

// --- Context percentage ---
let contextPct = 0;
if (inputJson?.context_window?.used_percentage != null) {
  contextPct = Math.floor(Number(inputJson.context_window.used_percentage));
}
contextPct = Math.max(0, Math.min(100, contextPct));

// --- Session duration ---
let sessionMs = 0;
if (inputJson?.cost?.total_duration_ms != null) {
  sessionMs = Number(inputJson.cost.total_duration_ms);
}
const sessionMin = Math.floor(sessionMs / 60000);

// --- Bridge mode (--bridge) ---
const bridgeMode = process.argv.includes('--bridge');

// --- Context bar (10 chars) ---
const filled = Math.floor(contextPct / 10);
const empty = 10 - filled;
const barStr = '\u2588'.repeat(filled);
const emptyStr = '\u2591'.repeat(empty);

const barColor = contextPct >= 80 ? C.BarHigh : contextPct >= 60 ? C.BarMid : C.BarLow;
const bar = `${barColor}${barStr}${C.Dim}${emptyStr}${C.Reset}`;

// --- Git info (cached, 30s TTL, per-project) ---
const projectDir = inputJson?.workspace?.project_dir || null;
const cacheSlug = projectDir ? projectDir.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+$/, '') : '_default';
const cacheFile = join(tmpdir(), `moxie-git-${cacheSlug}.json`);
const cacheTTL = 30;

let gitInfo = { branch: '', worktree: false, worktreeName: '', ahead: 0, dirty: false, behind: 0 };
let cacheValid = false;

// Bridge mode reads cache only (no git commands)
if (existsSync(cacheFile)) {
  try {
    const cacheAge = (Date.now() - statSync(cacheFile).mtimeMs) / 1000;
    if (cacheAge < (bridgeMode ? 60 : cacheTTL)) {
      gitInfo = JSON.parse(readFileSync(cacheFile, 'utf8'));
      cacheValid = true;
    }
  } catch {}
}

if (!cacheValid && !bridgeMode) {
  const gitC = projectDir ? ['-C', projectDir] : [];

  try {
    gitInfo.branch = execSync(`git ${gitC.join(' ')} branch --show-current`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {}

  if (!gitInfo.branch) {
    try {
      const remoteRef = execSync(`git ${gitC.join(' ')} for-each-ref --points-at HEAD --format=%(refname:short) refs/remotes/`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split('\n')[0];
      if (remoteRef) gitInfo.branch = remoteRef.replace(/^origin\//, '');
    } catch {}
  }
  if (!gitInfo.branch) {
    try {
      gitInfo.branch = execSync(`git ${gitC.join(' ')} rev-parse --short HEAD`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    } catch {}
  }
  if (!gitInfo.branch) gitInfo.branch = 'detached';

  // Worktree detection
  try {
    const toplevel = execSync(`git ${gitC.join(' ')} rev-parse --show-toplevel`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (toplevel) {
      const dotGit = join(toplevel, '.git');
      if (existsSync(dotGit) && statSync(dotGit).isFile()) {
        gitInfo.worktree = true;
        gitInfo.worktreeName = toplevel.split(/[/\\]/).pop();
      }
    }
  } catch {}

  // Ahead
  try {
    const ahead = execSync(`git ${gitC.join(' ')} rev-list --count --left-only HEAD...@{upstream}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (/^\d+$/.test(ahead)) gitInfo.ahead = parseInt(ahead, 10);
  } catch {}

  // Dirty
  try {
    const porcelain = execSync(`git ${gitC.join(' ')} status --porcelain`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    gitInfo.dirty = porcelain.length > 0;
  } catch {}

  // Behind
  try {
    const behind = execSync(`git ${gitC.join(' ')} rev-list --count --right-only HEAD...@{upstream}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (/^\d+$/.test(behind)) gitInfo.behind = parseInt(behind, 10);
  } catch {}

  // Write cache
  try { writeFileSync(cacheFile, JSON.stringify(gitInfo)); } catch {}
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
if (gitInfo.worktree) activeTags.push('worktree');
if (sessionMin > 60) activeTags.push('marathon');
if (sessionMin < 5) activeTags.push('fresh');
if (gitInfo.dirty) activeTags.push('dirty'); else activeTags.push('clean');
if (gitInfo.behind > 0) activeTags.push('behind');

// --- Select quip (cached 45s) ---
const quipCacheFile = join(tmpdir(), `moxie-quip-${cacheSlug}.json`);
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

  // Match simple tags
  for (const tag of activeTags) {
    const tagQuips = vibe.quips[tag];
    if (Array.isArray(tagQuips)) eligible.push(...tagQuips);
  }

  // Match combo tags (keys containing commas)
  for (const key of Object.keys(vibe.quips)) {
    if (!key.includes(',')) continue;
    const comboTags = key.split(',').map(t => t.trim());
    if (comboTags.every(t => activeTags.includes(t))) {
      const comboQuips = vibe.quips[key];
      if (Array.isArray(comboQuips)) eligible.push(...comboQuips);
    }
  }

  // Fallback to 'any'
  if (eligible.length === 0 && Array.isArray(vibe.quips.any)) {
    eligible.push(...vibe.quips.any);
  }

  if (eligible.length > 0) {
    quip = eligible[Math.floor(Math.random() * eligible.length)];
  }

  try { writeFileSync(quipCacheFile, JSON.stringify({ quip })); } catch {}
}

// --- Bridge mode output ---
if (bridgeMode) {
  const bullet = `${C.Dim}\u00B7${C.Reset}`;
  process.stdout.write(`${C.Name}${agentName}${C.Reset} ${bullet} ${C.Quip}${quip}${C.Reset}\n`);
  process.exit(0);
}

// --- Layout option ---
const quipPosition = vibe?.layout?.quipPosition || 'right';

// --- ANSI 256 helper ---
function ansi256(code, text) {
  return `\x1b[38;5;${code}m${text}\x1b[0m`;
}

// --- Build status line ---
const bullet = `${C.Dim}\u00B7${C.Reset}`;
const parts = [];

parts.push(`${C.Name}${agentName}${C.Reset}`);

// --- Totem rendering (with gradation + context coloring) ---
const totem = vibe?.totem || '';
if (totem) {
  let displayTotem = totem;
  const totemStages = vibe?.totemStages;
  if (totemStages?.length) {
    for (let i = totemStages.length - 1; i >= 0; i--) {
      const stage = totemStages[i];
      if (stage?.threshold != null && stage?.totem && contextPct >= stage.threshold) {
        displayTotem = stage.totem;
        break;
      }
    }
  }
  const totemColor = contextPct > 80 ? warningColor
    : contextPct > 60 ? accentColor : primaryColor;
  parts.push(ansi256(totemColor, displayTotem));
}

parts.push(`${bar} ${C.Reset}${contextPct}%`);
parts.push(bullet);
parts.push(`${C.Primary}${gitInfo.branch}${C.Reset}`);

if (gitInfo.ahead > 0) {
  parts.push(`${C.Dim}\u2191${gitInfo.ahead}${C.Reset}`);
}

if (gitInfo.worktree) {
  const wtName = gitInfo.worktreeName || 'worktree';
  parts.push(bullet);
  parts.push(`${C.Worktree}${wtName}${C.Reset}`);
}

if (quipPosition === 'inline' && quip) {
  parts.push(bullet);
  parts.push(`${C.Quip}${quip}${C.Reset}`);
  process.stdout.write(parts.join(' ') + '\n');
} else {
  const line1 = parts.join(' ');
  // Strip ANSI to get visible width
  const visibleLeft = line1.replace(/\x1b\[[0-9;]*m/g, '').length;
  const termWidth = process.stdout.columns || parseInt(process.env.COLUMNS) || 120;
  const ccMargin = 30;
  let gap = termWidth - visibleLeft - quip.length - ccMargin;
  if (gap < 2) gap = 2;
  process.stdout.write(`${line1}${' '.repeat(gap)}${C.Quip}${quip}${C.Reset}\n`);
}
