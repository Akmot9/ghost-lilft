import { defineStore } from 'pinia'
import benchPressDataset from '../datasets/bench-press.json'

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
        slug: benchPressDataset.slug,
        name: benchPressDataset.name,
        defaultReps: benchPressDataset.defaultReps,
        defaultWeight: benchPressDataset.defaultWeight,
        weightUnit: benchPressDataset.weightUnit,
        sets: createSetsFromDataset(benchPressDataset.sets),
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

function createSetsFromDataset(
  sets: Array<{ date: string; reps: number; weight: number }>,
): ExerciseSet[] {
  return sets.map((set, index) => ({
    id: index + 1,
    reps: set.reps,
    weight: set.weight,
    completedAt: new Date(set.date),
  }))
}
