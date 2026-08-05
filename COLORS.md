# Colors

Palette « forge » de Ghost Lift — noir chaud / orange feu / rouge sang / gris
fantôme. Refonte d'août 2026 : elle remplace l'ancien thème slate/cyan/violet.

Contrairement à l'ancien système (hex recopiés en dur dans chaque composant),
**toutes les couleurs sont déclarées une seule fois dans `src/assets/main.css`
(`:root`)** et consommées via `var(--...)`. Aucun composant ne doit
réintroduire un hex en dur — un `grep -rE "#[0-9a-f]{6}" src/` hors
`main.css` doit rester vide.

## La règle sémantique

Trois couleurs, trois significations — c'est la signature du design :

- **Orange (`--fire`)** : le présent et l'effort — actions, focus, élément
  actif, cible du jour, progression (deltas positifs, semaines en hausse).
- **Rouge (`--blood`)** : la régression — deltas négatifs, semaines en
  baisse, stagnation, suppression.
- **Gris (`--ghost`)** : le passé — le fantôme de la séance précédente et la
  moyenne mobile. Le fantôme est incolore par définition (hachures grises
  translucides, bordure en pointillés).

Tout le reste est monochrome (noir chaud + blanc cassé). Pas de dégradés,
pas de glows, pas d'ombres colorées : surfaces plates + bordures hairline.

## Tokens (`src/assets/main.css`)

| Token | Valeur | Rôle |
|---|---|---|
| `--bg` | `#0b0a09` | Fond de page (noir chaud, quasi OLED) |
| `--surface` | `#14120f` | Cartes / panneaux |
| `--surface-2` | `#1d1915` | Éléments imbriqués, champs |
| `--border` | `rgb(255 244 230 / 8%)` | Bordure hairline par défaut |
| `--border-strong` | `rgb(255 244 230 / 16%)` | Bordure appuyée (champs, boutons secondaires) |
| `--text` | `#f3eee7` | Texte principal |
| `--text-strong` | `#fffdf9` | Valeurs mises en avant |
| `--muted` | `#9b9187` | Texte secondaire (contraste ≥ 4.5:1 sur `--surface`) |
| `--fire` / `--fire-hover` | `#ff6a2b` / `#ff8450` | Accent action / hover |
| `--fire-dim` | `rgb(255 106 43 / 12%)` | Fond de chip/badge orange |
| `--on-fire` | `#1a0c03` | Texte sur fond orange |
| `--blood` | `#e5484d` | Rouge plein (barres, bordures, hover destructif) |
| `--blood-text` | `#f2777a` | Rouge éclairci pour le texte (lisibilité) |
| `--blood-dim` | `rgb(229 72 77 / 14%)` | Fond de badge rouge |
| `--ghost` / `--ghost-bright` | `#a6a09b` / `#d6d1cb` | Fantôme / points de moyenne mobile |
| `--ghost-dim` | `rgb(166 160 155 / 14%)` | Fond du chip fantôme, hovers neutres |

Tokens dérivés : `--panel-*` (cartes), `--field-*` (champs),
`--accent`/`--accent-hover`/`--accent-text-on-fill` (boutons),
`--control-radius: 8px`, `--panel-radius: 12px`, `--panel-shadow: none`.

## Typographie

`--font-display` : **Barlow Condensed** (600/700, embarquée offline via
`@fontsource/barlow-condensed`, importée dans `src/main.ts`). Utilisée pour
les h1/h2 (majuscules), les gros chiffres (stats, compte à rebours de repos)
et la marque. Le corps de texte reste Inter/system.

## Historique

L'ancienne palette (fond slate `#0b1120`, accent cyan→teal `#67e8f9`/`#2dd4bf`,
fantôme violet `#c4b5fd`, négatif rose `#fb7185`) a été entièrement retirée
en août 2026. Le violet du fantôme est devenu gris : la logique « une couleur
pour le passé » est conservée, mais le passé n'a plus de couleur du tout.
