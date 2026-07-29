# Colors

Audit des couleurs réellement utilisées dans le code de l'app (`src/`), pas du
mockup exploratoire publié en artifact — ce sont deux choses différentes, voir
la note en bas de page.

Bonne nouvelle : la palette actuelle est cohérente. Chaque rôle (fond, texte,
accent, fantôme, positif, négatif) reprend le même hex partout où il apparaît.
Le seul vrai problème est qu'elle n'est nulle part déclarée — chaque composant
recopie les mêmes valeurs littérales.

## Palette par rôle

### Fonds (ink)

| Hex | Rôle | Utilisé dans |
|---|---|---|
| `#0b1120` | Fond de page, base du dégradé | `main.css` (html/body/#app), `App.vue` |
| `#111827` | Milieu du dégradé de fond, fond des champs de saisie | `App.vue`, `ExerciseTracker.vue`, `NextExerciseView.vue` |
| `#172033` | Fin du dégradé de fond | `App.vue` |
| `#020617` | Fond des cartes graphiques (le plus sombre, "creux") | `SessionDiff.vue` (`.overlay-rail`), `WeeklyVolumeGraph.vue` (`.trading-chart`) |
| `rgb(15 23 42 / X%)` | Fond de carte translucide (slate-900 à opacité variable) | `ExerciseTracker.vue`, `SessionDiff.vue`, `WeeklyVolumeGraph.vue`, `NextExerciseView.vue` |

### Texte

| Hex | Rôle | Utilisé dans |
|---|---|---|
| `#e5edf5` | Texte principal | `main.css`, `ExerciseTracker.vue`, `SessionDiff.vue`, `NextExerciseView.vue` |
| `#f8fafc` | Texte principal accentué (valeurs mises en avant) | `ExerciseTracker.vue`, `SessionDiff.vue`, `NextExerciseView.vue` |
| `#94a3b8` | Texte secondaire / muet (labels, légendes) | Tous les composants — le muted le plus réutilisé du projet |
| `#cbd5e1` | Texte secondaire, variante plus claire | `ExerciseTracker.vue` |
| `#031926` | Texte sur fond accent clair (boutons cyan→teal) | `ExerciseTracker.vue`, `ExerciseView.vue`, `NextExerciseView.vue` |

### Bordures / lignes neutres

| Valeur | Rôle | Utilisé dans |
|---|---|---|
| `rgb(148 163 184 / X%)` | Bordure hairline neutre (slate-400 à faible opacité) | Partout — la bordure par défaut de toute carte, input, axe de graphique |

### Accent principal — cyan → teal

C'est la couleur de marque : boutons d'action, focus, éléments "actuel/actif".

| Hex | Rôle | Utilisé dans |
|---|---|---|
| `#67e8f9` | Accent principal (bordures actives, focus, labels de section) | `ExerciseTracker.vue`, `SessionDiff.vue`, `NextExerciseView.vue` |
| `#2dd4bf` | Accent principal, extrémité du dégradé bouton ; barre "actuelle" dans `SessionDiff` | `ExerciseTracker.vue`, `ExerciseView.vue`, `NextExerciseView.vue`, `SessionDiff.vue` (`.bar-now`) |
| `#a5f3fc` / `#5eead4` | Variante hover du dégradé bouton | `ExerciseTracker.vue`, `ExerciseView.vue`, `NextExerciseView.vue` |
| `#ccfbf1` | Highlight de bord sur `.bar-now` | `SessionDiff.vue` |

### Fantôme — violet (séance précédente)

Déjà, dans le code actuel, le "fantôme" (moyenne mobile, overlay de la
séance passée) est en violet — c'est la même logique de couleur que celle
utilisée dans le dossier de cadrage produit.

| Hex | Rôle | Utilisé dans |
|---|---|---|
| `#c4b5fd` | Ligne de moyenne mobile | `WeeklyVolumeGraph.vue` (`.ma-line`) |
| `#ddd6fe` | Points de moyenne mobile | `WeeklyVolumeGraph.vue` (`.ma-point`) |
| `rgb(196 181 253 / 62%)` | Rayures de la barre fantôme | `SessionDiff.vue` (`.bar-ghost`) |
| `rgb(167 139 250 / X%)` | Glow autour de la barre fantôme + halo du fond global | `SessionDiff.vue`, `App.vue` |

### Positif / négatif (delta de progression)

| Hex | Rôle | Utilisé dans |
|---|---|---|
| `#5eead4` | Delta positif, semaine en hausse | `SessionDiff.vue` (`.positive`), `WeeklyVolumeGraph.vue` (`.legend-up`, bougies en hausse) |
| `#fb7185` | Delta négatif, semaine en baisse, régression de volume | `SessionDiff.vue` (`.negative`), `WeeklyVolumeGraph.vue` (`.legend-down`, bougies en baisse, `.lower strong`) |
| `#fecdd3` / `rgb(159 18 57 / X%)` / `rgb(190 18 60 / X%)` | Variantes du rouge de régression (texte / fond de badge) | `ExerciseTracker.vue` |

## Cohérence observée

- **Le rouge de régression (`#fb7185`) et le violet fantôme sont déjà
  utilisés de façon identique dans deux composants indépendants**
  (`SessionDiff.vue` et `WeeklyVolumeGraph.vue`) sans qu'aucun système de
  design ne les impose — c'est un bon signe : la cohérence existe dans les
  faits, elle n'est juste pas déclarée.
- **`#94a3b8` (texte muet) et `rgb(148 163 184 / X%)` (bordure neutre) sont la
  même teinte slate-400**, utilisée en plein pour le texte et en transparence
  pour les bordures — cohérent, mais deux syntaxes différentes pour la même
  intention.
- **Risque réel** : ces valeurs sont recopiées en dur dans 6 fichiers. Rien
  n'empêche qu'un futur composant introduise un rouge ou un violet légèrement
  différent sans que ce soit visible en revue de code. Rien à changer dans
  l'immédiat, mais si l'app grossit, extraire ces valeurs en variables CSS
  (`:root { --accent-cyan: #67e8f9; --ghost-violet: #c4b5fd; --negative: #fb7185; ... }`)
  supprimerait ce risque.

## Rapport avec le dossier de cadrage produit

Le mockup publié en artifact (persona / parcours / user stories) utilisait une
palette différente et volontairement exploratoire (violet fantôme + ambre
pour l'effort présent, sur fond quasi noir) pour visualiser de nouveaux
écrans qui n'existent pas encore dans le code. Les deux partagent la même
idée — le violet pour "le passé" — mais le mockup n'est pas la palette de
l'app actuelle : cette note documente ce qui tourne réellement aujourd'hui
dans `src/`.
