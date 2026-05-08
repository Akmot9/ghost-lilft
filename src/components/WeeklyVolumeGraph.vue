<script setup lang="ts">
import { computed } from 'vue'

type BenchSet = {
  id: number
  reps: number
  weight: number
  completedAt: Date
}

type WeeklyVolume = {
  key: string
  label: string
  volume: number
  height: number
  isLowerThanPrevious: boolean
}

const props = defineProps<{
  sets: BenchSet[]
}>()

const weekFormatter = new Intl.DateTimeFormat('en', {
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
  const maxVolume = Math.max(...weeks.map(([, week]) => week.volume), 0)

  return weeks.map(([key, week], index) => {
    const previousWeek = weeks[index - 1]?.[1]

    return {
      key,
      label: weekFormatter.format(week.weekStart),
      volume: week.volume,
      height: maxVolume > 0 ? Math.max((week.volume / maxVolume) * 100, 8) : 0,
      isLowerThanPrevious: previousWeek ? week.volume < previousWeek.volume : false,
    }
  })
})

function getWeekStart(date: Date) {
  const weekStart = new Date(date)
  weekStart.setHours(0, 0, 0, 0)

  const day = weekStart.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  weekStart.setDate(weekStart.getDate() + mondayOffset)

  return weekStart
}
</script>

<template>
  <section class="volume-graph" aria-labelledby="weekly-volume-title">
    <div class="graph-header">
      <h2 id="weekly-volume-title">Weekly volume</h2>
      <span>{{ weeklyVolumes.length }} weeks</span>
    </div>

    <p v-if="weeklyVolumes.length === 0" class="empty-state">Add sets to see weekly progression.</p>

    <div v-else class="chart" aria-label="Bench press volume by week">
      <div
        v-for="week in weeklyVolumes"
        :key="week.key"
        class="bar-column"
        :class="{ lower: week.isLowerThanPrevious }"
        :title="`${week.label}: ${week.volume} kg`"
      >
        <span class="bar-value">{{ week.volume }} kg</span>
        <div class="bar-track">
          <div class="bar-fill" :style="{ height: `${week.height}%` }"></div>
        </div>
        <span class="bar-label">{{ week.label }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.volume-graph {
  padding: 20px;
  margin-bottom: 24px;
  background: rgb(15 23 42 / 74%);
  border: 1px solid rgb(148 163 184 / 22%);
  border-radius: 8px;
}

.graph-header {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

h2,
p {
  margin-top: 0;
}

h2 {
  margin-bottom: 0;
  font-size: 1.1rem;
}

.graph-header span,
.empty-state,
.bar-label {
  color: #94a3b8;
}

.empty-state {
  margin-bottom: 0;
}

.chart {
  display: grid;
  grid-auto-columns: minmax(74px, 1fr);
  grid-auto-flow: column;
  gap: 14px;
  min-height: 220px;
  overflow-x: auto;
}

.bar-column {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 8px;
  min-width: 74px;
  text-align: center;
}

.bar-value {
  min-height: 20px;
  color: #e5edf5;
  font-size: 0.82rem;
  font-weight: 800;
}

.bar-track {
  display: flex;
  align-items: end;
  min-height: 150px;
  padding: 8px;
  background: #020617;
  border: 1px solid rgb(148 163 184 / 20%);
  border-radius: 8px;
  box-shadow: inset 0 0 22px rgb(15 23 42 / 90%);
}

.bar-fill {
  width: 100%;
  min-height: 8px;
  background: linear-gradient(180deg, #67e8f9, #2dd4bf);
  border-radius: 6px;
  box-shadow: 0 0 18px rgb(45 212 191 / 24%);
}

.bar-column.lower .bar-fill {
  background: linear-gradient(180deg, #fb7185, #be123c);
  box-shadow: 0 0 18px rgb(251 113 133 / 20%);
}

.bar-column.lower .bar-value {
  color: #fb7185;
}

.bar-label {
  font-size: 0.82rem;
  font-weight: 700;
}
</style>
