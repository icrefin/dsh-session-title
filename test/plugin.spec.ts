/**
 * The plugin entry: what `apply()` registers, and what disposal releases.
 *
 * The point is the wiring a mount actually depends on — a provider in the one
 * registration slot, session-event listeners, the catalog route, and effects
 * that release all of them.
 *
 * @module dsh-session-title/test/plugin
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionTitleProvider, SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title'
import { apply, Config, inject, name } from '../src/index.ts'
import { API } from '../src/protocol.ts'
import { turnEnd, turnStart, userMessage, type FixtureEvent } from './fixtures.ts'

/** One recorded effect. */
interface Effect {
  label: string
  dispose: () => void
}

/** A host context double that records registrations and dispatches events. */
function fakeContext() {
  const effects: Effect[] = []
  const listeners = {
    event: [] as Array<(session: Session, event: SessionEvent) => void>,
    disposed: [] as Array<(session: Session) => void>,
  }
  const live = new Map<string, Session>()
  const refreshes: string[] = []
  const routes: Array<{ path: string }> = []
  let provider: SessionTitleProvider | undefined

  const ctx: Record<string, unknown> = {
    effect: (callback: () => () => void, label: string) => {
      effects.push({ label, dispose: callback() })
    },
    // The host half registers the catalog behind an optional `webServer` gate;
    // this double supplies it and runs the callback immediately.
    inject: (deps: string[], callback: (scope: Record<string, unknown>) => void) => {
      expect(deps).toEqual(['webServer'])
      callback(ctx)
    },
    webServer: {
      register: (route: { path: string }) => {
        routes.push(route)
        return () => {}
      },
    },
    on: (event: 'session/event' | 'session/disposed', listener: (...args: never[]) => void) => {
      if (event === 'session/event') {
        listeners.event.push(listener as (session: Session, event: SessionEvent) => void)
      } else {
        listeners.disposed.push(listener as (session: Session) => void)
      }
      return () => {
        if (event === 'session/event') {
          const index = listeners.event.indexOf(listener as never)
          if (index !== -1) listeners.event.splice(index, 1)
        } else {
          const index = listeners.disposed.indexOf(listener as never)
          if (index !== -1) listeners.disposed.splice(index, 1)
        }
      }
    },
    sessions: { get: (id: string) => live.get(id) },
    sessionTitle: {
      register: (candidate: SessionTitleProvider) => {
        if (provider !== undefined) throw new Error('a provider is already registered')
        provider = candidate
        return async () => {
          provider = undefined
        }
      },
      get: (): SessionTitleSnapshot | undefined => undefined,
      refresh: async (session: Session) => {
        refreshes.push(session.id as unknown as string)
        return undefined
      },
    },
    llm: {
      listProviders: () => [{ id: 'test-provider', name: 'Test Provider' }],
      listModels: async (id: string) => [{ provider: id, id: 'test-model', name: 'Test Model' }],
    },
    logger: { info() {}, warn() {}, debug() {}, error() {} },
  }

  return {
    ctx: ctx as unknown as Context,
    effects,
    listeners,
    live,
    refreshes,
    routes,
    provider: () => provider,
    emit: (event: SessionEvent, session: Session) => {
      for (const listener of listeners.event) listener(session, event)
    },
  }
}

/** A session double with one completed turn of work. */
function makeSession(id: string): { session: Session; append: (event: FixtureEvent) => void } {
  const events: FixtureEvent[] = [
    turnStart(1, 1),
    userMessage(2, 'Fix the login redirect loop'),
    turnEnd(3, 1),
  ]
  const session = {
    id,
    header: {},
    snapshotEvents: () => events,
  }
  return {
    session: session as unknown as Session,
    append: (event) => {
      events.push(event)
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('plugin entry', () => {
  it('exports the row identity and the schema its patch row carries', () => {
    expect(name).toBe('dsh-session-title')
    expect(inject).toEqual(['sessionTitle', 'llm', 'sessions'])
    expect(Config).toBeDefined()
    expect(typeof Config).toBe('function')
  })

  it('registers one title provider, the scheduler and the catalog route', () => {
    const test = fakeContext()

    apply(test.ctx, Config({}) as never)

    expect(test.provider()?.id).toBe('session-title')
    expect(test.provider()?.automatic).toBe('first-prompt')
    expect(test.effects.map((effect) => effect.label)).toEqual([
      'dsh-session-title: title provider',
      'dsh-session-title: update scheduler',
      'dsh-session-title: catalog route',
    ])
    expect(test.listeners.event).toHaveLength(1)
    expect(test.listeners.disposed).toHaveLength(1)
    expect(test.routes.map((route) => route.path)).toEqual([API.catalog])
  })

  it('requests a revision through the session-title service when a turn ends', async () => {
    const test = fakeContext()
    apply(test.ctx, Config({ minUpdateIntervalMs: 0 }) as never)
    const { session } = makeSession('s1')
    test.live.set('s1', session)

    test.emit(turnEnd(4, 1) as unknown as SessionEvent, session)
    await vi.runAllTimersAsync()

    expect(test.refreshes).toEqual(['s1'])
  })

  it('releases the provider, the listeners and pending timers on disposal', async () => {
    const test = fakeContext()
    apply(test.ctx, Config({ minUpdateIntervalMs: 60000 }) as never)
    const { session } = makeSession('s1')
    test.live.set('s1', session)

    test.emit(turnEnd(4, 1) as unknown as SessionEvent, session)
    for (const effect of test.effects.reverse()) effect.dispose()
    await vi.runAllTimersAsync()

    expect(test.refreshes).toEqual([])
    expect(test.provider()).toBeUndefined()
    expect(test.listeners.event).toHaveLength(0)
    expect(test.listeners.disposed).toHaveLength(0)
  })

  it('fails with actionable guidance when another provider owns the slot', () => {
    const test = fakeContext()
    apply(test.ctx, Config({}) as never)
    expect(test.provider()).toBeDefined()

    const occupant = {
      ...(test.ctx as unknown as Record<string, unknown>),
      sessionTitle: {
        register: () => {
          throw new Error('session-title provider "other" is already registered')
        },
      },
    } as unknown as Context

    expect(() => apply(occupant, Config({}) as never)).toThrow(/session-title-llm/u)
  })
})