import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      // Chaque fichier de test tourne dans son propre environnement : les
      // drapeaux globaux posés par un fichier (`globalThis.isTauri` dans les
      // tests du pont IPC) ne fuient pas vers le suivant. C'est la valeur
      // par défaut de vitest, mais l'isolation des tests ne doit pas reposer
      // sur un défaut implicite (#58).
      isolate: true,
    },
  }),
)
