/**
 * Les slugs côté TypeScript — uniquement pour le repli hors Tauri (navigateur
 * de dev, tests) : sous Tauri, c'est Rust qui les calcule (`mutations.rs`,
 * fonctions `slugify`/`unique_slug`), et les deux implémentations doivent
 * rester le miroir l'une de l'autre — les slugs des utilisateurs existants
 * en dépendent.
 */

export function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'item'
}

/** Suffixe `-2`, `-3`… jusqu'au premier libre : stable d'un appel à l'autre. */
export function createUniqueSlug(baseSlug: string, existingSlugs: string[]) {
  let slug = baseSlug
  let suffix = 2

  while (existingSlugs.includes(slug)) {
    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }

  return slug
}
