<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()

const isSeancesActive = computed(() => route.path.startsWith('/seances'))
const isDashboardActive = computed(() => route.path.startsWith('/dashboard'))
</script>

<template>
  <header class="top-bar">
    <nav class="top-bar__inner" aria-label="Navigation principale">
      <RouterLink to="/seances" class="brand">
        <img class="brand__mark" src="@/assets/logo-mark.svg" alt="" aria-hidden="true" />
        <span class="brand__name">Ghost Lift</span>
      </RouterLink>

      <ul class="nav-links">
        <li>
          <RouterLink to="/seances" class="nav-link" :class="{ 'nav-link--active': isSeancesActive }">
            Séances
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/dashboard"
            class="nav-link"
            :class="{ 'nav-link--active': isDashboardActive }"
          >
            Dashboard
          </RouterLink>
        </li>
      </ul>
    </nav>
  </header>
</template>

<style scoped>
.top-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgb(11 10 9 / 88%);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(10px);
}

.top-bar__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  max-width: 960px;
  min-height: 60px;
  padding: 0 24px;
  margin: 0 auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text-strong);
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.2rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-decoration: none;
  white-space: nowrap;
}

/* Un disque de fonte vu de profil : anneau plein, trou au centre. */
.brand__mark {
  width: auto;
  height: 26px;
}

.nav-links {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 0;
  margin: 0;
  list-style: none;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 0 14px;
  color: var(--muted);
  font-weight: 700;
  font-size: 0.92rem;
  text-decoration: none;
  white-space: nowrap;
  border-radius: var(--control-radius);
  transition: color 0.15s ease, background-color 0.15s ease;
}

.nav-link:hover {
  color: var(--text);
  background: var(--ghost-dim);
}

.nav-link--active,
.nav-link--active:hover {
  color: var(--fire);
  background: var(--fire-dim);
}

@media (max-width: 680px) {
  .top-bar__inner {
    min-height: 52px;
    padding: 0 16px;
  }

  .brand {
    font-size: 0.95rem;
  }

  .nav-links {
    gap: 2px;
  }

  .nav-link {
    min-height: 36px;
    padding: 0 10px;
    font-size: 0.86rem;
  }
}
</style>
