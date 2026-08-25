import { describe, expect, it } from 'vitest'
import { dominantWeightUnit, summarizeSeance } from '../seanceInsights'
import { makeSet } from './testFactories'

const day = (date: string, minute = 0) => new Date(`${date}T18:${String(minute).padStart(2, '0')}:00Z`)

describe('dominantWeightUnit', () => {
  it('falls back to kilograms and otherwise picks the most frequent unit', () => {
    expect(dominantWeightUnit([])).toBe('kg')
    expect(dominantWeightUnit([{ weightUnit: 'lb' }, { weightUnit: 'lb' }, { weightUnit: 'kg' }])).toBe(
      'lb',
    )
  })
})

describe('summarizeSeance', () => {
  it('reads the séance day by day, latest session against the previous one', () => {
    const overview = summarizeSeance([
      {
        slug: 'squat',
        name: 'Squat',
        weightUnit: 'kg',
        sets: [
          makeSet({ id: 1, reps: 5, weight: 100, completedAt: day('2026-04-20') }),
          makeSet({ id: 2, reps: 5, weight: 100, completedAt: day('2026-04-20', 5) }),
          makeSet({ id: 3, reps: 5, weight: 105, completedAt: day('2026-04-27') }),
          makeSet({ id: 4, reps: 5, weight: 105, completedAt: day('2026-04-27', 5) }),
        ],
      },
      {
        slug: 'presse',
        name: 'Presse',
        weightUnit: 'kg',
        sets: [
          makeSet({ id: 5, reps: 10, weight: 150, completedAt: day('2026-04-20', 20) }),
          // Sauté le 27 avril.
        ],
      },
    ])

    expect(overview.weightUnit).toBe('kg')
    expect(overview.sessions.map((session) => session.key)).toEqual(['2026-04-27', '2026-04-20'])
    expect(overview.latest).toMatchObject({ volume: 1050, reps: 10, exercisesDone: 1 })
    expect(overview.previous).toMatchObject({ volume: 2500, reps: 20, exercisesDone: 2 })
    expect(overview.volumeDelta).toBe(-1450)
    expect(overview.exercises).toEqual([
      expect.objectContaining({ slug: 'squat', latest: 1050, previous: 1000, delta: 50 }),
      expect.objectContaining({ slug: 'presse', latest: 0, previous: 1500, delta: -1500 }),
    ])
  })

  it('has no comparison before a second session, and nothing at all without sets', () => {
    const single = summarizeSeance([
      {
        slug: 'squat',
        name: 'Squat',
        weightUnit: 'kg',
        sets: [makeSet({ id: 1, reps: 5, weight: 100, completedAt: day('2026-04-20') })],
      },
    ])

    expect(single.previous).toBeNull()
    expect(single.volumeDelta).toBeNull()
    expect(single.exercises[0]).toMatchObject({ latest: 500, previous: null, delta: null })

    const empty = summarizeSeance([{ slug: 'squat', name: 'Squat', weightUnit: 'kg', sets: [] }])
    expect(empty.latest).toBeNull()
    expect(empty.sessions).toEqual([])
    expect(empty.exercises[0]).toMatchObject({ latest: 0, previous: null })
  })

  it('leaves warm-ups and foreign units out of the totals', () => {
    const overview = summarizeSeance([
      {
        slug: 'squat',
        name: 'Squat',
        weightUnit: 'kg',
        sets: [
          makeSet({ id: 1, reps: 10, weight: 40, completedAt: day('2026-04-20'), isWarmup: true }),
          makeSet({ id: 2, reps: 5, weight: 100, completedAt: day('2026-04-20', 5) }),
        ],
      },
      { slug: 'presse', name: 'Presse', weightUnit: 'kg', sets: [] },
      {
        slug: 'curl',
        name: 'Curl',
        weightUnit: 'lb',
        sets: [makeSet({ id: 3, reps: 10, weight: 30, completedAt: day('2026-04-20', 10) })],
      },
    ])

    expect(overview.weightUnit).toBe('kg')
    expect(overview.latest).toMatchObject({ volume: 500, reps: 5, exercisesDone: 2 })
    expect(overview.sets.map((set) => set.id)).toEqual([2])
    expect(overview.exercises[2]).toMatchObject({ slug: 'curl', latest: 300, isOtherUnit: true })
  })
})
