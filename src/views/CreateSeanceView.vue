<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSeanceStore } from '../stores/seances'
import type { CreateExerciseInput } from '../stores/seances'
import RestoreBackupButton from '../components/RestoreBackupButton.vue'

type DraftExercise = CreateExerciseInput & { id: number }

const route = useRoute()
const router = useRouter()
const seanceStore = useSeanceStore()

const isOnboarding = computed(() => route.name === 'onboarding')

const heading = computed(() =>
  isOnboarding.value ? 'Bienvenue — crée ta première séance' : 'Nouvelle séance',
)
const intro = computed(() =>
  isOnboarding.value
    ? "Configure cette séance une bonne fois pour toutes : tu la répéteras pendant des mois, sans la repenser à chaque entraînement. C'est la régularité qui fait progresser, pas la nouveauté."
    : 'Ajoute une séance à ton programme. Une fois créée, tu la garderas telle quelle et tu la répéteras dans la durée.',
)
const submitLabel = computed(() =>
  isOnboarding.value ? 'Créer ma première séance' : 'Créer la séance',
)

const seanceName = ref('')

const exerciseName = ref('')
const exerciseReps = ref(5)
const exerciseWeight = ref(20)
const exerciseUnit = ref('kg')

const exercises = ref<DraftExercise[]>([])
let nextDraftId = 1

const canAddExercise = computed(
  () =>
    exerciseName.value.trim().length > 0 && exerciseReps.value >= 1 && exerciseWeight.value >= 1,
)
const canSubmit = computed(() => seanceName.value.trim().length > 0 && exercises.value.length > 0)

function addExercise() {
  if (!canAddExercise.value) {
    return
  }

  exercises.value.push({
    id: nextDraftId++,
    name: exerciseName.value.trim(),
    defaultReps: exerciseReps.value,
    defaultWeight: exerciseWeight.value,
    weightUnit: exerciseUnit.value.trim() || 'kg',
  })

  exerciseName.value = ''
  exerciseReps.value = 5
  exerciseWeight.value = 20
  exerciseUnit.value = 'kg'
}

function removeExercise(id: number) {
  exercises.value = exercises.value.filter((exercise) => exercise.id !== id)
}

async function createSeance() {
  if (!canSubmit.value) {
    return
  }

  const slug = await seanceStore.createSeance(
    seanceName.value,
    exercises.value.map(({ id, ...input }) => input),
  )

  router.push(`/seances/${slug}`)
}
</script>

<template>
  <section class="create-seance" aria-labelledby="create-seance-title">
    <p class="eyebrow">Ghost Lift</p>
    <h1 id="create-seance-title">{{ heading }}</h1>
    <p class="intro">{{ intro }}</p>

    <form @submit.prevent="createSeance">
      <label>
        <span>Nom de la séance</span>
        <input v-model="seanceName" type="text" placeholder="Push day" autocomplete="off" />
      </label>

      <div class="exercises-section">
        <h2>Exercices de la séance</h2>

        <ul v-if="exercises.length > 0" class="exercise-list">
          <li v-for="exercise in exercises" :key="exercise.id">
            <div>
              <strong>{{ exercise.name }}</strong>
              <span>
                {{ exercise.defaultReps }} reps · {{ exercise.defaultWeight }}
                {{ exercise.weightUnit }}
              </span>
            </div>
            <button
              type="button"
              aria-label="Retirer l'exercice"
              @click="removeExercise(exercise.id)"
            >
              Retirer
            </button>
          </li>
        </ul>

        <p v-else class="empty-state">Aucun exercice ajouté pour l'instant.</p>

        <div class="exercise-form">
          <label>
            <span>Nom de l'exercice</span>
            <input
              v-model="exerciseName"
              type="text"
              placeholder="Développé couché"
              autocomplete="off"
            />
          </label>

          <label>
            <span>Reps par défaut</span>
            <input
              v-model.number="exerciseReps"
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
            />
          </label>

          <label>
            <span>Poids par défaut</span>
            <input
              v-model.number="exerciseWeight"
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
            />
          </label>

          <label>
            <span>Unité</span>
            <input v-model="exerciseUnit" type="text" autocomplete="off" />
          </label>

          <button type="button" class="add-exercise" :disabled="!canAddExercise" @click="addExercise">
            Ajouter l'exercice
          </button>
        </div>
      </div>

      <button type="submit" class="submit-button" :disabled="!canSubmit">
        {{ submitLabel }}
      </button>
    </form>

    <RestoreBackupButton />
  </section>
</template>

<style scoped>
.create-seance {
  display: grid;
  gap: 18px;
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

h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.intro {
  margin: 0;
  max-width: 60ch;
  color: var(--muted);
  line-height: 1.5;
}

form {
  display: grid;
  gap: 24px;
}

label {
  display: grid;
  gap: 8px;
  font-weight: 700;
}

label span {
  color: var(--muted);
  font-size: 0.9rem;
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

.exercises-section {
  display: grid;
  gap: 16px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}

.empty-state {
  margin: 0;
  color: var(--muted);
}

.exercise-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.exercise-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
}

.exercise-list li div {
  display: grid;
  gap: 4px;
}

.exercise-list strong {
  color: var(--text-strong);
}

.exercise-list span {
  color: var(--muted);
  font-size: 0.9rem;
}

.exercise-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  align-items: end;
}

.add-exercise {
  grid-column: 1 / -1;
  color: var(--fire);
  background: transparent;
  border: 1px solid var(--border-strong);
}

.add-exercise:hover {
  background: var(--fire-dim);
  border-color: var(--fire);
}

button {
  justify-self: start;
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

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.exercise-list button {
  min-height: 38px;
  padding: 0 12px;
  color: var(--blood-text);
  background: var(--blood-dim);
}

.exercise-list button:hover {
  color: var(--text-strong);
  background: var(--blood);
}

@media (max-width: 680px) {
  .create-seance {
    padding: 24px;
  }

  .exercise-form {
    grid-template-columns: 1fr;
  }

  button {
    justify-self: stretch;
  }
}
</style>
