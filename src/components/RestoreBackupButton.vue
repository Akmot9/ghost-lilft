<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSeanceStore } from '../stores/seances'
import { pickTextFile } from '../lib/fileTransfer'

const seanceStore = useSeanceStore()
const router = useRouter()

// Deux clics plutôt que window.confirm (absent du WebView iOS/macOS).
const confirmRestore = ref(false)
const restoring = ref(false)
const restoreError = ref('')

async function onRestore() {
  restoreError.value = ''

  if (!confirmRestore.value) {
    confirmRestore.value = true
    return
  }

  confirmRestore.value = false

  const text = await pickTextFile()

  if (text === null) {
    return
  }

  restoring.value = true
  try {
    await seanceStore.importBackup(text)
    router.push('/seances')
  } catch (error) {
    restoreError.value =
      error instanceof Error ? error.message : 'Restauration impossible : fichier illisible.'
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <div v-if="!seanceStore.hasRealData" class="restore">
    <button type="button" class="restore-button" :disabled="restoring" @click="onRestore">
      {{
        restoring
          ? 'Restauration…'
          : confirmRestore
            ? 'Confirmer : remplacer les données d’exemple ?'
            : 'Restaurer une sauvegarde'
      }}
    </button>

    <p v-if="restoreError" class="restore-error" role="alert">{{ restoreError }}</p>
  </div>
</template>

<style scoped>
.restore {
  display: grid;
  gap: 8px;
}

.restore-button {
  min-height: 44px;
}

.restore-error {
  margin: 0;
  color: var(--blood-text);
}
</style>
