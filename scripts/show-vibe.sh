#!/usr/bin/env bash
# Renders a fake Claude Code terminal screen with a moxie statusline for a given vibe.
# Used by gen-screenshots.sh (piped to freeze) and demo.tape (VHS).
#
# Usage: ./show-vibe.sh <vibe-name> [--no-chrome] [--quip "override quip"]
#        [--context <pct>] [--branch <name>] [--cc-version <ver>] [--model <model>]
#
# Requires: jq

set -f

VIBES_DIR="$(cd "$(dirname "$0")/../vibes" && pwd)"

vibe_name="${1:-pirate}"
shift || true

no_chrome=false
custom_quip=""
context_pct=23
branch_name="main"
cc_version="v2.1.34"
cc_model="claude-sonnet-4-5-20250929"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-chrome) no_chrome=true; shift ;;
        --quip) custom_quip="$2"; shift 2 ;;
        --context) context_pct="$2"; shift 2 ;;
        --branch) branch_name="$2"; shift 2 ;;
        --cc-version) cc_version="$2"; shift 2 ;;
        --model) cc_model="$2"; shift 2 ;;
        *) shift ;;
    esac
done

vibe_file="${VIBES_DIR}/${vibe_name}.json"
if [[ ! -f "$vibe_file" ]]; then
    echo "Error: vibe file not found: $vibe_file" >&2
    exit 1
fi

# --- Load vibe colors ---
agent_name=$(jq -r '.agent.name' "$vibe_file")
name_color=$(jq -r '.agent.nameColor' "$vibe_file")
primary=$(jq -r '.palette.primary' "$vibe_file")
accent=$(jq -r '.palette.accent' "$vibe_file")
dim=$(jq -r '.palette.dim' "$vibe_file")

# --- ANSI helpers ---
esc="\033"
c_name="${esc}[38;5;${name_color}m"
c_primary="${esc}[38;5;${primary}m"
c_accent="${esc}[38;5;${accent}m"
c_dim="${esc}[38;5;${dim}m"
c_reset="${esc}[0m"
c_bold="${esc}[1m"
c_white="${esc}[38;5;255m"
c_gray="${esc}[38;5;245m"
c_dgray="${esc}[38;5;240m"
c_cyan="${esc}[38;5;44m"
c_magenta="${esc}[38;5;170m"

# --- Pick quip ---
if [[ -n "$custom_quip" ]]; then
    quip="$custom_quip"
else
    # Grab a random quip from the "any" pool
    quip_count=$(jq '.quips.any | length' "$vibe_file")
    idx=$(( RANDOM % quip_count ))
    quip=$(jq -r ".quips.any[$idx]" "$vibe_file")
fi

# --- Pick spinner verb ---
verb_count=$(jq '.spinnerVerbs.verbs | length' "$vibe_file")
vidx=$(( RANDOM % verb_count ))
spinner_verb=$(jq -r ".spinnerVerbs.verbs[$vidx]" "$vibe_file")

# --- Build context bar ---
filled=$(( context_pct / 10 ))
empty=$(( 10 - filled ))
bar_str=""
for (( i=0; i<filled; i++ )); do bar_str+="█"; done
empty_str=""
for (( i=0; i<empty; i++ )); do empty_str+="░"; done

# --- Fake CC header block ---
# Mimics the Claude Code startup screen
print_cc_header() {
    echo ""
    echo -e "  ${c_bold}${c_white}╭─────────────────────────────────────────────╮${c_reset}"
    echo -e "  ${c_bold}${c_white}│${c_reset}  ${c_bold}${c_magenta}◆${c_reset} ${c_bold}${c_white}Claude Code${c_reset} ${c_gray}${cc_version}${c_reset}                      ${c_bold}${c_white}│${c_reset}"
    echo -e "  ${c_bold}${c_white}│${c_reset}                                             ${c_bold}${c_white}│${c_reset}"
    echo -e "  ${c_bold}${c_white}│${c_reset}  ${c_gray}Model:${c_reset} ${c_white}${cc_model}${c_reset}       ${c_bold}${c_white}│${c_reset}"
    echo -e "  ${c_bold}${c_white}│${c_reset}  ${c_gray}Context:${c_reset} ${c_cyan}200k tokens${c_reset} ${c_gray}(Sonnet)${c_reset}           ${c_bold}${c_white}│${c_reset}"
    echo -e "  ${c_bold}${c_white}│${c_reset}  ${c_gray}Project:${c_reset} ${c_white}/home/dev/myproject${c_reset}           ${c_bold}${c_white}│${c_reset}"
    echo -e "  ${c_bold}${c_white}╰─────────────────────────────────────────────╯${c_reset}"
    echo ""
}

# --- Build statusline ---
build_statusline() {
    local bullet="${c_dim}·${c_reset}"
    local line=""
    line+="${c_name}${agent_name}${c_reset}"
    line+=" ${c_primary}${bar_str}${c_dim}${empty_str}${c_reset} ${context_pct}%"
    line+=" ${bullet}"
    line+=" ${c_primary}${branch_name}${c_reset}"

    # Pad to ~100 chars then quip
    local pad="                              "
    line+="${pad}${c_dim}${quip}${c_reset}"
    echo -e "$line"
}

# --- Prompt line ---
print_prompt() {
    echo -e "  ${c_bold}${c_magenta}◆${c_reset} ${c_gray}What would you like to do?${c_reset}"
    echo ""
}

# --- Action bar (fake CC bottom bar) ---
print_action_bar() {
    echo -e "  ${c_dgray}? help   / commands   ↑↓ history   esc clear${c_reset}"
}

# --- Render ---
if [[ "$no_chrome" == "false" ]]; then
    print_cc_header
fi
print_prompt

# Separator + statusline
echo -e "  ${c_dgray}─────────────────────────────────────────────────────────────────────────────────${c_reset}"
build_statusline
echo -e "  ${c_dgray}─────────────────────────────────────────────────────────────────────────────────${c_reset}"

if [[ "$no_chrome" == "false" ]]; then
    echo ""
    print_action_bar
fi
echo ""
