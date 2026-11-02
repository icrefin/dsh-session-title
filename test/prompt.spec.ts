/**
 * The title prompt: instruction, framing bounds, and output parsing.
 *
 * The framing tests are the important ones. A digest is user text, and user
 * text must never reach the model as anything but JSON values inside one
 * bounded request.
 *
 * @module dsh-session-title/test/prompt
 */

import { describe, expect, it } from 'vitest'
import { buildWorkDigest } from '../src/digest.ts'
import { byteLength, frameDigest, systemPrompt, titleFromOutput } from '../src/prompt.ts'
import { assistantMessage, toolCall, turnEnd, turnStart, userMessage, type FixtureEvent } from './fixtures.ts'

/** The identifier that opens every framed request. */
const FRAME_PREFIX = 'Name the session from this JSON object:\n'

/** Parse the JSON payload out of a framed request. */
function payloadOf(input: string): Record<string, unknown> {
  expect(input.startsWith(FRAME_PREFIX)).toBe(true)
  return JSON.parse(input.slice(FRAME_PREFIX.length)) as Record<string, unknown>
}

/** Build a multi-turn fixture log. */
function multiTurnLog(turns: number): FixtureEvent[] {
  const events: FixtureEvent[] = []
  for (let turn = 1; turn <= turns; turn += 1) {
    events.push(
      turnStart(turn * 10, turn),
      userMessage(turn * 10 + 1, `Task ${turn}: rename the ${'thing '.repeat(20)}`),
      toolCall(turn * 10 + 2, 'bash', { description: `Command for task ${turn}` }, turn),
      assistantMessage(turn * 10 + 3, `Finished task ${turn} with a long explanation.`, turn),
      turnEnd(turn * 10 + 4, turn),
    )
  }
  return events
}

describe('systemPrompt', () => {
  it('asks for the work, not the conversation, and names the length targets', () => {
    const prompt = systemPrompt({ targetWords: 7, targetCjkCharacters: 14 }, false)

    expect(prompt).toContain('from the work it actually did')
    expect(prompt).toContain('the subject and the action')
    expect(prompt).toContain('7 words')
    expect(prompt).toContain('14 CJK characters')
    expect(prompt).toContain('Return only the title')
  })

  it('adds the preservation rules only when a title is anchored', () => {
    const plain = systemPrompt({ targetWords: 6, targetCjkCharacters: 12 }, false)
    const anchored = systemPrompt({ targetWords: 6, targetCjkCharacters: 12 }, true)

    expect(plain).not.toContain('currentTitle')
    expect(anchored).toContain('currentTitle')
    expect(anchored).toContain('Keep it exactly unchanged')
  })
})

describe('frameDigest', () => {
  it('frames the turns, the work, and the totals as one JSON object', () => {
    const digest = buildWorkDigest(multiTurnLog(2), { maxTurns: 10 })
    const { input, turns } = frameDigest(digest, undefined, 8192)
    const payload = payloadOf(input)

    expect(turns).toHaveLength(2)
    expect(payload['totalTurns']).toBe(2)
    expect(payload['toolCallCount']).toBe(2)
    expect(payload['currentTitle']).toBeUndefined()
    const framed = payload['turns'] as Array<Record<string, unknown>>
    expect(framed[0]?.['prompt']).toContain('Task 1')
    expect(framed[1]?.['work']).toEqual(['bash: Command for task 2'])
  })

  it('carries the anchored title when the model should preserve one', () => {
    const digest = buildWorkDigest(multiTurnLog(1), { maxTurns: 10 })
    const payload = payloadOf(frameDigest(digest, 'Fix the auth redirect', 8192).input)

    expect(payload['currentTitle']).toBe('Fix the auth redirect')
  })

  it('trims oldest turns first until the request fits its byte bound', () => {
    const digest = buildWorkDigest(multiTurnLog(10), { maxTurns: 10 })
    const limit = 1800
    const { input, turns } = frameDigest(digest, undefined, limit)

    expect(byteLength(input)).toBeLessThanOrEqual(limit)
    expect(turns.length).toBeLessThan(10)
    expect(turns.length).toBeGreaterThan(0)
    expect(payloadOf(input)['turns']).toHaveLength(turns.length)
  })

  it('drops work lines before it drops the last turn', () => {
    const digest = buildWorkDigest(multiTurnLog(1), { maxTurns: 10 })
    const limit = 700
    const { turns } = frameDigest(digest, undefined, limit)

    expect(turns).toHaveLength(1)
  })

  it('fails loudly when nothing fits the bound', () => {
    const digest = buildWorkDigest(multiTurnLog(1), { maxTurns: 10 })

    expect(() => frameDigest(digest, undefined, 20)).toThrow(/exceeding maxInputBytes/u)
  })
})

describe('titleFromOutput', () => {
  it('takes the first non-empty line', () => {
    expect(titleFromOutput('\n  Fix login redirect \nsecond line')).toBe('Fix login redirect')
  })

  it('removes emphasis that wraps the whole title', () => {
    expect(titleFromOutput('**Fix login redirect**')).toBe('Fix login redirect')
    expect(titleFromOutput('*Fix login redirect*')).toBe('Fix login redirect')
  })

  it('keeps emphasis inside a longer line', () => {
    expect(titleFromOutput('Fix **login** redirect')).toBe('Fix **login** redirect')
  })

  it('returns an empty string for an empty response', () => {
    expect(titleFromOutput('   \n\n')).toBe('')
  })
})