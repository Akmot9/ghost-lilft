<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useSeanceStore } from '../stores/seances'

const props = defineProps<{
  seanceSlug: string
}>()

const router = useRouter()
const seanceStore = useSeanceStore()

const seance = computed(() => seanceStore.findSeanceBySlug(props.seanceSlug))

const name = ref('')
const defaultReps = ref(5)
const defaultWeight = ref(20)
const weightUnit = ref('kg')

async function createExercise() {
  if (!name.value.trim() || defaultReps.value < 1 || defaultWeight.value < 1) {
    return
  }

  const exerciseSlug = await seanceStore.addExerciseToSeance(props.seanceSlug, {
    name: name.value,
    defaultReps: defaultReps.value,
    defaultWeight: defaultWeight.value,
    weightUnit: weightUnit.value,
  })

  if (!exerciseSlug) {
    return
  }

  router.push(`/seances/${props.seanceSlug}`)
}
</script>

<template>
  <section v-if="!seance" class="create-exercise not-found">
    <p class="eyebrow">Ghost Lift</p>
    <h1>Séance introuvable</h1>
    <p class="empty-state">Impossible d'ajouter un exercice à une séance qui n'existe pas.</p>
    <RouterLink class="button-link" to="/seances">Retour aux séances</RouterLink>
  </section>

  <section v-else class="create-exercise">
    <p class="eyebrow">{{ seance.name }}</p>
    <h1>Ajouter un exercice</h1>

    <form @submit.prevent="createExercise">
      <label>
        <span>Nom</span>
        <input v-model="name" type="text" placeholder="Squat" autocomplete="off" />
      </label>

      <label>
        <span>Reps par défaut</span>
        <input v-model.number="defaultReps" type="number" min="1" step="1" inputmode="numeric" />
      </label>

      <label>
        <span>Poids par défaut</span>
        <input
          v-model.number="defaultWeight"
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
        />
      </label>

      <label>
        <span>Unité</span>
        <input v-model="weightUnit" type="text" autocomplete="off" />
      </label>

      <button type="submit">Ajouter l'exercice</button>
    </form>
  </section>
</template>

<style scoped>
.create-exercise {
  display: grid;
  gap: 18px;
  width: min(100%, 760px);
  padding: 32px;
  color: #e5edf5;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--panel-shadow);
}

form {
  display: grid;
  gap: 16px;
}

label {
  display: grid;
  gap: 8px;
  font-weight: 700;
}

label span {
  color: #cbd5e1;
  font-size: 0.9rem;
}

input {
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  color: #f8fafc;
  font: inherit;
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  border-radius: 6px;
}

input:focus {
  border-color: var(--field-focus-border);
  outline: 3px solid var(--field-focus-ring);
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

button {
  justify-self: start;
  min-height: 48px;
  padding: 0 18px;
  color: var(--accent-text-on-fill);
  font: inherit;
  font-weight: 800;
  background: var(--accent-gradient);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

button:hover {
  background: var(--accent-gradient-hover);
}

.empty-state {
  margin: 0;
  color: #94a3b8;
}

.button-link {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  padding: 0 18px;
  color: var(--accent-text-on-fill);
  font-weight: 800;
  text-decoration: none;
  background: var(--accent-gradient);
  border-radius: 6px;
}

.button-link:hover {
  background: var(--accent-gradient-hover);
}

.not-found {
  gap: 16px;
}

@media (max-width: 680px) {
  .create-exercise {
    padding: 24px;
  }

  button {
    justify-self: stretch;
  }
}
</style>
