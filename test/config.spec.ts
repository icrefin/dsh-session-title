/**
 * The live configuration view.
 *
 * The settings page writes volatile fields, and the Loader updates them in
 * place. These tests pin the consequence: `Settings` must read the current value
 * on each use, not the value that existed at mount.
 *
 * @module dsh-session-title/test/config
 */

import { describe, expect, it } from 'vitest'
import { resolveExecution, resolveSettings } from '../src/config.ts'

/** A mutable volatile-field holder, shaped like the Loader's own. */
function holder<T>(initial: T) {
  let value = initial
  return {
    get: (): T => value,
    set: (next: T): void => {
      value = next
    },
  }
}

describe('resolveSettings', () => {
  it('fills the documented defaults', () => {
    const settings = resolveSettings({})

    expect(settings.targetWords).toBe(6)
    expect(settings.targetCjkCharacters).toBe(12)
    expect(settings.maxTurnsInDigest).toBe(10)
    expect(settings.minTurnsBetweenUpdates).toBe(1)
    expect(settings.minStepsBetweenUpdates).toBe(2)
    expect(settings.minUpdateIntervalMs).toBe(120000)
    expect(settings.updateOnTurnEnd).toBe(true)
    expect(settings.updateOnStepEnd).toBe(true)
    expect(settings.includeChildSessions).toBe(false)
    expect(settings.route).toEqual({})
  })

  it('reads a volatile holder live, so a settings write applies without a restart', () => {
    const interval = holder(120000)
    const settings = resolveSettings({ minUpdateIntervalMs: interval })

    expect(settings.minUpdateIntervalMs).toBe(120000)
    interval.set(30000)
    expect(settings.minUpdateIntervalMs).toBe(30000)
  })

  it('reads the pinned route live', () => {
    const provider = holder('')
    const model = holder('')
    const settings = resolveSettings({ provider, model })

    expect(settings.route).toEqual({})
    provider.set('baidu-team')
    model.set('deepseek-v4.1-flash-1017')
    expect(settings.route).toEqual({ provider: 'baidu-team', model: 'deepseek-v4.1-flash-1017' })
    provider.set('')
    model.set('')
    expect(settings.route).toEqual({})
  })

  it('rejects a half-supplied route pair at mount', () => {
    expect(() => resolveSettings({ provider: 'baidu-team' })).toThrow(/supplied together/u)
    expect(() => resolveSettings({ model: 'deepseek-v4.1-flash-1017' })).toThrow(/supplied together/u)
  })

  it('rejects a field outside its accepted range', () => {
    expect(() => resolveSettings({ minStepsBetweenUpdates: 0 })).toThrow(/minStepsBetweenUpdates/u)
    expect(() => resolveSettings({ targetWords: 'many' })).toThrow(/targetWords/u)
    expect(() => resolveSettings({ timeoutMs: 700000 })).toThrow(/timeoutMs/u)
    expect(() => resolveSettings({ updateOnTurnEnd: 'yes' })).toThrow(/updateOnTurnEnd/u)
  })
})

describe('resolveExecution', () => {
  it('composes the bounds with the inherited route', () => {
    const settings = resolveSettings({})
    const execution = resolveExecution(settings)

    expect(execution.maxInputBytes).toBe(8192)
    expect(execution.maxOutputTokens).toBe(2048)
    expect(execution.timeoutMs).toBe(30000)
    expect(execution.provider).toBeUndefined()
    expect(execution.model).toBeUndefined()
  })

  it('carries a pinned route into the auxiliary request', () => {
    const settings = resolveSettings({ provider: 'baidu-team', model: 'deepseek-v4.1-flash-1017' })
    const execution = resolveExecution(settings)

    expect(execution.provider).toBe('baidu-team')
    expect(execution.model).toBe('deepseek-v4.1-flash-1017')
  })

  it('re-validates on read, so a bad live value fails that request only', () => {
    const timeout = holder(30000)
    const settings = resolveSettings({ timeoutMs: timeout })
    timeout.set(700000)

    expect(() => resolveExecution(settings)).toThrow(/timeoutMs/u)
  })
})