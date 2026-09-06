import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  compareSetToGhost,
  getMedianRestTaken,
  getPositionalGhost,
  getRecordHistory,
  getSuggestedTarget,
  groupIntoSessions,
  isExerciseStagnant,
  suggestWarmupRamp,
  type ExerciseSet,
} from '../trainingInsights'

/**
 * Le fichier de référence partagé avec Rust (#71) : chaque cas décrit un
 * historique et ce que les règles TypeScript en tirent. `src-tauri/src/insights.rs`
 * relit le même fichier et doit rendre exactement ces valeurs.
 *
 * C'est ce qui rend la migration falsifiable : une règle qui diverge d'un côté
 * fait tomber un test de l'autre, au lieu de donner deux lectures différentes
 * de la même progression selon l'écran.
 *
 * Ce test **écrit** le fichier puis vérifie qu'il n'a pas changé : régénérer se
 * fait en supprimant `fixtures/insights-cases.json` et en relançant.
 */
const FIXTURE_PATH = resolve(process.cwd(), 'fixtures/insights-cases.json')

type Case = {
  name: string
  today: string
  fallback: { weight: number; reps: number }
  isDumbbell: boolean
  weightUnit: string
  sets: Array<{
    id: number
    reps: number
    weight: number
    completedAt: string
    isWarmup: boolean
    rpe: number | null
    isDeload: boolean
  }>
}

const day = (date: string, hour = 18, minute = 0) =>
  `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`

function set(
  id: number,
  reps: number,
  weight: number,
  completedAt: string,
  extra: Partial<Case['sets'][number]> = {},
): Case['sets'][number] {
  return { id, reps, weight, completedAt, isWarmup: false, rpe: null, isDeload: false, ...extra }
}

const cases: Case[] = [
  {
    name: 'exercice vierge : ni fantôme ni cible, le défaut du programme',
    today: '2026-04-27',
    fallback: { weight: 60, reps: 5 },
    isDumbbell: false,
    weightUnit: 'kg',
    sets: [],
  },
  {
    name: 'pyramide : la N-ième se mesure à la N-ième',
    today: '2026-04-27',
    fallback: { weight: 60, reps: 5 },
    isDumbbell: false,
    weightUnit: 'kg',
    sets: [
      set(1, 8, 60, day('2026-04-20', 18, 0)),
      set(2, 8, 70, day('2026-04-20', 18, 4)),
      set(3, 6, 80, day('2026-04-20', 18, 9)),
    ],
  },
  {
    name: 'décharge : le fantôme remonte à la séance qui n’en était pas une',
    today: '2026-08-31',
    fallback: { weight: 20, reps: 8 },
    isDumbbell: false,
    weightUnit: 'kg',
    sets: [
      set(1, 8, 35, day('2026-08-17')),
      set(2, 12, 5, day('2026-08-23'), { isDeload: true }),
    ],
  },
  {
    name: 'stagnation : deux séances identiques d’affilée',
    today: '2026-04-28',
    fallback: { weight: 86, reps: 6 },
    isDumbbell: false,
    weightUnit: 'kg',
    sets: [set(1, 6, 86, day('2026-04-20')), set(2, 6, 86, day('2026-04-27'))],
  },
  {
    name: 'records : l’échauffement et la décharge n’en sont pas',
    today: '2026-02-02',
    fallback: { weight: 60, reps: 5 },
    isDumbbell: false,
    weightUnit: 'kg',
    sets: [
      set(1, 5, 60, day('2026-01-05')),
      set(2, 5, 90, day('2026-01-12'), { isWarmup: true }),
      set(3, 5, 95, day('2026-01-19'), { isDeload: true }),
      set(4, 5, 65, day('2026-01-26')),
    ],
  },
  {
    name: 'repos pris : médiane, hors échauffement et hors interruption',
    today: '2026-04-28',
    fallback: { weight: 60, reps: 8 },
    isDumbbell: false,
    weightUnit: 'kg',
    sets: [
      set(1, 8, 40, day('2026-04-27', 17, 50), { isWarmup: true }),
      set(2, 8, 60, day('2026-04-27', 18, 0)),
      set(3, 8, 60, day('2026-04-27', 18, 3)),
      set(4, 8, 60, day('2026-04-27', 18, 8)),
      set(5, 8, 60, day('2026-04-27', 18, 40)),
    ],
  },
  {
    name: 'séance du jour en cours : le fantôme est celle d’avant',
    today: '2026-04-27',
    fallback: { weight: 60, reps: 8 },
    isDumbbell: false,
    weightUnit: 'kg',
    sets: [
      set(1, 8, 60, day('2026-04-20', 18, 0)),
      set(2, 8, 65, day('2026-04-20', 18, 5)),
      set(3, 8, 62, day('2026-04-27', 18, 0)),
    ],
  },
  {
    name: 'haltères : la rampe démarre à mi-charge, arrondie au kilo',
    today: '2026-04-27',
    fallback: { weight: 36, reps: 10 },
    isDumbbell: true,
    weightUnit: 'kg',
    sets: [],
  },
]

function toSets(entry: Case): ExerciseSet[] {
  return entry.sets.map((set) => ({ ...set, completedAt: new Date(set.completedAt) }))
}

/** Ce que Rust rend d'un seul appel — composé ici depuis les règles existantes. */
function snapshot(entry: Case) {
  const sets = toSets(entry)
  const sessions = groupIntoSessions(sets)
  const ghost = getPositionalGhost(sets, new Date(`${entry.today}T12:00:00.000Z`), sessions)
  const target = getSuggestedTarget(sets, entry.fallback, ghost)

  return {
    sessions: sessions.map((session) => ({
      key: session.key,
      sets: session.sets.map((set) => set.id),
      reps: session.reps,
      volume: session.volume,
      heaviest: session.heaviest,
      isDeload: session.isDeload,
    })),
    ghost: ghost && {
      setId: ghost.set.id,
      position: ghost.position,
      sessionKey: ghost.sessionDate.toISOString().slice(0, 10),
    },
    target,
    isStagnant: isExerciseStagnant(sets, sessions),
    records: getRecordHistory(sets).map((record) => record.id),
    medianRestTaken: getMedianRestTaken(sets, sessions),
    warmupRamp: suggestWarmupRamp(
      { weight: target.weight },
      { isDumbbell: entry.isDumbbell, weightUnit: entry.weightUnit },
    ),
    verdictAgainstGhost:
      ghost && entry.sets.length > 0
        ? compareSetToGhost(
            { reps: entry.sets[0]!.reps, weight: entry.sets[0]!.weight },
            { reps: ghost.set.reps, weight: ghost.set.weight },
          )
        : null,
  }
}

describe('fixture partagée des règles d’entraînement', () => {
  it('décrit ce que les règles TypeScript rendent, pour que Rust le reproduise', () => {
    const produced = `${JSON.stringify(
      cases.map((entry) => ({ ...entry, snapshot: snapshot(entry) })),
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
