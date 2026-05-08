<script setup lang="ts">
import ExerciseTracker from './components/ExerciseTracker.vue'

type ExerciseSet = {
  id: number
  reps: number
  weight: number
  completedAt: Date
}

const benchPressSets = createBenchPressSets()

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
</script>

<template>
  <main>
    <ExerciseTracker
      exercise-name="Bench press"
      :initial-sets="benchPressSets"
      :default-reps="5"
      :default-weight="60"
      weight-unit="kg"
    />
  </main>
</template>

<style scoped>
main {
  display: grid;
  min-height: 100vh;
  padding: 32px 16px;
  place-items: center;
  background:
    radial-gradient(circle at 18% 12%, rgb(125 211 252 / 13%), transparent 28%),
    radial-gradient(circle at 88% 82%, rgb(167 139 250 / 12%), transparent 32%),
    linear-gradient(135deg, #0b1120 0%, #111827 48%, #172033 100%);
}
</style>
