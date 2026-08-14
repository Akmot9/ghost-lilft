<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import ExerciseTracker from '../components/ExerciseTracker.vue'
import { useSeanceStore } from '../stores/seances'
import type { ExerciseSet } from '../lib/trainingInsights'

const props = defineProps<{
  seanceSlug: string
  exerciseSlug: string
}>()

const seanceStore = useSeanceStore()

const exercise = computed(() => seanceStore.findExercise(props.seanceSlug, props.exerciseSlug))

async function addSet(set: ExerciseSet) {
  await seanceStore.addSet(props.seanceSlug, props.exerciseSlug, set)
}

async function removeSet(setId: number) {
  await seanceStore.removeSet(props.seanceSlug, props.exerciseSlug, setId)
}

async function clearSets() {
  await seanceStore.clearSets(props.seanceSlug, props.exerciseSlug)
}
</script>

<template>
  <div class="exercise-tracker-view">
    <template v-if="exercise">
      <ExerciseTracker
        :exercise-name="exercise.name"
        :sets="exercise.sets"
        :default-reps="exercise.defaultReps"
        :default-weight="exercise.defaultWeight"
        :weight-unit="exercise.weightUnit"
        :rest-seconds="exercise.restSeconds"
        @add-set="addSet"
        @remove-set="removeSet"
        @clear-sets="clearSets"
      />

      <RouterLink class="nav-link" :to="`/seances/${props.seanceSlug}`">Retour à la séance</RouterLink>
    </template>

    <section v-else class="not-found">
      <p class="eyebrow">Ghost Lift</p>
      <h1>Exercice introuvable</h1>
      <p>Cet exercice n'existe pas ou plus dans cette séance.</p>
      <RouterLink class="nav-link" :to="`/seances/${props.seanceSlug}`">Retour à la séance</RouterLink>
    </section>
  </div>
</template>

<style scoped>
.exercise-tracker-view {
  display: grid;
  gap: 16px;
  width: min(100%, 760px);
}

.nav-link {
  justify-self: start;
  padding: 12px 16px;
  color: var(--accent-text-on-fill);
  font-weight: 800;
  text-decoration: none;
  background: var(--accent);
  border-radius: var(--control-radius);
}

.nav-link:hover {
  background: var(--accent-hover);
}

.not-found {
  display: grid;
  gap: 12px;
  justify-items: start;
  padding: 32px;
  color: var(--text);
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--panel-shadow);
}

.not-found .eyebrow {
  margin: 0;
  color: var(--fire);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.not-found h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.9rem, 5vw, 2.5rem);
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.15;
}

.not-found p {
  margin: 0;
  color: var(--muted);
}

@media (max-width: 680px) {
  .not-found {
    padding: 24px;
  }

  .nav-link {
    justify-self: stretch;
    text-align: center;
  }
}
</style>
