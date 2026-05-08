import { defineStore } from 'pinia'

export type ExerciseSet = {
  id: number
  reps: number
  weight: number
  completedAt: Date
}

export type Exercise = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  sets: ExerciseSet[]
}

type CreateExerciseInput = {
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
}

export const useExerciseStore = defineStore('exercises', {
  state: () => ({
    exercises: [
      {
        slug: 'bench-press',
        name: 'Bench press',
        defaultReps: 5,
        defaultWeight: 60,
        weightUnit: 'kg',
        sets: createBenchPressSets(),
      },
    ] satisfies Exercise[],
  }),
  getters: {
    findBySlug: (state) => (slug: string) =>
      state.exercises.find((exercise) => exercise.slug === slug) ?? null,
    getPreviousExercise: (state) => (currentSlug: string) => {
      const currentIndex = state.exercises.findIndex((exercise) => exercise.slug === currentSlug)

      if (currentIndex <= 0) {
        return null
      }

      return state.exercises[currentIndex - 1] ?? null
    },
    getNextExercise: (state) => (currentSlug: string) => {
      const currentIndex = state.exercises.findIndex((exercise) => exercise.slug === currentSlug)

      if (currentIndex < 0) {
        return null
      }

      return state.exercises[currentIndex + 1] ?? null
    },
  },
  actions: {
    createExercise(input: CreateExerciseInput) {
      const baseSlug = slugify(input.name)
      const slug = createUniqueSlug(baseSlug, this.exercises)

      this.exercises.push({
        slug,
        name: input.name.trim(),
        defaultReps: input.defaultReps,
        defaultWeight: input.defaultWeight,
        weightUnit: input.weightUnit.trim() || 'kg',
        sets: [],
      })

      return slug
    },
    addSet(exerciseSlug: string, set: ExerciseSet) {
      const exercise = this.findBySlug(exerciseSlug)

      if (!exercise) {
        return
      }

      exercise.sets.unshift(set)
    },
    removeSet(exerciseSlug: string, setId: number) {
      const exercise = this.findBySlug(exerciseSlug)

      if (!exercise) {
        return
      }

      exercise.sets = exercise.sets.filter((set) => set.id !== setId)
    },
  },
})

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'exercise'
}

function createUniqueSlug(baseSlug: string, exercises: Exercise[]) {
  let slug = baseSlug
  let suffix = 2

  while (exercises.some((exercise) => exercise.slug === slug)) {
    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }

  return slug
}

function createBenchPressSets(): ExerciseSet[] {
  const sets = [
    { date: '2026-02-09T18:20:00', reps: 6, weight: 72 },
    { date: '2026-02-09T18:28:00', reps: 8, weight: 70 },
    { date: '2026-02-09T18:35:00', reps: 12, weight: 68 },
    { date: '2026-02-16T18:43:00', reps: 6, weight: 74 },
    { date: '2026-02-16T19:05:00', reps: 8, weight: 72 },
    { date: '2026-02-16T19:14:00', reps: 12, weight: 70 },
    { date: '2026-03-02T18:50:00', reps: 6, weight: 76 },
    { date: '2026-03-02T18:58:00', reps: 8, weight: 74 },
    { date: '2026-03-02T19:10:00', reps: 12, weight: 72 },
    { date: '2026-03-09T19:18:00', reps: 6, weight: 78 },
    { date: '2026-03-09T18:45:00', reps: 8, weight: 76 },
    { date: '2026-03-09T18:54:00', reps: 12, weight: 74 },
    { date: '2026-03-23T19:00:00', reps: 6, weight: 80 },
    { date: '2026-03-23T19:09:00', reps: 8, weight: 78 },
    { date: '2026-03-23T18:40:00', reps: 12, weight: 76 },
    { date: '2026-03-30T18:49:00', reps: 6, weight: 82 },
    { date: '2026-03-30T19:20:00', reps: 8, weight: 80 },
    { date: '2026-03-30T19:29:00', reps: 12, weight: 78 },
    { date: '2026-04-13T18:30:00', reps: 6, weight: 84 },
    { date: '2026-04-13T18:39:00', reps: 8, weight: 82 },
    { date: '2026-04-13T19:15:00', reps: 12, weight: 80 },
    { date: '2026-04-20T19:24:00', reps: 6, weight: 86 },
    { date: '2026-04-20T18:55:00', reps: 8, weight: 84 },
    { date: '2026-04-20T19:04:00', reps: 10, weight: 82 },
    { date: '2026-04-27T18:40:00', reps: 6, weight: 86 },
    { date: '2026-04-27T18:49:00', reps: 8, weight: 84 },
    { date: '2026-04-27T18:58:00', reps: 12, weight: 82 },
  ]

  return sets.map((set, index) => ({
    id: index + 1,
    reps: set.reps,
    weight: set.weight,
    completedAt: new Date(set.date),
  }))
}
