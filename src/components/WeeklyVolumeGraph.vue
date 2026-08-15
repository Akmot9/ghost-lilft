<script setup lang="ts">
import { computed } from 'vue'
import { getWeekStart, type ExerciseSet } from '../lib/trainingInsights'

type WeeklyVolume = {
  key: string
  label: string
  /** Clôture : volume total de la semaine. */
  volume: number
  /** Ouverture : volume de la semaine précédente. */
  openVolume: number
  sessionCount: number
  showLabel: boolean
  movingAverage: number
  isLowerThanPrevious: boolean
  /** Bord gauche du corps de la bougie. */
  x: number
  centerX: number
  width: number
  bodyY: number
  bodyHeight: number
  wickTop: number | null
  wickBottom: number | null
  movingAverageY: number
}

const props = defineProps<{
  sets: ExerciseSet[]
  weightUnit: string
}>()

const movingAverageWindow = 3
const chartWidth = 400
const chartHeight = 220
const chartPadding = {
  top: 14,
  right: 12,
  bottom: 34,
  left: 14,
}
/** Écart entre deux bougies : collées, avec juste de quoi les distinguer. */
const candleGap = 2

const weekFormatter = new Intl.DateTimeFormat('fr', {
  month: 'short',
  day: 'numeric',
})

const weeklyVolumes = computed<WeeklyVolume[]>(() => {
  // Une séance = un jour d'entraînement. On garde le détail par séance en plus
  // du total : c'est ce qui permet de dessiner une mèche les rares semaines où
  // le même exercice est travaillé deux fois.
  const totals = new Map<string, { weekStart: Date; volume: number; sessions: Map<string, number> }>()

  for (const set of props.sets) {
    const weekStart = getWeekStart(set.completedAt)
    const key = weekStart.toISOString().slice(0, 10)
    const sessionKey = set.completedAt.toISOString().slice(0, 10)
    const volume = set.reps * set.weight
    const existing = totals.get(key) ?? { weekStart, volume: 0, sessions: new Map<string, number>() }

    existing.volume += volume
    existing.sessions.set(sessionKey, (existing.sessions.get(sessionKey) ?? 0) + volume)
    totals.set(key, existing)
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

  // L'échelle suit les données au lieu de partir de zéro. Un graphe de tendance
  // se lit par la pente, pas par la hauteur des corps : ancré à zéro, une
  // progression réelle de 30 % s'écrasait dans un cinquième du cadre. La marge
  // évite que la bougie extrême touche le bord.
  const sessionVolumes = weeks.flatMap(([, week]) => Array.from(week.sessions.values()))
  const observed = [...volumes, ...movingAverages, ...sessionVolumes]
  const rawMin = Math.min(...observed)
  const rawMax = Math.max(...observed)
  const margin = Math.max(rawMax - rawMin, 1) * 0.12
  const minValue = Math.max(0, rawMin - margin)
  const maxValue = rawMax + margin

  const slot = (chartWidth - chartPadding.left - chartPadding.right) / weeks.length
  const bodyWidth = Math.max(slot - candleGap, 2)

  return weeks.map(([key, week], index) => {
    const previousWeek = weeks[index - 1]?.[1]
    // L'ouverture est la clôture de la semaine précédente : le corps dit le
    // mouvement d'une séance à la suivante, ce qui est la question que se pose
    // le lifteur. La première semaine n'a pas de référence, son corps est plat.
    const openVolume = previousWeek ? previousWeek.volume : week.volume
    const movingAverage = movingAverages[index] ?? week.volume
    const sessions = Array.from(week.sessions.values())

    const openY = getY(openVolume, minValue, maxValue)
    const closeY = getY(week.volume, minValue, maxValue)
    const x = chartPadding.left + index * slot + candleGap / 2

    return {
      key,
      label: weekFormatter.format(week.weekStart),
      volume: week.volume,
      openVolume,
      sessionCount: sessions.length,
      // Au-delà de six semaines, une étiquette sur deux : sinon les dates se
      // chevauchent et deviennent illisibles.
      showLabel: weeks.length <= 6 || index % 2 === 0,
      movingAverage,
      isLowerThanPrevious: previousWeek ? week.volume < previousWeek.volume : false,
      x,
      centerX: x + bodyWidth / 2,
      width: bodyWidth,
      bodyY: Math.min(openY, closeY),
      // Deux pixels minimum : une semaine sans variation reste une bougie
      // visible, pas un trait invisible.
      bodyHeight: Math.max(Math.abs(closeY - openY), 2),
      // Mèche seulement quand la semaine compte plusieurs séances du même
      // exercice — elle montre alors la plus faible et la plus forte.
      wickTop: sessions.length > 1 ? getY(Math.max(...sessions), minValue, maxValue) : null,
      wickBottom: sessions.length > 1 ? getY(Math.min(...sessions), minValue, maxValue) : null,
      movingAverageY: getY(movingAverage, minValue, maxValue),
    }
  })
})
const movingAveragePoints = computed(() =>
  weeklyVolumes.value.map((week) => `${week.centerX},${week.movingAverageY}`).join(' '),
)

const volumeRangeLabel = computed(() => {
  if (weeklyVolumes.value.length === 0) {
    return ''
  }

  const volumes = weeklyVolumes.value.map((week) => week.volume)
  return `${Math.min(...volumes)}-${Math.max(...volumes)} ${props.weightUnit}`
})

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
            {{ week.label }} : {{ week.volume }} {{ weightUnit }} (ouverture
            {{ week.openVolume }} {{ weightUnit }}), MM{{ movingAverageWindow }}
            {{ week.movingAverage }} {{ weightUnit
            }}{{ week.sessionCount > 1 ? `, ${week.sessionCount} séances` : '' }}
          </title>
          <line
            v-if="week.wickTop !== null"
            class="candle-wick"
            :x1="week.centerX"
            :x2="week.centerX"
            :y1="week.wickTop"
            :y2="week.wickBottom ?? week.wickTop"
          />
          <rect
            class="candle-body"
            :x="week.x"
            :y="week.bodyY"
            :width="week.width"
            :height="week.bodyHeight"
          />
          <text
            v-if="week.showLabel"
            class="week-label"
            :x="week.centerX"
            :y="chartHeight - 12"
          >{{ week.label }}</text>
        </g>

        <polyline class="ma-line" :points="movingAveragePoints" />

        <g v-for="week in weeklyVolumes" :key="`${week.key}-ma`">
          <circle class="ma-point" :cx="week.centerX" :cy="week.movingAverageY" r="3" />
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
  width: 100%;
  height: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
}

.axis-line {
  stroke: rgb(255 244 230 / 14%);
  stroke-width: 1;
}

.candle-body {
  fill: var(--gain);
  stroke: none;
}

.candle-wick {
  stroke: var(--gain);
  stroke-linecap: round;
  stroke-width: 2;
}

.volume-candle.lower .candle-body {
  fill: var(--blood);
}

.volume-candle.lower .candle-wick {
  stroke: var(--blood);
}

.week-label {
  fill: var(--muted);
  font-size: 11px;
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
