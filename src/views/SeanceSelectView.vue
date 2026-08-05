<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useSeanceStore } from '../stores/seances'

const seanceStore = useSeanceStore()

function formatExerciseCount(count: number) {
  return count > 1 ? `${count} exercices` : `${count} exercice`
}
</script>

<template>
  <section class="seance-select" aria-labelledby="seance-select-title">
    <div class="header">
      <div>
        <p class="eyebrow">Ghost Lift</p>
        <h1 id="seance-select-title">Tes séances</h1>
      </div>

      <RouterLink to="/seances/new" class="new-seance-link">+ Nouvelle séance</RouterLink>
    </div>

    <p v-if="seanceStore.seances.length === 0" class="empty-state">
      Aucune séance pour l'instant. Crée ta première séance pour commencer à t'entraîner.
    </p>

    <ul v-else class="seance-list">
      <li v-for="seance in seanceStore.seances" :key="seance.slug">
        <RouterLink :to="`/seances/${seance.slug}`" class="seance-card">
          <span class="seance-name">{{ seance.name }}</span>
          <span class="seance-meta">{{ formatExerciseCount(seance.exercises.length) }}</span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.seance-select {
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

.header {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--fire);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 7vw, 3.8rem);
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
  text-transform: uppercase;
}

.new-seance-link {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  color: var(--accent-text-on-fill);
  font-weight: 800;
  text-decoration: none;
  background: var(--accent);
  border-radius: var(--control-radius);
}

.new-seance-link:hover {
  background: var(--accent-hover);
}

.empty-state {
  margin: 0;
  color: var(--muted);
}

.seance-list {
  display: grid;
  gap: 12px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.seance-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 72px;
  padding: 16px 20px;
  color: inherit;
  text-decoration: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  transition: border-color 0.15s ease;
}

.seance-card:hover,
.seance-card:focus-visible {
  border-color: var(--fire);
  outline: none;
}

.seance-name {
  color: var(--text-strong);
  font-size: 1.1rem;
  font-weight: 800;
}

.seance-meta {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

@media (max-width: 680px) {
  .seance-select {
    padding: 24px;
  }

  .header {
    flex-direction: column;
    align-items: stretch;
  }

  .new-seance-link {
    justify-content: center;
  }

  .seance-card {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
}
</style>
