<script setup lang="ts">
import { computed } from 'vue'
import type { TrainingSession } from '../lib/trainingInsights'

type SessionComparison = {
  label: string
  unit: string
  current: number
  previous: number
  delta: number
  currentWidth: number
  previousWidth: number
}

const props = defineProps<{
  latestSession: TrainingSession | null
  previousSession: TrainingSession | null
  weightUnit: string
}>()

const dateFormatter = new Intl.DateTimeFormat('fr', {
  dateStyle: 'medium',
})

const sessionComparisons = computed<SessionComparison[]>(() => {
  if (!props.latestSession || !props.previousSession) {
    return []
  }

  return [
    createSessionComparison(
      'Charge max',
      props.weightUnit,
      props.latestSession.heaviest,
      props.previousSession.heaviest,
    ),
    createSessionComparison(
      'Volume',
      props.weightUnit,
      props.latestSession.volume,
      props.previousSession.volume,
    ),
    createSessionComparison(
      'Répétitions',
      '',
      props.latestSession.reps,
      props.previousSession.reps,
    ),
  ]
})

function formatSessionDate(date: Date) {
  return dateFormatter.format(date)
}

function formatValue(value: number, unit: string, signed: boolean) {
  const sign = signed && value > 0 ? '+' : ''
  return unit ? `${sign}${value} ${unit}` : `${sign}${value}`
}

function createSessionComparison(
  label: string,
  unit: string,
  current: number,
  previous: number,
): SessionComparison {
  const max = Math.max(current, previous, 1)

  return {
    label,
    unit,
    current,
    previous,
    delta: current - previous,
    currentWidth: Math.max((current / max) * 100, 6),
    previousWidth: Math.max((previous / max) * 100, 6),
  }
}
</script>

<template>
  <section v-if="latestSession" class="session-highlight" aria-labelledby="latest-session-title">
    <div class="session-heading">
      <span class="highlight-label">Écart de séance</span>
      <h2 id="latest-session-title">
        {{ formatSessionDate(latestSession.date) }}
        <span v-if="previousSession">face à {{ formatSessionDate(previousSession.date) }}</span>
      </h2>
    </div>

    <div v-if="previousSession" class="session-comparison">
      <div v-for="comparison in sessionComparisons" :key="comparison.label" class="comparison-row">
        <div class="comparison-topline">
          <span>{{ comparison.label }}</span>
          <strong :class="{ positive: comparison.delta > 0, negative: comparison.delta < 0 }">
            {{ formatValue(comparison.delta, comparison.unit, true) }}
          </strong>
        </div>

        <div class="overlay-comparison">
          <div class="overlay-values">
            <span>Avant {{ formatValue(comparison.previous, comparison.unit, false) }}</span>
            <strong>Maintenant {{ formatValue(comparison.current, comparison.unit, false) }}</strong>
          </div>
          <div class="overlay-rail">
            <div class="bar-ghost" :style="{ width: `${comparison.previousWidth}%` }"></div>
            <div class="bar-now" :style="{ width: `${comparison.currentWidth}%` }"></div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.session-highlight {
  display: grid;
  gap: 18px;
  padding: 20px;
  margin-bottom: 24px;
  background:
    linear-gradient(135deg, rgb(45 212 191 / 11%), transparent 40%),
    rgb(15 23 42 / 82%);
  border: 1px solid rgb(103 232 249 / 24%);
  border-left: 6px solid #67e8f9;
  border-radius: 8px;
}

.session-heading {
  display: flex;
  gap: 16px;
  align-items: end;
  justify-content: space-between;
}

.highlight-label {
  display: block;
  margin-bottom: 8px;
  color: #67e8f9;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

h2 {
  margin-top: 0;
  margin-bottom: 0;
  font-size: 1.4rem;
}

h2 span {
  display: block;
  margin-top: 4px;
  color: #94a3b8;
  font-size: 0.9rem;
  font-weight: 700;
}

.session-comparison {
  display: grid;
  gap: 14px;
}

.comparison-row {
  display: grid;
  gap: 10px;
  padding: 14px;
  background: rgb(2 6 23 / 40%);
  border: 1px solid rgb(148 163 184 / 22%);
  border-radius: 8px;
}

.comparison-topline {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) 74px;
  gap: 12px;
  align-items: center;
}

.comparison-topline span {
  color: #e5edf5;
  font-weight: 800;
}

.comparison-topline strong {
  grid-column: 3;
  justify-self: end;
  color: #e5edf5;
}

.comparison-topline strong.positive {
  color: #5eead4;
}

.comparison-topline strong.negative {
  color: #fb7185;
}

.overlay-comparison {
  display: grid;
  gap: 6px;
}

.overlay-values {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  color: #94a3b8;
  font-size: 0.82rem;
  font-weight: 800;
}

.overlay-values strong {
  color: #f8fafc;
}

.overlay-rail {
  position: relative;
  height: 30px;
  overflow: hidden;
  background: #020617;
  border-radius: 999px;
  box-shadow:
    inset 0 0 0 1px rgb(148 163 184 / 28%),
    inset 0 0 18px rgb(15 23 42 / 90%);
}

.bar-ghost,
.bar-now {
  position: absolute;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  border-radius: 999px;
}

.bar-ghost {
  height: 100%;
  background: repeating-linear-gradient(
    135deg,
    rgb(196 181 253 / 62%) 0,
    rgb(196 181 253 / 62%) 8px,
    rgb(196 181 253 / 26%) 8px,
    rgb(196 181 253 / 26%) 16px
  );
  border: 1px solid rgb(221 214 254 / 72%);
  box-shadow:
    0 0 16px rgb(167 139 250 / 34%),
    inset 0 0 10px rgb(255 255 255 / 10%);
}

.bar-now {
  height: 52%;
  background: #2dd4bf;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 42%);
}

.bar-now::after {
  position: absolute;
  top: -4px;
  right: -2px;
  width: 4px;
  height: calc(100% + 8px);
  content: '';
  background: #5eead4;
  border-radius: 999px;
}

@media (max-width: 680px) {
  .session-heading,
  .comparison-topline {
    grid-template-columns: 1fr;
  }

  .session-heading {
    display: grid;
    align-items: start;
  }

  .comparison-topline strong {
    grid-column: auto;
    justify-self: start;
  }

  .overlay-values {
    display: grid;
    gap: 4px;
  }
}
</style>
