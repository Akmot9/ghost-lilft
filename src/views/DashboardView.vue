<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import WeeklyVolumeGraph from '../components/WeeklyVolumeGraph.vue'
import { isExerciseStagnant } from '../lib/trainingInsights'
import { useSeanceStore } from '../stores/seances'

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
  color: #e5edf5;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--panel-shadow);
}

.eyebrow {
  margin: 0;
  color: #67e8f9;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 6vw, 3.5rem);
  line-height: 1;
}

.panel-label {
  display: block;
  margin-bottom: 8px;
  color: #67e8f9;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.alerts-panel {
  padding: 20px;
  background: linear-gradient(135deg, rgb(159 18 57 / 16%), transparent 45%), rgb(15 23 42 / 82%);
  border: 1px solid rgb(251 113 133 / 28%);
  border-left: 6px solid #fb7185;
  border-radius: 8px;
}

.alerts-panel.is-clear {
  background: rgb(30 41 59 / 72%);
  border: 1px solid rgb(148 163 184 / 22%);
  border-left: 6px solid rgb(148 163 184 / 40%);
}

.alerts-panel h2 {
  margin: 0 0 12px;
  font-size: 1.3rem;
}

.empty-state {
  margin: 0;
  color: #94a3b8;
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
  background: rgb(2 6 23 / 40%);
  border: 1px solid rgb(148 163 184 / 22%);
  border-radius: 8px;
}

.alert-link:hover {
  border-color: rgb(251 113 133 / 46%);
  background: rgb(159 18 57 / 26%);
}

.alert-link:focus-visible {
  border-color: #67e8f9;
  outline: 3px solid rgb(103 232 249 / 18%);
}

.alert-badge {
  padding: 4px 10px;
  color: #fecdd3;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
  white-space: nowrap;
  background: rgb(190 18 60 / 36%);
  border-radius: 999px;
}

.alert-body {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}

.alert-body strong {
  color: #f8fafc;
  font-size: 1rem;
}

.alert-seance {
  color: #fecdd3;
  font-size: 0.84rem;
  font-weight: 700;
}

.alert-chevron {
  color: #fb7185;
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
