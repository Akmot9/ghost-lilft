<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import ExerciseTracker from '../components/ExerciseTracker.vue'
import { useExerciseStore } from '../stores/exercises'
import NextExerciseView from './NextExerciseView.vue'

const props = defineProps<{
  slug: string
}>()

const exerciseStore = useExerciseStore()

const exercise = computed(() => exerciseStore.findBySlug(props.slug))
const previousExercise = computed(() => exerciseStore.getPreviousExercise(props.slug))
const nextExercise = computed(() => exerciseStore.getNextExercise(props.slug))
</script>

<template>
  <div v-if="exercise" class="exercise-view">
    <ExerciseTracker
      :exercise-name="exercise.name"
      :sets="exercise.sets"
      :default-reps="exercise.defaultReps"
      :default-weight="exercise.defaultWeight"
      :weight-unit="exercise.weightUnit"
      @add-set="exerciseStore.addSet(exercise.slug, $event)"
      @remove-set="exerciseStore.removeSet(exercise.slug, $event)"
    />

    <nav class="exercise-nav" aria-label="Navigation exercice">
      <RouterLink
        v-if="previousExercise"
        class="nav-link"
        :to="`/exercises/${previousExercise.slug}`"
      >
        Exercice précédent
      </RouterLink>

      <RouterLink
        class="nav-link next-link"
        :to="nextExercise ? `/exercises/${nextExercise.slug}` : '/exercises/next'"
      >
        Exercice suivant
      </RouterLink>
    </nav>
  </div>

  <NextExerciseView v-else />
</template>

<style scoped>
.exercise-view {
  display: grid;
  gap: 16px;
  width: min(100%, 760px);
}

.exercise-nav {
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.nav-link {
  padding: 12px 16px;
  color: #031926;
  font-weight: 800;
  text-decoration: none;
  background: linear-gradient(180deg, #67e8f9, #2dd4bf);
  border-radius: 6px;
}

.nav-link:hover {
  background: linear-gradient(180deg, #a5f3fc, #5eead4);
}

.next-link {
  margin-left: auto;
}

@media (max-width: 680px) {
  .exercise-nav {
    display: grid;
  }

  .next-link {
    margin-left: 0;
  }

  .nav-link {
    text-align: center;
  }
}
</style>
