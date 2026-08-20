<script setup lang="ts">
import { computed } from 'vue'
import type { ExerciseSet, TrainingSession } from '../lib/trainingInsights'

const props = withDefaults(
  defineProps<{
    latestSession: TrainingSession | null
    previousSession: TrainingSession | null
    weightUnit?: string
  }>(),
  {
    weightUnit: 'kg',
  },
)

const MAX_SERIES = 3

// Les séries d'une session sont rangées de la plus récente à la plus ancienne
// dans trainingInsights. Le graphique les remet dans l'ordre réalisé afin que
// S1 soit bien comparée à S1, S2 à S2 et S3 à S3.
function chronologicalSets(session: TrainingSession | null) {
  return session ? [...session.sets].reverse().slice(0, MAX_SERIES) : []
}

const latestSets = computed(() => chronologicalSets(props.latestSession))
const ghostSets = computed(() => chronologicalSets(props.previousSession))
const seriesCount = computed(() => Math.max(latestSets.value.length, ghostSets.value.length))
const hasData = computed(() => seriesCount.value > 0)

const pairs = computed(() =>
  Array.from({ length: seriesCount.value }, (_, index) => ({
    position: index + 1,
    latest: latestSets.value[index] ?? null,
    ghost: ghostSets.value[index] ?? null,
  })),
)

const maxWeight = computed(() => {
  const weights = [...latestSets.value, ...ghostSets.value].map((set) => set.weight)
  return Math.max(...weights, 1)
})

const numberFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })
const dateFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

function formatWeight(weight: number) {
  return numberFormatter.format(weight)
}

function formatDate(session: TrainingSession | null) {
  return session ? dateFormatter.format(session.date) : ''
}

function barHeight(set: ExerciseSet) {
  // Une petite hauteur minimale garde les charges très légères perceptibles,
  // tandis que l'échelle part toujours de zéro pour ne pas amplifier l'écart.
  return `${Math.max((set.weight / maxWeight.value) * 100, 8)}%`
}

function accessibleSetLabel(set: ExerciseSet, position: number, isGhost: boolean) {
  const sessionLabel = isGhost ? 'fantôme' : 'dernière séance'
  return `Série ${position}, ${sessionLabel} : ${set.reps} répétitions à ${formatWeight(set.weight)} ${props.weightUnit}`
}
</script>

<template>
  <section class="set-ghost-card" aria-labelledby="set-ghost-title">
    <header class="set-ghost-head">
      <div>
        <h2 id="set-ghost-title">Séries face au fantôme</h2>
        <p>Charge totale par position</p>
      </div>
    </header>

    <template v-if="hasData">
      <div class="set-ghost-legend" aria-label="Légende du graphique">
        <span>
          <i class="legend-swatch legend-swatch--latest" aria-hidden="true"></i>
          Dernière<span v-if="latestSession"> · {{ formatDate(latestSession) }}</span>
        </span>
        <span v-if="previousSession">
          <i class="legend-swatch legend-swatch--ghost" aria-hidden="true"></i>
          Fantôme · {{ formatDate(previousSession) }}
        </span>
      </div>

      <div
        class="set-ghost-chart"
        role="group"
        aria-label="Comparaison des trois dernières séries avec leur fantôme"
      >
        <div v-for="pair in pairs" :key="pair.position" class="set-pair">
          <div class="set-pair-bars">
            <div class="set-bar-column">
              <span class="set-bar-value" :class="{ 'set-bar-value--empty': !pair.latest }">
                {{ pair.latest ? `${pair.latest.reps} × ${formatWeight(pair.latest.weight)}` : '—' }}
              </span>
              <div class="set-bar-track">
                <div
                  v-if="pair.latest"
                  class="set-bar set-bar--latest"
                  :style="{ height: barHeight(pair.latest) }"
                  role="img"
                  :aria-label="accessibleSetLabel(pair.latest, pair.position, false)"
                ></div>
              </div>
            </div>

            <div class="set-bar-column">
              <span class="set-bar-value" :class="{ 'set-bar-value--empty': !pair.ghost }">
                {{ pair.ghost ? `${pair.ghost.reps} × ${formatWeight(pair.ghost.weight)}` : '—' }}
              </span>
              <div class="set-bar-track">
                <div
                  v-if="pair.ghost"
                  class="set-bar set-bar--ghost"
                  :style="{ height: barHeight(pair.ghost) }"
                  role="img"
                  :aria-label="accessibleSetLabel(pair.ghost, pair.position, true)"
                ></div>
              </div>
            </div>
          </div>
          <strong class="set-position">S{{ pair.position }}</strong>
        </div>
      </div>

      <p v-if="!previousSession" class="set-ghost-note">
        Le fantôme apparaîtra après une deuxième séance.
      </p>
    </template>

    <p v-else class="set-ghost-empty">
      Enregistre une première série pour afficher sa progression.
    </p>
  </section>
</template>

<style scoped>
.set-ghost-card {
  padding: 20px;
  margin-bottom: 24px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
}

.set-ghost-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.set-ghost-head h2 {
  margin: 0;
  font-size: 1.05rem;
  letter-spacing: -0.02em;
}

.set-ghost-head p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 0.82rem;
}

.set-ghost-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 16px;
  color: var(--muted);
  font-size: 0.78rem;
}

.set-ghost-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

.set-ghost-chart {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  min-height: 188px;
  padding: 16px 12px 12px;
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 16px;
}

.set-pair {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-width: 0;
}

.set-pair-bars {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
  gap: 6px;
  min-height: 144px;
}

.set-bar-column {
  display: grid;
  grid-template-rows: 22px minmax(0, 1fr);
  min-width: 0;
}

.set-bar-value {
  overflow: hidden;
  color: var(--text);
  font-size: clamp(0.66rem, 2.7vw, 0.78rem);
  font-weight: 700;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}

.set-bar-value--empty {
  color: var(--muted);
}

.set-bar-track {
  display: flex;
  align-items: flex-end;
  min-width: 0;
  border-bottom: 1px solid var(--border);
}

.set-bar {
  width: 100%;
  min-height: 8px;
  border-radius: 8px 8px 3px 3px;
  transform-origin: bottom;
  animation: grow-bar 320ms ease-out both;
}

.set-bar--latest {
  background: linear-gradient(180deg, var(--fire), var(--fire-hover));
}

.set-bar--ghost {
  background-color: var(--ghost);
  background-image: repeating-linear-gradient(
    135deg,
    transparent 0,
    transparent 6px,
    var(--ghost-bright) 6px,
    var(--ghost-bright) 9px
  );
}

.set-position {
  margin-top: 8px;
  color: var(--muted);
  font-size: 0.78rem;
  text-align: center;
}

.set-ghost-note,
.set-ghost-empty {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.set-ghost-empty {
  margin-top: 0;
  padding: 20px;
  text-align: center;
  background: var(--surface-2);
  border-radius: 16px;
}

@keyframes grow-bar {
  from {
    transform: scaleY(0);
  }
}

@media (max-width: 420px) {
  .set-ghost-card {
    padding: 16px;
  }

  .set-ghost-chart {
    gap: 8px;
    padding-inline: 8px;
  }

  .set-pair-bars {
    gap: 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .set-bar {
    animation: none;
  }
}
</style>
