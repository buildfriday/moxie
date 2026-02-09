#!/usr/bin/env bash
# moxie bridge for ccstatusline custom-command widget
# Returns: AgentName · "contextual quip" with ANSI colors
#
# ccstatusline pipes Claude Code JSON to stdin and displays the output.
# This script reads the active vibe + stdin context to pick a quip.
#
# ccstatusline widget config:
#   { "type": "custom-command", "commandPath": "~/.moxie/ccbridge.sh", "maxWidth": 60, "timeout": 500, "preserveColors": true }
#
# Requires: jq

set -f

MOXIE_DIR="${HOME}/.moxie"
VIBE_FILE="${MOXIE_DIR}/active.json"
CACHE_DIR="${TMPDIR:-/tmp}"

# --- Load vibe ---
agent_name="Claude"
name_color="44"
dim="245"

if [[ -f "$VIBE_FILE" ]] && command -v jq &>/dev/null; then
    agent_name=$(jq -r '.agent.name // "Claude"' "$VIBE_FILE" 2>/dev/null)
    name_color=$(jq -r '.agent.nameColor // "44"' "$VIBE_FILE" 2>/dev/null)
    dim=$(jq -r '.palette.dim // "245"' "$VIBE_FILE" 2>/dev/null)
fi

c_name="\033[38;5;${name_color}m"
c_quip="\033[38;5;${dim}m"
c_dim="\033[38;5;${dim}m"
c_reset="\033[0m"

# --- Read stdin JSON from ccstatusline ---
input_json=""
if read -r -t 1 input_json; then
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

context_pct=${context_pct%.*}
(( context_pct < 0 )) && context_pct=0
(( context_pct > 100 )) && context_pct=100
session_min=$(( session_ms / 60000 ))

# --- Git state (minimal, for tag matching) ---
cache_slug="default"
if [[ -n "$project_dir" ]]; then
    cache_slug=$(echo "$project_dir" | tr -c 'a-zA-Z0-9' '-' | sed 's/-*$//')
fi

# Reuse moxie's git cache if available
cache_file="${CACHE_DIR}/moxie-git-${cache_slug}.json"
git_dirty=false
git_behind=0

if [[ -f "$cache_file" ]] && command -v jq &>/dev/null; then
    cache_age=$(( $(date +%s) - $(stat -c %Y "$cache_file" 2>/dev/null || stat -f %m "$cache_file" 2>/dev/null || echo 0) ))
    if (( cache_age < 60 )); then
        git_dirty=$(jq -r '.dirty // false' "$cache_file" 2>/dev/null)
        git_behind=$(jq -r '.behind // 0' "$cache_file" 2>/dev/null)
    fi
fi

# --- Build active tags ---
active_tags=("any")
hour=$(date +%H)
hour=${hour#0}
dow=$(date +%u)

if (( context_pct < 30 )); then active_tags+=("chill")
elif (( context_pct <= 70 )); then active_tags+=("warm")
else active_tags+=("hot"); fi

if (( hour >= 22 || hour < 5 )); then active_tags+=("late"); fi
if (( hour >= 5 && hour < 8 )); then active_tags+=("morning"); fi
if (( dow == 5 )); then active_tags+=("friday"); fi
if (( dow >= 6 )); then active_tags+=("weekend"); fi
(( session_min > 60 )) && active_tags+=("marathon")
(( session_min < 5 )) && active_tags+=("fresh")
[[ "$git_dirty" == "true" ]] && active_tags+=("dirty") || active_tags+=("clean")
(( git_behind > 0 )) && active_tags+=("behind")

# --- Select quip (cached 45s) ---
quip_cache="${CACHE_DIR}/moxie-bridge-quip-${cache_slug}.txt"
quip=""

if [[ -f "$quip_cache" ]]; then
    quip_age=$(( $(date +%s) - $(stat -c %Y "$quip_cache" 2>/dev/null || stat -f %m "$quip_cache" 2>/dev/null || echo 0) ))
    if (( quip_age < 45 )); then
        quip=$(cat "$quip_cache" 2>/dev/null)
    fi
fi

if [[ -z "$quip" && -f "$VIBE_FILE" ]] && command -v jq &>/dev/null; then
    eligible=()

    for tag in "${active_tags[@]}"; do
        tag_quips=$(jq -r ".quips.\"$tag\"[]? // empty" "$VIBE_FILE" 2>/dev/null)
        while IFS= read -r q; do
            [[ -n "$q" ]] && eligible+=("$q")
        done <<< "$tag_quips"
    done

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

# --- Output: AgentName · "quip" ---
bullet="${c_dim}\xC2\xB7${c_reset}"
echo -e "${c_name}${agent_name}${c_reset} ${bullet} ${c_quip}${quip}${c_reset}"
