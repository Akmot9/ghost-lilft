import type { Exercise, Seance } from '../stores/seances'

/**
 * Jeux de données de test, jamais livrés dans l'app : ils ne sont chargés que
 * par les tests unitaires et par les tests e2e (via `window.__GHOST_LIFT_FIXTURE__`,
 * sous garde `import.meta.env.DEV`).
 *
 * Ils sont paramétrés par « maintenant » plutôt que datés en dur : un jeu de
 * données à dates absolues vieillit et finit par sortir des fenêtres
 * hebdomadaires calculées par `trainingInsights` — c'est déjà le cas de
 * `bench-press.json`, semé en 2025.
 *
 * Convention : l'exercice qu'illustre un scénario est **le premier de sa
 * première séance**. Les tests s'appuient dessus.
 */
export type Scenario = (now: Date) => Seance[]

export type ScenarioName = 'stagnation' | 'progression' | 'record' | 'debutant' | 'pyramide'

type SetDraft = {
  /** Nombre de jours avant « maintenant ». Jamais 0 : une série est passée. */
  daysAgo: number
  reps: number
  weight: number
}

type ExerciseDraft = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  restSeconds: number
  sets: SetDraft[]
}

const DAY_MS = 24 * 60 * 60 * 1000

// Heure fixée en UTC : `groupIntoSessions` regroupe les séries par jour UTC,
// une heure locale ferait basculer un set d'un jour à l'autre selon le fuseau
// de la machine qui exécute les tests.
function completedAt(now: Date, daysAgo: number, minute: number): Date {
  const date = new Date(now.getTime() - daysAgo * DAY_MS)
  date.setUTCHours(18, minute, 0, 0)

  return date
}

function buildExercise(draft: ExerciseDraft, now: Date): Exercise {
  return {
    slug: draft.slug,
    name: draft.name,
    defaultReps: draft.defaultReps,
    defaultWeight: draft.defaultWeight,
    weightUnit: 'kg',
    restSeconds: draft.restSeconds,
    sets: draft.sets.map((set, index) => ({
      id: index + 1,
      reps: set.reps,
      weight: set.weight,
      // 10 minutes entre deux séries : l'ordre à l'intérieur d'une séance suit
      // l'ordre de déclaration, ce dont dépend le fantôme positionnel.
      completedAt: completedAt(now, set.daysAgo, index * 10),
    })),
  }
}

function buildSeance(
  slug: string,
  name: string,
  exercises: ExerciseDraft[],
  now: Date,
): Seance {
  return {
    slug,
    name,
    // Un scénario n'est pas le mode découverte : pas de bannière d'adoption
    // par-dessus les écrans testés.
    isDemo: false,
    exercises: exercises.map((exercise) => buildExercise(exercise, now)),
  }
}

/**
 * Deux dernières séances rigoureusement identiques (même charge max, même
 * total de répétitions) : `isExerciseStagnant` s'allume et le dashboard
 * remonte l'alerte. Le second exercice progresse, pour vérifier que l'alerte
 * cible bien un exercice et pas la séance entière.
 */
const stagnation: Scenario = (now) => [
  buildSeance(
    'upper-a',
    'Upper A',
    [
      {
        slug: 'developpe-couche',
        name: 'Développé couché',
        defaultReps: 8,
        defaultWeight: 70,
        restSeconds: 120,
        sets: [
          { daysAgo: 21, reps: 10, weight: 60 },
          { daysAgo: 21, reps: 8, weight: 62 },
          { daysAgo: 21, reps: 6, weight: 65 },
          { daysAgo: 14, reps: 8, weight: 70 },
          { daysAgo: 14, reps: 8, weight: 70 },
          { daysAgo: 14, reps: 6, weight: 75 },
          { daysAgo: 7, reps: 8, weight: 70 },
          { daysAgo: 7, reps: 8, weight: 70 },
          { daysAgo: 7, reps: 6, weight: 75 },
        ],
      },
      {
        slug: 'rowing-barre',
        name: 'Rowing barre',
        defaultReps: 10,
        defaultWeight: 50,
        restSeconds: 90,
        sets: [
          { daysAgo: 14, reps: 10, weight: 45 },
          { daysAgo: 14, reps: 10, weight: 45 },
          { daysAgo: 7, reps: 10, weight: 50 },
          { daysAgo: 7, reps: 10, weight: 50 },
        ],
      },
    ],
    now,
  ),
]

/**
 * Charge croissante d'une semaine à l'autre à répétitions constantes : aucune
 * alerte de stagnation, et une tendance de volume hebdomadaire qui monte.
 */
const progression: Scenario = (now) => [
  buildSeance(
    'lower',
    'Lower',
    [
      {
        slug: 'high-bar-squat',
        name: 'High bar squat',
        defaultReps: 8,
        defaultWeight: 70,
        restSeconds: 120,
        sets: [
          { daysAgo: 21, reps: 8, weight: 60 },
          { daysAgo: 21, reps: 8, weight: 60 },
          { daysAgo: 21, reps: 8, weight: 60 },
          { daysAgo: 14, reps: 8, weight: 65 },
          { daysAgo: 14, reps: 8, weight: 65 },
          { daysAgo: 14, reps: 8, weight: 65 },
          { daysAgo: 7, reps: 8, weight: 70 },
          { daysAgo: 7, reps: 8, weight: 70 },
          { daysAgo: 7, reps: 8, weight: 70 },
        ],
      },
    ],
    now,
  ),
]

/**
 * Historique plafonné à 60 kg : la première série un peu plus lourde loggée
 * par un test bat tout l'historique et déclenche le badge record.
 */
const record: Scenario = (now) => [
  buildSeance(
    'upper-b',
    'Upper B',
    [
      {
        slug: 'overhead-press',
        name: 'Overhead press',
        defaultReps: 5,
        defaultWeight: 60,
        restSeconds: 150,
        sets: [
          { daysAgo: 14, reps: 8, weight: 50 },
          { daysAgo: 14, reps: 6, weight: 55 },
          { daysAgo: 14, reps: 5, weight: 60 },
          { daysAgo: 7, reps: 10, weight: 52 },
          { daysAgo: 7, reps: 6, weight: 56 },
          { daysAgo: 7, reps: 5, weight: 60 },
        ],
      },
    ],
    now,
  ),
]

/**
 * Séance créée mais jamais loggée : pas de fantôme, pas de cible suggérée
 * (retour aux valeurs par défaut), écrans dans leur état vide.
 */
const debutant: Scenario = (now) => [
  buildSeance(
    'ma-seance',
    'Ma séance',
    [
      {
        slug: 'developpe-couche',
        name: 'Développé couché',
        defaultReps: 8,
        defaultWeight: 40,
        restSeconds: 120,
        sets: [],
      },
      {
        slug: 'tractions',
        name: 'Tractions',
        defaultReps: 6,
        defaultWeight: 0,
        restSeconds: 90,
        sets: [],
      },
    ],
    now,
  ),
]

/**
 * Schéma pyramidal : trois séries à trois charges distinctes. Le fantôme est
 * positionnel, la N-ième série du jour se compare à la N-ième de la séance de
 * référence — un scénario où « dernière série + 1 rep » donnerait faux.
 */
const pyramide: Scenario = (now) => [
  buildSeance(
    'upper-a',
    'Upper A',
    [
      {
        slug: 'developpe-couche',
        name: 'Développé couché',
        defaultReps: 12,
        defaultWeight: 50,
        restSeconds: 120,
        sets: [
          { daysAgo: 14, reps: 12, weight: 45 },
          { daysAgo: 14, reps: 8, weight: 55 },
          { daysAgo: 14, reps: 6, weight: 65 },
          { daysAgo: 7, reps: 12, weight: 50 },
          { daysAgo: 7, reps: 8, weight: 60 },
          { daysAgo: 7, reps: 6, weight: 70 },
        ],
      },
    ],
    now,
  ),
]

export const scenarios: Record<ScenarioName, Scenario> = {
  stagnation,
  progression,
  record,
  debutant,
  pyramide,
}
