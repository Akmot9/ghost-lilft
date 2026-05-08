<script setup lang="ts">
import BenchPressTracker from './components/BenchPressTracker.vue'
</script>

<template>
  <main>
    <BenchPressTracker />
  </main>
</template>

<style scoped>
main {
  display: grid;
  min-height: 100vh;
  padding: 32px 16px;
  place-items: center;
  background:
    linear-gradient(135deg, rgb(15 118 110 / 8%), transparent 36%),
    linear-gradient(315deg, rgb(225 29 72 / 7%), transparent 32%),
    #f7fafc;
}
</style>
