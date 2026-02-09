# moxie bridge for ccstatusline custom-command widget (PowerShell / Windows)
# Returns: AgentName . "contextual quip" with ANSI colors
#
# ccstatusline pipes Claude Code JSON to stdin and displays the output.
# This script reads the active vibe + stdin context to pick a quip.
#
# ccstatusline widget config:
#   { "type": "custom-command", "commandPath": "~/.moxie/ccbridge.ps1", "maxWidth": 60, "timeout": 500, "preserveColors": true }

param()

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# --- Load vibe ---
$moxieDir = Join-Path $env:USERPROFILE '.moxie'
$vibeFile = Join-Path $moxieDir 'active.json'
$vibe = $null

if (Test-Path $vibeFile) {
    try { $vibe = Get-Content $vibeFile -Raw | ConvertFrom-Json } catch {}
}

$agentName = 'Claude'
$nameColorCode = '44'
$dimColor = '245'

if ($vibe) {
    if ($vibe.agent -and $vibe.agent.name) { $agentName = $vibe.agent.name }
    if ($vibe.agent -and $vibe.agent.nameColor) { $nameColorCode = $vibe.agent.nameColor }
    if ($vibe.palette -and $vibe.palette.dim) { $dimColor = $vibe.palette.dim }
}

$esc = [char]27
$cName = "$esc[38;5;${nameColorCode}m"
$cQuip = "$esc[38;5;${dimColor}m"
$cDim = "$esc[38;5;${dimColor}m"
$cReset = "$esc[0m"

# --- Read stdin JSON from ccstatusline ---
$inputJson = $null
try {
    $inputJson = [Console]::In.ReadToEnd() | ConvertFrom-Json
} catch {}

# --- Parse context ---
$contextPct = 0
if ($inputJson -and $inputJson.context_window) {
    $contextPct = [int]($inputJson.context_window.used_percentage)
}
$contextPct = [math]::Max(0, [math]::Min(100, $contextPct))

$sessionMs = 0
if ($inputJson -and $inputJson.cost) {
    $sessionMs = [long]($inputJson.cost.total_duration_ms)
}
$sessionMin = [math]::Floor($sessionMs / 60000)

# --- Git state (reuse moxie cache) ---
$projectDir = if ($inputJson -and $inputJson.workspace) { $inputJson.workspace.project_dir } else { $null }
$cacheSlug = if ($projectDir) { ($projectDir -replace '[^a-zA-Z0-9]', '-').TrimEnd('-') } else { '_default' }
$cacheFile = Join-Path $env:TEMP "moxie-git-$cacheSlug.json"
$gitDirty = $false
$gitBehind = 0

if (Test-Path $cacheFile) {
    $cacheAge = ((Get-Date) - (Get-Item $cacheFile).LastWriteTime).TotalSeconds
    if ($cacheAge -lt 60) {
        try {
            $gitInfo = Get-Content $cacheFile -Raw | ConvertFrom-Json
            $gitDirty = [bool]$gitInfo.dirty
            $gitBehind = [int]$gitInfo.behind
        } catch {}
    }
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
if ($sessionMin -gt 60) { $activeTags += 'marathon' }
if ($sessionMin -lt 5) { $activeTags += 'fresh' }
if ($gitDirty) { $activeTags += 'dirty' } else { $activeTags += 'clean' }
if ($gitBehind -gt 0) { $activeTags += 'behind' }

# --- Select quip (cached 45s) ---
$quipCacheFile = Join-Path $env:TEMP "moxie-bridge-quip-$cacheSlug.json"
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

    foreach ($tag in $activeTags) {
        $tagQuips = $vibe.quips.$tag
        if ($tagQuips) { $eligible += $tagQuips }
    }

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
        $eligible = @($vibe.quips.any)
    }

    if ($eligible.Count -gt 0) {
        $quip = $eligible | Get-Random
    }

    try {
        @{ quip = $quip } | ConvertTo-Json -Compress | Set-Content $quipCacheFile -NoNewline
    } catch {}
}

# --- Output: AgentName . "quip" ---
$bullet = "$cDim$([char]0x00B7)$cReset"
Write-Host "$cName$agentName$cReset $bullet $cQuip$quip$cReset"
