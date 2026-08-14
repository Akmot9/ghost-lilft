<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import SessionDiff from './SessionDiff.vue'
import WeeklyVolumeGraph from './WeeklyVolumeGraph.vue'
import {
  getPositionalGhost,
  getSuggestedTarget,
  getWeekStart,
  groupIntoSessions,
  isExerciseStagnant,
  isNewRecord,
  type ExerciseSet,
} from '../lib/trainingInsights'

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
  clearSets: []
}>()

const restDurationSeconds = 180

const sessions = computed(() => groupIntoSessions(props.sets))
const sortedSets = computed(() => sessions.value.flatMap((session) => session.sets))
const visibleSets = computed(() => sortedSets.value.slice(0, 3))
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

// Fantôme positionnel : la N-ième série du jour se mesure à la N-ième série
// de la séance précédente (les schémas pyramidaux se reproduisent série par
// série). Recalculé après chaque ajout : au retour du repos, le formulaire
// propose la série suivante.
const ghost = computed(() => getPositionalGhost(props.sets, new Date(), sessions.value))
const suggestedTarget = computed(() =>
  getSuggestedTarget(props.sets, { weight: props.defaultWeight, reps: props.defaultReps }, ghost.value),
)
// Passing the already-computed sessions avoids isExerciseStagnant() re-running
// groupIntoSessions() on props.sets a second time on every set logged.
const isStagnant = computed(() => isExerciseStagnant(props.sets, sessions.value))

const reps = ref(suggestedTarget.value.reps)
const weight = ref(suggestedTarget.value.weight)

watch(suggestedTarget, (target) => {
  reps.value = target.reps
  weight.value = target.weight
})

const lastAddedSetId = ref<number | null>(null)
const isLatestSetNewRecord = computed(
  () => lastAddedSetId.value !== null && isNewRecord(props.sets, lastAddedSetId.value),
)

const isResting = ref(false)
const restSecondsRemaining = ref(0)
let restIntervalId: ReturnType<typeof setInterval> | null = null

const dateTimeFormatter = new Intl.DateTimeFormat('fr', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatCompletedAt(date: Date) {
  return dateTimeFormatter.format(date)
}

function formatRestTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function clearRestInterval() {
  if (restIntervalId !== null) {
    clearInterval(restIntervalId)
    restIntervalId = null
  }
}

function startRest() {
  clearRestInterval()
  isResting.value = true
  restSecondsRemaining.value = restDurationSeconds

  restIntervalId = setInterval(() => {
    restSecondsRemaining.value -= 1

    if (restSecondsRemaining.value <= 0) {
      finishRest()
    }
  }, 1000)
}

function finishRest() {
  clearRestInterval()
  isResting.value = false
  restSecondsRemaining.value = 0
  lastAddedSetId.value = null
}

function skipRest() {
  finishRest()
}

function adjustRest(deltaSeconds: number) {
  restSecondsRemaining.value = Math.max(0, restSecondsRemaining.value + deltaSeconds)

  if (restSecondsRemaining.value <= 0) {
    finishRest()
  }
}

onUnmounted(() => {
  clearRestInterval()
})

function addSet() {
  if (reps.value < 1 || weight.value < 1 || !Number.isInteger(weight.value)) {
    return
  }

  const completedAt = new Date()
  const newSet: ExerciseSet = {
    id: completedAt.getTime(),
    reps: reps.value,
    weight: weight.value,
    completedAt,
  }

  lastAddedSetId.value = newSet.id
  emit('addSet', newSet)
  startRest()
}

function removeSet(id: number) {
  emit('removeSet', id)
}

// Deux clics plutôt que window.confirm (absent du WebView iOS/macOS).
const confirmClearSets = ref(false)

function clearSets() {
  if (!confirmClearSets.value) {
    confirmClearSets.value = true
    return
  }
  confirmClearSets.value = false
  emit('clearSets')
}
</script>

<template>
  <section class="exercise-tracker" aria-labelledby="exercise-title">
    <div class="tracker-header">
      <p class="eyebrow">{{ exerciseName }}</p>
      <h1 id="exercise-title">Suivi des séries</h1>
      <p v-if="isStagnant" class="badge badge-negative">Même charge que la dernière fois</p>
    </div>

    <div class="ghost-target">
      <div v-if="ghost" class="ghost-row">
        <span class="ghost-label">Fantôme</span>
        <span>
          Série {{ ghost.position }}, dernière séance :
          {{ ghost.set.reps }} × {{ ghost.set.weight }} {{ weightUnit }}
        </span>
      </div>

      <div class="target-chip">
        Cible → {{ suggestedTarget.weight }} {{ weightUnit }} × {{ suggestedTarget.reps }}
      </div>
    </div>

    <form v-if="!isResting" class="set-form" @submit.prevent="addSet">
      <label>
        <span>Répétitions</span>
        <input v-model.number="reps" type="number" min="1" step="1" inputmode="numeric" />
      </label>

      <label>
        <span>Poids</span>
        <div class="weight-input">
          <input v-model.number="weight" type="number" min="1" step="1" inputmode="numeric" />
          <span>{{ weightUnit }}</span>
        </div>
      </label>

      <button type="submit">Ajouter la série</button>
    </form>

    <div v-else class="rest-panel" aria-live="polite">
      <p v-if="isLatestSetNewRecord" class="badge badge-positive">Nouveau record</p>
      <p class="rest-label">Repos</p>
      <p class="rest-countdown">{{ formatRestTime(restSecondsRemaining) }}</p>
      <div class="rest-controls">
        <button type="button" @click="adjustRest(-15)">-15 s</button>
        <button type="button" @click="adjustRest(15)">+15 s</button>
        <button type="button" class="skip-button" @click="skipRest">Passer</button>
      </div>
    </div>

    <div class="stats-grid" aria-label="Totaux d'entraînement">
      <div>
        <span>Répétitions cette semaine</span>
        <strong>{{ weeklyReps }}</strong>
      </div>
      <div>
        <span>Volume cette semaine</span>
        <strong>{{ weeklyVolume }} {{ weightUnit }}</strong>
      </div>
      <div>
        <span>Charge max cette semaine</span>
        <strong>{{ heaviestSet ? `${heaviestSet.weight} ${weightUnit}` : '—' }}</strong>
      </div>
    </div>

    <SessionDiff
      :latest-session="latestSession"
      :previous-session="previousSession"
      :weight-unit="weightUnit"
    />

    <WeeklyVolumeGraph :sets="sortedSets" :weight-unit="weightUnit" />

    <div class="sets-panel">
      <div class="sets-head">
        <h2>Séries</h2>
        <button
          v-if="sortedSets.length > 0"
          type="button"
          class="clear-sets"
          :class="{ 'clear-sets--confirm': confirmClearSets }"
          @click="clearSets"
        >
          {{ confirmClearSets ? 'Confirmer : tout supprimer ?' : 'Tout supprimer' }}
        </button>
      </div>

      <p v-if="visibleSets.length === 0" class="empty-state">Aucune série ajoutée pour l'instant.</p>

      <ul v-else class="set-list">
        <li v-for="set in visibleSets" :key="set.id">
          <div>
            <strong>{{ set.reps }} répétitions</strong>
            <span>{{ set.weight }} {{ weightUnit }} le {{ formatCompletedAt(set.completedAt) }}</span>
          </div>
          <button type="button" aria-label="Supprimer la série" @click="removeSet(set.id)">
            Retirer
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.exercise-tracker {
  width: min(100%, 760px);
  padding: 32px;
  color: var(--text);
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--panel-shadow);
}

.tracker-header {
  margin-bottom: 28px;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--fire);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 7vw, 3.8rem);
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
  text-transform: uppercase;
}

h2 {
  margin-bottom: 16px;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 6px 12px;
  margin-top: 12px;
  margin-bottom: 0;
  font-size: 0.82rem;
  font-weight: 800;
  border-radius: 999px;
}

.badge-negative {
  color: var(--blood-text);
  background: var(--blood-dim);
  border: 1px solid var(--blood);
}

.badge-positive {
  color: var(--gain);
  background: var(--gain-dim);
  border: 1px solid var(--gain);
}

.ghost-target {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 24px;
}

.ghost-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 14px;
  color: var(--ghost-bright);
  font-weight: 700;
  background: var(--ghost-dim);
  border: 1px dashed var(--ghost);
  border-radius: var(--control-radius);
}

.ghost-label {
  padding: 3px 8px;
  color: var(--ghost);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid var(--ghost);
  border-radius: 999px;
}

.target-chip {
  padding: 10px 14px;
  color: var(--fire);
  font-weight: 800;
  background: var(--fire-dim);
  border: 1px solid var(--fire);
  border-radius: var(--control-radius);
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
  color: var(--muted);
}

input {
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  color: var(--text-strong);
  font: inherit;
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  border-radius: var(--control-radius);
}

input:focus {
  border-color: var(--field-focus-border);
  outline: 3px solid var(--field-focus-ring);
}

.weight-input {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  border: 1px solid var(--field-border);
  border-radius: var(--control-radius);
  background: var(--field-bg);
}

.weight-input:focus-within {
  border-color: var(--field-focus-border);
  outline: 3px solid var(--field-focus-ring);
}

.weight-input input {
  border: 0;
  outline: 0;
}

.weight-input span {
  padding-right: 14px;
  color: var(--muted);
  font-weight: 700;
}

button {
  min-height: 48px;
  padding: 0 18px;
  color: var(--accent-text-on-fill);
  font: inherit;
  font-weight: 800;
  background: var(--accent);
  border: 0;
  border-radius: var(--control-radius);
  cursor: pointer;
}

button:hover {
  background: var(--accent-hover);
}

.rest-panel {
  display: grid;
  gap: 14px;
  padding: 24px;
  margin-bottom: 24px;
  text-align: center;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
}

.rest-panel .badge {
  justify-self: center;
  margin-top: 0;
}

.rest-label {
  margin: 0;
  color: var(--fire);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.rest-countdown {
  margin: 0;
  color: var(--text-strong);
  font-family: var(--font-display);
  font-size: clamp(2.6rem, 8vw, 4rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.rest-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}

.rest-controls button {
  min-height: 48px;
  padding: 0 18px;
}

.skip-button {
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--border-strong);
}

.skip-button:hover {
  color: var(--text);
  background: var(--ghost-dim);
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
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
}

.stats-grid span,
.set-list span,
.empty-state {
  color: var(--muted);
}

.stats-grid strong {
  font-family: var(--font-display);
  font-size: 1.7rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.sets-panel {
  padding-top: 8px;
}

.sets-head {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.clear-sets {
  min-height: 38px;
  padding: 0 12px;
  color: var(--blood-text);
  background: transparent;
  border: 1px solid var(--border-strong);
}

.clear-sets:hover,
.clear-sets--confirm {
  color: var(--text-strong);
  background: var(--blood-dim);
  border-color: var(--blood);
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
  border-bottom: 1px solid var(--border);
}

.set-list li:first-child {
  border-top: 1px solid var(--border);
}

.set-list li div {
  display: grid;
  gap: 4px;
}

.set-list button {
  min-height: 38px;
  padding: 0 12px;
  color: var(--blood-text);
  background: var(--blood-dim);
}

.set-list button:hover {
  color: var(--text-strong);
  background: var(--blood);
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
