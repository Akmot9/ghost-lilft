import { describe, expect, it } from 'vitest'
import { buildProgressCard, progressCardFileName } from '../chartImage'

const card = () =>
  buildProgressCard({
    exerciseName: 'Développé couché',
    weightUnit: 'kg',
    latestDate: new Date('2026-04-27T18:00:00.000Z'),
    previousDate: new Date('2026-04-20T18:00:00.000Z'),
    pairs: [
      { position: 1, latest: { reps: 8, weight: 70 }, ghost: { reps: 8, weight: 65 } },
      { position: 2, latest: { reps: 6, weight: 75 }, ghost: null },
    ],
  })!

describe('buildProgressCard', () => {
  it('names the exercise and dates both sessions', () => {
    const texts = card().items.filter((item) => item.kind === 'text')

    expect(texts.some((item) => item.text === 'Développé couché')).toBe(true)
    expect(texts.some((item) => item.text.includes('27 avr.'))).toBe(true)
    expect(texts.some((item) => item.text.includes('20 avr.'))).toBe(true)
  })

  it('draws one bar per logged set, and none for a set that was not done', () => {
    // S1 a les deux séances, S2 seulement la dernière : trois barres.
    const bars = card().items.filter((item) => item.kind === 'bar')

    expect(bars).toHaveLength(3)
  })

  it('scales the bars from zero, the heaviest set filling the plot', () => {
    const bars = card().items.filter((item) => item.kind === 'bar')
    const tallest = bars.reduce((best, bar) => (bar.height > best.height ? bar : best))
    const lightest = bars.reduce((worst, bar) => (bar.height < worst.height ? bar : worst))

    // 75 kg est la plus lourde ; 65 kg fait 65/75 de sa hauteur.
    expect(lightest.height / tallest.height).toBeCloseTo(65 / 75, 2)
  })

  it('sits on an opaque background, so the image reads outside the app', () => {
    const [first] = card().items

    expect(first).toMatchObject({ kind: 'rect', x: 0, y: 0 })
    expect(first!.fill).not.toBe('transparent')
  })

  it('has nothing to draw without a single set', () => {
    const empty = buildProgressCard({
      exerciseName: 'Squat',
      weightUnit: 'kg',
      latestDate: null,
      previousDate: null,
      pairs: [],
    })

    expect(empty).toBeNull()
  })
})

describe('progressCardFileName', () => {
  it('names the file after the exercise and the day', () => {
    expect(progressCardFileName('Développé couché', new Date('2026-04-27T18:00:00.000Z'))).toBe(
      'revenant-developpe-couche-2026-04-27.png',
    )
  })
})
