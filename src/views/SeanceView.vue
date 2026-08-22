<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useSeanceStore } from '../stores/seances'
import { getMostRecentSet } from '../lib/trainingInsights'

const props = defineProps<{
  seanceSlug: string
}>()

const seanceStore = useSeanceStore()

const seance = computed(() => seanceStore.findSeanceBySlug(props.seanceSlug))

const lastSetSummaries = computed(() => {
  const summaries = new Map<string, string>()

  for (const exercise of seance.value?.exercises ?? []) {
    const mostRecentSet = getMostRecentSet(exercise.sets)

    summaries.set(
      exercise.slug,
      mostRecentSet
        ? `Dernière fois : ${mostRecentSet.reps} reps × ${mostRecentSet.weight} ${exercise.weightUnit}`
        : 'Aucune série enregistrée pour le moment',
    )
  }

  return summaries
})

const isRenaming = ref(false)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

function startRenaming() {
  if (!seance.value) {
    return
  }

  nameDraft.value = seance.value.name
  isRenaming.value = true

  nextTick(() => {
    nameInput.value?.focus()
  })
}

async function confirmRenaming() {
  if (!seance.value || !nameDraft.value.trim()) {
    isRenaming.value = false
    return
  }

  await seanceStore.renameSeance(props.seanceSlug, nameDraft.value)
  isRenaming.value = false
}

function cancelRenaming() {
  isRenaming.value = false
}

/**
 * Le réordonnancement est un mode, pas un ornement permanent : à la salle,
 * l'écran de séance sert à ouvrir un exercice, et deux flèches par ligne
 * mettraient une cible à côté de chaque lien pour un geste qu'on fait une
 * fois. Le mode ne s'ouvre que s'il y a au moins deux exercices à permuter.
 */
const isReordering = ref(false)

const canReorder = computed(() => (seance.value?.exercises.length ?? 0) > 1)

/** Annonce le déplacement : la liste bouge sous le doigt, pas sous l'oreille. */
const moveAnnouncement = ref('')

// Le bouton qui vient de servir peut devenir désactivé (l'exercice atteint une
// extrémité) : le focus disparaîtrait alors, renvoyé au début du document. On
// le repose sur la flèche opposée, celle qui ramène l'exercice d'où il vient.
const moveButtons = new Map<string, HTMLButtonElement>()

function keepMoveButton(exerciseSlug: string, direction: 'up' | 'down') {
  return (element: unknown) => {
    const key = `${exerciseSlug}|${direction}`

    if (element) {
      moveButtons.set(key, element as HTMLButtonElement)
    } else {
      moveButtons.delete(key)
    }
  }
}

async function moveExercise(exerciseSlug: string, direction: 'up' | 'down') {
  const moved = await seanceStore.moveExercise(props.seanceSlug, exerciseSlug, direction)

  if (!moved) {
    return
  }

  const exercises = seance.value?.exercises ?? []
  const position = exercises.findIndex((exercise) => exercise.slug === exerciseSlug)
  const name = exercises[position]?.name ?? ''

  moveAnnouncement.value = `${name} déplacé en position ${position + 1} sur ${exercises.length}.`

  await nextTick()

  const opposite = direction === 'up' ? 'down' : 'up'
  const pressed = moveButtons.get(`${exerciseSlug}|${direction}`)
  const fallback = moveButtons.get(`${exerciseSlug}|${opposite}`)

  ;(pressed && !pressed.disabled ? pressed : fallback)?.focus()
}

function toggleReordering() {
  isReordering.value = !isReordering.value
  moveAnnouncement.value = ''
}
</script>

<template>
  <section v-if="!seance" class="seance-view not-found">
    <p class="eyebrow">Revenant</p>
    <h1>Séance introuvable</h1>
    <p class="empty-state">Cette séance n'existe pas ou plus.</p>
    <RouterLink class="button-link" to="/seances">Retour aux séances</RouterLink>
  </section>

  <section v-else class="seance-view" aria-labelledby="seance-title">
    <div class="seance-header">
      <p class="eyebrow">Revenant</p>

      <div v-if="!isRenaming" class="name-row">
        <h1 id="seance-title">{{ seance.name }}</h1>
        <button type="button" class="rename-button" @click="startRenaming">Renommer</button>
      </div>

      <form v-else class="rename-form" @submit.prevent="confirmRenaming">
        <input
          ref="nameInput"
          v-model="nameDraft"
          type="text"
          autocomplete="off"
          @keyup.esc="cancelRenaming"
        />
        <button type="submit">Valider</button>
        <button type="button" class="cancel-button" @click="cancelRenaming">Annuler</button>
      </form>
    </div>

    <div class="exercises-panel">
      <div class="exercises-header">
        <h2>Exercices</h2>

        <button
          v-if="canReorder"
          type="button"
          class="reorder-button"
          :aria-pressed="isReordering"
          @click="toggleReordering"
        >
          {{ isReordering ? 'Terminer' : 'Réordonner' }}
        </button>
      </div>

      <p v-if="seance.exercises.length === 0" class="empty-state">
        Aucun exercice dans cette séance pour le moment.
      </p>

      <p v-if="isReordering" class="reorder-hint">
        Range les exercices dans l'ordre où tu les enchaînes.
      </p>

      <ul v-if="seance.exercises.length > 0" class="exercise-list">
        <li
          v-for="(exercise, index) in seance.exercises"
          :key="exercise.slug"
          :class="['exercise-row', { reordering: isReordering }]"
        >
          <RouterLink
            class="exercise-link"
            :to="`/seances/${seance.slug}/exercises/${exercise.slug}`"
          >
            <span class="exercise-name">{{ exercise.name }}</span>
            <span class="exercise-summary">{{ lastSetSummaries.get(exercise.slug) }}</span>
          </RouterLink>

          <div v-if="isReordering" class="move-controls">
            <button
              :ref="keepMoveButton(exercise.slug, 'up')"
              type="button"
              class="move-button"
              :disabled="index === 0"
              :aria-label="`Monter ${exercise.name}`"
              @click="moveExercise(exercise.slug, 'up')"
            >
              <span aria-hidden="true">↑</span>
            </button>
            <button
              :ref="keepMoveButton(exercise.slug, 'down')"
              type="button"
              class="move-button"
              :disabled="index === seance.exercises.length - 1"
              :aria-label="`Descendre ${exercise.name}`"
              @click="moveExercise(exercise.slug, 'down')"
            >
              <span aria-hidden="true">↓</span>
            </button>
          </div>
        </li>
      </ul>

      <p class="visually-hidden" role="status" aria-live="polite">{{ moveAnnouncement }}</p>

      <RouterLink class="add-exercise-link" :to="`/seances/${seance.slug}/exercises/new`">
        + Ajouter un exercice
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.seance-view {
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

.seance-header {
  display: grid;
  gap: 8px;
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
  margin: 0 0 16px;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.name-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.rename-button {
  min-height: 38px;
  padding: 0 14px;
  color: var(--muted);
  font: inherit;
  font-weight: 700;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--control-radius);
  cursor: pointer;
}

.rename-button:hover {
  color: var(--text);
  border-color: var(--ghost);
}

.rename-form {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.rename-form input {
  flex: 1 1 220px;
  min-height: 48px;
  padding: 0 14px;
  color: var(--text-strong);
  font: inherit;
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  border-radius: var(--control-radius);
}

.rename-form input:focus {
  border-color: var(--field-focus-border);
  outline: 3px solid var(--field-focus-ring);
}

.rename-form button[type='submit'] {
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

.rename-form button[type='submit']:hover {
  background: var(--accent-hover);
}

.cancel-button {
  min-height: 48px;
  padding: 0 18px;
  color: var(--muted);
  font: inherit;
  font-weight: 700;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--control-radius);
  cursor: pointer;
}

.cancel-button:hover {
  color: var(--text);
  border-color: var(--ghost);
}

.exercises-panel {
  padding-top: 8px;
}

.empty-state {
  margin: 0;
  color: var(--muted);
}

.exercises-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.exercises-header h2 {
  margin: 0;
}

.reorder-button {
  min-height: 38px;
  padding: 0 14px;
  color: var(--muted);
  font: inherit;
  font-weight: 700;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--control-radius);
  cursor: pointer;
}

.reorder-button:hover {
  color: var(--text);
  border-color: var(--ghost);
}

.reorder-button[aria-pressed='true'] {
  color: var(--accent-text-on-fill);
  background: var(--accent);
  border-color: transparent;
}

.reorder-hint {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 0.9rem;
}

.exercise-list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0 0 20px;
  list-style: none;
}

.exercise-row.reordering {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
}

.move-controls {
  display: grid;
  gap: 6px;
}

.move-button {
  width: 48px;
  min-height: 44px;
  color: var(--text);
  font: inherit;
  font-size: 1.1rem;
  line-height: 1;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--control-radius);
  cursor: pointer;
}

.move-button:hover:not(:disabled) {
  border-color: var(--fire);
}

.move-button:disabled {
  color: var(--muted);
  cursor: not-allowed;
  opacity: 0.45;
}

/* Visible pour les lecteurs d'écran, absente de l'écran. */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.exercise-link {
  display: grid;
  gap: 6px;
  padding: 16px;
  color: inherit;
  text-decoration: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  transition: border-color 0.15s ease;
}

.exercise-link:hover,
.exercise-link:focus-visible {
  border-color: var(--fire);
  outline: none;
}

.exercise-name {
  color: var(--text-strong);
  font-size: 1.1rem;
  font-weight: 800;
}

.exercise-summary {
  color: var(--muted);
  font-size: 0.9rem;
}

.add-exercise-link {
  display: inline-block;
  color: var(--fire);
  font-weight: 700;
  text-decoration: none;
}

.add-exercise-link:hover {
  text-decoration: underline;
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
  .seance-view {
    padding: 24px;
  }

  .rename-form button,
  .cancel-button {
    flex: 1 1 auto;
  }
}
</style>
