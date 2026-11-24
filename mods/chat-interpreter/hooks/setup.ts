import type { TranslationConnection } from './connection'
import { validTarget } from './config'
import type { Scope, Settings } from './config'

export type SetupChoices = Pick<Settings, 'inputTarget' | 'outputTarget' | 'translateInput' | 'translateOutput'>
export type TrialSample = { target: string; source: string; translation: string }
export type Interview = {
  candidate?: TranslationConnection
  samples: Map<string, TrialSample>
  review?: { scope: Scope; choices: SetupChoices; replies: number }
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
      mode: { type: 'string', enum: ['input', 'output', 'both', 'later'] },
      inputTarget: { type: 'string' },
      outputTarget: { type: 'string' },
    },
    required: ['action'],
    additionalProperties: false,
  },
}

export function setupChoices(mode: unknown, inputTarget: unknown, outputTarget: unknown): SetupChoices {
  if (mode !== 'input' && mode !== 'output' && mode !== 'both' && mode !== 'later') {
    throw new Error('Choose input, output, both, or later before running a trial.')
  }
  if (!validTarget(inputTarget) || !validTarget(outputTarget)) {
    throw new Error('Give a target language for each direction.')
  }
  return {
    translateInput: mode === 'input' || mode === 'both', translateOutput: mode === 'output' || mode === 'both',
    inputTarget: inputTarget.trim(), outputTarget: outputTarget.trim(),
  }
}

export function trialTargets(choices: SetupChoices): string[] {
  const targets: string[] = []
  if (choices.translateInput || !choices.translateOutput) targets.push(choices.inputTarget)
  if (choices.translateOutput && !targets.some(target => target.toLowerCase() === choices.outputTarget.toLowerCase())) {
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
