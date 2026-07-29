import type { ExerciseSet } from '../trainingInsights'

export function makeSet(overrides: Partial<ExerciseSet> & { id: number }): ExerciseSet {
  return {
    reps: 8,
    weight: 60,
    completedAt: new Date('2026-01-01T18:00:00.000Z'),
    ...overrides,
  }
}
