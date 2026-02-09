#!/usr/bin/env bash
# moxie statusline for Claude Code (bash / Mac / Linux)
# Reads personality from ~/.moxie/active.json, shows metrics + git info + rotating quip
#
# Requires: jq (https://jqlang.github.io/jq/)
#
# Usage: Set in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash ~/.moxie/statusline.sh" }
#
# Input: JSON on stdin from Claude Code
# Output: Single-line ANSI status bar

set -f

MOXIE_DIR="${HOME}/.moxie"
VIBE_FILE="${MOXIE_DIR}/active.json"
CACHE_DIR="${TMPDIR:-/tmp}"

# --- Load vibe config ---
agent_name="Claude"
name_color="44"
primary="44"
accent="214"
warning="204"
dim="245"

if [[ -f "$VIBE_FILE" ]] && command -v jq &>/dev/null; then
    agent_name=$(jq -r '.agent.name // "Claude"' "$VIBE_FILE" 2>/dev/null)
    name_color=$(jq -r '.agent.nameColor // "44"' "$VIBE_FILE" 2>/dev/null)
    primary=$(jq -r '.palette.primary // "44"' "$VIBE_FILE" 2>/dev/null)
    accent=$(jq -r '.palette.accent // "214"' "$VIBE_FILE" 2>/dev/null)
    warning=$(jq -r '.palette.warning // "204"' "$VIBE_FILE" 2>/dev/null)
    dim=$(jq -r '.palette.dim // "245"' "$VIBE_FILE" 2>/dev/null)
fi

# --- ANSI helpers ---
c_name="\033[38;5;${name_color}m"
c_primary="\033[38;5;${primary}m"
c_bar_low="\033[38;5;${primary}m"
c_bar_mid="\033[38;5;${accent}m"
c_bar_high="\033[38;5;${warning}m"
c_quip="\033[38;5;${dim}m"
c_dim="\033[38;5;${dim}m"
c_accent="\033[38;5;${accent}m"
c_reset="\033[0m"

# --- Read stdin JSON ---
input_json=""
if read -r -t 1 input_json; then
    # Read any remaining lines
    while IFS= read -r -t 0.1 line; do
        input_json="${input_json}${line}"
    done
fi

# --- Parse context ---
context_pct=0
session_ms=0
project_dir=""

if [[ -n "$input_json" ]] && command -v jq &>/dev/null; then
    context_pct=$(echo "$input_json" | jq -r '.context_window.used_percentage // 0' 2>/dev/null)
    session_ms=$(echo "$input_json" | jq -r '.cost.total_duration_ms // 0' 2>/dev/null)
    project_dir=$(echo "$input_json" | jq -r '.workspace.project_dir // ""' 2>/dev/null)
fi

context_pct=${context_pct%.*}  # truncate to int
(( context_pct < 0 )) && context_pct=0
(( context_pct > 100 )) && context_pct=100
session_min=$(( session_ms / 60000 ))

# --- Context bar (10 chars) ---
filled=$(( context_pct / 10 ))
empty=$(( 10 - filled ))

bar_str=""
for (( i=0; i<filled; i++ )); do bar_str+="█"; done
empty_str=""
for (( i=0; i<empty; i++ )); do empty_str+="░"; done

if (( context_pct >= 80 )); then
    bar_color="$c_bar_high"
elif (( context_pct >= 60 )); then
    bar_color="$c_bar_mid"
else
    bar_color="$c_bar_low"
fi

bar="${bar_color}${bar_str}${c_dim}${empty_str}${c_reset}"

# --- Git info (cached, 30s TTL) ---
cache_slug="default"
if [[ -n "$project_dir" ]]; then
    cache_slug=$(echo "$project_dir" | tr -c 'a-zA-Z0-9' '-' | sed 's/-*$//')
fi
cache_file="${CACHE_DIR}/moxie-git-${cache_slug}.json"

git_branch=""
git_worktree=false
git_worktree_name=""
git_ahead=0
git_dirty=false
git_behind=0
cache_valid=false

if [[ -f "$cache_file" ]]; then
    cache_age=$(( $(date +%s) - $(stat -c %Y "$cache_file" 2>/dev/null || stat -f %m "$cache_file" 2>/dev/null || echo 0) ))
    if (( cache_age < 30 )); then
        if command -v jq &>/dev/null; then
            git_branch=$(jq -r '.branch // ""' "$cache_file" 2>/dev/null)
            git_worktree=$(jq -r '.worktree // false' "$cache_file" 2>/dev/null)
            git_worktree_name=$(jq -r '.worktreeName // ""' "$cache_file" 2>/dev/null)
            git_ahead=$(jq -r '.ahead // 0' "$cache_file" 2>/dev/null)
            git_dirty=$(jq -r '.dirty // false' "$cache_file" 2>/dev/null)
            git_behind=$(jq -r '.behind // 0' "$cache_file" 2>/dev/null)
            cache_valid=true
        fi
    fi
fi

if [[ "$cache_valid" != "true" ]]; then
    git_args=()
    [[ -n "$project_dir" ]] && git_args=(-C "$project_dir")

    git_branch=$(git "${git_args[@]}" branch --show-current 2>/dev/null)
    if [[ -z "$git_branch" ]]; then
        remote_ref=$(git "${git_args[@]}" for-each-ref --points-at HEAD --format='%(refname:short)' refs/remotes/ 2>/dev/null | head -1)
        if [[ -n "$remote_ref" ]]; then
            git_branch="${remote_ref#origin/}"
        else
            git_branch=$(git "${git_args[@]}" rev-parse --short HEAD 2>/dev/null || echo "detached")
        fi
    fi

    # Worktree detection
    toplevel=$(git "${git_args[@]}" rev-parse --show-toplevel 2>/dev/null)
    if [[ -n "$toplevel" && -f "$toplevel/.git" ]]; then
        git_worktree=true
        git_worktree_name=$(basename "$toplevel")
    fi

    ahead=$(git "${git_args[@]}" rev-list --count --left-only 'HEAD...@{upstream}' 2>/dev/null)
    [[ "$ahead" =~ ^[0-9]+$ ]] && git_ahead=$ahead

    porcelain=$(git "${git_args[@]}" status --porcelain 2>/dev/null)
    [[ -n "$porcelain" ]] && git_dirty=true || git_dirty=false

    behind=$(git "${git_args[@]}" rev-list --count --right-only 'HEAD...@{upstream}' 2>/dev/null)
    [[ "$behind" =~ ^[0-9]+$ ]] && git_behind=$behind

    # Write cache
    if command -v jq &>/dev/null; then
        jq -n \
            --arg branch "$git_branch" \
            --argjson worktree "$git_worktree" \
            --arg worktreeName "$git_worktree_name" \
            --argjson ahead "$git_ahead" \
            --argjson dirty "$git_dirty" \
            --argjson behind "$git_behind" \
            '{branch:$branch,worktree:$worktree,worktreeName:$worktreeName,ahead:$ahead,dirty:$dirty,behind:$behind}' \
            > "$cache_file" 2>/dev/null
    fi
fi

# --- Build active tags ---
active_tags=("any")
hour=$(date +%H)
hour=${hour#0}  # strip leading zero
dow=$(date +%u)  # 1=Mon, 7=Sun

if (( context_pct < 30 )); then active_tags+=("chill")
elif (( context_pct <= 70 )); then active_tags+=("warm")
else active_tags+=("hot"); fi

if (( hour >= 22 || hour < 5 )); then active_tags+=("late"); fi
if (( hour >= 5 && hour < 8 )); then active_tags+=("morning"); fi
if (( dow == 5 )); then active_tags+=("friday"); fi
if (( dow >= 6 )); then active_tags+=("weekend"); fi
[[ "$git_worktree" == "true" ]] && active_tags+=("worktree")
(( session_min > 60 )) && active_tags+=("marathon")
(( session_min < 5 )) && active_tags+=("fresh")
[[ "$git_dirty" == "true" ]] && active_tags+=("dirty") || active_tags+=("clean")
(( git_behind > 0 )) && active_tags+=("behind")

# --- Select quip (cached 45s) ---
quip_cache="${CACHE_DIR}/moxie-quip-${cache_slug}.txt"
quip=""

if [[ -f "$quip_cache" ]]; then
    quip_age=$(( $(date +%s) - $(stat -c %Y "$quip_cache" 2>/dev/null || stat -f %m "$quip_cache" 2>/dev/null || echo 0) ))
    if (( quip_age < 45 )); then
        quip=$(cat "$quip_cache" 2>/dev/null)
    fi
fi

if [[ -z "$quip" && -f "$VIBE_FILE" ]] && command -v jq &>/dev/null; then
    eligible=()

    # Match simple tags (no comma in key)
    for tag in "${active_tags[@]}"; do
        tag_quips=$(jq -r ".quips.\"$tag\"[]? // empty" "$VIBE_FILE" 2>/dev/null)
        while IFS= read -r q; do
            [[ -n "$q" ]] && eligible+=("$q")
        done <<< "$tag_quips"
    done

    # Match combo tags (keys containing commas, e.g. "hot,late")
    while IFS= read -r combo_key; do
        [[ -z "$combo_key" || "$combo_key" != *,* ]] && continue
        all_match=true
        IFS=',' read -ra sub_tags <<< "$combo_key"
        for st in "${sub_tags[@]}"; do
            st=$(echo "$st" | tr -d ' ')
            found=false
            for at in "${active_tags[@]}"; do
                [[ "$at" == "$st" ]] && { found=true; break; }
            done
            [[ "$found" == "false" ]] && { all_match=false; break; }
        done
        if [[ "$all_match" == "true" ]]; then
            combo_quips=$(jq -r ".quips.\"$combo_key\"[]? // empty" "$VIBE_FILE" 2>/dev/null)
            while IFS= read -r q; do
                [[ -n "$q" ]] && eligible+=("$q")
            done <<< "$combo_quips"
        fi
    done < <(jq -r '.quips | keys[]' "$VIBE_FILE" 2>/dev/null)

    if (( ${#eligible[@]} == 0 )); then
        while IFS= read -r q; do
            [[ -n "$q" ]] && eligible+=("$q")
        done < <(jq -r '.quips.any[]? // empty' "$VIBE_FILE" 2>/dev/null)
    fi

    if (( ${#eligible[@]} > 0 )); then
        idx=$(( RANDOM % ${#eligible[@]} ))
        quip="${eligible[$idx]}"
    fi

    echo -n "$quip" > "$quip_cache" 2>/dev/null
fi

# --- Layout option ---
quip_position="right"
if [[ -f "$VIBE_FILE" ]] && command -v jq &>/dev/null; then
    qp=$(jq -r '.layout.quipPosition // "right"' "$VIBE_FILE" 2>/dev/null)
    [[ -n "$qp" && "$qp" != "null" ]] && quip_position="$qp"
fi

# --- Build status line ---
bullet="${c_dim}·${c_reset}"
line=""

line+="${c_name}${agent_name}${c_reset}"
line+=" ${bar} ${c_reset}${context_pct}%"
line+=" ${bullet}"
line+=" ${c_primary}${git_branch}${c_reset}"

if (( git_ahead > 0 )); then
    line+=" ${c_dim}↑${git_ahead}${c_reset}"
fi

if [[ "$git_worktree" == "true" ]]; then
    wt_name="${git_worktree_name:-worktree}"
    line+=" ${bullet} ${c_accent}${wt_name}${c_reset}"
fi

if [[ "$quip_position" == "inline" && -n "$quip" ]]; then
    line+=" ${bullet} ${c_quip}${quip}${c_reset}"
    echo -e "${line}"
else
    # Strip ANSI to get visible width
    visible_left=$(echo -e "$line" | sed 's/\x1b\[[0-9;]*m//g' | wc -c)
    visible_left=$(( visible_left - 1 ))  # subtract trailing newline

    term_width="${COLUMNS:-120}"
    cc_margin=30
    gap=$(( term_width - visible_left - ${#quip} - cc_margin ))
    (( gap < 2 )) && gap=2

    padding=$(printf '%*s' "$gap" '')

    echo -e "${line}${padding}${c_quip}${quip}${c_reset}"
fi
