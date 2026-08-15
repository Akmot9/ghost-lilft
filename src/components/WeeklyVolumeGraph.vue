<script setup lang="ts">
import { computed } from 'vue'
import { getWeekStart, type ExerciseSet } from '../lib/trainingInsights'

type WeeklyVolume = {
  key: string
  label: string
  volume: number
  movingAverage: number
  isLowerThanPrevious: boolean
  x: number
  y: number
  previousY: number
  movingAverageY: number
}

const props = defineProps<{
  sets: ExerciseSet[]
  weightUnit: string
}>()

const movingAverageWindow = 3
const chartWidth = 720
const chartHeight = 260
const chartPadding = {
  top: 18,
  right: 22,
  bottom: 42,
  left: 56,
}

const weekFormatter = new Intl.DateTimeFormat('fr', {
  month: 'short',
  day: 'numeric',
})

const weeklyVolumes = computed<WeeklyVolume[]>(() => {
  const totals = new Map<string, { weekStart: Date; volume: number }>()

  for (const set of props.sets) {
    const weekStart = getWeekStart(set.completedAt)
    const key = weekStart.toISOString().slice(0, 10)
    const existing = totals.get(key)
    const volume = set.reps * set.weight

    if (existing) {
      existing.volume += volume
    } else {
      totals.set(key, { weekStart, volume })
    }
  }

  const weeks = Array.from(totals.entries()).sort(
    ([, first], [, second]) => first.weekStart.getTime() - second.weekStart.getTime(),
  )

  const volumes = weeks.map(([, week]) => week.volume)
  const movingAverages = volumes.map((_, index) => {
    const start = Math.max(0, index - movingAverageWindow + 1)
    const values = volumes.slice(start, index + 1)

    return Math.round(values.reduce((total, volume) => total + volume, 0) / values.length)
  })
  const maxValue = Math.max(...volumes, ...movingAverages, 1)
  const minValue = Math.min(...volumes, ...movingAverages, 0)

  return weeks.map(([key, week], index) => {
    const previousWeek = weeks[index - 1]?.[1]
    const previousVolume = previousWeek ? previousWeek.volume : week.volume
    const movingAverage = movingAverages[index] ?? week.volume
    const x = getX(index, weeks.length)

    return {
      key,
      label: weekFormatter.format(week.weekStart),
      volume: week.volume,
      movingAverage,
      isLowerThanPrevious: previousWeek ? week.volume < previousWeek.volume : false,
      x,
      y: getY(week.volume, minValue, maxValue),
      previousY: getY(previousVolume, minValue, maxValue),
      movingAverageY: getY(movingAverage, minValue, maxValue),
    }
  })
})
const movingAveragePoints = computed(() =>
  weeklyVolumes.value.map((week) => `${week.x},${week.movingAverageY}`).join(' '),
)

const volumeRangeLabel = computed(() => {
  if (weeklyVolumes.value.length === 0) {
    return ''
  }

  const volumes = weeklyVolumes.value.map((week) => week.volume)
  return `${Math.min(...volumes)}-${Math.max(...volumes)} ${props.weightUnit}`
})

function getX(index: number, total: number) {
  if (total <= 1) {
    return chartWidth / 2
  }

  const usableWidth = chartWidth - chartPadding.left - chartPadding.right
  return chartPadding.left + (usableWidth / (total - 1)) * index
}

function getY(value: number, minValue: number, maxValue: number) {
  const usableHeight = chartHeight - chartPadding.top - chartPadding.bottom
  const range = Math.max(maxValue - minValue, 1)
  return chartPadding.top + usableHeight - ((value - minValue) / range) * usableHeight
}

</script>

<template>
  <section class="volume-graph" aria-labelledby="weekly-volume-title">
    <div class="graph-header">
      <div>
        <h2 id="weekly-volume-title">Tendance du volume hebdomadaire</h2>
        <span>MM{{ movingAverageWindow }} {{ volumeRangeLabel }}</span>
      </div>
      <span>{{ weeklyVolumes.length }} semaines</span>
    </div>

    <p v-if="weeklyVolumes.length === 0" class="empty-state">
      Ajoute des séries pour voir la progression hebdomadaire.
    </p>

    <!-- Une semaine ne fait pas une tendance. L'échelle étant ancrée à zéro,
         l'unique valeur se dessinerait tout en haut du cadre, le reste vide :
         un graphe qui ressemble à une panne, dans l'état où se trouve tout
         nouvel utilisateur. Mieux vaut annoncer l'attente. -->
    <p v-else-if="weeklyVolumes.length === 1" class="empty-state">
      Première semaine enregistrée : {{ weeklyVolumes[0]?.volume }} {{ weightUnit }}. La tendance
      apparaîtra dès ta deuxième semaine d'entraînement.
    </p>

    <div v-else class="chart-shell" aria-label="Volume de l'exercice par semaine">
      <svg class="trading-chart" :viewBox="`0 0 ${chartWidth} ${chartHeight}`" role="img">
        <line
          class="axis-line"
          :x1="chartPadding.left"
          :x2="chartWidth - chartPadding.right"
          :y1="chartHeight - chartPadding.bottom"
          :y2="chartHeight - chartPadding.bottom"
        />
        <line
          class="axis-line"
          :x1="chartPadding.left"
          :x2="chartPadding.left"
          :y1="chartPadding.top"
          :y2="chartHeight - chartPadding.bottom"
        />

        <g
          v-for="week in weeklyVolumes"
          :key="week.key"
          class="volume-candle"
          :class="{ lower: week.isLowerThanPrevious }"
        >
          <title>
            {{ week.label }} : {{ week.volume }} {{ weightUnit }}, MM{{ movingAverageWindow }}
            {{ week.movingAverage }} {{ weightUnit }}
          </title>
          <line class="range-line" :x1="week.x" :x2="week.x" :y1="week.previousY" :y2="week.y" />
          <line class="open-tick" :x1="week.x - 12" :x2="week.x" :y1="week.previousY" :y2="week.previousY" />
          <line class="close-tick" :x1="week.x" :x2="week.x + 12" :y1="week.y" :y2="week.y" />
          <text class="week-label" :x="week.x" :y="chartHeight - 16">{{ week.label }}</text>
        </g>

        <polyline class="ma-line" :points="movingAveragePoints" />

        <g v-for="week in weeklyVolumes" :key="`${week.key}-ma`">
          <circle class="ma-point" :cx="week.x" :cy="week.movingAverageY" r="3" />
        </g>
      </svg>

      <div class="legend">
        <span><i class="legend-up"></i>Semaine en hausse / stable</span>
        <span><i class="legend-down"></i>Semaine en baisse</span>
        <span><i class="legend-ma"></i>Moyenne mobile</span>
      </div>

      <div class="latest-values">
        <div
          v-for="week in weeklyVolumes"
          :key="`${week.key}-value`"
          :class="{ lower: week.isLowerThanPrevious }"
        >
          <span>{{ week.label }}</span>
          <strong>{{ week.volume }} {{ weightUnit }}</strong>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.volume-graph {
  padding: 20px;
  margin-bottom: 24px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
}

.graph-header {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.graph-header div {
  display: grid;
  gap: 4px;
}

h2,
p {
  margin-top: 0;
}

h2 {
  margin-bottom: 0;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.graph-header span,
.empty-state,
.bar-label {
  color: var(--muted);
}

.empty-state {
  margin-bottom: 0;
}

.chart-shell {
  overflow-x: auto;
}

.trading-chart {
  display: block;
  width: max(100%, 720px);
  min-height: 260px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
}

.axis-line {
  stroke: rgb(255 244 230 / 14%);
  stroke-width: 1;
}

.range-line,
.open-tick,
.close-tick {
  stroke: var(--gain);
  stroke-linecap: round;
  stroke-width: 4;
}

.volume-candle.lower .range-line,
.volume-candle.lower .open-tick,
.volume-candle.lower .close-tick {
  stroke: var(--blood);
}

.week-label {
  fill: var(--muted);
  font-size: 0.82rem;
  font-weight: 700;
  text-anchor: middle;
}

.ma-line {
  fill: none;
  stroke: var(--ghost);
  stroke-dasharray: 1 7;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 3;
}

.ma-point {
  fill: var(--ghost-bright);
  stroke: var(--bg);
  stroke-width: 2;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 800;
}

.legend span {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.legend i {
  width: 18px;
  height: 4px;
  border-radius: 999px;
}

.legend-up {
  background: var(--gain);
}

.legend-down {
  background: var(--blood);
}

.legend-ma {
  background: var(--ghost);
}

.latest-values {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.latest-values div {
  display: grid;
  gap: 3px;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
}

.latest-values span {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.latest-values strong {
  color: var(--text);
  font-size: 0.86rem;
  font-variant-numeric: tabular-nums;
}

.latest-values .lower strong {
  color: var(--blood-text);
}
</style>
