import { describe, it, expect } from 'vitest'
import {
  groupIntoSessions,
  getPositionalGhost,
  getSuggestedTarget,
  getMostRecentSet,
  getWeekKey,
  isExerciseStagnant,
  isNewRecord,
  suggestWarmupRamp,
  getMedianRestTaken,
  restAfterSet,
  getRecordHistory,
  estimateOneRepMax,
  getBestEstimatedOneRepMax,
  isNewRecordForReps,
  daysSinceLastSession,
  suggestReturnLoad,
} from '../insightsBrowser'
import { makeSet } from './testFactories'
import type { ExerciseSet } from '../trainingInsights'

// L'adaptateur navigateur (#71) : la référence est Rust, et
// `insightsFixture.spec.ts` tient les deux d'accord. Ces tests disent ce que
// chaque règle fait, à hauteur d'un cas — le fichier partagé fait le reste.

describe('groupIntoSessions', () => {
  it('returns an empty array for no sets', () => {
    expect(groupIntoSessions([])).toEqual([])
  })

  it('groups sets from the same calendar day into one session', () => {
    const sets = [
      makeSet({ id: 1, reps: 10, weight: 60, completedAt: new Date('2026-01-05T18:20:00.000Z') }),
      makeSet({ id: 2, reps: 8, weight: 65, completedAt: new Date('2026-01-05T18:30:00.000Z') }),
    ]

    const sessions = groupIntoSessions(sets)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.sets).toHaveLength(2)
  })

  it('splits sets from different calendar days into separate sessions, newest first', () => {
    const sets = [
      makeSet({ id: 1, completedAt: new Date('2026-01-05T18:00:00.000Z') }),
      makeSet({ id: 2, completedAt: new Date('2026-01-12T18:00:00.000Z') }),
    ]

    const sessions = groupIntoSessions(sets)

    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.key).toBe('2026-01-12')
    expect(sessions[1]?.key).toBe('2026-01-05')
  })

  it('computes reps, volume and heaviest per session', () => {
    const sets = [
      makeSet({ id: 1, reps: 10, weight: 60, completedAt: new Date('2026-01-05T18:20:00.000Z') }),
      makeSet({ id: 2, reps: 8, weight: 65, completedAt: new Date('2026-01-05T18:30:00.000Z') }),
      makeSet({ id: 3, reps: 6, weight: 70, completedAt: new Date('2026-01-05T18:40:00.000Z') }),
    ]

    const [session] = groupIntoSessions(sets)

    expect(session?.reps).toBe(24)
    expect(session?.volume).toBe(10 * 60 + 8 * 65 + 6 * 70)
    expect(session?.heaviest).toBe(70)
  })

  it('keeps warm-up ramps out of the working session totals', () => {
    // Cas réel du JSON exporté : trois montées, puis la pyramide S1/S2/S3.
    const sets = [
      makeSet({ id: 1, reps: 6, weight: 48, completedAt: new Date('2026-08-17T18:00:00Z'), isWarmup: true }),
      makeSet({ id: 2, reps: 7, weight: 56, completedAt: new Date('2026-08-17T18:03:00Z'), isWarmup: true }),
      makeSet({ id: 3, reps: 6, weight: 64, completedAt: new Date('2026-08-17T18:06:00Z'), isWarmup: true }),
      makeSet({ id: 4, reps: 6, weight: 84, completedAt: new Date('2026-08-17T18:09:00Z') }),
      makeSet({ id: 5, reps: 8, weight: 76, completedAt: new Date('2026-08-17T18:12:00Z') }),
      makeSet({ id: 6, reps: 12, weight: 68, completedAt: new Date('2026-08-17T18:15:00Z') }),
    ]

    const [session] = groupIntoSessions(sets)

    expect(session?.sets.map((set) => set.weight)).toEqual([68, 76, 84])
    expect(session?.reps).toBe(26)
    expect(session?.volume).toBe(6 * 84 + 8 * 76 + 12 * 68)
    expect(session?.heaviest).toBe(84)
  })
})

describe('getMostRecentSet', () => {
  it('returns null for no sets', () => {
    expect(getMostRecentSet([])).toBeNull()
  })

  it('returns the set with the latest completedAt, regardless of array order', () => {
    const sets = [
      makeSet({ id: 1, completedAt: new Date('2026-01-12T18:00:00.000Z') }),
      makeSet({ id: 2, completedAt: new Date('2026-01-05T18:00:00.000Z') }),
    ]

    expect(getMostRecentSet(sets)?.id).toBe(1)
  })

  it('ignores a newer warm-up set', () => {
    const sets = [
      makeSet({ id: 1, weight: 84, completedAt: new Date('2026-01-05T18:00:00Z') }),
      makeSet({ id: 2, weight: 48, completedAt: new Date('2026-01-12T18:00:00Z'), isWarmup: true }),
    ]

    expect(getMostRecentSet(sets)?.id).toBe(1)
  })
})

describe('getWeekKey', () => {
  it('anchors to the Monday of the same week', () => {
    // Thursday 2026-01-08 -> Monday 2026-01-05
    expect(getWeekKey('2026-01-08')).toBe('2026-01-05')
  })

  it('treats Sunday as the end of the week, not the start', () => {
    // Sunday 2026-01-11 -> still Monday 2026-01-05
    expect(getWeekKey('2026-01-11')).toBe('2026-01-05')
  })

  it('does not move the Monday across a year change', () => {
    expect(getWeekKey('2027-01-01')).toBe('2026-12-28')
  })
})

describe('getPositionalGhost / getSuggestedTarget', () => {
  const today = '2026-01-12'
  const fallback = { weight: 20, reps: 5 }
  const ghostOf = (sets: ExerciseSet[]) => getPositionalGhost(groupIntoSessions(sets), today)
  // Séance pyramidale de la semaine dernière : 6@80 → 8@70 → 12@60.
  const lastWeek = [
    makeSet({ id: 1, reps: 6, weight: 80, completedAt: new Date('2026-01-05T18:00:00.000Z') }),
    makeSet({ id: 2, reps: 8, weight: 70, completedAt: new Date('2026-01-05T18:10:00.000Z') }),
    makeSet({ id: 3, reps: 12, weight: 60, completedAt: new Date('2026-01-05T18:20:00.000Z') }),
  ]

  it('falls back to the exercise defaults when there are no sets yet', () => {
    expect(ghostOf([])).toBeNull()
    expect(getSuggestedTarget(null, fallback)).toEqual(fallback)
  })

  it('has no ghost during the very first session of the exercise', () => {
    const onlyToday = [
      makeSet({ id: 9, reps: 6, weight: 80, completedAt: new Date('2026-01-12T18:00:00.000Z') }),
    ]

    expect(ghostOf(onlyToday)).toBeNull()
    expect(getSuggestedTarget(null, fallback)).toEqual(fallback)
  })

  it('proposes série 1 of the previous session before any set today', () => {
    const ghost = ghostOf(lastWeek)

    expect(ghost).toMatchObject({ position: 1, set: { reps: 6, weight: 80 } })
    expect(getSuggestedTarget(ghost, fallback)).toEqual({ weight: 80, reps: 6 })
  })

  it('advances to the homologous série as sets are logged today (pyramide 6/8/12)', () => {
    const afterFirstSet = [
      ...lastWeek,
      makeSet({ id: 4, reps: 6, weight: 82, completedAt: new Date('2026-01-12T18:00:00.000Z') }),
    ]

    const ghost = ghostOf(afterFirstSet)

    expect(ghost).toMatchObject({ position: 2, set: { reps: 8, weight: 70 } })
    expect(getSuggestedTarget(ghost, fallback)).toEqual({ weight: 70, reps: 8 })
  })

  it('stays on the last série of the reference session beyond its length', () => {
    const afterFourSets = [
      ...lastWeek,
      makeSet({ id: 4, reps: 6, weight: 82, completedAt: new Date('2026-01-12T18:00:00.000Z') }),
      makeSet({ id: 5, reps: 8, weight: 72, completedAt: new Date('2026-01-12T18:05:00.000Z') }),
      makeSet({ id: 6, reps: 12, weight: 62, completedAt: new Date('2026-01-12T18:10:00.000Z') }),
      makeSet({ id: 7, reps: 15, weight: 50, completedAt: new Date('2026-01-12T18:15:00.000Z') }),
    ]

    const ghost = ghostOf(afterFourSets)

    expect(ghost).toMatchObject({ position: 3, set: { reps: 12, weight: 60 } })
  })

  it('does not advance S1 when warm-up sets are logged today', () => {
    const withWarmupsToday = [
      ...lastWeek,
      makeSet({
        id: 10,
        reps: 6,
        weight: 48,
        completedAt: new Date('2026-01-12T18:00:00.000Z'),
        isWarmup: true,
      }),
      makeSet({
        id: 11,
        reps: 5,
        weight: 60,
        completedAt: new Date('2026-01-12T18:05:00.000Z'),
        isWarmup: true,
      }),
    ]

    expect(ghostOf(withWarmupsToday)).toMatchObject({
      position: 1,
      set: { reps: 6, weight: 80 },
    })
  })
})

describe('isExerciseStagnant', () => {
  it('is false with fewer than two sessions', () => {
    const sets = [makeSet({ id: 1, completedAt: new Date('2026-01-05T18:00:00.000Z') })]

    expect(isExerciseStagnant(groupIntoSessions(sets))).toBe(false)
  })

  it('is true when the two most recent sessions have identical heaviest weight and total reps', () => {
    const sets = [
      makeSet({ id: 1, reps: 6, weight: 86, completedAt: new Date('2026-04-20T18:20:00.000Z') }),
      makeSet({ id: 2, reps: 6, weight: 86, completedAt: new Date('2026-04-27T18:20:00.000Z') }),
    ]

    expect(isExerciseStagnant(groupIntoSessions(sets))).toBe(true)
  })

  it('is false when reps improved even at the same heaviest weight', () => {
    const sets = [
      makeSet({ id: 1, reps: 10, weight: 82, completedAt: new Date('2026-04-20T18:40:00.000Z') }),
      makeSet({ id: 2, reps: 12, weight: 82, completedAt: new Date('2026-04-27T18:40:00.000Z') }),
    ]

    expect(isExerciseStagnant(groupIntoSessions(sets))).toBe(false)
  })

  it('only compares the two most recent sessions, ignoring older history', () => {
    const sets = [
      makeSet({ id: 1, reps: 6, weight: 70, completedAt: new Date('2026-03-01T18:00:00.000Z') }),
      makeSet({ id: 2, reps: 6, weight: 86, completedAt: new Date('2026-04-20T18:00:00.000Z') }),
      makeSet({ id: 3, reps: 6, weight: 86, completedAt: new Date('2026-04-27T18:00:00.000Z') }),
    ]

    expect(isExerciseStagnant(groupIntoSessions(sets))).toBe(true)
  })
})

describe('isNewRecord', () => {
  it('is false for an unknown set id', () => {
    const sets = [makeSet({ id: 1, weight: 60 })]

    expect(isNewRecord(sets, 999)).toBe(false)
  })

  it('is true when the set is strictly heavier than every other set', () => {
    const sets = [
      makeSet({ id: 1, weight: 60 }),
      makeSet({ id: 2, weight: 65 }),
    ]

    expect(isNewRecord(sets, 2)).toBe(true)
  })

  it('is false when another set is at least as heavy', () => {
    const sets = [
      makeSet({ id: 1, weight: 65 }),
      makeSet({ id: 2, weight: 65 }),
    ]

    expect(isNewRecord(sets, 2)).toBe(false)
  })

  it('is true for the only set recorded so far', () => {
    const sets = [makeSet({ id: 1, weight: 60 })]

    expect(isNewRecord(sets, 1)).toBe(true)
  })

  it('never treats a warm-up as a record and ignores warm-ups when comparing work sets', () => {
    const sets = [
      makeSet({ id: 1, weight: 120, isWarmup: true }),
      makeSet({ id: 2, weight: 100 }),
    ]

    expect(isNewRecord(sets, 1)).toBe(false)
    expect(isNewRecord(sets, 2)).toBe(true)
  })
})

describe('suggestWarmupRamp', () => {
  it('climbs from the empty bar to just under the working weight, reps falling to one', () => {
    expect(suggestWarmupRamp({ weight: 65 })).toEqual([
      { weight: 20, reps: 10 },
      { weight: 32.5, reps: 6 },
      { weight: 45, reps: 3 },
      { weight: 57.5, reps: 1 },
    ])
  })

  it('skips steps that would not climb or would reach the working weight', () => {
    expect(suggestWarmupRamp({ weight: 30 })).toEqual([
      { weight: 20, reps: 10 },
      { weight: 27.5, reps: 1 },
    ])
    expect(suggestWarmupRamp({ weight: 20 })).toEqual([])
  })

  it('starts at half load for dumbbells, rounded to one kilo per dumbbell', () => {
    expect(suggestWarmupRamp({ weight: 36 }, { isDumbbell: true })).toEqual([
      { weight: 18, reps: 6 },
      { weight: 26, reps: 3 },
      { weight: 32, reps: 1 },
    ])
  })
})

describe('getMedianRestTaken', () => {
  const at = (iso: string) => new Date(`2026-01-05T${iso}.000Z`)

  it('returns null when no session holds two working sets', () => {
    expect(getMedianRestTaken([])).toBeNull()
    expect(getMedianRestTaken(groupIntoSessions([makeSet({ id: 1, completedAt: at('18:00:00') })]))).toBeNull()
  })

  it('measures the gap between two consecutive sets of the same session', () => {
    const sets = [
      makeSet({ id: 1, completedAt: at('18:00:00') }),
      makeSet({ id: 2, completedAt: at('18:03:00') }),
    ]

    expect(getMedianRestTaken(groupIntoSessions(sets))).toBe(180)
  })

  it('ignores the gap that spans two sessions', () => {
    const sets = [
      makeSet({ id: 1, completedAt: new Date('2026-01-05T18:00:00.000Z') }),
      makeSet({ id: 2, completedAt: new Date('2026-01-12T18:00:00.000Z') }),
      makeSet({ id: 3, completedAt: new Date('2026-01-12T18:02:00.000Z') }),
    ]

    expect(getMedianRestTaken(groupIntoSessions(sets))).toBe(120)
  })

  it('discards a gap longer than the interruption threshold', () => {
    const sets = [
      makeSet({ id: 1, completedAt: at('18:00:00') }),
      makeSet({ id: 2, completedAt: at('18:02:00') }),
      makeSet({ id: 3, completedAt: at('18:30:00') }),
    ]

    expect(getMedianRestTaken(groupIntoSessions(sets))).toBe(120)
  })

  it('returns the median of the gaps, not their mean', () => {
    const sets = [
      makeSet({ id: 1, completedAt: at('18:00:00') }),
      makeSet({ id: 2, completedAt: at('18:01:00') }),
      makeSet({ id: 3, completedAt: at('18:04:00') }),
      makeSet({ id: 4, completedAt: at('18:13:00') }),
    ]

    expect(getMedianRestTaken(groupIntoSessions(sets))).toBe(180)
  })

  it('rounds the median of the two middle gaps down to the second, like Rust', () => {
    const sets = [
      makeSet({ id: 1, completedAt: at('18:00:00') }),
      makeSet({ id: 2, completedAt: at('18:01:00') }),
      makeSet({ id: 3, completedAt: at('18:03:00') }),
      makeSet({ id: 4, completedAt: at('18:07:00') }),
      makeSet({ id: 5, completedAt: at('18:12:00') }),
    ]

    // Écarts de 60, 120, 240 et 300 s : la médiane tombe entre 120 et 240.
    expect(getMedianRestTaken(groupIntoSessions(sets))).toBe(180)
  })

  it('ignores warmup sets, whose rest is not the working rest', () => {
    const sets = [
      makeSet({ id: 1, isWarmup: true, completedAt: at('18:00:00') }),
      makeSet({ id: 2, isWarmup: true, completedAt: at('18:01:00') }),
      makeSet({ id: 3, completedAt: at('18:02:00') }),
      makeSet({ id: 4, completedAt: at('18:05:00') }),
    ]

    expect(getMedianRestTaken(groupIntoSessions(sets))).toBe(180)
  })
})

describe('restAfterSet', () => {
  // Pyramide montante : 8 × 60, 8 × 70, 6 × 80. La plus lourde est la troisième.
  const pyramid = () =>
    groupIntoSessions([
      makeSet({ id: 1, reps: 8, weight: 60, completedAt: new Date('2026-01-05T18:00:00.000Z') }),
      makeSet({ id: 2, reps: 8, weight: 70, completedAt: new Date('2026-01-05T18:04:00.000Z') }),
      makeSet({ id: 3, reps: 6, weight: 80, completedAt: new Date('2026-01-05T18:08:00.000Z') }),
    ])[0]!

  it('keeps the configured rest when the set to come is not the heaviest', () => {
    expect(restAfterSet(120, 1, pyramid())).toBe(120)
  })

  it('lengthens the rest that precedes the heaviest set of the reference session', () => {
    expect(restAfterSet(120, 2, pyramid())).toBe(150)
  })

  it('keeps the configured rest past the last set of the reference session', () => {
    expect(restAfterSet(120, 3, pyramid())).toBe(120)
  })

  it('keeps the configured rest without a reference session', () => {
    expect(restAfterSet(120, null, null)).toBe(120)
    expect(restAfterSet(120, 1, null)).toBe(120)
  })
})

describe('deload sessions', () => {
  const heavy = (id: number, day: string) =>
    makeSet({ id, reps: 8, weight: 35, completedAt: new Date(`${day}T18:00:00.000Z`) })
  const light = (id: number, day: string) =>
    makeSet({
      id,
      reps: 12,
      weight: 5,
      isDeload: true,
      completedAt: new Date(`${day}T18:00:00.000Z`),
    })

  it('marks a session whose working sets are all deloads', () => {
    const sessions = groupIntoSessions([heavy(1, '2026-01-05'), light(2, '2026-01-12')])

    expect(sessions[0]?.isDeload).toBe(true)
    expect(sessions[1]?.isDeload).toBe(false)
  })

  it('reaches past a deload session for the ghost', () => {
    // 17/08 à 8 × 35, décharge le 23/08 à 12 × 5 : le 31/08 doit viser le 17.
    const sets = [heavy(1, '2026-08-17'), light(2, '2026-08-23')]

    const ghost = getPositionalGhost(groupIntoSessions(sets), '2026-08-31')

    expect(ghost?.set.weight).toBe(35)
  })

  it('falls back to the deload session when nothing else came before it', () => {
    const ghost = getPositionalGhost(groupIntoSessions([light(1, '2026-08-23')]), '2026-08-31')

    expect(ghost?.set.weight).toBe(5)
  })

  it('never calls a deload set a record', () => {
    const sets = [heavy(1, '2026-08-17'), makeSet({ id: 2, weight: 99, isDeload: true })]

    expect(isNewRecord(sets, 2)).toBe(false)
  })

  it('reads stagnation on the sessions that were not deloads', () => {
    const sets = [
      heavy(1, '2026-08-10'),
      heavy(2, '2026-08-17'),
      light(3, '2026-08-23'),
    ]

    expect(isExerciseStagnant(groupIntoSessions(sets))).toBe(true)
  })
})

describe('getRecordHistory', () => {
  const set = (id: number, weight: number, day: string, extra: Partial<ExerciseSet> = {}) =>
    makeSet({ id, weight, reps: 5, completedAt: new Date(`${day}T18:00:00.000Z`), ...extra })

  it('keeps the sets that beat every set before them, oldest first', () => {
    const history = getRecordHistory([
      set(1, 60, '2026-01-05'),
      set(2, 65, '2026-01-12'),
      set(3, 62, '2026-01-19'),
      set(4, 70, '2026-01-26'),
    ])

    expect(history.map((record) => record.weight)).toEqual([60, 65, 70])
  })

  it('does not call an equal load a new record', () => {
    const history = getRecordHistory([set(1, 60, '2026-01-05'), set(2, 60, '2026-01-12')])

    expect(history.map((record) => record.id)).toEqual([1])
  })

  it('ignores warm-ups and deloads, which are never records', () => {
    const history = getRecordHistory([
      set(1, 60, '2026-01-05'),
      set(2, 90, '2026-01-12', { isWarmup: true }),
      set(3, 95, '2026-01-19', { isDeload: true }),
      set(4, 65, '2026-01-26'),
    ])

    expect(history.map((record) => record.weight)).toEqual([60, 65])
  })

  it('has no record to show without sets', () => {
    expect(getRecordHistory([])).toEqual([])
  })
})

describe('estimateOneRepMax', () => {
  it('gives the load itself for a single repetition', () => {
    expect(estimateOneRepMax({ reps: 1, weight: 100 })).toBe(100)
  })

  it('climbs with the repetitions held at the same load (Epley)', () => {
    // 100 × 5 → 100 × (1 + 5/30) ≈ 116,7
    expect(estimateOneRepMax({ reps: 5, weight: 100 })).toBeCloseTo(116.7, 1)
  })

  it('ranks a heavy triple above a light set of twelve', () => {
    const heavy = estimateOneRepMax({ reps: 5, weight: 90 })
    const light = estimateOneRepMax({ reps: 12, weight: 40 })

    // Le tonnage dit l'inverse : 3 × 12 à 40 (1440) « bat » 3 × 5 à 90 (1350).
    expect(heavy).toBeGreaterThan(light)
  })
})

describe('getBestEstimatedOneRepMax', () => {
  const at = (id: number, reps: number, weight: number, day: string) =>
    makeSet({ id, reps, weight, completedAt: new Date(`${day}T18:00:00.000Z`) })

  it('takes the best estimate of the working sets', () => {
    expect(
      getBestEstimatedOneRepMax([at(1, 8, 80, '2026-01-05'), at(2, 5, 90, '2026-01-12')]),
    ).toBeCloseTo(105, 1)
  })

  it('has nothing to estimate without a working set', () => {
    expect(getBestEstimatedOneRepMax([])).toBeNull()
    expect(getBestEstimatedOneRepMax([makeSet({ id: 1, isWarmup: true })])).toBeNull()
  })
})

describe('isNewRecordForReps', () => {
  const at = (id: number, reps: number, weight: number, day: string) =>
    makeSet({ id, reps, weight, completedAt: new Date(`${day}T18:00:00.000Z`) })

  it('calls it a record when no earlier set matched that load for as many reps', () => {
    // 8 × 80 après 6 × 80 : ce n'est pas un record de charge, c'en est un pour
    // la cible de répétitions.
    const sets = [at(1, 6, 80, '2026-01-05'), at(2, 8, 80, '2026-01-12')]

    expect(isNewRecordForReps(sets, 2)).toBe(true)
  })

  it('does not call it a record when the same load was already held for more', () => {
    const sets = [at(1, 10, 80, '2026-01-05'), at(2, 8, 80, '2026-01-12')]

    expect(isNewRecordForReps(sets, 2)).toBe(false)
  })

  it('ignores warm-ups and deloads, and a lighter load never counts', () => {
    const sets = [
      at(1, 12, 80, '2026-01-05', ),
      makeSet({ id: 2, reps: 8, weight: 60, completedAt: new Date('2026-01-12T18:00:00.000Z') }),
    ]

    expect(isNewRecordForReps(sets, 2)).toBe(false)
  })
})

describe('daysSinceLastSession', () => {
  it('counts the days since the most recent working session', () => {
    const sets = [makeSet({ id: 1, completedAt: new Date('2026-04-13T18:00:00.000Z') })]

    expect(daysSinceLastSession(groupIntoSessions(sets), '2026-04-27')).toBe(14)
  })

  it('has nothing to count on an exercise never done', () => {
    expect(daysSinceLastSession([], '2026-04-27')).toBeNull()
  })
})

describe('suggestReturnLoad', () => {
  it('leaves the target alone below the break threshold', () => {
    expect(suggestReturnLoad(100, 13)).toBeNull()
  })

  it('takes ten percent off after a fortnight away, rounded to the half kilo', () => {
    expect(suggestReturnLoad(100, 14)).toBe(90)
    expect(suggestReturnLoad(87, 20)).toBe(78.5)
  })

  it('has nothing to suggest without a break to speak of', () => {
    expect(suggestReturnLoad(100, null)).toBeNull()
  })
})
