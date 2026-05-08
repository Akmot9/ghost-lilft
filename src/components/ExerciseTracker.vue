<script setup lang="ts">
import { computed, ref } from 'vue'
import SessionDiff from './SessionDiff.vue'
import WeeklyVolumeGraph from './WeeklyVolumeGraph.vue'

type ExerciseSet = {
  id: number
  reps: number
  weight: number
  completedAt: Date
}

type TrainingSession = {
  key: string
  date: Date
  sets: ExerciseSet[]
  reps: number
  volume: number
  heaviest: number
}

const props = withDefaults(
  defineProps<{
    exerciseName: string
    sets?: ExerciseSet[]
    defaultReps?: number
    defaultWeight?: number
    weightUnit?: string
  }>(),
  {
    sets: () => [],
    defaultReps: 5,
    defaultWeight: 60,
    weightUnit: 'kg',
  },
)
const emit = defineEmits<{
  addSet: [set: ExerciseSet]
  removeSet: [setId: number]
}>()

const reps = ref(props.defaultReps)
const weight = ref(props.defaultWeight)
const sortedSets = computed(() => sortSets(props.sets))

const visibleSets = computed(() => sortedSets.value.slice(0, 3))
const sessions = computed(() => {
  const groupedSessions = new Map<string, ExerciseSet[]>()

  for (const set of sortedSets.value) {
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
  const latestSet = sortedSets.value[0]

  if (!latestSet) {
    return []
  }

  const latestWeekStart = getWeekStart(latestSet.completedAt).getTime()

  return sortedSets.value.filter((set) => getWeekStart(set.completedAt).getTime() === latestWeekStart)
})
const weeklyReps = computed(() => latestWeekSets.value.reduce((total, set) => total + set.reps, 0))
const weeklyVolume = computed(() =>
  latestWeekSets.value.reduce((total, set) => total + set.reps * set.weight, 0),
)
const heaviestSet = computed(() =>
  latestWeekSets.value.reduce<ExerciseSet | null>(
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

function createTrainingSession(key: string, sessionSets: ExerciseSet[]): TrainingSession {
  return {
    key,
    date: new Date(key),
    sets: sessionSets,
    reps: sessionSets.reduce((total, set) => total + set.reps, 0),
    volume: sessionSets.reduce((total, set) => total + set.reps * set.weight, 0),
    heaviest: Math.max(...sessionSets.map((set) => set.weight)),
  }
}

function sortSets(exerciseSets: ExerciseSet[]) {
  return [...exerciseSets].sort(
    (first, second) => second.completedAt.getTime() - first.completedAt.getTime(),
  )
}

function getWeekStart(date: Date) {
  const weekStart = new Date(date)
  weekStart.setHours(0, 0, 0, 0)

  const day = weekStart.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  weekStart.setDate(weekStart.getDate() + mondayOffset)

  return weekStart
}

function addSet() {
  if (reps.value < 1 || weight.value < 1 || !Number.isInteger(weight.value)) {
    return
  }

  const completedAt = new Date()

  emit('addSet', {
    id: completedAt.getTime(),
    reps: reps.value,
    weight: weight.value,
    completedAt,
  })
}

function removeSet(id: number) {
  emit('removeSet', id)
}
</script>

<template>
  <section class="exercise-tracker" aria-labelledby="exercise-title">
    <div class="tracker-header">
      <p class="eyebrow">{{ exerciseName }}</p>
      <h1 id="exercise-title">Track reps and weight</h1>
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
          <span>{{ weightUnit }}</span>
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
        <strong>{{ weeklyVolume }} {{ weightUnit }}</strong>
      </div>
      <div>
        <span>Latest week heaviest</span>
        <strong>{{ heaviestSet ? `${heaviestSet.weight} ${weightUnit}` : '-' }}</strong>
      </div>
    </div>

    <SessionDiff
      :latest-session="latestSession"
      :previous-session="previousSession"
      :weight-unit="weightUnit"
    />

    <WeeklyVolumeGraph :sets="sortedSets" :weight-unit="weightUnit" />

    <div class="sets-panel">
      <h2>Sets</h2>

      <p v-if="visibleSets.length === 0" class="empty-state">No sets added yet.</p>

      <ul v-else class="set-list">
        <li v-for="set in visibleSets" :key="set.id">
          <div>
            <strong>{{ set.reps }} reps</strong>
            <span>{{ set.weight }} {{ weightUnit }} on {{ formatCompletedAt(set.completedAt) }}</span>
          </div>
          <button type="button" aria-label="Remove set" @click="removeSet(set.id)">Remove</button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.exercise-tracker {
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
  .exercise-tracker {
    padding: 24px;
  }

  .set-form,
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
