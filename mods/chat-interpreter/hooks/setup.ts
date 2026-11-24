import type { TranslationConnection } from './connection'
import { validTarget } from './config'
import type { Scope, Settings } from './config'

export type SetupChoices = Pick<Settings, 'inputTarget' | 'outputTarget' | 'translateInput' | 'outputMode'>
export type TrialSample = { target: string; source: string; translation: string }
export type Interview = {
  candidate?: TranslationConnection
  samples: Map<string, TrialSample>
  review?: { scope: Scope; previous: SetupChoices; choices: SetupChoices; replies: number }
  replies: number
  busy?: 'trial' | 'confirm'
}

export const SETUP_TOOL = {
  name: 'setup',
  description: 'Run the current person-initiated Chat Interpreter setup. Pass credential references only. See the setup skill for the connection format.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'stage', 'trial', 'confirm', 'cancel'] },
      connection: { type: 'object', description: 'For stage. HTTP or CLI description, without an id or any secrets.' },
      renewCredentials: { type: 'boolean', description: 'For stage. Allocate a new private credential file even for the same destination.' },
      scope: { type: 'string', enum: ['global', 'project'] },
      translateInput: { type: 'boolean' },
      outputMode: { type: 'string', enum: ['manual', 'automatic'] },
      inputTarget: { type: 'string' },
      outputTarget: { type: 'string' },
    },
    required: ['action'],
    additionalProperties: false,
  },
}

export function currentChoices(settings: Settings): SetupChoices {
  const { translateInput, outputMode, inputTarget, outputTarget } = settings
  return { translateInput, outputMode, inputTarget, outputTarget }
}

export function setupChoices(translateInput: unknown, outputMode: unknown, inputTarget: unknown, outputTarget: unknown): SetupChoices {
  if (typeof translateInput !== 'boolean' || (outputMode !== 'manual' && outputMode !== 'automatic')) {
    throw new Error('Choose whether to translate input and select manual or automatic replies before the trial.')
  }
  if (!validTarget(inputTarget) || !validTarget(outputTarget)) {
    throw new Error('Give a target language for each direction.')
  }
  return {
    translateInput, outputMode,
    inputTarget: inputTarget.trim(), outputTarget: outputTarget.trim(),
  }
}

export function trialTargets(choices: SetupChoices): string[] {
  const targets: string[] = []
  if (choices.translateInput) targets.push(choices.inputTarget)
  if ((!choices.translateInput || choices.outputMode === 'automatic') && !targets.some(target => target.toLowerCase() === choices.outputTarget.toLowerCase())) {
    targets.push(choices.outputTarget)
  }
  return targets
}

export function sampleSource(target: string): string {
  return /^(en(?:[-_].*)?|english|英语|英文)$/i.test(target) ? 'La ventana está abierta.' : 'The window is open.'
}

export function sameDestination(a: TranslationConnection, b: TranslationConnection): boolean {
  if (JSON.stringify(a.credential) !== JSON.stringify(b.credential)) return false
  if (a.kind === 'http' && b.kind === 'http') return a.url === b.url
  if (a.kind === 'cli' && b.kind === 'cli') return a.program === b.program
  return false
}

export function setupResult(value: object): { result: string } {
  return { result: JSON.stringify(value) }
}
