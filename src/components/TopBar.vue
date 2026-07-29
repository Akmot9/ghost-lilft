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
        <span class="brand__mark" aria-hidden="true"></span>
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
  background: rgb(15 23 42 / 92%);
  border-bottom: 1px solid rgb(148 163 184 / 22%);
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
  gap: 8px;
  color: #f8fafc;
  font-weight: 800;
  font-size: 1.05rem;
  text-decoration: none;
  white-space: nowrap;
}

.brand__mark {
  width: 10px;
  height: 10px;
  background: linear-gradient(180deg, #67e8f9, #2dd4bf);
  border-radius: 50%;
  box-shadow: 0 0 10px rgb(45 212 191 / 45%);
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
  color: #94a3b8;
  font-weight: 700;
  font-size: 0.92rem;
  text-decoration: none;
  white-space: nowrap;
  border-radius: 6px;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.nav-link:hover {
  color: #e5edf5;
  background: rgb(148 163 184 / 10%);
}

.nav-link--active,
.nav-link--active:hover {
  color: #67e8f9;
  background: rgb(103 232 249 / 12%);
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
