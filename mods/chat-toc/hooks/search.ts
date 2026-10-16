/* Search (spec §2): which Turn groups hold every word of a query, and in
   which fields. The fields are the User input as typed, the last text and
   the absolute paths of the files the group touched (facts.ts); the View
   filter picks among them. Each group's fields are kept NFKC-normalised
   and lower-cased in an index built with the groups at regroup, under the
   group object: a read replaces only the groups it regrouped, so only
   those are built again, and a keystroke filters these strings alone. */

import type { TurnGroup } from './groups'
import type { ViewFilter } from './view'

const fold = (text: string) => text.normalize('NFKC').toLowerCase()

/* One group's searchable text. `latest` is what a running group has
   written so far, when it differs from its last text. */
export type SearchFields = { input: string; last: string; latest: string | undefined; paths: string[] }

export type SearchIndex = WeakMap<TurnGroup, SearchFields>

export function newSearchIndex(): SearchIndex {
  return new WeakMap()
}

function build(group: TurnGroup): SearchFields {
  const { input, lastText, latestText, changed, read } = group.facts
  const last = fold(lastText ?? '')
  const latest = latestText === undefined || latestText === lastText ? undefined : fold(latestText)
  return { input: fold(input), last, latest, paths: [...changed, ...read].map(fold) }
}

function fieldsOf(index: SearchIndex, group: TurnGroup): SearchFields {
  let fields = index.get(group)
  if (fields === undefined) {
    fields = build(group)
    index.set(group, fields)
  }
  return fields
}

/* Builds the fields of the groups not indexed yet; how many it built. */
export function indexGroups(index: SearchIndex, groups: readonly TurnGroup[]): number {
  let built = 0
  for (const group of groups) {
    if (index.has(group)) continue
    index.set(group, build(group))
    built += 1
  }
  return built
}

/* A query's words: split on spaces after NFKC (a full-width space is one),
   lower-cased. No quoting, no operators. */
export function queryWords(query: string): string[] {
  return fold(query)
    .split(/\s+/)
    .filter(word => word !== '')
}

/* A group that holds every word: which fields held one, and the paths
   (as the facts give them) that did. */
export type Match = { group: number; user: boolean; agent: boolean; files: boolean; paths: string[] }

/* The groups holding every word, in order, on the sides the View filter
   shows: All every field, User the User input, Agent the last text and the
   paths. `isLastRunning` matches the last group by what it has written so
   far. No words match nothing. */
export function matchesOf(index: SearchIndex, groups: readonly TurnGroup[], words: readonly string[], filter: ViewFilter, isLastRunning: boolean): Match[] {
  const found: Match[] = []
  if (words.length === 0) return found
  const hasUser = filter !== 'agent'
  const hasAgent = filter !== 'user'
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g]!
    const fields = fieldsOf(index, group)
    const agentText = isLastRunning && g === groups.length - 1 ? (fields.latest ?? fields.last) : fields.last
    let user = false
    let agent = false
    const pathHit = new Set<number>()
    let isAll = true
    for (const word of words) {
      let isFound = false
      if (hasUser && fields.input.includes(word)) isFound = user = true
      if (hasAgent && agentText.includes(word)) isFound = agent = true
      if (hasAgent) {
        fields.paths.forEach((path, i) => {
          if (path.includes(word)) {
            isFound = true
            pathHit.add(i)
          }
        })
      }
      if (!isFound) {
        isAll = false
        break
      }
    }
    if (!isAll) continue
    const all = [...group.facts.changed, ...group.facts.read]
    const paths = [...pathHit].sort((a, b) => a - b).map(i => all[i]!)
    found.push({ group: g, user, agent, files: paths.length > 0, paths })
  }
  return found
}

/* The match nearest the Current position: the nearest at or before it,
   else the first after it; the newest with no position. `matches` are
   group indices in order. */
export function nearestMatch(matches: readonly number[], position: number | undefined): number | undefined {
  if (matches.length === 0) return undefined
  if (position === undefined) return matches[matches.length - 1]
  let nearest: number | undefined
  for (const g of matches) {
    if (g > position) break
    nearest = g
  }
  return nearest ?? matches[0]
}
