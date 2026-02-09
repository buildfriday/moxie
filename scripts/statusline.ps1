# moxie statusline for Claude Code (PowerShell / Windows)
# Reads personality from ~/.moxie/active.json, shows metrics + git info + rotating quip
#
# Usage: Set in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "powershell -ExecutionPolicy Bypass -File ~/.moxie/statusline.ps1" }
#
# Input: JSON on stdin from Claude Code (context_window.used_percentage, etc.)
# Output: Single-line ANSI status bar

param()

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# --- Load vibe config ---
$moxieDir = Join-Path $env:USERPROFILE '.moxie'
$vibeFile = Join-Path $moxieDir 'active.json'
$vibe = $null

if (Test-Path $vibeFile) {
    try { $vibe = Get-Content $vibeFile -Raw | ConvertFrom-Json } catch {}
}

# Defaults if no vibe loaded
$agentName = 'Claude'
$nameColorCode = '44'
$primaryColor = '44'
$accentColor = '214'
$warningColor = '204'
$dimColor = '245'

if ($vibe) {
    if ($vibe.agent -and $vibe.agent.name) { $agentName = $vibe.agent.name }
    if ($vibe.agent -and $vibe.agent.nameColor) { $nameColorCode = $vibe.agent.nameColor }
    if ($vibe.palette) {
        if ($vibe.palette.primary) { $primaryColor = $vibe.palette.primary }
        if ($vibe.palette.accent) { $accentColor = $vibe.palette.accent }
        if ($vibe.palette.warning) { $warningColor = $vibe.palette.warning }
        if ($vibe.palette.dim) { $dimColor = $vibe.palette.dim }
    }
}

# --- ANSI Colors (256-color) ---
$esc = [char]27
$C = @{
    Name    = "$esc[38;5;${nameColorCode}m"
    Primary = "$esc[38;5;${primaryColor}m"
    BarLow  = "$esc[38;5;${primaryColor}m"
    BarMid  = "$esc[38;5;${accentColor}m"
    BarHigh = "$esc[38;5;${warningColor}m"
    Quip    = "$esc[38;5;${dimColor}m"
    Dim     = "$esc[38;5;${dimColor}m"
    Accent  = "$esc[38;5;${accentColor}m"
    Reset   = "$esc[0m"
}

# --- Read stdin JSON ---
$inputJson = $null
try {
    $inputJson = [Console]::In.ReadToEnd() | ConvertFrom-Json
} catch {}

# --- Context percentage ---
$contextPct = 0
if ($inputJson -and $inputJson.context_window) {
    $contextPct = [int]($inputJson.context_window.used_percentage)
}
$contextPct = [math]::Max(0, [math]::Min(100, $contextPct))

# --- Session duration ---
$sessionMs = 0
if ($inputJson -and $inputJson.cost) {
    $sessionMs = [long]($inputJson.cost.total_duration_ms)
}
$sessionMin = [math]::Floor($sessionMs / 60000)

# --- Context bar (10 chars) ---
$filled = [math]::Floor($contextPct / 10)
$empty = 10 - $filled
$barStr = [string]::new([char]0x2588, $filled)
$emptyStr = [string]::new([char]0x2591, $empty)

$barColor = if ($contextPct -ge 80) { $C.BarHigh }
            elseif ($contextPct -ge 60) { $C.BarMid }
            else { $C.BarLow }

$bar = "$barColor$barStr$($C.Dim)$emptyStr$($C.Reset)"

# --- Git info (cached, 30s TTL, per-project) ---
$projectDir = if ($inputJson -and $inputJson.workspace) { $inputJson.workspace.project_dir } else { $null }
$cacheSlug = if ($projectDir) { ($projectDir -replace '[^a-zA-Z0-9]', '-').TrimEnd('-') } else { '_default' }
$cacheFile = Join-Path $env:TEMP "moxie-git-$cacheSlug.json"
$cacheTTL = 30
$gitInfo = $null
$cacheValid = $false

if (Test-Path $cacheFile) {
    $cacheAge = ((Get-Date) - (Get-Item $cacheFile).LastWriteTime).TotalSeconds
    if ($cacheAge -lt $cacheTTL) {
        try {
            $gitInfo = Get-Content $cacheFile -Raw | ConvertFrom-Json
            $cacheValid = $true
        } catch {}
    }
}

if (-not $cacheValid) {
    $gitC = if ($projectDir) { @('-C', $projectDir) } else { @() }

    $gitInfo = [ordered]@{
        branch       = ''
        worktree     = $false
        worktreeName = ''
        ahead        = 0
        dirty        = $false
        behind       = 0
    }

    $gitInfo.branch = git @gitC branch --show-current 2>$null
    if (-not $gitInfo.branch) {
        $remoteRef = git @gitC for-each-ref --points-at HEAD --format='%(refname:short)' refs/remotes/ 2>$null | Select-Object -First 1
        if ($remoteRef) {
            $gitInfo.branch = $remoteRef -replace '^origin/', ''
        } else {
            $gitInfo.branch = git @gitC rev-parse --short HEAD 2>$null
            if (-not $gitInfo.branch) { $gitInfo.branch = 'detached' }
        }
    }

    # Worktree detection
    $toplevel = git @gitC rev-parse --show-toplevel 2>$null
    $gitDir = if ($toplevel) { Join-Path $toplevel '.git' } else { $null }
    if ($gitDir -and (Test-Path $gitDir) -and -not (Test-Path -Path $gitDir -PathType Container)) {
        $gitInfo.worktree = $true
        $gitInfo.worktreeName = Split-Path $toplevel -Leaf
    }

    $ahead = git @gitC rev-list --count --left-only 'HEAD...@{upstream}' 2>$null
    if ($ahead -match '^\d+$') { $gitInfo.ahead = [int]$ahead }

    $porcelain = git @gitC status --porcelain 2>$null
    $gitInfo.dirty = [bool]$porcelain

    $behind = git @gitC rev-list --count --right-only 'HEAD...@{upstream}' 2>$null
    if ($behind -match '^\d+$') { $gitInfo.behind = [int]$behind }

    try {
        $gitInfo | ConvertTo-Json -Compress | Set-Content $cacheFile -NoNewline
    } catch {}
}

# --- Build active tags ---
$activeTags = @('any')
$hour = (Get-Date).Hour
$dow = (Get-Date).DayOfWeek

if ($contextPct -lt 30) { $activeTags += 'chill' }
elseif ($contextPct -le 70) { $activeTags += 'warm' }
else { $activeTags += 'hot' }

if ($hour -ge 22 -or $hour -lt 5) { $activeTags += 'late' }
if ($hour -ge 5 -and $hour -lt 8) { $activeTags += 'morning' }
if ($dow -eq 'Friday') { $activeTags += 'friday' }
if ($dow -eq 'Saturday' -or $dow -eq 'Sunday') { $activeTags += 'weekend' }
if ($gitInfo.worktree) { $activeTags += 'worktree' }
if ($sessionMin -gt 60) { $activeTags += 'marathon' }
if ($sessionMin -lt 5) { $activeTags += 'fresh' }
if ($gitInfo.dirty) { $activeTags += 'dirty' } else { $activeTags += 'clean' }
if ($gitInfo.behind -gt 0) { $activeTags += 'behind' }

# --- Select quip (cached 45s) ---
$quipCacheFile = Join-Path $env:TEMP "moxie-quip-$cacheSlug.json"
$quipTTL = 45
$quip = ''
$quipCacheValid = $false

if (Test-Path $quipCacheFile) {
    $quipAge = ((Get-Date) - (Get-Item $quipCacheFile).LastWriteTime).TotalSeconds
    if ($quipAge -lt $quipTTL) {
        try {
            $cached = Get-Content $quipCacheFile -Raw | ConvertFrom-Json
            $quip = $cached.quip
            $quipCacheValid = $true
        } catch {}
    }
}

if (-not $quipCacheValid -and $vibe -and $vibe.quips) {
    $eligible = @()

    # Collect quips matching active tags
    foreach ($tag in $activeTags) {
        $tagQuips = $vibe.quips.$tag
        if ($tagQuips) { $eligible += $tagQuips }
    }

    # Check combo tags (e.g. "hot,late")
    $quipProps = $vibe.quips | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name
    foreach ($prop in $quipProps) {
        if ($prop -match ',') {
            $comboTags = $prop -split ',' | ForEach-Object { $_.Trim() }
            $allMatch = $true
            foreach ($t in $comboTags) {
                if ($t -notin $activeTags) { $allMatch = $false; break }
            }
            if ($allMatch) { $eligible += $vibe.quips.$prop }
        }
    }

    if ($eligible.Count -eq 0) {
        # Fallback to 'any' quips
        $eligible = @($vibe.quips.any)
    }

    if ($eligible.Count -gt 0) {
        $quip = $eligible | Get-Random
    }

    try {
        @{ quip = $quip } | ConvertTo-Json -Compress | Set-Content $quipCacheFile -NoNewline
    } catch {}
}

# --- Build status line ---
$upArrow = [char]0x2191
$bullet = "$($C.Dim)$([char]0x00B7)$($C.Reset)"
$parts = @()

$parts += "$($C.Name)$agentName$($C.Reset)"
$parts += "$bar $($C.Reset)${contextPct}%"
$parts += $bullet
$parts += "$($C.Primary)$($gitInfo.branch)$($C.Reset)"

if ($gitInfo.ahead -gt 0) {
    $parts += "$($C.Dim)${upArrow}$($gitInfo.ahead)$($C.Reset)"
}

if ($gitInfo.worktree) {
    $wtName = if ($gitInfo.worktreeName) { $gitInfo.worktreeName } else { 'worktree' }
    $parts += $bullet
    $parts += "$($C.Accent)$wtName$($C.Reset)"
}

$line1 = $parts -join ' '

# Calculate spacing for right-aligned quip
$visibleLeft = ($line1 -replace "$esc\[[0-9;]*m", '').Length
$termWidth = if ($env:COLUMNS) { [int]$env:COLUMNS } else { try { [Console]::WindowWidth } catch { 120 } }
$ccMargin = 30
$gap = $termWidth - $visibleLeft - $quip.Length - $ccMargin
if ($gap -lt 2) { $gap = 2 }

Write-Host "$line1$(' ' * $gap)$($C.Quip)$quip$($C.Reset)"
