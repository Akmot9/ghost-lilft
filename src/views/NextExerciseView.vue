<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useExerciseStore } from '../stores/exercises'

const router = useRouter()
const exerciseStore = useExerciseStore()

const name = ref('')
const defaultReps = ref(5)
const defaultWeight = ref(20)
const weightUnit = ref('kg')

function createExercise() {
  if (!name.value.trim() || defaultReps.value < 1 || defaultWeight.value < 1) {
    return
  }

  const slug = exerciseStore.createExercise({
    name: name.value,
    defaultReps: defaultReps.value,
    defaultWeight: defaultWeight.value,
    weightUnit: weightUnit.value,
  })

  router.push(`/exercises/${slug}`)
}
</script>

<template>
  <section class="next-exercise">
    <p class="eyebrow">Ghost Lift</p>
    <h1>Créer un exercice</h1>

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

      <button type="submit">Créer l'exercice suivant</button>
    </form>
  </section>
</template>

<style scoped>
.next-exercise {
  display: grid;
  gap: 18px;
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
  background: #111827;
  border: 1px solid rgb(148 163 184 / 38%);
  border-radius: 6px;
}

input:focus {
  border-color: #67e8f9;
  outline: 3px solid rgb(103 232 249 / 18%);
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

@media (max-width: 680px) {
  .next-exercise {
    padding: 24px;
  }

  button {
    justify-self: stretch;
  }
}
</style>
