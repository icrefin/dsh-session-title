/**
 * The work-digest fold, driven by real-shaped session events.
 *
 * These tests pin the part a title depends on: which prompts are eligible,
 * which tool calls become work lines, and how a stale digest is bounded without
 * losing the newest turn.
 *
 * @module dsh-session-title/test/digest
 */

import { describe, expect, it } from 'vitest'
import { buildWorkDigest, clip, describeToolCall } from '../src/digest.ts'
import {
  assistantMessage,
  toolCall,
  turnEnd,
  turnStart,
  userMessage,
  type FixtureEvent,
} from './fixtures.ts'

/** Fold a fixture log with the default window. */
function digestOf(events: readonly FixtureEvent[], maxTurns = 10) {
  return buildWorkDigest(events, { maxTurns })
}

describe('buildWorkDigest', () => {
  it('attributes the prompt, the tool work, and the settled answer to their turn', () => {
    const digest = digestOf([
      turnStart(1, 1),
      userMessage(2, 'Fix the login redirect loop'),
      toolCall(3, 'read', { file_path: 'src/login.ts' }),
      toolCall(4, 'edit', { file_path: 'src/login.ts' }),
      assistantMessage(5, 'Removed the recursive redirect from the login callback.'),
      turnEnd(6, 1),
    ])

    expect(digest.turns).toHaveLength(1)
    const [turn] = digest.turns
    expect(turn?.turn).toBe(1)
    expect(turn?.prompt).toBe('Fix the login redirect loop')
    expect(turn?.work).toEqual(['read: src/login.ts', 'edit: src/login.ts'])
    expect(turn?.outcome).toBe('Removed the recursive redirect from the login callback.')
    expect(turn?.failed).toBe(false)
    expect(digest.totalTurns).toBe(1)
    expect(digest.toolCallCount).toBe(2)
    expect(digest.promptCount).toBe(1)
  })

  it('keeps injected context out of the prompt', () => {
    const digest = digestOf([
      turnStart(1, 1),
      userMessage(2, 'AGENTS.md instructions: always run the tests', 'agent'),
      userMessage(3, 'Now add the tests'),
      turnEnd(4, 1),
    ])

    expect(digest.promptCount).toBe(1)
    expect(digest.turns[0]?.prompt).toBe('Now add the tests')
  })

  it('prefers a tool call\'s own label over its raw parameters', () => {
    const digest = digestOf([
      turnStart(1, 1),
      userMessage(2, 'Run the suite'),
      toolCall(3, 'bash', { description: 'Run the test suite', command: 'pnpm test' }),
      turnEnd(4, 1),
    ])

    expect(digest.turns[0]?.work).toEqual(['bash: Run the test suite'])
  })

  it('turns a todo_write call into the task list it records', () => {
    const digest = digestOf([
      turnStart(1, 1),
      userMessage(2, 'Ship the plugin'),
      toolCall(3, 'todo_write', {
        todos: [
          { content: 'Scaffold the package', status: 'completed' },
          { content: 'Write the provider', status: 'in_progress' },
        ],
      }),
      turnEnd(4, 1),
    ])

    expect(digest.turns[0]?.work).toEqual(['todo_write: Scaffold the package; Write the provider'])
  })

  it('keeps the newest turns inside the window and counts the whole log', () => {
    const events: FixtureEvent[] = []
    for (let turn = 1; turn <= 5; turn += 1) {
      events.push(turnStart(turn * 10, turn), userMessage(turn * 10 + 1, `Task ${turn}`), turnEnd(turn * 10 + 2, turn))
    }

    const digest = digestOf(events, 2)
    expect(digest.turns.map((turn) => turn.prompt)).toEqual(['Task 4', 'Task 5'])
    expect(digest.totalTurns).toBe(5)
    expect(digest.promptCount).toBe(5)
  })

  it('carries work that lands after the newest human prompt', () => {
    const digest = digestOf([
      turnStart(1, 1),
      userMessage(2, 'Rename the plugin'),
      toolCall(3, 'write', { file_path: 'package.json' }),
      toolCall(4, 'bash', { description: 'Run the tests' }),
    ])

    expect(digest.turns[0]?.work).toEqual(['write: package.json', 'bash: Run the tests'])
    expect(digest.turns[0]?.outcome).toBe('')
  })

  it('marks a turn that ended without completing', () => {
    const completed = digestOf([turnStart(1, 1), userMessage(2, 'A'), turnEnd(3, 1)])
    const blocked = digestOf([turnStart(1, 1), userMessage(2, 'A'), turnEnd(3, 1, 'blocked')])

    expect(completed.turns[0]?.failed).toBe(false)
    expect(blocked.turns[0]?.failed).toBe(true)
  })

  it('fingerprints new work so an idle session reads as unchanged', () => {
    const log = [
      turnStart(1, 1),
      userMessage(2, 'A'),
      toolCall(3, 'read', { file_path: 'a.ts' }),
      turnEnd(4, 1),
    ]

    expect(digestOf(log).key).toBe(digestOf(log).key)
    expect(digestOf([...log, toolCall(5, 'read', { file_path: 'b.ts' })]).key).not.toBe(digestOf(log).key)
  })

  it('drops turns that contain nothing a title could use', () => {
    const digest = digestOf([turnStart(1, 1), turnEnd(2, 1)])

    expect(digest.turns).toEqual([])
  })
})

describe('describeToolCall', () => {
  it('falls back to the tool name when arguments are missing or malformed', () => {
    expect(describeToolCall('bash', undefined)).toBe('bash')
    expect(describeToolCall('bash', '{not json')).toBe('bash')
  })

  it('keeps one work line within its character budget', () => {
    const long = `bash: ${'x'.repeat(500)}`
    const line = describeToolCall('bash', JSON.stringify({ command: 'x'.repeat(500) }))
    expect(line.length).toBeLessThanOrEqual(140)
    expect(line.startsWith('bash: ')).toBe(true)
    expect(long.length).toBeGreaterThan(line.length)
  })
})

describe('clip', () => {
  it('collapses whitespace and clips with a trailing ellipsis', () => {
    expect(clip('a\n\n  b\tc', 32)).toBe('a b c')
    expect(clip('x'.repeat(20), 8)).toBe('xxxxxxx…')
  })
})