#!/usr/bin/env sh
# Parcours sur l'app Tauri de bureau, vrai backend Rust (docs/tests.md).
#
# Prérequis, hors CI : `cargo install tauri-driver`, `apt install
# webkit2gtk-driver xvfb`, et `npm run dev` qui tourne (le binaire debug charge
# devUrl). La base vit dans un dossier de travail jetable : jamais ~/.config.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
export XDG_CONFIG_HOME="$WORK/xdg" XDG_DATA_HOME="$WORK/xdg"

cargo build --manifest-path "$ROOT/src-tauri/Cargo.toml" --quiet
curl -sf -m 3 http://localhost:5173/ >/dev/null || { echo "lance d'abord : npm run dev" >&2; exit 1; }

# Dans son propre groupe de processus : à la sortie, on tue xvfb-run, Xvfb,
# tauri-driver et WebKitWebDriver d'un coup, pas seulement l'enveloppe.
setsid xvfb-run -a "${TAURI_DRIVER:-$HOME/.cargo/bin/tauri-driver}" --port 4444 >"$WORK/tauri-driver.log" 2>&1 &
DRIVER=$!
trap 'kill -- -"$DRIVER" 2>/dev/null; rm -rf "$WORK"' EXIT INT TERM
until curl -sf -m 2 http://127.0.0.1:4444/status >/dev/null; do sleep 0.5; done

node "$ROOT/scripts/desktop-e2e.mjs"
