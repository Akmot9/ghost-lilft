<script setup lang="ts">
import { computed } from 'vue'
import { summarizeSeance, type SeanceExerciseInput } from '../lib/seanceInsights'

const props = defineProps<{
  exercises: SeanceExerciseInput[]
}>()

const overview = computed(() => summarizeSeance(props.exercises))

const numberFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const dateFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const longDateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })

function formatVolume(volume: number, unit = overview.value.weightUnit) {
  return `${numberFormatter.format(volume)} ${unit}`
}

function formatDelta(delta: number, unit = overview.value.weightUnit) {
  if (delta === 0) {
    return 'identique'
  }

  return `${delta > 0 ? '+' : '−'}${numberFormatter.format(Math.abs(delta))} ${unit}`
}

function deltaClass(delta: number | null) {
  return {
    positive: delta !== null && delta > 0,
    negative: delta !== null && delta < 0,
  }
}

type ExerciseVolume = (typeof overview.value.exercises)[number]

// Un exercice absent des deux séances n'a rien à comparer : « identique »
// entre deux zéros ne dirait rien, et il ne compte pas dans la progression.
function isComparable(exercise: ExerciseVolume) {
  return exercise.delta !== null && (exercise.latest > 0 || (exercise.previous ?? 0) > 0)
}

/** Exercices qui ont battu leur volume de la séance précédente. */
const progressingCount = computed(
  () => overview.value.exercises.filter((exercise) => isComparable(exercise) && exercise.delta! > 0).length,
)
const comparableCount = computed(() => overview.value.exercises.filter(isComparable).length)

// Toutes les barres partagent la même échelle, ancrée à zéro : la longueur
// dit le volume, et un exercice sauté reste un vide honnête.
const maxVolume = computed(() =>
  Math.max(
    ...overview.value.exercises.flatMap((exercise) => [exercise.latest, exercise.previous ?? 0]),
    1,
  ),
)

function barWidth(volume: number) {
  return `${(volume / maxVolume.value) * 100}%`
}

function exerciseLabel(exercise: ExerciseVolume) {
  const latest = `${exercise.name} : ${formatVolume(exercise.latest, exercise.weightUnit)} à la dernière séance`

  return exercise.previous === null
    ? latest
    : `${latest}, ${formatVolume(exercise.previous, exercise.weightUnit)} à la précédente`
}
</script>

<template>
  <section class="seance-overview" aria-labelledby="seance-overview-title">
    <header class="overview-head">
      <div>
        <h2 id="seance-overview-title">Bilan de la séance</h2>
        <p v-if="overview.latest">
          Dernière séance le {{ longDateFormatter.format(overview.latest.date) }}
          <template v-if="overview.previous">
            · face au {{ longDateFormatter.format(overview.previous.date) }}
          </template>
        </p>
      </div>
    </header>

    <p v-if="!overview.latest" class="overview-empty">
      Enregistre des séries sur un exercice pour voir le bilan de la séance.
    </p>

    <template v-else>
      <div class="overview-stats" aria-label="Chiffres de la séance">
        <div class="stat-tile">
          <span>Volume dernière séance</span>
          <strong>{{ formatVolume(overview.latest.volume) }}</strong>
          <em
            v-if="overview.volumeDelta !== null"
            class="stat-delta"
            :class="deltaClass(overview.volumeDelta)"
          >
            {{ formatDelta(overview.volumeDelta) }}
          </em>
          <em v-else class="stat-delta">première séance</em>
        </div>

        <div class="stat-tile">
          <span>Exercices en progression</span>
          <strong v-if="overview.previous">{{ progressingCount }} / {{ comparableCount }}</strong>
          <strong v-else>—</strong>
          <em class="stat-delta">{{ overview.latest.exercisesDone }} exercice{{ overview.latest.exercisesDone > 1 ? 's' : '' }} fait{{ overview.latest.exercisesDone > 1 ? 's' : '' }}</em>
        </div>

        <div class="stat-tile">
          <span>Séances enregistrées</span>
          <strong>{{ overview.sessions.length }}</strong>
          <em class="stat-delta">
            depuis le {{ dateFormatter.format(overview.sessions[overview.sessions.length - 1]!.date) }}
          </em>
        </div>
      </div>

      <div class="overview-legend" aria-label="Légende du graphique">
        <span>
          <i class="legend-swatch legend-swatch--latest" aria-hidden="true"></i>
          Dernière · {{ dateFormatter.format(overview.latest.date) }}
        </span>
        <span v-if="overview.previous">
          <i class="legend-swatch legend-swatch--ghost" aria-hidden="true"></i>
          Fantôme · {{ dateFormatter.format(overview.previous.date) }}
        </span>
      </div>

      <ul class="exercise-volumes" aria-label="Volume par exercice">
        <li
          v-for="exercise in overview.exercises"
          :key="exercise.slug"
          class="exercise-volume"
          :class="{ 'exercise-volume--skipped': exercise.latest === 0 }"
        >
          <div class="exercise-volume-topline">
            <span class="exercise-volume-name">{{ exercise.name }}</span>
            <span class="exercise-volume-values">
              <strong v-if="exercise.latest > 0">
                {{ formatVolume(exercise.latest, exercise.weightUnit) }}
              </strong>
              <strong v-else class="skipped">non fait</strong>
              <em
                v-if="isComparable(exercise)"
                class="exercise-volume-delta"
                :class="deltaClass(exercise.delta)"
              >
                {{ formatDelta(exercise.delta ?? 0, exercise.weightUnit) }}
              </em>
            </span>
          </div>
          <div class="volume-rail" role="img" :aria-label="exerciseLabel(exercise)">
            <div
              v-if="exercise.previous"
              class="volume-bar volume-bar--ghost"
              :style="{ width: barWidth(exercise.previous) }"
            ></div>
            <div
              v-if="exercise.latest > 0"
              class="volume-bar volume-bar--latest"
              :style="{ width: barWidth(exercise.latest) }"
            ></div>
          </div>
          <small v-if="exercise.isOtherUnit" class="other-unit">
            En {{ exercise.weightUnit }} : hors du volume total.
          </small>
        </li>
      </ul>

      <p v-if="!overview.previous" class="overview-note">
        Le fantôme apparaîtra après une deuxième séance.
      </p>
    </template>
  </section>
</template>

<style scoped>
.seance-overview {
  display: grid;
  gap: 16px;
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
}

.overview-head h2 {
  margin: 0;
  font-size: 1.05rem;
  letter-spacing: -0.02em;
}

.overview-head p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 0.82rem;
}

.overview-empty,
.overview-note {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.overview-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.stat-tile {
  display: grid;
  gap: 6px;
  align-content: start;
  min-height: 92px;
  padding: 14px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
}

.stat-tile span {
  color: var(--muted);
  font-size: 0.82rem;
}

.stat-tile strong {
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.stat-delta {
  color: var(--muted);
  font-size: 0.8rem;
  font-style: normal;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.positive {
  color: var(--gain-text);
}

.negative {
  color: var(--blood-text);
}

.overview-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  color: var(--muted);
  font-size: 0.78rem;
}

.overview-legend span {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.legend-swatch {
  width: 18px;
  height: 8px;
  border-radius: 999px;
}

.legend-swatch--latest {
  background: var(--fire);
}

.legend-swatch--ghost {
  background-color: var(--ghost);
  background-image: repeating-linear-gradient(
    135deg,
    transparent 0,
    transparent 3px,
    var(--ghost-bright) 3px,
    var(--ghost-bright) 5px
  );
}

.exercise-volumes {
  display: grid;
  gap: 14px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.exercise-volume {
  display: grid;
  gap: 6px;
}

.exercise-volume-topline {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
}

.exercise-volume-name {
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.exercise-volume-values {
  display: inline-flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: baseline;
  font-variant-numeric: tabular-nums;
}

.exercise-volume-values strong {
  font-family: var(--font-num);
  font-size: 0.95rem;
}

.exercise-volume-values .skipped {
  color: var(--muted);
  font-family: inherit;
  font-weight: 600;
}

.exercise-volume-delta {
  color: var(--muted);
  font-size: 0.8rem;
  font-style: normal;
  font-weight: 700;
}

/* Deux barres superposées sur le même rail, à la même échelle : le fantôme
   hachuré derrière, la dernière séance en laiton devant. La superposition
   se lit d'un coup d'œil — laiton qui dépasse, on a progressé. */
.volume-rail {
  position: relative;
  height: 12px;
  overflow: hidden;
  background: var(--surface-2);
  border-radius: 999px;
}

.volume-bar {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
}

.volume-bar--ghost {
  background-color: var(--ghost-dim);
  background-image: repeating-linear-gradient(
    135deg,
    transparent 0,
    transparent 3px,
    var(--ghost) 3px,
    var(--ghost) 4px
  );
  border: 1px dashed var(--ghost);
}

.volume-bar--latest {
  top: 3px;
  bottom: 3px;
  background: var(--fire);
}

.exercise-volume--skipped .exercise-volume-name {
  color: var(--muted);
}

.other-unit {
  color: var(--muted);
  font-size: 0.78rem;
}

@media (max-width: 680px) {
  .overview-stats {
    grid-template-columns: 1fr;
  }

  .stat-tile {
    min-height: 0;
  }
}
</style>
