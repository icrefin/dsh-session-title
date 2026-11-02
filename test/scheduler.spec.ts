/**
 * The update scheduler, with fake timers and a recording title service.
 *
 * These tests exist because the interesting behavior is *when* a title is not
 * requested: before any work landed, inside the rest interval, for an unchanged
 * log, and for a session the user named. Each of those is a real cost — a model
 * call and a new `session/title` event — so each is asserted here.
 *
 * @module dsh-session-title/test/scheduler
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title'
import { resolveSettings } from '../src/config.ts'
import { createScheduler, type SchedulerDeps } from '../src/scheduler.ts'
import {
  stepEnd,
  toolCall,
  turnEnd,
  turnStart,
  userMessage,
  type FixtureEvent,
} from './fixtures.ts'

/** A session double: an id, a header, and a mutable log. */
interface FakeSession {
  readonly id: string
  header: { parentSession?: string }
  events: FixtureEvent[]
  snapshotEvents(): readonly FixtureEvent[]
}

/** Build a session double with one turn of work already in its log. */
function makeSession(id: string, parentSession?: string): FakeSession {
  const session: FakeSession = {
    id,
    header: parentSession === undefined ? {} : { parentSession },
    events: [
      turnStart(1, 1),
      userMessage(2, 'Fix the login redirect loop'),
      toolCall(3, 'read', { file_path: 'src/login.ts' }),
      turnEnd(4, 1),
    ],
    snapshotEvents() {
      return session.events
    },
  }
  return session
}

/** The title snapshot shape the scheduler reads. */
function snapshot(title: string, kind: 'provider' | 'user' = 'provider'): SessionTitleSnapshot {
  return {
    title,
    messageSeqs: [],
    source: kind === 'provider' ? { kind, provider: 'session-title' } : { kind },
    eventSeq: 0,
    updatedAt: 0,
  } as unknown as SessionTitleSnapshot
}

/** A recording harness around {@link createScheduler}. */
function harness(overrides: Record<string, unknown> = {}) {
  const settings = resolveSettings({
    minTurnsBetweenUpdates: 1,
    minStepsBetweenUpdates: 2,
    minUpdateIntervalMs: 0,
    ...overrides,
  })
  const live = new Map<string, FakeSession>()
  const refreshes: string[] = []
  const warnings: string[] = []
  let currentTitle: SessionTitleSnapshot | undefined
  let failure: Error | undefined
  let release: (() => void) | undefined

  const deps: SchedulerDeps = {
    settings,
    getSession: (id) => live.get(id as unknown as string) as unknown as Session | undefined,
    getTitle: () => currentTitle,
    refreshTitle: async (session) => {
      refreshes.push(session.id as unknown as string)
      if (failure !== undefined) throw failure
      if (release !== undefined) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      currentTitle = snapshot('New title')
      return currentTitle
    },
    log: {
      info: () => {},
      warn: (message) => warnings.push(message),
    },
  }

  const scheduler = createScheduler(deps)
  return {
    settings,
    scheduler,
    refreshes,
    warnings,
    live,
    setTitle: (value: SessionTitleSnapshot | undefined) => {
      currentTitle = value
    },
    failWith: (error: Error | undefined) => {
      failure = error
    },
    hold: () => {
      release = () => {}
    },
    release: () => {
      release?.()
      release = undefined
    },
  }
}

/** Cast one fixture event to the session-event type the scheduler receives. */
function asEvent(event: FixtureEvent): SessionEvent {
  return event as unknown as SessionEvent
}

/** Cast a session double to the session type the scheduler receives. */
function asSession(session: FakeSession): Session {
  return session as unknown as Session
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createScheduler', () => {
  it('asks for one revision after a completed turn', async () => {
    const test = harness()
    const session = makeSession('s1')
    test.live.set('s1', session)

    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(5, 1)))
    await vi.runAllTimersAsync()

    expect(test.refreshes).toEqual(['s1'])
  })

  it('waits for the rest interval before asking again', async () => {
    const test = harness({ minUpdateIntervalMs: 120000 })
    const session = makeSession('s1')
    test.live.set('s1', session)

    // The first revision has no prior attempt to rest from.
    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(5, 1)))
    await vi.runAllTimersAsync()
    expect(test.refreshes).toEqual(['s1'])

    session.events.push(turnStart(6, 2), toolCall(7, 'edit', { file_path: 'a.ts' }, 2), turnEnd(8, 2))
    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(8, 2)))
    await vi.advanceTimersByTimeAsync(60000)
    expect(test.refreshes).toEqual(['s1'])

    await vi.advanceTimersByTimeAsync(60001)
    expect(test.refreshes).toEqual(['s1', 's1'])
  })

  it('holds a revision until the configured progress lands', async () => {
    const test = harness({ minTurnsBetweenUpdates: 2, minStepsBetweenUpdates: 3 })
    const session = makeSession('s1')
    test.live.set('s1', session)

    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(5, 1)))
    test.scheduler.onEvent(asSession(session), asEvent(stepEnd(6, 2, 1)))
    test.scheduler.onEvent(asSession(session), asEvent(stepEnd(7, 2, 2)))
    await vi.runAllTimersAsync()
    expect(test.refreshes).toEqual([])

    test.scheduler.onEvent(asSession(session), asEvent(stepEnd(8, 2, 3)))
    await vi.runAllTimersAsync()
    expect(test.refreshes).toEqual(['s1'])
  })

  it('leaves a session the user named alone', async () => {
    const test = harness()
    const session = makeSession('s1')
    test.live.set('s1', session)
    test.setTitle(snapshot('My own name', 'user'))

    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(5, 1)))
    await vi.runAllTimersAsync()

    expect(test.refreshes).toEqual([])
  })

  it('skips child sessions unless they are included', async () => {
    const child = makeSession('child', 'parent')

    const excluded = harness()
    excluded.live.set('child', child)
    excluded.scheduler.onEvent(asSession(child), asEvent(turnEnd(5, 1)))
    await vi.runAllTimersAsync()
    expect(excluded.refreshes).toEqual([])

    const included = harness({ includeChildSessions: true })
    included.live.set('child', child)
    included.scheduler.onEvent(asSession(child), asEvent(turnEnd(5, 1)))
    await vi.runAllTimersAsync()
    expect(included.refreshes).toEqual(['child'])
  })

  it('does not retitle a log that grew without new work', async () => {
    const test = harness()
    const session = makeSession('s1')
    test.live.set('s1', session)

    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(5, 1)))
    await vi.runAllTimersAsync()
    expect(test.refreshes).toEqual(['s1'])

    session.events.push(stepEnd(6, 2, 1), stepEnd(7, 2, 2))
    test.scheduler.onEvent(asSession(session), asEvent(stepEnd(6, 2, 1)))
    test.scheduler.onEvent(asSession(session), asEvent(stepEnd(7, 2, 2)))
    await vi.runAllTimersAsync()

    expect(test.refreshes).toEqual(['s1'])
  })

  it('counts new tool work as a reason to retitle', async () => {
    const test = harness()
    const session = makeSession('s1')
    test.live.set('s1', session)
    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(5, 1)))
    await vi.runAllTimersAsync()

    session.events.push(
      turnStart(6, 2),
      toolCall(7, 'edit', { file_path: 'src/login.ts' }, 2),
      turnEnd(8, 2),
    )
    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(8, 2)))
    await vi.runAllTimersAsync()

    expect(test.refreshes).toEqual(['s1', 's1'])
  })

  it('runs one revision at a time', async () => {
    const test = harness()
    const session = makeSession('s1')
    test.live.set('s1', session)
    test.hold()

    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(5, 1)))
    await vi.runAllTimersAsync()
    session.events.push(turnStart(6, 2), toolCall(7, 'edit', { file_path: 'a.ts' }, 2), turnEnd(8, 2))
    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(8, 2)))
    await vi.runAllTimersAsync()

    expect(test.refreshes).toEqual(['s1'])
    test.release()
    await vi.runAllTimersAsync()
  })

  it('warns and backs off when generation fails', async () => {
    const test = harness({ minUpdateIntervalMs: 60000 })
    const session = makeSession('s1')
    test.live.set('s1', session)
    test.failWith(new Error('provider down'))

    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(5, 1)))
    await vi.advanceTimersByTimeAsync(0)
    expect(test.warnings).toHaveLength(1)
    expect(test.warnings[0]).toContain('provider down')

    session.events.push(turnStart(6, 2), turnEnd(7, 2))
    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(7, 2)))
    await vi.advanceTimersByTimeAsync(30000)
    expect(test.refreshes).toHaveLength(1)
  })

  it('forgets a session that left the store', async () => {
    const test = harness({ minUpdateIntervalMs: 60000 })
    const session = makeSession('s1')
    test.live.set('s1', session)

    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(5, 1)))
    expect(test.scheduler.pendingCount()).toBe(1)

    test.scheduler.onDisposed(asSession(session))
    expect(test.scheduler.pendingCount()).toBe(0)
    await vi.runAllTimersAsync()
    expect(test.refreshes).toEqual([])
  })

  it('does not act after close()', async () => {
    const test = harness({ minUpdateIntervalMs: 60000 })
    const session = makeSession('s1')
    test.live.set('s1', session)

    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(5, 1)))
    test.scheduler.close()
    await vi.runAllTimersAsync()

    expect(test.refreshes).toEqual([])
    expect(test.scheduler.pendingCount()).toBe(0)
  })

  it('ignores steps and turns when both opportunities are configured off', async () => {
    const test = harness({ updateOnTurnEnd: false, updateOnStepEnd: false })
    const session = makeSession('s1')
    test.live.set('s1', session)

    test.scheduler.onEvent(asSession(session), asEvent(turnEnd(5, 1)))
    test.scheduler.onEvent(asSession(session), asEvent(stepEnd(6, 2, 1)))
    await vi.runAllTimersAsync()

    expect(test.refreshes).toEqual([])
  })
})