import { describe, it, expect } from 'vitest'
import {
  groupIntoSessions,
  getPositionalGhost,
  getSuggestedTarget,
  getMostRecentSet,
  getWeekStart,
  isExerciseStagnant,
  isNewRecord,
} from '../trainingInsights'
import { makeSet } from './testFactories'

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
})

describe('getWeekStart', () => {
  it('anchors to the Monday of the same week', () => {
    // Thursday 2026-01-08 -> Monday 2026-01-05
    const weekStart = getWeekStart(new Date('2026-01-08T18:00:00.000Z'))

    expect(weekStart.getFullYear()).toBe(2026)
    expect(weekStart.getMonth()).toBe(0)
    expect(weekStart.getDate()).toBe(5)
  })

  it('treats Sunday as the end of the week, not the start', () => {
    // Sunday 2026-01-11 -> still Monday 2026-01-05
    const weekStart = getWeekStart(new Date('2026-01-11T18:00:00.000Z'))

    expect(weekStart.getDate()).toBe(5)
  })

  it('zeroes out the time of day', () => {
    const weekStart = getWeekStart(new Date('2026-01-08T18:42:07.000Z'))

    expect(weekStart.getHours()).toBe(0)
    expect(weekStart.getMinutes()).toBe(0)
    expect(weekStart.getSeconds()).toBe(0)
  })
})

describe('getPositionalGhost / getSuggestedTarget', () => {
  const now = new Date('2026-01-12T18:30:00.000Z')
  const fallback = { weight: 20, reps: 5 }
  // Séance pyramidale de la semaine dernière : 6@80 → 8@70 → 12@60.
  const lastWeek = [
    makeSet({ id: 1, reps: 6, weight: 80, completedAt: new Date('2026-01-05T18:00:00.000Z') }),
    makeSet({ id: 2, reps: 8, weight: 70, completedAt: new Date('2026-01-05T18:10:00.000Z') }),
    makeSet({ id: 3, reps: 12, weight: 60, completedAt: new Date('2026-01-05T18:20:00.000Z') }),
  ]

  it('falls back to the exercise defaults when there are no sets yet', () => {
    expect(getPositionalGhost([], now)).toBeNull()
    expect(getSuggestedTarget([], fallback, null)).toEqual(fallback)
  })

  it('has no ghost during the very first session of the exercise', () => {
    const onlyToday = [
      makeSet({ id: 9, reps: 6, weight: 80, completedAt: new Date('2026-01-12T18:00:00.000Z') }),
    ]

    expect(getPositionalGhost(onlyToday, now)).toBeNull()
    expect(getSuggestedTarget(onlyToday, fallback, null)).toEqual(fallback)
  })

  it('proposes série 1 of the previous session before any set today', () => {
    const ghost = getPositionalGhost(lastWeek, now)

    expect(ghost).toMatchObject({ position: 1, set: { reps: 6, weight: 80 } })
    expect(getSuggestedTarget(lastWeek, fallback, ghost)).toEqual({ weight: 80, reps: 6 })
  })

  it('advances to the homologous série as sets are logged today (pyramide 6/8/12)', () => {
    const afterFirstSet = [
      ...lastWeek,
      makeSet({ id: 4, reps: 6, weight: 82, completedAt: new Date('2026-01-12T18:00:00.000Z') }),
    ]

    const ghost = getPositionalGhost(afterFirstSet, now)

    expect(ghost).toMatchObject({ position: 2, set: { reps: 8, weight: 70 } })
    expect(getSuggestedTarget(afterFirstSet, fallback, ghost)).toEqual({ weight: 70, reps: 8 })
  })

  it('stays on the last série of the reference session beyond its length', () => {
    const afterFourSets = [
      ...lastWeek,
      makeSet({ id: 4, reps: 6, weight: 82, completedAt: new Date('2026-01-12T18:00:00.000Z') }),
      makeSet({ id: 5, reps: 8, weight: 72, completedAt: new Date('2026-01-12T18:05:00.000Z') }),
      makeSet({ id: 6, reps: 12, weight: 62, completedAt: new Date('2026-01-12T18:10:00.000Z') }),
      makeSet({ id: 7, reps: 15, weight: 50, completedAt: new Date('2026-01-12T18:15:00.000Z') }),
    ]

    const ghost = getPositionalGhost(afterFourSets, now)

    expect(ghost).toMatchObject({ position: 3, set: { reps: 12, weight: 60 } })
  })
})

describe('isExerciseStagnant', () => {
  it('is false with fewer than two sessions', () => {
    const sets = [makeSet({ id: 1, completedAt: new Date('2026-01-05T18:00:00.000Z') })]

    expect(isExerciseStagnant(sets)).toBe(false)
  })

  it('is true when the two most recent sessions have identical heaviest weight and total reps', () => {
    const sets = [
      makeSet({ id: 1, reps: 6, weight: 86, completedAt: new Date('2026-04-20T18:20:00.000Z') }),
      makeSet({ id: 2, reps: 6, weight: 86, completedAt: new Date('2026-04-27T18:20:00.000Z') }),
    ]

    expect(isExerciseStagnant(sets)).toBe(true)
  })

  it('is false when reps improved even at the same heaviest weight', () => {
    const sets = [
      makeSet({ id: 1, reps: 10, weight: 82, completedAt: new Date('2026-04-20T18:40:00.000Z') }),
      makeSet({ id: 2, reps: 12, weight: 82, completedAt: new Date('2026-04-27T18:40:00.000Z') }),
    ]

    expect(isExerciseStagnant(sets)).toBe(false)
  })

  it('only compares the two most recent sessions, ignoring older history', () => {
    const sets = [
      makeSet({ id: 1, reps: 6, weight: 70, completedAt: new Date('2026-03-01T18:00:00.000Z') }),
      makeSet({ id: 2, reps: 6, weight: 86, completedAt: new Date('2026-04-20T18:00:00.000Z') }),
      makeSet({ id: 3, reps: 6, weight: 86, completedAt: new Date('2026-04-27T18:00:00.000Z') }),
    ]

    expect(isExerciseStagnant(sets)).toBe(true)
  })

  it('accepts precomputed sessions instead of regrouping, without changing the result', () => {
    const sets = [
      makeSet({ id: 1, reps: 6, weight: 86, completedAt: new Date('2026-04-20T18:20:00.000Z') }),
      makeSet({ id: 2, reps: 6, weight: 86, completedAt: new Date('2026-04-27T18:20:00.000Z') }),
    ]

    expect(isExerciseStagnant(sets, groupIntoSessions(sets))).toBe(true)
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
})
