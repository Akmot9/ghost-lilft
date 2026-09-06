import { slugify } from './slug'

/**
 * Capturer le graphe de progression (#35) sans dépendance de capture d'écran.
 *
 * Le graphe de l'app est du HTML mis en forme par des feuilles de style à
 * portée limitée : le rastériser demanderait soit une bibliothèque de capture,
 * soit d'inliner les styles calculés — deux façons fragiles d'obtenir une
 * image qui ressemble à un écran plutôt qu'à une carte qu'on partage.
 *
 * On redessine donc la même donnée sur un canevas. Le calcul de ce qu'il faut
 * dessiner est une fonction pure — un plan de dessin, testable sans canevas —
 * et le tracé n'est qu'une boucle sur ce plan.
 */

/** Une série telle que la carte a besoin de la connaître. */
export type CardSet = { reps: number; weight: number }

export type ProgressCardInput = {
  exerciseName: string
  weightUnit: string
  latestDate: Date | null
  previousDate: Date | null
  pairs: Array<{ position: number; latest: CardSet | null; ghost: CardSet | null }>
}

export type DrawItem =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: string }
  | {
      kind: 'bar'
      x: number
      y: number
      width: number
      height: number
      fill: string
      isGhost: boolean
    }
  | {
      kind: 'text'
      x: number
      y: number
      text: string
      fill: string
      font: string
      align: 'left' | 'center' | 'right'
    }

export type ProgressCard = { width: number; height: number; items: DrawItem[] }

// Les couleurs de la carte sont figées, pas lues dans le thème : une image
// partagée quitte l'app, elle ne peut pas dépendre du mode clair ou sombre de
// celui qui l'a exportée.
const INK = '#1d1d1f'
const MUTED = '#6e6e73'
const PAPER = '#ffffff'
const LATEST = '#9c6407'
const GHOST = '#7d8694'

const WIDTH = 1080
const HEIGHT = 1080
const MARGIN = 88
const PLOT_TOP = 360
const PLOT_HEIGHT = 460
const BAR_GAP = 18

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const numberFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

/**
 * Le plan de dessin de la carte, ou `null` quand il n'y a rien à montrer —
 * une carte sans série serait un cadre vide, pas une progression.
 */
export function buildProgressCard(input: ProgressCardInput): ProgressCard | null {
  const columns = input.pairs.filter((pair) => pair.latest || pair.ghost)

  if (columns.length === 0) {
    return null
  }

  const heaviest = Math.max(
    ...columns.flatMap((pair) =>
      [pair.latest?.weight, pair.ghost?.weight].filter((weight): weight is number =>
        Number.isFinite(weight),
      ),
    ),
    1,
  )

  const items: DrawItem[] = [
    { kind: 'rect', x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: PAPER },
  ]

  items.push(text(input.exerciseName, MARGIN, 190, INK, '700 74px system-ui, sans-serif'))

  const subtitle = [
    input.latestDate ? `Dernière séance · ${dateFormatter.format(input.latestDate)}` : null,
    input.previousDate ? `Fantôme · ${dateFormatter.format(input.previousDate)}` : null,
  ]
    .filter(Boolean)
    .join('   ·   ')

  if (subtitle) {
    items.push(text(subtitle, MARGIN, 258, MUTED, '400 34px system-ui, sans-serif'))
  }

  // Chaque série occupe une colonne, partagée entre la dernière séance et son
  // fantôme. L'échelle part de zéro : elle ne doit pas amplifier l'écart.
  const columnWidth = (WIDTH - MARGIN * 2) / columns.length
  const barWidth = (columnWidth - BAR_GAP * 3) / 2

  columns.forEach((pair, index) => {
    const left = MARGIN + columnWidth * index + BAR_GAP

    for (const [offset, set, isGhost] of [
      [0, pair.latest, false],
      [barWidth + BAR_GAP, pair.ghost, true],
    ] as const) {
      if (!set) {
        continue
      }

      const height = (set.weight / heaviest) * PLOT_HEIGHT
      const x = left + offset

      items.push({
        kind: 'bar',
        x,
        y: PLOT_TOP + PLOT_HEIGHT - height,
        width: barWidth,
        height,
        fill: isGhost ? GHOST : LATEST,
        isGhost,
      })
      items.push(
        text(
          `${numberFormatter.format(set.weight)} ${input.weightUnit}`,
          x + barWidth / 2,
          PLOT_TOP + PLOT_HEIGHT - height - 42,
          isGhost ? MUTED : INK,
          '600 30px system-ui, sans-serif',
          'center',
        ),
      )
      items.push(
        text(
          `× ${set.reps}`,
          x + barWidth / 2,
          PLOT_TOP + PLOT_HEIGHT - height - 12,
          MUTED,
          '400 26px system-ui, sans-serif',
          'center',
        ),
      )
    }

    items.push(
      text(
        `S${pair.position}`,
        left + columnWidth / 2 - BAR_GAP,
        PLOT_TOP + PLOT_HEIGHT + 56,
        MUTED,
        '600 34px system-ui, sans-serif',
        'center',
      ),
    )
  })

  items.push(text('Revenant', MARGIN, HEIGHT - MARGIN, MUTED, '600 32px system-ui, sans-serif'))

  return { width: WIDTH, height: HEIGHT, items }
}

function text(
  value: string,
  x: number,
  y: number,
  fill: string,
  font: string,
  align: 'left' | 'center' | 'right' = 'left',
): DrawItem {
  return { kind: 'text', x, y, text: value, fill, font, align }
}

/** Le nom du fichier : l'exercice et le jour, comme pour une sauvegarde. */
export function progressCardFileName(exerciseName: string, exportedAt: Date): string {
  return `revenant-${slugify(exerciseName)}-${exportedAt.toISOString().slice(0, 10)}.png`
}

/** Le tracé : une boucle sur le plan, seule partie qui touche un canevas. */
export function drawProgressCard(card: ProgressCard, context: CanvasRenderingContext2D): void {
  for (const item of card.items) {
    if (item.kind === 'text') {
      context.fillStyle = item.fill
      context.font = item.font
      context.textAlign = item.align
      context.fillText(item.text, item.x, item.y)
      continue
    }

    context.fillStyle = item.fill
    context.fillRect(item.x, item.y, item.width, item.height)
  }
}

/** La carte en PNG, prête à être enregistrée ou partagée. */
export async function progressCardBlob(card: ProgressCard): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = card.width
  canvas.height = card.height

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error("Ce navigateur ne sait pas dessiner l'image du graphe.")
  }

  drawProgressCard(card, context)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("L'image du graphe n'a pas pu être créée."))),
      'image/png',
    )
  })
}
