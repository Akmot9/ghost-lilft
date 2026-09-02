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
// Le programme prescrit un repos propre à chaque exercice (1' à 2'30) :
// la base le gère depuis toujours, le formulaire l'expose enfin (#43).
const restSeconds = ref(180)
const isDumbbell = ref(false)

const totalDefaultWeight = computed(() =>
  isDumbbell.value ? defaultWeight.value * 2 : defaultWeight.value,
)

function toggleDumbbell(event: Event) {
  const next = (event.currentTarget as HTMLInputElement).checked

  // Conserver la charge effective quand on change de référentiel de saisie.
  if (Number.isFinite(defaultWeight.value)) {
    defaultWeight.value = next ? defaultWeight.value / 2 : defaultWeight.value * 2
  }

  isDumbbell.value = next
}

/**
 * Ce qui empêche l'envoi, dit à l'utilisateur au lieu d'échouer en silence
 * (#4). Les mêmes règles que Rust — le formulaire peut être plus strict,
 * jamais plus laxiste.
 */
const validationErrors = computed(() => {
  const errors: string[] = []

  if (!name.value.trim()) {
    errors.push("Donne un nom à l'exercice.")
  }

  if (!Number.isInteger(defaultReps.value) || defaultReps.value < 1) {
    errors.push('Au moins une répétition par défaut.')
  }

  if (
    !Number.isFinite(defaultWeight.value) ||
    defaultWeight.value < 0.5 ||
    Math.round(defaultWeight.value * 2) !== defaultWeight.value * 2
  ) {
    errors.push('Une charge par défaut au demi-kilo près, d’au moins 0,5.')
  }

  if (!Number.isInteger(restSeconds.value) || restSeconds.value < 0) {
    errors.push('Un repos en secondes entières, jamais négatif.')
  }

  return errors
})

// Les erreurs n'apparaissent qu'après une tentative : un formulaire vierge
// n'a rien à reprocher à personne.
const showErrors = ref(false)

async function createExercise() {
  if (validationErrors.value.length > 0) {
    showErrors.value = true
    return
  }

  const exerciseSlug = await seanceStore.addExerciseToSeance(props.seanceSlug, {
    name: name.value,
    defaultReps: defaultReps.value,
    defaultWeight: totalDefaultWeight.value,
    weightUnit: weightUnit.value,
    restSeconds: restSeconds.value,
    isDumbbell: isDumbbell.value,
  })

  if (!exerciseSlug) {
    return
  }

  router.push(`/seances/${props.seanceSlug}`)
}
</script>

<template>
  <section v-if="!seance" class="create-exercise not-found">
    <p class="eyebrow">Revenant</p>
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
        <span>{{ isDumbbell ? 'Poids par haltère' : 'Poids par défaut' }}</span>
        <input
          v-model.number="defaultWeight"
          type="number"
          min="0.5"
          step="0.5"
          inputmode="decimal"
        />
        <span v-if="isDumbbell" class="dumbbell-hint">
          = {{ totalDefaultWeight }} {{ weightUnit }} au total
        </span>
      </label>

      <label class="dumbbell-checkbox">
        <input :checked="isDumbbell" type="checkbox" @change="toggleDumbbell" />
        <span>
          <strong>Exercice aux haltères</strong>
          <small>Saisir le poids d'un haltère, Revenant enregistrera le total ×2.</small>
        </span>
      </label>

      <label>
        <span>Unité</span>
        <input v-model="weightUnit" type="text" autocomplete="off" />
      </label>

      <label>
        <span>Repos (s)</span>
        <input v-model.number="restSeconds" type="number" min="0" step="5" inputmode="numeric" />
        <span class="field-hint">Entre les séries de cet exercice — le minuteur s'y règle.</span>
      </label>

      <ul v-if="showErrors && validationErrors.length > 0" class="form-errors" role="alert">
        <li v-for="message in validationErrors" :key="message">{{ message }}</li>
      </ul>

      <button type="submit">Ajouter l'exercice</button>
    </form>
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

.create-exercise {
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

.dumbbell-hint {
  color: var(--muted);
  font-size: 0.85rem;
}

.dumbbell-checkbox {
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

.empty-state {
  margin: 0;
  color: var(--muted);
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
  background: var(--accent);
  border-radius: var(--control-radius);
}

.button-link:hover {
  background: var(--accent-hover);
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
