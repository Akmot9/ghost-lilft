<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useSeanceStore } from '../stores/seances'
import { backupFileName } from '../lib/backup'
import { saveTextFile } from '../lib/fileTransfer'
import RestoreBackupButton from '../components/RestoreBackupButton.vue'

const seanceStore = useSeanceStore()
const router = useRouter()

// Deux clics plutôt que window.confirm (absent du WebView iOS/macOS).
const confirmDemoDelete = ref(false)
const deletingDemo = ref(false)
const adoptingDemo = ref(false)

// Incrémenté pour désarmer la confirmation de restauration quand celle de
// suppression s'arme : deux confirmations voisines, jamais en même temps.
const disarmRestore = ref(0)

async function onDeleteDemo() {
  if (!confirmDemoDelete.value) {
    confirmDemoDelete.value = true
    disarmRestore.value += 1
    return
  }
  confirmDemoDelete.value = false
  deletingDemo.value = true
  try {
    await seanceStore.deleteDemoData()
    if (!seanceStore.hasOnboarded) {
      router.push('/onboarding')
    }
  } finally {
    deletingDemo.value = false
  }
}

// Garde les séances du programme mais vide l'historique d'exemple.
async function onAdoptDemo() {
  confirmDemoDelete.value = false
  adoptingDemo.value = true
  try {
    await seanceStore.adoptDemoSeances()
  } finally {
    adoptingDemo.value = false
  }
}

function formatExerciseCount(count: number) {
  return count > 1 ? `${count} exercices` : `${count} exercice`
}

const exporting = ref(false)
const backupError = ref('')
// Sur iOS, après le dialogue de fichier, rien ne disait que l'export avait
// réussi (#57). Pour une fonction dont l'enjeu est la confiance, la
// confirmation vaut le message d'erreur.
const backupSuccess = ref('')

async function onExport() {
  backupError.value = ''
  backupSuccess.value = ''
  exporting.value = true
  try {
    const exportedAt = new Date()
    const fileName = backupFileName(exportedAt)
    const saved = await saveTextFile(fileName, await seanceStore.exportBackup(exportedAt))

    if (saved) {
      backupSuccess.value = `Sauvegarde exportée : ${fileName}.`
    }
  } catch (error) {
    backupError.value =
      error instanceof Error
        ? `Export impossible : ${error.message}`
        : 'Export impossible.'
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <section class="seance-select" aria-labelledby="seance-select-title">
    <div class="header">
      <div>
        <p class="eyebrow">Revenant</p>
        <h1 id="seance-select-title">Tes séances</h1>
      </div>

      <RouterLink to="/seances/new" class="new-seance-link">+ Nouvelle séance</RouterLink>
    </div>

    <div v-if="seanceStore.hasDemoData" class="demo-banner" aria-label="Données de démonstration">
      <div class="demo-copy">
        <p class="demo-eyebrow">Mode découverte</p>
        <p>
          Programme de départ Upper A / Lower / Upper B, avec huit semaines
          d'historique d'exemple. Supprime-le quand tu veux créer tes propres
          séances.
        </p>
      </div>
      <div class="demo-actions">
        <button type="button" class="demo-adopt" :disabled="adoptingDemo || deletingDemo" @click="onAdoptDemo">
          {{ adoptingDemo ? 'Nettoyage…' : 'Garder le programme, vider l’historique' }}
        </button>
        <button type="button" class="demo-delete" :disabled="deletingDemo || adoptingDemo" @click="onDeleteDemo">
          {{
            deletingDemo
              ? 'Suppression…'
              : confirmDemoDelete
                ? 'Confirmer la suppression ?'
                : 'Tout supprimer'
          }}
        </button>
        <RestoreBackupButton
          :disarm-signal="disarmRestore"
          @armed="confirmDemoDelete = false"
        />
      </div>
    </div>

    <template v-if="seanceStore.seances.length === 0">
      <p class="empty-state">
        Aucune séance pour l'instant. Crée ta première séance pour commencer à t'entraîner.
      </p>
      <RestoreBackupButton />
    </template>

    <ul v-else class="seance-list">
      <li v-for="seance in seanceStore.seances" :key="seance.slug">
        <RouterLink :to="`/seances/${seance.slug}`" class="seance-card">
          <span class="seance-name">
            {{ seance.name }}
            <span v-if="seance.isDemo" class="demo-chip">exemple</span>
          </span>
          <span class="seance-meta">{{ formatExerciseCount(seance.exercises.length) }}</span>
        </RouterLink>
      </li>
    </ul>

    <div class="data-actions">
      <h2 class="data-title">Tes données</h2>
      <p class="data-hint">
        Tout est stocké sur cet appareil. Exporte régulièrement : une
        réinstallation efface l'historique.
      </p>

      <button type="button" class="data-action-button data-export" :disabled="exporting" @click="onExport">
        {{ exporting ? 'Export en cours…' : 'Exporter mes données' }}
      </button>

      <p v-if="backupError" class="data-action-error" role="alert">{{ backupError }}</p>
      <p v-if="backupSuccess" class="data-success" role="status">{{ backupSuccess }}</p>
    </div>
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
  font-size: clamp(1.9rem, 5vw, 2.5rem);
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.15;
}

.new-seance-link {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 22px;
  color: var(--accent-text-on-fill);
  font-weight: 600;
  text-decoration: none;
  background: var(--accent);
  border-radius: var(--pill-radius);
  transition: transform 0.2s var(--ease), filter 0.2s var(--ease);
}

.new-seance-link:hover {
  background: var(--accent-hover);
  transform: scale(1.02);
}

.new-seance-link:active {
  transform: scale(0.98);
}

.demo-banner {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: var(--fire-dim);
  border: 1px solid var(--fire);
  border-radius: var(--control-radius);
}

.demo-copy {
  display: grid;
  gap: 4px;
}

.demo-copy p {
  margin: 0;
  color: var(--text);
  font-size: 0.92rem;
}

.demo-eyebrow {
  color: var(--fire);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.demo-actions {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 8px;
}

.demo-adopt {
  min-height: 44px;
  padding: 0 16px;
  color: var(--accent-text-on-fill);
  font-weight: 600;
  cursor: pointer;
  background: var(--accent);
  border: 0;
  border-radius: var(--pill-radius);
  transition: transform 0.2s var(--ease), background-color 0.2s var(--ease);
}

.demo-adopt:hover:not(:disabled) {
  background: var(--accent-hover);
  transform: scale(1.02);
}

.demo-adopt:disabled {
  opacity: 0.6;
}

.demo-delete {
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 16px;
  color: var(--text-strong);
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--pill-radius);
}

.demo-delete:hover:not(:disabled) {
  color: var(--blood-text);
  border-color: var(--blood);
}

.demo-delete:disabled {
  opacity: 0.6;
}

.demo-chip {
  margin-left: 8px;
  padding: 2px 8px;
  color: var(--ghost);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  vertical-align: middle;
  background: var(--ghost-dim);
  border: 1px solid var(--ghost);
  border-radius: 999px;
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
  transition: border-color 0.2s var(--ease), transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
}

.seance-card:hover,
.seance-card:focus-visible {
  border-color: var(--fire);
  outline: none;
  transform: translateY(-1px);
  box-shadow: var(--panel-shadow);
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

.data-actions {
  display: grid;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--panel-border);
}

.data-title {
  margin: 0;
  font-size: 1rem;
}

.data-hint {
  margin: 0;
  color: var(--muted);
}

.data-export {
  justify-self: start;
}



.data-success {
  margin: 0;
  color: var(--muted);
  font-weight: 700;
}


@media (max-width: 680px) {
  .seance-select {
    padding: 24px;
  }

  .header {
    flex-direction: column;
    align-items: stretch;
  }

  .demo-banner {
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
