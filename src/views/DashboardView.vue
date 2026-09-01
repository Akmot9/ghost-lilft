<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import WeeklyVolumeGraph from '../components/WeeklyVolumeGraph.vue'
import { isExerciseStagnant } from '../lib/trainingInsights'
import { useSeanceStore } from '../stores/seances'
import { localDay, useBodyWeightStore } from '../stores/bodyWeight'

type StagnantExercise = {
  seanceSlug: string
  seanceName: string
  exerciseSlug: string
  exerciseName: string
}

const seanceStore = useSeanceStore()

const dashboardWeightUnit = computed(() => {
  const unitCounts = new Map<string, number>()

  for (const seance of seanceStore.seances) {
    for (const exercise of seance.exercises) {
      unitCounts.set(exercise.weightUnit, (unitCounts.get(exercise.weightUnit) ?? 0) + 1)
    }
  }

  let mostCommonUnit = 'kg'
  let highestCount = 0

  for (const [unit, count] of unitCounts) {
    if (count > highestCount) {
      mostCommonUnit = unit
      highestCount = count
    }
  }

  return mostCommonUnit
})

const stagnantExercises = computed<StagnantExercise[]>(() => {
  const stagnant: StagnantExercise[] = []

  for (const seance of seanceStore.seances) {
    for (const exercise of seance.exercises) {
      if (isExerciseStagnant(exercise.sets)) {
        stagnant.push({
          seanceSlug: seance.slug,
          seanceName: seance.name,
          exerciseSlug: exercise.slug,
          exerciseName: exercise.name,
        })
      }
    }
  }

  return stagnant
})

// ——— Poids de corps : une pesée par jour, la dernière lecture fait foi. ———

const bodyWeightStore = useBodyWeightStore()

onMounted(() => {
  void bodyWeightStore.init()
})

// Prérempli avec la dernière pesée : on ne change en général que de quelques
// centaines de grammes d'un jour à l'autre.
const weightInput = ref<number | null>(null)
const weightError = ref('')

const latestWeight = computed(() => bodyWeightStore.latest)
const weightDelta = computed(() => {
  const latest = bodyWeightStore.latest
  const previous = bodyWeightStore.previous

  if (!latest || !previous) {
    return null
  }

  // Les pesées sont au dixième : l'écart aussi, sans bruit flottant.
  return Math.round((latest.kilograms - previous.kilograms) * 10) / 10
})

const RECENT_WEIGHT_COUNT = 5
const recentWeights = computed(() => bodyWeightStore.weights.slice(0, RECENT_WEIGHT_COUNT))

function formatWeightDay(day: string): string {
  // `day` est un jour calendaire sans fuseau : midi UTC évite qu'un fuseau
  // négatif l'affiche la veille.
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
  })
}

async function logTodayWeight() {
  const kilograms = weightInput.value

  // Le dixième est la marche du pèse-personne ; en deçà de 20 kg ou au-delà
  // de 400, c'est une faute de frappe — le même garde-fou que Rust.
  if (
    kilograms === null ||
    !Number.isFinite(kilograms) ||
    Math.round(kilograms * 10) !== kilograms * 10 ||
    kilograms < 20 ||
    kilograms > 400
  ) {
    weightError.value = 'Un poids en kilogrammes, au dixième près, entre 20 et 400.'
    return
  }

  weightError.value = ''
  await bodyWeightStore.logWeight(localDay(), kilograms)
  weightInput.value = null
}
</script>

<template>
  <section class="dashboard" aria-labelledby="dashboard-title">
    <p class="eyebrow">Vue d'ensemble</p>
    <h1 id="dashboard-title">Tableau de bord</h1>

    <div class="alerts-panel" :class="{ 'is-clear': stagnantExercises.length === 0 }" aria-labelledby="alerts-title">
      <span class="panel-label">Stagnation</span>
      <h2 id="alerts-title">
        {{ stagnantExercises.length === 0 ? 'Rien à signaler' : 'Exercices qui stagnent' }}
      </h2>

      <p v-if="stagnantExercises.length === 0" class="empty-state">
        Aucun exercice ne stagne en ce moment : chaque séance progresse ou vient d'être créée.
      </p>

      <ul v-else class="alert-list">
        <li v-for="item in stagnantExercises" :key="`${item.seanceSlug}-${item.exerciseSlug}`">
          <RouterLink
            class="alert-link"
            :to="`/seances/${item.seanceSlug}/exercises/${item.exerciseSlug}`"
          >
            <span class="alert-badge">Stagne</span>
            <span class="alert-body">
              <strong>{{ item.exerciseName }}</strong>
              <span class="alert-seance">{{ item.seanceName }}</span>
            </span>
            <span class="alert-chevron" aria-hidden="true">→</span>
          </RouterLink>
        </li>
      </ul>
    </div>

    <div class="weight-panel" aria-labelledby="weight-title">
      <span class="panel-label">Poids de corps</span>
      <h2 id="weight-title">
        <template v-if="latestWeight">
          {{ latestWeight.kilograms }} kg
          <span v-if="weightDelta !== null" class="weight-delta">
            {{ weightDelta > 0 ? '+' : '' }}{{ weightDelta }} kg depuis la pesée précédente
          </span>
        </template>
        <template v-else>Aucune pesée pour l'instant</template>
      </h2>

      <form class="weight-form" @submit.prevent="logTodayWeight">
        <label>
          <span>Pesée du jour</span>
          <div class="weight-entry">
            <input
              v-model.number="weightInput"
              type="number"
              min="20"
              max="400"
              step="0.1"
              inputmode="decimal"
              :placeholder="latestWeight ? String(latestWeight.kilograms) : '75.0'"
            />
            <span>kg</span>
          </div>
        </label>
        <button type="submit">Enregistrer</button>
      </form>
      <p v-if="weightError" class="weight-error" role="alert">{{ weightError }}</p>

      <ul v-if="recentWeights.length > 0" class="weight-list">
        <li v-for="weight in recentWeights" :key="weight.day">
          <span class="weight-day">{{ formatWeightDay(weight.day) }}</span>
          <strong>{{ weight.kilograms }} kg</strong>
          <button
            type="button"
            class="weight-remove"
            :aria-label="`Retirer la pesée du ${formatWeightDay(weight.day)}`"
            @click="bodyWeightStore.deleteWeight(weight.day)"
          >
            Retirer
          </button>
        </li>
      </ul>
    </div>

    <div class="volume-section">
      <span class="panel-label">Ensemble des séances</span>
      <WeeklyVolumeGraph :sets="seanceStore.allSets" :weight-unit="dashboardWeightUnit" />
    </div>
  </section>
</template>

<style scoped>
.dashboard {
  display: grid;
  gap: 24px;
  width: min(100%, 760px);
  padding: 32px;
  color: var(--text);
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--panel-shadow);
}

.eyebrow {
  margin: 0;
  color: var(--fire);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.9rem, 5vw, 2.5rem);
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.15;
}

.panel-label {
  display: block;
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Le poids de corps partage la carte des alertes : même chair, autre sujet. */
.weight-panel {
  display: grid;
  gap: 12px;
  padding: 20px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
}

.weight-panel h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.4rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.weight-delta {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 0.85rem;
  font-weight: 700;
}

.weight-form {
  display: flex;
  gap: 12px;
  align-items: end;
  flex-wrap: wrap;
}

.weight-form label {
  display: grid;
  gap: 6px;
  font-size: 0.85rem;
  font-weight: 700;
}

.weight-entry {
  display: flex;
  gap: 8px;
  align-items: center;
}

.weight-entry input {
  width: 110px;
}

.weight-error {
  margin: 0;
  color: var(--blood);
  font-size: 0.85rem;
  font-weight: 700;
}

.weight-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.weight-list li {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.weight-day {
  color: var(--muted);
  font-weight: 700;
}

.weight-remove {
  min-height: 36px;
  padding: 0 12px;
  font-size: 0.8rem;
}

.alerts-panel {
  padding: 20px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 2px solid var(--blood);
  border-radius: var(--control-radius);
}

.alerts-panel.is-clear {
  border-left: 2px solid var(--border-strong);
}

.alerts-panel h2 {
  margin: 0 0 12px;
  font-family: var(--font-display);
  font-size: 1.4rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.empty-state {
  margin: 0;
  color: var(--muted);
}

.alert-list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.alert-link {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 14px;
  color: inherit;
  text-decoration: none;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  transition: border-color 0.15s ease;
}

.alert-link:hover {
  border-color: var(--blood);
}

.alert-link:focus-visible {
  border-color: var(--fire);
  outline: 3px solid var(--field-focus-ring);
}

.alert-badge {
  padding: 4px 10px;
  color: var(--blood-text);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  background: var(--blood-dim);
  border: 1px solid var(--blood);
  border-radius: 999px;
}

.alert-body {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}

.alert-body strong {
  color: var(--text-strong);
  font-size: 1rem;
}

.alert-seance {
  color: var(--muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.alert-chevron {
  color: var(--blood-text);
  font-weight: 800;
}

.volume-section :deep(.volume-graph) {
  margin-bottom: 0;
}

@media (max-width: 680px) {
  .dashboard {
    padding: 24px;
  }

  .alert-link {
    flex-wrap: wrap;
  }
}
</style>
