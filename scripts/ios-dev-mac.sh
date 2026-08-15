#!/usr/bin/env bash
# ==============================================================================
# Revenant — installer l'app sur un iPhone depuis un Mac emprunté
# ==============================================================================
#
# Usage : bash scripts/ios-dev-mac.sh
#
# Ce script prépare un Mac « vierge » (rien d'installé à part Xcode) puis
# compile Revenant et l'installe sur l'iPhone branché en USB, en signature
# gratuite (« free provisioning », sans compte développeur payant).
#
# ATTENTION — la limite d'Apple sur la signature gratuite : l'app cesse de
# fonctionner au bout de 7 JOURS et doit être réinstallée depuis un Mac. Les
# données SQLite déjà saisies survivent à la réinstallation, seule la
# signature expire. Pour un usage au-delà du test, il faut le compte
# développeur payant (99 €/an) + TestFlight, qui n'exige alors plus de Mac
# du tout (voir .github/workflows/ios-release.yml).
#
# À FAIRE AVANT DE SE DÉPLACER (Xcode pèse plus de 15 Go, c'est long) :
#   1. Demander au propriétaire du Mac d'installer Xcode depuis le Mac App
#      Store, de l'ouvrir une fois et d'accepter la licence.
#   2. Sur l'iPhone : Réglages > Confidentialité et sécurité > Mode
#      développeur > activer, puis redémarrer le téléphone.
#   3. Prévoir un câble USB-C (l'iPhone 17 Pro est en USB-C).
#
# PENDANT L'EXÉCUTION, Xcode demandera une identité de signature. Se
# connecter avec SON PROPRE identifiant Apple (Xcode > Settings > Accounts >
# « + » > Apple ID) : la signature est liée au compte utilisé, pas au Mac.
# Inutile d'utiliser le compte du propriétaire du Mac.
# ==============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Vérification de Xcode"
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Xcode n'est pas installé. L'installer depuis le Mac App Store, l'ouvrir" >&2
  echo "une fois pour accepter la licence, puis relancer ce script." >&2
  exit 1
fi

echo "==> Rust (installé seulement s'il manque)"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi

echo "==> Cibles Rust iOS"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

echo "==> CocoaPods (requis par Tauri pour générer le projet Xcode)"
if ! command -v pod >/dev/null 2>&1; then
  brew install cocoapods
fi

echo "==> Dépendances npm"
npm ci

echo "==> Génération du projet Xcode (src-tauri/gen/apple, non versionné)"
if [ ! -d "src-tauri/gen/apple" ]; then
  npm run tauri ios init
fi

echo
echo "==> Lancement sur l'iPhone branché"
echo "    Si la compilation s'arrête sur une erreur de signature, ouvrir"
echo "    src-tauri/gen/apple/*.xcodeproj dans Xcode, onglet « Signing &"
echo "    Capabilities », cocher « Automatically manage signing » et choisir"
echo "    son équipe personnelle, puis relancer ce script."
echo
echo "    Au premier lancement, l'iPhone refusera d'ouvrir l'app : aller dans"
echo "    Réglages > Général > VPN et gestion de l'appareil, et faire"
echo "    confiance au certificat développeur."
echo
npm run tauri ios dev
