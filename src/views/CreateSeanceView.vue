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
// Le repos propre à l'exercice (#43) : la base le gère depuis la v4, le
// formulaire l'expose enfin — sinon tout retombe sur 180 s.
const exerciseRest = ref(180)
const exerciseIsDumbbell = ref(false)

const exerciseTotalWeight = computed(() =>
  exerciseIsDumbbell.value ? exerciseWeight.value * 2 : exerciseWeight.value,
)

const exercises = ref<DraftExercise[]>([])
let nextDraftId = 1

/** Ce qui empêche d'ajouter l'exercice au brouillon, dit au lieu d'un bouton mort (#4). */
const exerciseErrors = computed(() => {
  const errors: string[] = []

  if (!exerciseName.value.trim()) {
    errors.push("Donne un nom à l'exercice.")
  }

  if (!Number.isInteger(exerciseReps.value) || exerciseReps.value < 1) {
    errors.push('Au moins une répétition par défaut.')
  }

  if (
    !Number.isFinite(exerciseWeight.value) ||
    exerciseWeight.value < 0.5 ||
    Math.round(exerciseWeight.value * 2) !== exerciseWeight.value * 2
  ) {
    errors.push('Une charge au demi-kilo près, d’au moins 0,5.')
  }

  if (!Number.isInteger(exerciseRest.value) || exerciseRest.value < 0) {
    errors.push('Un repos en secondes entières, jamais négatif.')
  }

  return errors
})

const seanceErrors = computed(() => {
  const errors: string[] = []

  if (!seanceName.value.trim()) {
    errors.push('Donne un nom à la séance.')
  }

  if (exercises.value.length === 0) {
    errors.push('Ajoute au moins un exercice : une séance vide ne se crée pas.')
  }

  return errors
})

const showExerciseErrors = ref(false)
const showSeanceErrors = ref(false)

const canAddExercise = computed(() => exerciseErrors.value.length === 0)
const canSubmit = computed(() => seanceErrors.value.length === 0)

function addExercise() {
  if (!canAddExercise.value) {
    showExerciseErrors.value = true
    return
  }

  showExerciseErrors.value = false
  exercises.value.push({
    id: nextDraftId++,
    name: exerciseName.value.trim(),
    defaultReps: exerciseReps.value,
    defaultWeight: exerciseTotalWeight.value,
    weightUnit: exerciseUnit.value.trim() || 'kg',
    restSeconds: exerciseRest.value,
    isDumbbell: exerciseIsDumbbell.value,
  })

  exerciseName.value = ''
  exerciseReps.value = 5
  exerciseWeight.value = 20
  exerciseUnit.value = 'kg'
  exerciseRest.value = 180
  exerciseIsDumbbell.value = false
}

function toggleExerciseDumbbell(event: Event) {
  const next = (event.currentTarget as HTMLInputElement).checked

  if (Number.isFinite(exerciseWeight.value)) {
    exerciseWeight.value = next ? exerciseWeight.value / 2 : exerciseWeight.value * 2
  }

  exerciseIsDumbbell.value = next
}

function removeExercise(id: number) {
  exercises.value = exercises.value.filter((exercise) => exercise.id !== id)
}

async function createSeance() {
  if (!canSubmit.value) {
    showSeanceErrors.value = true
    return
  }

  showSeanceErrors.value = false

  const slug = await seanceStore.createSeance(
    seanceName.value,
    exercises.value.map(({ id, ...input }) => input),
  )

  router.push(`/seances/${slug}`)
}
</script>

<template>
  <section class="create-seance" aria-labelledby="create-seance-title">
    <p class="eyebrow">Revenant</p>
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
                {{ exercise.defaultReps }} reps ·
                <template v-if="exercise.isDumbbell">
                  {{ exercise.defaultWeight / 2 }} {{ exercise.weightUnit }} par haltère ·
                </template>
                {{ exercise.defaultWeight }} {{ exercise.weightUnit }} au total
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
            <span>{{ exerciseIsDumbbell ? 'Poids par haltère' : 'Poids par défaut' }}</span>
            <input
              v-model.number="exerciseWeight"
              type="number"
              min="0.5"
              step="0.5"
              inputmode="decimal"
            />
            <span v-if="exerciseIsDumbbell" class="dumbbell-hint">
              = {{ exerciseTotalWeight }} {{ exerciseUnit }} au total
            </span>
          </label>

          <label>
            <span>Unité</span>
            <input v-model="exerciseUnit" type="text" autocomplete="off" />
          </label>

          <label>
            <span>Repos (s)</span>
            <input
              v-model.number="exerciseRest"
              type="number"
              min="0"
              step="5"
              inputmode="numeric"
            />
            <span class="field-hint">Entre les séries — le minuteur s'y règle.</span>
          </label>

          <label class="dumbbell-checkbox">
            <input
              :checked="exerciseIsDumbbell"
              type="checkbox"
              @change="toggleExerciseDumbbell"
            />
            <span>
              <strong>Exercice aux haltères</strong>
              <small>Saisir un haltère ; le total ×2 sera enregistré.</small>
            </span>
          </label>

          <ul
            v-if="showExerciseErrors && exerciseErrors.length > 0"
            class="form-errors"
            role="alert"
          >
            <li v-for="message in exerciseErrors" :key="message">{{ message }}</li>
          </ul>

          <button type="button" class="add-exercise" @click="addExercise">
            Ajouter l'exercice
          </button>
        </div>
      </div>

      <ul v-if="showSeanceErrors && seanceErrors.length > 0" class="form-errors" role="alert">
        <li v-for="message in seanceErrors" :key="message">{{ message }}</li>
      </ul>

      <button type="submit" class="submit-button">
        {{ submitLabel }}
      </button>
    </form>

    <RestoreBackupButton />
  </section>
</template>

<style scoped>
.form-errors {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 12px 16px 12px 32px;
  color: var(--blood, #b3261e);
  font-size: 0.88rem;
  font-weight: 700;
  background: color-mix(in srgb, var(--blood, #b3261e) 8%, transparent);
  border-radius: 12px;
}

.field-hint {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 600;
}

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

.dumbbell-hint {
  color: var(--muted);
  font-size: 0.85rem;
}

.dumbbell-checkbox {
  grid-column: 1 / -1;
  grid-template-columns: auto 1fr;
  align-items: center;
  padding: 14px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  cursor: pointer;
}

.dumbbell-checkbox input {
  width: 22px;
  min-height: 22px;
  margin: 0;
  accent-color: var(--accent);
}

.dumbbell-checkbox span {
  display: grid;
  gap: 3px;
}

.dumbbell-checkbox strong {
  color: var(--text-strong);
}

.dumbbell-checkbox small {
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 500;
  line-height: 1.35;
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
