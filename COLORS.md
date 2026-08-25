# Colors

Palette « nuit & laiton » de Revenant — direction artistique partagée avec
TruePerf (suivi de portefeuille) : fond nuit bleuté, laiton pour l'action,
vert pour la progression, rouge pour la régression, gris froid pour le
fantôme. Refonte d'août 2026 : elle remplace la palette « forge »
(noir chaud / orange feu).

Contrairement à l'ancien système (hex recopiés en dur dans chaque composant),
**toutes les couleurs sont déclarées une seule fois dans `src/assets/main.css`
(`:root`)** et consommées via `var(--...)`. Aucun composant ne doit
réintroduire un hex en dur — un `grep -rE "#[0-9a-f]{6}" src/` hors
`main.css` doit rester vide.

## La règle sémantique

Cinq couleurs, cinq significations — c'est la signature du design :

- **Laiton (`--fire`)** : le présent et l'effort — actions, focus, élément
  actif, cible du jour. (Le token garde son nom historique « fire ».)
- **Vert (`--gain`)** : la progression — deltas positifs, semaines en
  hausse, nouveaux records. Même vert que les plus-values dans TruePerf.
- **Rouge (`--blood`)** : la régression — deltas négatifs, semaines en
  baisse, stagnation, suppression.
- **Gris (`--ghost`)** : le passé — le fantôme de la séance précédente et la
  moyenne mobile. Le fantôme est incolore par définition (gris froid,
  hachures translucides, bordure en pointillés).
- **Bleu (`--warmup`)** : la préparation — le mode échauffement, la montée
  en charge, les séries hors compte. Froid pour ne se confondre ni avec
  l'effort (laiton) ni avec le passé (gris) : en mode échauffement, tout le
  panneau de suivi vire au bleu, et dans le carnet une série d'échauffement
  se reconnaît à son liseré bleu là où une série de travail a un liseré
  laiton et son numéro (S1, S2, S3).

Tout le reste est monochrome (nuit bleutée + ivoire). Panneaux arrondis
(14 px) avec ombre douce, bordures bleu-nuit — la douceur TruePerf remplace
les surfaces plates de la palette forge.

## Tokens (`src/assets/main.css`)

| Token | Valeur | Rôle |
|---|---|---|
| `--bg` | `#090c13` | Fond de page (nuit bleutée, quasi OLED) |
| `--surface` | `#111722` | Cartes / panneaux |
| `--surface-2` | `#182131` | Éléments imbriqués, champs |
| `--border` | `#263248` | Bordure par défaut |
| `--border-strong` | `#334360` | Bordure appuyée (champs, boutons secondaires) |
| `--text` | `#f3f1ea` | Texte principal (ivoire) |
| `--text-strong` | `#fdfcf7` | Valeurs mises en avant |
| `--muted` | `#8f9bb0` | Texte secondaire |
| `--fire` / `--fire-hover` | `#f0b94b` / `#f6cb74` | Laiton action / hover |
| `--fire-dim` | `rgb(240 185 75 / 12%)` | Fond de chip/badge laiton |
| `--on-fire` | `#1a1608` | Texte sur fond laiton |
| `--gain` / `--gain-text` | `#4bd399` / `#6fe0b0` | Vert progression / texte éclairci |
| `--gain-dim` | `rgb(75 211 153 / 14%)` | Fond de badge vert |
| `--blood` | `#ff6670` | Rouge plein (barres, bordures, hover destructif) |
| `--blood-text` | `#ff98a0` | Rouge éclairci pour le texte (lisibilité) |
| `--blood-dim` | `rgb(255 102 112 / 14%)` | Fond de badge rouge |
| `--ghost` / `--ghost-bright` | `#93a0b5` / `#cbd5e6` | Fantôme / points de moyenne mobile |
| `--ghost-dim` | `rgb(147 160 181 / 14%)` | Fond du chip fantôme, hovers neutres |
| `--warmup` / `--warmup-text` | `#5fb4e8` / `#8fcbf0` | Bleu échauffement / texte éclairci |
| `--warmup-dim` / `--warmup-ring` | `rgb(95 180 232 / 14%)` / `… / 22%` | Fond teinté, anneau de focus en mode échauffement |
| `--on-warmup` | `#071420` | Texte sur fond bleu |

Tokens dérivés : `--panel-*` (cartes, radius 14 px, ombre douce), `--field-*`
(champs), `--accent`/`--accent-hover`/`--accent-text-on-fill` (boutons),
`--control-radius: 10px`.

## Typographie

`--font-display` : pile système (`ui-sans-serif`/`system-ui`), en capitales
espacées pour les h1/h2 — même traitement que la barre de titre TruePerf.
`--font-num` : monospace (`ui-monospace`, SF Mono…) pour les chiffres alignés
(stats, deltas) avec `font-variant-numeric: tabular-nums`. Barlow Condensed
a été retirée avec la palette forge.

## Historique

- **Palette « forge »** (fond noir chaud `#0b0a09`, orange feu `#ff6a2b`,
  rouge `#e5484d`, gris chaud `#a6a09b`, Barlow Condensed) : remplacée en
  août 2026 par la palette « nuit & laiton » pour aligner Revenant sur la
  direction artistique de TruePerf. L'orange portait alors aussi la
  progression ; elle est désormais verte (`--gain`).
- **Palette d'origine** (fond slate `#0b1120`, accent cyan→teal
  `#67e8f9`/`#2dd4bf`, fantôme violet `#c4b5fd`, négatif rose `#fb7185`) :
  retirée en août 2026. Le violet du fantôme est devenu gris : la logique
  « une couleur pour le passé » est conservée, mais le passé n'a plus de
  couleur du tout.
