#!/usr/bin/env bash
# Hook PostToolUse (Edit|Write) : remet le fichier touché d'équerre.
#   - TypeScript / Vue de src → les tests Vitest liés au fichier
#   - Python de grafana       → les tests du chargeur, que la CI ne lance pas
# Pas de rustfmt ici : le backend n'est pas encore au format (cargo fmt --check
# le dit), formater fichier par fichier noierait chaque commit dans du bruit.
# À rebrancher après un commit de formatage unique.
# Un échec de test sort en code 2 : Claude Code rend alors la sortie au modèle,
# qui corrige au lieu de continuer sur du rouge.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
file=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$file" ] && [ -f "$file" ] || exit 0

fail() { # $1 = titre, $2 = sortie de la commande
  { echo "$1"; echo "$2" | tail -n 40; } >&2
  exit 2
}

case "$file" in
  "$root"/src/*.ts | "$root"/src/*.vue)
    out=$(cd "$root" && npx vitest related "$file" --run 2>&1) \
      || fail "Tests Vitest liés à ${file#"$root"/} en échec :" "$out" ;;
  "$root"/grafana/*.py)
    out=$(cd "$root/grafana" && python3 -m unittest discover -p 'test_*.py' 2>&1) \
      || fail "Tests du chargeur Grafana en échec :" "$out" ;;
esac
exit 0
