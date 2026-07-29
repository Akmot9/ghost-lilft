# User Stories

## Persona

**Cyprien — lifteur autonome.** S'entraîne seul, sans coach, sur mobile, à la
salle, entre les séries (jamais après coup). Niveau qui évolue dans le temps :
l'app ne cible pas un seul palier. Objectif principal : ne jamais stagner sans
le savoir. Usage secondaire réel : montrer un graphe de progression à des amis
en soirée.

## Modèle de données

- **Séance** — structure fixe créée une fois (généralement à l'onboarding),
  rarement recréée ou modifiée par la suite. Contient 1 ou plusieurs
  Exercices.
- **Exercice** — rattaché à une séance. Contient 0 ou plusieurs Séries.
- **Série** — un set loggé (reps, poids, date). Inchangé par rapport à
  aujourd'hui (`ExerciseSet`).
- Les stats se lisent par **semaine** (volume moyen, récupération), pas par
  instance de séance — le mot « séance » désigne uniquement le programme,
  jamais un objet stocké séparé pour « l'instant réel à la salle ». Ce dernier
  reste une vue dérivée des séries par date (comme `SessionDiff` aujourd'hui).
- Aujourd'hui le store ne connaît qu'une liste plate d'exercices : la Séance
  est un nouveau niveau à ajouter au-dessus.

## Navigation confirmée à la salle

1. Ouvre l'app → sélectionne sa séance dans une liste.
2. Voit la liste des exercices de cette séance.
3. Sélectionne un exercice → vue de saisie avec cible suggérée (fantôme).
4. Valide la série → le chrono de repos se lance → la vue repropose une
   saisie (poids/reps pré-remplis) pour la série suivante.
5. Peut revenir à la liste des exercices de la séance à tout moment, via le
   menu du haut, toujours visible (y compris pendant la saisie).

## Journey map — une séance

1. **Avant la série** — ouvre l'exercice, voit le fantôme de la dernière séance,
   sait quoi viser. *(Incertitude → confiance)*
2. **Pendant / juste après** — logge poids + reps en un minimum de gestes.
   *(Friction à éliminer)*
3. **Verdict immédiat** — comparaison instantanée au fantôme : progression,
   stagnation ou record. *(Fierté ou vigilance)*
4. **Repos** — chrono automatique entre les séries. *(Relâchement maîtrisé)*
5. **Fin de séance** — bilan du volume hebdomadaire. *(Satisfaction ou alerte)*
6. **Le soir, entre potes** — ressort le graphe de progression, sans contexte à
   donner. *(Fierté sociale)*

Détail visuel (personas, maquettes d'écrans) : voir le dossier de cadrage
publié en artifact.

Le suivi (todo / en cours / fait) se fait désormais via les
[issues GitHub](https://github.com/Akmot9/ghost-lilft/issues), plus dans un
fichier Kanban local.

## Séance, onboarding et navigation générale

- GL-13 — En tant que développeur, je veux que les exercices soient regroupés
  dans une entité Séance plutôt qu'une liste plate, afin que la navigation et
  l'onboarding reflètent la vraie structure d'un programme d'entraînement.
- GL-14 — En tant que lifteur, je veux créer ma séance initiale (nom +
  premiers exercices) au premier lancement de l'app, afin de commencer à
  logger dès ma première fois à la salle.
- GL-15 — En tant que lifteur, je veux sélectionner ma séance du jour dans
  une liste, afin de retrouver directement les exercices que je dois faire.
- GL-16 — En tant que lifteur, je veux voir la liste des exercices de la
  séance sélectionnée et pouvoir y revenir à tout moment, afin de naviguer
  librement entre mes exercices pendant l'entraînement.
- GL-17 — En tant que lifteur, je veux un menu du haut toujours visible avec
  un accès direct à mes séances, afin de ne jamais me sentir bloqué dans
  l'app, même en pleine saisie.
- GL-18 — En tant que lifteur, je veux un dashboard général avec le volume
  hebdomadaire global et les alertes de stagnation, afin d'avoir une vue
  d'ensemble de ma progression dès l'ouverture de l'app.
- GL-19 — En tant que lifteur, je veux pouvoir renommer ma séance et
  ajouter/retirer des exercices après coup, afin de garder la possibilité
  d'ajuster ma structure même si c'est rare.

## Guidage pré-série

- GL-01 — En tant que lifteur, je veux voir le poids et les reps de ma dernière
  séance affichés en fantôme avant de commencer une série, afin de savoir
  exactement quoi battre sans calcul mental.
- GL-02 — En tant que lifteur, je veux une cible suggérée (ex. +1 rep ou
  +2,5 kg) par rapport au fantôme, afin d'avoir un objectif concret plutôt
  qu'un historique à interpréter.

## Logging instantané

- GL-03 — En tant que lifteur, je veux logger une série en au maximum deux
  interactions, afin que l'app ne casse jamais mon rythme de repos pendant la
  séance.
- GL-04 — En tant que lifteur, je veux que le poids et les reps soient
  pré-remplis avec ma dernière série sur cet exercice, afin de n'avoir qu'à
  ajuster plutôt que tout ressaisir.

## Détection de stagnation

- GL-05 — En tant que lifteur, je veux être alerté quand je répète le même
  poids et les mêmes reps sur un exercice plusieurs séances d'affilée, afin de
  repérer un plateau avant qu'il ne coûte des semaines.
- GL-06 — En tant que lifteur, je veux que cette alerte soit distincte de la
  baisse de volume hebdomadaire déjà existante, afin de distinguer une
  mauvaise semaine d'un vrai plateau sur un exercice précis.

## Records personnels (PR)

- GL-07 — En tant que lifteur, je veux qu'un nouveau record de poids ou de
  volume soit détecté et mis en avant automatiquement, afin que mon effort
  soit récompensé sans que j'aie à comparer moi-même.
- GL-08 — En tant que lifteur, je veux consulter l'historique de mes records
  par exercice, afin de mesurer le chemin parcouru sur le temps long.

## Minuteur de repos

- GL-09 — En tant que lifteur, je veux qu'un chrono de repos démarre
  automatiquement dès qu'une série est loggée, afin de ne pas dépendre d'une
  application de chrono séparée.
- GL-10 — En tant que lifteur, je veux pouvoir ajuster la durée de repos par
  défaut, afin qu'elle corresponde à l'exercice et à l'intensité du jour.

## Graphique partageable

- GL-11 — En tant que lifteur, je veux un graphique de progression assez
  lisible et soigné pour être montré sans explication, afin qu'un simple coup
  d'œil impressionne par lui-même.
- GL-12 — En tant que lifteur, je veux pouvoir capturer ce graphique en un
  geste, afin que le partager en soirée ne demande aucune friction.

## Add Vue Router and Pinia exercise state

- As a lifter, I want to move between exercises with previous and next navigation so I can track a full workout without typing URLs.
- As a lifter, I want to create a new exercise from the app so I can expand my workout beyond the default bench press exercise.
- As a lifter, I want newly created exercises to be shared across routes so I can open them immediately after creation.
- As a lifter, I want added and removed sets to update shared exercise state so each exercise route reflects the current workout data.
- As a developer, I want exercises stored in Pinia instead of static data so routing, creation, and future persistence can use one source of truth.

## Generalize exercise tracker component

- As a lifter, I want the same tracker to work for any exercise so I can track bench press, squat, deadlift, or future movements consistently.
- As a lifter, I want each exercise to provide its own name, default reps, default weight, unit, and dataset so the tracker adapts to the selected exercise.
- As a developer, I want exercise data separated from the tracker component so future Vue Router views can reuse the same tracker with different exercise datasets.
- As a developer, I want the bench press data moved out of the generic tracker so the component is no longer coupled to one exercise.

## Refine Ghost Lift visual theme

- As a lifter, I want the app colors to match the Ghost Lift identity so the experience feels cohesive and recognizable.
- As a lifter, I want the previous session ghost overlay to stand out clearly so I can compare it against the current session at a glance.
- As a developer, I want the session diff extracted into its own component so the tracker stays focused on workout state and the comparison UI is easier to maintain.
- As a lifter, I want weekly volume drops to remain visually distinct in the dark theme so regressions stay easy to spot.

## Improve session progression visuals

- As a lifter, I want to compare my latest bench session against the previous one as an overlay so I can immediately see where the new session beat or missed the last one.
- As a lifter, I want the previous session to appear as a ghost behind the current session so heavier weight with lower reps or volume is visible without explanatory text.
- As a lifter, I want weekly volume drops to render in red so regressions stand out in the progression chart.
