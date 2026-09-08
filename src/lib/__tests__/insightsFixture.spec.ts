import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildDashboardSnapshot,
  buildExerciseSnapshot,
  buildSeanceSnapshot,
  type SeanceInput,
} from '../insightsBrowser'
import { compareSetToGhost, type ExerciseSet } from '../trainingInsights'

/**
 * Le fichier de référence partagé avec Rust (#71) : chaque cas décrit un
 * historique et l'instantané **complet** que l'adaptateur navigateur
 * (`insightsBrowser.ts`) en tire — le JSON même qui voyagerait sur le fil.
 * `src-tauri/src/insights.rs` relit le même fichier et doit sérialiser, champ
 * pour champ, le même JSON.
 *
 * C'est ce qui rend la copie TypeScript honnête : une règle qui diverge d'un
 * côté fait tomber un test de l'autre, au lieu de donner au mode navigateur
 * une autre lecture de la progression que celle de l'app.
 *
 * Ce test **écrit** le fichier puis vérifie qu'il n'a pas changé : régénérer se
 * fait en supprimant `fixtures/insights-cases.json` et en relançant.
 */
const FIXTURE_PATH = resolve(process.cwd(), 'fixtures/insights-cases.json')

type SetInput = {
  id: number
  reps: number
  weight: number
  completedAt: string
  isWarmup: boolean
  rpe: number | null
  isDeload: boolean
}

type ExerciseCase = {
  name: string
  today: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  restSeconds: number
  isDumbbell: boolean
  sets: SetInput[]
}

type SeanceExerciseInput = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  restSeconds: number
  isDumbbell: boolean
  sets: SetInput[]
}

type SeanceCase = {
  name: string
  today: string
  seance: { slug: string; name: string; exercises: SeanceExerciseInput[] }
}

type DashboardCase = {
  name: string
  today: string
  seances: Array<{ slug: string; name: string; exercises: SeanceExerciseInput[] }>
}

const day = (date: string, hour = 18, minute = 0, second = 0) =>
  `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`

function set(
  id: number,
  reps: number,
  weight: number,
  completedAt: string,
  extra: Partial<SetInput> = {},
): SetInput {
  return { id, reps, weight, completedAt, isWarmup: false, rpe: null, isDeload: false, ...extra }
}

function exercise(
  slug: string,
  name: string,
  sets: SetInput[],
  extra: Partial<SeanceExerciseInput> = {},
): SeanceExerciseInput {
  return {
    slug,
    name,
    defaultReps: 8,
    defaultWeight: 60,
    weightUnit: 'kg',
    restSeconds: 180,
    isDumbbell: false,
    sets,
    ...extra,
  }
}

const exerciseCases: ExerciseCase[] = [
  {
    name: 'exercice vierge : ni fantôme ni cible, le défaut du programme',
    today: '2026-04-27',
    defaultReps: 5,
    defaultWeight: 60,
    weightUnit: 'kg',
    restSeconds: 180,
    isDumbbell: false,
    sets: [],
  },
  {
    name: 'pyramide : la N-ième se mesure à la N-ième, le repos s’allonge avant le sommet',
    today: '2026-04-27',
    defaultReps: 5,
    defaultWeight: 60,
    weightUnit: 'kg',
    restSeconds: 120,
    isDumbbell: false,
    sets: [
      set(1, 8, 60, day('2026-04-20', 18, 0)),
      set(2, 8, 70, day('2026-04-20', 18, 4)),
      set(3, 6, 80, day('2026-04-20', 18, 9)),
      set(4, 8, 62, day('2026-04-27', 18, 0), { rpe: 8 }),
    ],
  },
  {
    name: 'décharge : le fantôme remonte à la séance qui n’en était pas une',
    today: '2026-08-31',
    defaultReps: 8,
    defaultWeight: 20,
    weightUnit: 'kg',
    restSeconds: 180,
    isDumbbell: false,
    sets: [
      set(1, 8, 35, day('2026-08-17')),
      set(2, 12, 5, day('2026-08-23'), { isDeload: true }),
    ],
  },
  {
    name: 'stagnation : deux séances identiques d’affilée',
    today: '2026-04-28',
    defaultReps: 6,
    defaultWeight: 86,
    weightUnit: 'kg',
    restSeconds: 180,
    isDumbbell: false,
    sets: [set(1, 6, 86, day('2026-04-20')), set(2, 6, 86, day('2026-04-27'))],
  },
  {
    name: 'records : l’échauffement et la décharge n’en sont pas',
    today: '2026-02-02',
    defaultReps: 5,
    defaultWeight: 60,
    weightUnit: 'kg',
    restSeconds: 180,
    isDumbbell: false,
    sets: [
      set(1, 5, 60, day('2026-01-05')),
      set(2, 5, 90, day('2026-01-12'), { isWarmup: true }),
      set(3, 5, 95, day('2026-01-19'), { isDeload: true }),
      set(4, 5, 65, day('2026-01-26')),
    ],
  },
  {
    name: 'record à cible de répétitions : la même charge tenue plus longtemps',
    today: '2026-04-27',
    defaultReps: 6,
    defaultWeight: 80,
    weightUnit: 'kg',
    restSeconds: 180,
    isDumbbell: false,
    sets: [set(1, 6, 80, day('2026-04-20')), set(2, 8, 80, day('2026-04-27'))],
  },
  {
    name: 'repos pris : médiane, hors échauffement et hors interruption, à la seconde',
    today: '2026-04-28',
    defaultReps: 8,
    defaultWeight: 60,
    weightUnit: 'kg',
    restSeconds: 180,
    isDumbbell: false,
    sets: [
      set(1, 8, 40, day('2026-04-27', 17, 50), { isWarmup: true }),
      set(2, 8, 60, day('2026-04-27', 18, 0)),
      set(3, 8, 60, day('2026-04-27', 18, 3, 1)),
      set(4, 8, 60, day('2026-04-27', 18, 8)),
      set(5, 8, 60, day('2026-04-27', 18, 40)),
    ],
  },
  {
    name: 'séance du jour en cours : le fantôme est celle d’avant',
    today: '2026-04-27',
    defaultReps: 8,
    defaultWeight: 60,
    weightUnit: 'kg',
    restSeconds: 180,
    isDumbbell: false,
    sets: [
      set(1, 8, 60, day('2026-04-20', 18, 0)),
      set(2, 8, 65, day('2026-04-20', 18, 5)),
      set(3, 8, 62, day('2026-04-27', 18, 0)),
    ],
  },
  {
    name: 'haltères : la rampe démarre à mi-charge, arrondie au kilo',
    today: '2026-04-27',
    defaultReps: 10,
    defaultWeight: 36,
    weightUnit: 'kg',
    restSeconds: 90,
    isDumbbell: true,
    sets: [],
  },
  {
    name: 'reprise : trois semaines sans l’exercice, −10 % au demi-kilo',
    today: '2026-04-27',
    defaultReps: 5,
    defaultWeight: 60,
    weightUnit: 'kg',
    restSeconds: 180,
    isDumbbell: false,
    sets: [set(1, 5, 102.5, day('2026-04-06')), set(2, 3, 105, day('2026-04-06', 18, 4))],
  },
  {
    name: 'semaines : les journées se rangent sous leur lundi UTC, échauffement à part',
    today: '2027-01-04',
    defaultReps: 8,
    defaultWeight: 60,
    weightUnit: 'kg',
    restSeconds: 180,
    isDumbbell: false,
    sets: [
      set(1, 8, 50, day('2026-12-27', 23, 30)),
      set(2, 6, 20, day('2026-12-28', 0, 10), { isWarmup: true }),
      set(3, 8, 52, day('2026-12-28', 0, 20)),
      set(4, 8, 54, day('2026-12-30', 18, 0)),
      set(5, 6, 20, day('2027-01-03', 17, 50), { isWarmup: true }),
      set(6, 8, 56, day('2027-01-03', 18, 0)),
    ],
  },
]

const seanceCases: SeanceCase[] = [
  {
    name: 'séance : journée par journée, la dernière face à la précédente, un exercice sauté vaut zéro',
    today: '2026-04-28',
    seance: {
      slug: 'lower',
      name: 'Lower',
      exercises: [
        exercise(
          'squat',
          'Squat',
          [
            set(1, 5, 100, day('2026-04-20')),
            set(2, 5, 100, day('2026-04-20', 18, 5)),
            set(3, 5, 105, day('2026-04-27')),
            set(4, 5, 105, day('2026-04-27', 18, 5)),
          ],
          { restSeconds: 120 },
        ),
        exercise('presse', 'Presse', [set(5, 10, 150, day('2026-04-20', 18, 20))]),
        exercise('curl', 'Curl', [set(6, 10, 30, day('2026-04-20', 18, 30))], { weightUnit: 'lb' }),
        exercise('mollets', 'Mollets', [set(7, 12, 60, day('2026-04-20', 17, 55), { isWarmup: true })]),
      ],
    },
  },
  {
    name: 'séance vierge : rien à comparer',
    today: '2026-04-28',
    seance: {
      slug: 'upper',
      name: 'Upper',
      exercises: [exercise('developpe', 'Développé', [])],
    },
  },
  {
    name: 'séance : l’unité dominante départage, la première la plus fréquente gagne',
    today: '2026-04-28',
    seance: {
      slug: 'arms',
      name: 'Arms',
      exercises: [
        exercise('curl', 'Curl', [set(1, 10, 30, day('2026-04-20'))], { weightUnit: 'lb' }),
        exercise('extension', 'Extension', [set(2, 10, 20, day('2026-04-20', 18, 10))]),
      ],
    },
  },
]

const dashboardCases: DashboardCase[] = [
  {
    name: 'dashboard : stagnation, fenêtre de trente journées UTC, volume par semaine',
    today: '2026-04-28',
    seances: [
      {
        slug: 'upper-a',
        name: 'Upper A',
        exercises: [
          exercise('developpe', 'Développé', [
            set(1, 6, 86, day('2026-04-13')),
            set(2, 6, 86, day('2026-04-20')),
          ]),
          exercise('rowing', 'Rowing', [
            set(3, 8, 60, day('2026-03-29', 18, 0)),
            set(4, 8, 62, day('2026-04-06', 18, 0)),
            set(5, 8, 40, day('2026-04-06', 17, 50), { isWarmup: true }),
          ]),
        ],
      },
      {
        slug: 'lower',
        name: 'Lower',
        exercises: [exercise('squat', 'Squat', [set(6, 5, 100, day('2026-04-21', 7, 0))])],
      },
    ],
  },
  {
    name: 'dashboard vide',
    today: '2026-04-28',
    seances: [],
  },
]

function toSets(sets: SetInput[]): ExerciseSet[] {
  return sets.map((set) => ({ ...set, completedAt: new Date(set.completedAt) }))
}

function toSeance(seance: SeanceCase['seance']): SeanceInput {
  return {
    slug: seance.slug,
    name: seance.name,
    exercises: seance.exercises.map((exercise) => ({ ...exercise, sets: toSets(exercise.sets) })),
  }
}

function exerciseSnapshot(entry: ExerciseCase) {
  const snapshot = buildExerciseSnapshot({ ...entry, sets: toSets(entry.sets) }, entry.today)
  const [first] = entry.sets

  return {
    ...entry,
    snapshot,
    // Le verdict reste calculé dans Vue (#71) : la fixture le verrouille aussi,
    // sur la première série du cas face au fantôme.
    verdictAgainstGhost:
      snapshot.ghost && first
        ? compareSetToGhost(
            { reps: first.reps, weight: first.weight },
            { reps: snapshot.ghost.set.reps, weight: snapshot.ghost.set.weight },
          )
        : null,
  }
}

describe('fixture partagée des règles d’entraînement', () => {
  it('décrit ce que l’adaptateur navigateur rend, pour que Rust le reproduise', () => {
    const produced = `${JSON.stringify(
      {
        exercises: exerciseCases.map(exerciseSnapshot),
        seances: seanceCases.map((entry) => ({
          ...entry,
          snapshot: buildSeanceSnapshot(toSeance(entry.seance)),
        })),
        dashboards: dashboardCases.map((entry) => ({
          ...entry,
          snapshot: buildDashboardSnapshot(entry.seances.map(toSeance), entry.today),
        })),
      },
      null,
      2,
    )}\n`

    let stored: string | null = null

    try {
      stored = readFileSync(FIXTURE_PATH, 'utf8')
    } catch {
      writeFileSync(FIXTURE_PATH, produced)
      stored = produced
    }

    // Le fichier est l'artefact partagé : le modifier sans le vouloir ferait
    // diverger Rust en silence.
    expect(produced).toBe(stored)
  })
})
