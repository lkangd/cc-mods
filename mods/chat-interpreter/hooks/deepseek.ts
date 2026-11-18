import type { HttpInit, HttpResponse } from 'claude-code'
import type { Direction } from './config'
import { maskProtected, restoreProtected } from './text'

export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

export function translationRequest(apiKey: string, text: string, direction: Direction): { values: Array<[string, string]>; init: HttpInit } {
  const { masked, values } = maskProtected(text)
  const language = direction === 'zh-en' ? 'English' : 'Chinese'
  return {
    values,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a professional translator. Return only the translation. Preserve Markdown structure, line breaks, technical identifiers, and every __CI_KEEP_N__ marker exactly. Do not add explanations, labels, or notes.' },
          { role: 'user', content: `Translate the following text to ${language}. Output only the translation:\n\n${masked}` },
        ],
        stream: false,
      }),
    },
  }
}

export function translationResult(response: HttpResponse, values: ReadonlyArray<readonly [string, string]>): string {
  if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`)
  let data
  try { data = JSON.parse(response.text) } catch { throw new Error('DeepSeek returned invalid JSON') }
  if (data?.error) throw new Error('DeepSeek returned an error')
  const choice = data?.choices?.[0]
  if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error('DeepSeek did not finish the translation')
  const content = choice?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('DeepSeek returned an empty translation')
  return restoreProtected(content, values)
}
