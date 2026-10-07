/* A failed helper call: its category, as the message every caller already
   reads, and for damage the generation it was met in, which is the one a
   quarantine may move. The generation travels with the error that reported
   it, never beside it, so a later failure cannot change what an earlier one
   said. */
export class HelperFailure extends Error {
  readonly category: string
  readonly generation?: string

  constructor(category: string, generation?: string) {
    super(category)
    this.name = 'HelperFailure'
    this.category = category
    if (generation !== undefined) this.generation = generation
  }
}

/* What the helper said on stderr, kept to a category it is known to use
   and, for damage, a generation that is an identifier. Anything else is the
   caller's own name for the operation. */
export function parseHelperFailure(
  stderr: string,
  fallback: string,
  categories: ReadonlySet<string>,
  isId: (value: unknown) => value is string,
): HelperFailure {
  try {
    const parsed: unknown = JSON.parse(stderr)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      'category' in parsed &&
      typeof parsed.category === 'string' &&
      categories.has(parsed.category)
    ) {
      const generation = 'generation' in parsed ? parsed.generation : undefined
      return new HelperFailure(
        parsed.category,
        parsed.category === 'archive-integrity' && isId(generation) ? generation : undefined,
      )
    }
  } catch {
    // Diagnostics never repeat untrusted helper output.
  }
  return new HelperFailure(fallback)
}
