<script setup lang="ts">
import { computed, ref } from 'vue'
import SessionDiff from './SessionDiff.vue'
import WeeklyVolumeGraph from './WeeklyVolumeGraph.vue'

type BenchSet = {
  id: number
  reps: number
  weight: number
  completedAt: Date
}

type TrainingSession = {
  key: string
  date: Date
  sets: BenchSet[]
  reps: number
  volume: number
  heaviest: number
}

const reps = ref(5)
const weight = ref(60)
const sets = ref<BenchSet[]>(createMockSets())

const visibleSets = computed(() => sets.value.slice(0, 3))
const sessions = computed(() => {
  const groupedSessions = new Map<string, BenchSet[]>()

  for (const set of sets.value) {
    const key = getDateKey(set.completedAt)
    const sessionSets = groupedSessions.get(key)

    if (sessionSets) {
      sessionSets.push(set)
    } else {
      groupedSessions.set(key, [set])
    }
  }

  return Array.from(groupedSessions.entries())
    .map(([key, sessionSets]) => createTrainingSession(key, sessionSets))
    .sort((first, second) => second.date.getTime() - first.date.getTime())
})
const latestSession = computed(() => sessions.value[0] ?? null)
const previousSession = computed(() => sessions.value[1] ?? null)
const latestWeekSets = computed(() => {
  const latestSet = sets.value[0]

  if (!latestSet) {
    return []
  }

  const latestWeekStart = getWeekStart(latestSet.completedAt).getTime()

  return sets.value.filter((set) => getWeekStart(set.completedAt).getTime() === latestWeekStart)
})
const weeklyReps = computed(() => latestWeekSets.value.reduce((total, set) => total + set.reps, 0))
const weeklyVolume = computed(() =>
  latestWeekSets.value.reduce((total, set) => total + set.reps * set.weight, 0),
)
const heaviestSet = computed(() =>
  latestWeekSets.value.reduce<BenchSet | null>(
    (heaviest, set) => (!heaviest || set.weight > heaviest.weight ? set : heaviest),
    null,
  ),
)

const dateTimeFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatCompletedAt(date: Date) {
  return dateTimeFormatter.format(date)
}

function getDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function createTrainingSession(key: string, sessionSets: BenchSet[]): TrainingSession {
  return {
    key,
    date: new Date(key),
    sets: sessionSets,
    reps: sessionSets.reduce((total, set) => total + set.reps, 0),
    volume: sessionSets.reduce((total, set) => total + set.reps * set.weight, 0),
    heaviest: Math.max(...sessionSets.map((set) => set.weight)),
  }
}

function getWeekStart(date: Date) {
  const weekStart = new Date(date)
  weekStart.setHours(0, 0, 0, 0)

  const day = weekStart.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  weekStart.setDate(weekStart.getDate() + mondayOffset)

  return weekStart
}

function createMockSets(): BenchSet[] {
  const mockSets = [
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

  return mockSets
    .map((set, index) => ({
      id: index + 1,
      reps: set.reps,
      weight: set.weight,
      completedAt: new Date(set.date),
    }))
    .sort((first, second) => second.completedAt.getTime() - first.completedAt.getTime())
}

function addSet() {
  if (reps.value < 1 || weight.value < 1 || !Number.isInteger(weight.value)) {
    return
  }

  const completedAt = new Date()

  sets.value.unshift({
    id: completedAt.getTime(),
    reps: reps.value,
    weight: weight.value,
    completedAt,
  })
}

function removeSet(id: number) {
  sets.value = sets.value.filter((set) => set.id !== id)
}
</script>

<template>
  <section class="bench-tracker" aria-labelledby="bench-title">
    <div class="tracker-header">
      <p class="eyebrow">Bench press</p>
      <h1 id="bench-title">Track reps and weight</h1>
    </div>

    <form class="set-form" @submit.prevent="addSet">
      <label>
        <span>Reps</span>
        <input v-model.number="reps" type="number" min="1" step="1" inputmode="numeric" />
      </label>

      <label>
        <span>Weight</span>
        <div class="weight-input">
          <input v-model.number="weight" type="number" min="1" step="1" inputmode="numeric" />
          <span>kg</span>
        </div>
      </label>

      <button type="submit">Add set</button>
    </form>

    <div class="stats-grid" aria-label="Workout totals">
      <div>
        <span>Latest week reps</span>
        <strong>{{ weeklyReps }}</strong>
      </div>
      <div>
        <span>Latest week volume</span>
        <strong>{{ weeklyVolume }} kg</strong>
      </div>
      <div>
        <span>Latest week heaviest</span>
        <strong>{{ heaviestSet ? `${heaviestSet.weight} kg` : '-' }}</strong>
      </div>
    </div>

    <SessionDiff :latest-session="latestSession" :previous-session="previousSession" />

    <WeeklyVolumeGraph :sets="sets" />

    <div class="sets-panel">
      <h2>Sets</h2>

      <p v-if="visibleSets.length === 0" class="empty-state">No bench press sets added yet.</p>

      <ul v-else class="set-list">
        <li v-for="set in visibleSets" :key="set.id">
          <div>
            <strong>{{ set.reps }} reps</strong>
            <span>{{ set.weight }} kg on {{ formatCompletedAt(set.completedAt) }}</span>
          </div>
          <button type="button" aria-label="Remove set" @click="removeSet(set.id)">Remove</button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.bench-tracker {
  width: min(100%, 760px);
  padding: 32px;
  color: #e5edf5;
  background: rgb(15 23 42 / 92%);
  border: 1px solid rgb(148 163 184 / 24%);
  border-radius: 8px;
  box-shadow:
    0 26px 70px rgb(0 0 0 / 34%),
    0 0 42px rgb(45 212 191 / 10%);
}

.tracker-header {
  margin-bottom: 28px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #67e8f9;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-size: clamp(2rem, 6vw, 3.5rem);
  line-height: 1;
}

h2 {
  margin-bottom: 16px;
  font-size: 1.1rem;
}

.set-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  gap: 16px;
  align-items: end;
  margin-bottom: 24px;
}

label {
  display: grid;
  gap: 8px;
  font-weight: 700;
}

label span {
  font-size: 0.9rem;
  color: #cbd5e1;
}

input {
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  color: #f8fafc;
  font: inherit;
  background: #111827;
  border: 1px solid rgb(148 163 184 / 38%);
  border-radius: 6px;
}

input:focus {
  border-color: #67e8f9;
  outline: 3px solid rgb(103 232 249 / 18%);
}

.weight-input {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  border: 1px solid rgb(148 163 184 / 38%);
  border-radius: 6px;
  background: #111827;
}

.weight-input:focus-within {
  border-color: #67e8f9;
  outline: 3px solid rgb(103 232 249 / 18%);
}

.weight-input input {
  border: 0;
  outline: 0;
}

.weight-input span {
  padding-right: 14px;
  color: #94a3b8;
  font-weight: 700;
}

button {
  min-height: 48px;
  padding: 0 18px;
  color: #031926;
  font: inherit;
  font-weight: 800;
  background: linear-gradient(180deg, #67e8f9, #2dd4bf);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

button:hover {
  background: linear-gradient(180deg, #a5f3fc, #5eead4);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.stats-grid div {
  display: grid;
  gap: 8px;
  min-height: 92px;
  padding: 16px;
  background: rgb(30 41 59 / 72%);
  border: 1px solid rgb(148 163 184 / 22%);
  border-radius: 8px;
}

.stats-grid span,
.set-list span,
.empty-state {
  color: #94a3b8;
}

.stats-grid strong {
  font-size: 1.4rem;
}

.sets-panel {
  padding-top: 8px;
}

.empty-state {
  margin-bottom: 0;
}

.set-list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.set-list li {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid rgb(148 163 184 / 20%);
}

.set-list li:first-child {
  border-top: 1px solid rgb(148 163 184 / 20%);
}

.set-list li div {
  display: grid;
  gap: 4px;
}

.set-list button {
  min-height: 38px;
  padding: 0 12px;
  color: #fecdd3;
  background: rgb(159 18 57 / 26%);
}

.set-list button:hover {
  background: rgb(190 18 60 / 36%);
}

@media (max-width: 680px) {
  .bench-tracker {
    padding: 24px;
  }

  .set-form,
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
