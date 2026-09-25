#!/usr/bin/env bash
# Hook PreToolUse (Edit|Write) : refuse les fichiers que seuls leurs outils
# doivent écrire — verrous de dépendances et code généré par Tauri.
# Reçoit l'appel d'outil en JSON sur stdin ; répond par une décision « deny ».
set -euo pipefail

file=$(jq -r '.tool_input.file_path // empty')
[ -n "$file" ] || exit 0

case "$file" in
  */package-lock.json | */Cargo.lock | */deno.lock)
    reason="« $(basename "$file") » est un verrou de dépendances : il ne change que par son outil (npm install, cargo update, deno cache), jamais à la main." ;;
  */src-tauri/gen/*)
    reason="« src-tauri/gen/ » est généré par Tauri (tauri ios init, tauri build) : modifie la source ou la configuration, pas la sortie." ;;
  *) exit 0 ;;
esac

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
