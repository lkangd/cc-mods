/* The desktop's strip of bars over the list: one bar per Turn group, as
   tall as the steps its agent took, the lit group's in the highlight
   colour and a running one's in Claude's, pulsing. An SVG the surface draws
   as an image; it carries its own light and dark colours and stops pulsing
   under reduced motion. Past MAX_BARS groups a bar stands for several, as
   tall as the most steps among them. */

export const MINIMAP_HEIGHT = 36
const MAX_BARS = 120
const MOST = 32

export type Minimap = { source: string; alt: string }

export function minimapOf(steps: readonly number[], lit: number | undefined, running: number | undefined, width: number): Minimap {
  const n = steps.length
  const per = Math.max(1, Math.ceil(n / MAX_BARS))
  const bars = Math.ceil(n / per)
  const slot = width / Math.max(1, bars)
  const rects: string[] = []
  for (let b = 0; b < bars; b++) {
    const from = b * per
    const to = Math.min(n, from + per)
    let most = 0
    for (let i = from; i < to; i++) most = Math.max(most, steps[i] ?? 0)
    const h = most === 0 ? 3 : Math.min(MOST, 6 + most * 3)
    const isLit = lit !== undefined && lit >= from && lit < to
    const isRunning = running !== undefined && running >= from && running < to
    const cls = isRunning ? 'r' : isLit ? 'l' : 'b'
    rects.push(`<rect class="${cls}" x="${(b * slot + slot * 0.2).toFixed(1)}" y="${MINIMAP_HEIGHT - h}" width="${Math.max(1, slot * 0.6).toFixed(1)}" height="${h}" rx="1.5"/>`)
  }
  const style =
    '<style>.b{fill:#d9d8d4}.l{fill:#5769f7}.r{fill:#d77757;animation:p 1.4s ease-in-out infinite}' +
    '@keyframes p{50%{opacity:.35}}' +
    '@media (prefers-color-scheme: dark){.b{fill:#3a3a38}.l{fill:#b1b9f9}}' +
    '@media (prefers-reduced-motion: reduce){.r{animation:none}}</style>'
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${MINIMAP_HEIGHT}" viewBox="0 0 ${width} ${MINIMAP_HEIGHT}">${style}${rects.join('')}</svg>`
  const alt = per === 1 ? `${n} 轮，每轮一根竖条，高度按步数` : `${n} 轮，每根竖条 ${per} 轮，高度按步数`
  return { source, alt }
}
