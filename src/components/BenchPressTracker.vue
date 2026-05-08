<script setup lang="ts">
import { computed, ref } from 'vue'
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

type SessionComparison = {
  label: string
  unit: string
  current: number
  previous: number
  delta: number
  currentWidth: number
  previousWidth: number
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
const sessionComparisons = computed<SessionComparison[]>(() => {
  if (!latestSession.value || !previousSession.value) {
    return []
  }

  return [
    createSessionComparison('Heaviest', 'kg', latestSession.value.heaviest, previousSession.value.heaviest),
    createSessionComparison('Volume', 'kg', latestSession.value.volume, previousSession.value.volume),
    createSessionComparison('Reps', '', latestSession.value.reps, previousSession.value.reps),
  ]
})
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
const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
})

function formatCompletedAt(date: Date) {
  return dateTimeFormatter.format(date)
}

function formatSessionDate(date: Date) {
  return dateFormatter.format(date)
}

function formatSignedWeight(value: number) {
  return `${value > 0 ? '+' : ''}${value} kg`
}

function formatSignedNumber(value: number) {
  return `${value > 0 ? '+' : ''}${value}`
}

function formatComparisonValue(value: number, unit: string) {
  return unit ? `${value} ${unit}` : String(value)
}

function formatComparisonDelta(value: number, unit: string) {
  return unit ? formatSignedWeight(value) : formatSignedNumber(value)
}

function createSessionComparison(
  label: string,
  unit: string,
  current: number,
  previous: number,
): SessionComparison {
  const max = Math.max(current, previous, 1)

  return {
    label,
    unit,
    current,
    previous,
    delta: current - previous,
    currentWidth: Math.max((current / max) * 100, 6),
    previousWidth: Math.max((previous / max) * 100, 6),
  }
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

    <section v-if="latestSession" class="session-highlight" aria-labelledby="latest-session-title">
      <div class="session-heading">
        <span class="highlight-label">Session diff</span>
        <h2 id="latest-session-title">
          {{ formatSessionDate(latestSession.date) }}
          <span v-if="previousSession">vs {{ formatSessionDate(previousSession.date) }}</span>
        </h2>
      </div>

      <div v-if="previousSession" class="session-comparison">
        <div v-for="comparison in sessionComparisons" :key="comparison.label" class="comparison-row">
          <div class="comparison-topline">
            <span>{{ comparison.label }}</span>
            <strong :class="{ positive: comparison.delta > 0, negative: comparison.delta < 0 }">
              {{ formatComparisonDelta(comparison.delta, comparison.unit) }}
            </strong>
          </div>

          <div class="overlay-comparison">
            <div class="overlay-values">
              <span>Last {{ formatComparisonValue(comparison.previous, comparison.unit) }}</span>
              <strong>Now {{ formatComparisonValue(comparison.current, comparison.unit) }}</strong>
            </div>
            <div class="overlay-rail">
              <div class="bar-ghost" :style="{ width: `${comparison.previousWidth}%` }"></div>
              <div class="bar-now" :style="{ width: `${comparison.currentWidth}%` }"></div>
            </div>
          </div>
        </div>
      </div>
    </section>

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
  color: #1f2933;
  background: #ffffff;
  border: 1px solid #dde5eb;
  border-radius: 8px;
  box-shadow: 0 20px 50px rgb(24 39 75 / 10%);
}

.tracker-header {
  margin-bottom: 28px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #0f766e;
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
}

input {
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  color: #17212b;
  font: inherit;
  border: 1px solid #b6c4cf;
  border-radius: 6px;
}

input:focus {
  border-color: #0f766e;
  outline: 3px solid rgb(15 118 110 / 18%);
}

.weight-input {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  border: 1px solid #b6c4cf;
  border-radius: 6px;
  background: #ffffff;
}

.weight-input:focus-within {
  border-color: #0f766e;
  outline: 3px solid rgb(15 118 110 / 18%);
}

.weight-input input {
  border: 0;
  outline: 0;
}

.weight-input span {
  padding-right: 14px;
  color: #52616e;
  font-weight: 700;
}

button {
  min-height: 48px;
  padding: 0 18px;
  color: #ffffff;
  font: inherit;
  font-weight: 800;
  background: #0f766e;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

button:hover {
  background: #115e59;
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
  background: #f4f7f9;
  border: 1px solid #dde5eb;
  border-radius: 8px;
}

.stats-grid span,
.set-list span,
.empty-state {
  color: #52616e;
}

.stats-grid strong {
  font-size: 1.4rem;
}

.session-highlight {
  display: grid;
  gap: 18px;
  padding: 20px;
  margin-bottom: 24px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-left: 6px solid #0f766e;
  border-radius: 8px;
}

.session-heading {
  display: flex;
  gap: 16px;
  align-items: end;
  justify-content: space-between;
}

.highlight-label {
  display: block;
  margin-bottom: 8px;
  color: #0f766e;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.session-highlight h2 {
  margin-bottom: 0;
  font-size: 1.4rem;
}

.session-highlight h2 span {
  display: block;
  margin-top: 4px;
  color: #52616e;
  font-size: 0.9rem;
  font-weight: 700;
}

.session-comparison {
  display: grid;
  gap: 14px;
}

.comparison-row {
  display: grid;
  gap: 10px;
  padding: 14px;
  background: #ffffff;
  border: 1px solid #dde5eb;
  border-radius: 8px;
}

.comparison-topline {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) 74px;
  gap: 12px;
  align-items: center;
}

.comparison-topline span {
  color: #1f2933;
  font-weight: 800;
}

.comparison-topline strong {
  grid-column: 3;
  justify-self: end;
  color: #1f2933;
}

.comparison-topline strong.positive {
  color: #047857;
}

.comparison-topline strong.negative {
  color: #be123c;
}

.overlay-comparison {
  display: grid;
  gap: 6px;
}

.overlay-values {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  color: #52616e;
  font-size: 0.82rem;
  font-weight: 800;
}

.overlay-values strong {
  color: #1f2933;
}

.overlay-rail {
  position: relative;
  height: 26px;
  overflow: hidden;
  background: #e7edf2;
  border-radius: 999px;
}

.bar-ghost,
.bar-now {
  position: absolute;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  border-radius: 999px;
}

.bar-ghost {
  height: 100%;
  background: repeating-linear-gradient(
    135deg,
    rgb(100 116 139 / 26%) 0,
    rgb(100 116 139 / 26%) 8px,
    rgb(100 116 139 / 12%) 8px,
    rgb(100 116 139 / 12%) 16px
  );
  border: 1px solid rgb(100 116 139 / 28%);
}

.bar-now {
  height: 62%;
  background: #0f766e;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 42%);
}

.bar-now::after {
  position: absolute;
  top: -4px;
  right: -2px;
  width: 4px;
  height: calc(100% + 8px);
  content: '';
  background: #134e4a;
  border-radius: 999px;
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
  border-bottom: 1px solid #e7edf2;
}

.set-list li:first-child {
  border-top: 1px solid #e7edf2;
}

.set-list li div {
  display: grid;
  gap: 4px;
}

.set-list button {
  min-height: 38px;
  padding: 0 12px;
  color: #7f1d1d;
  background: #fee2e2;
}

.set-list button:hover {
  background: #fecaca;
}

@media (max-width: 680px) {
  .bench-tracker {
    padding: 24px;
  }

  .set-form,
  .stats-grid,
  .session-heading,
  .comparison-topline {
    grid-template-columns: 1fr;
  }

  .session-heading {
    display: grid;
    align-items: start;
  }

  .comparison-topline strong {
    grid-column: auto;
    justify-self: start;
  }

  .overlay-values {
    display: grid;
    gap: 4px;
  }
}
</style>
