import type { AppApi } from './appApi'

/**
 * Un `AppApi` qui refuse tout ce qu'on ne lui a pas explicitement appris (#67).
 *
 * `appApiMemory` est un backend complet : pratique pour un scénario de bout en
 * bout, mais il **répond à tout**. Un test de présentation qui s'en sert ne
 * peut donc pas prouver qu'un écran appelle la bonne commande, ni détecter un
 * appel parasite — et le risque que l'epic #73 nomme explicitement est qu'un
 * faux backend devienne par accident une seconde implémentation métier.
 *
 * Celui-ci fait l'inverse : chaque méthode non fournie jette. Un test déclare
 * ce que l'écran a le droit d'appeler, et tout le reste est une erreur.
 */
export function createStrictAppApi(overrides: Partial<AppApi> = {}): AppApi {
  return new Proxy({} as AppApi, {
    get(_target, property: string | symbol) {
      const stub = (overrides as Record<string | symbol, unknown>)[property]

      if (stub !== undefined) {
        return stub
      }

      // `then` est interrogé par `await` sur n'importe quel objet : le faux ne
      // doit pas se faire passer pour une promesse.
      if (property === 'then' || typeof property === 'symbol') {
        return undefined
      }

      return () => {
        throw new Error(`Appel inattendu à AppApi.${String(property)}`)
      }
    },
  })
}
