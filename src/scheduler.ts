/**
 * The update scheduler: when a session is worth re-titling.
 *
 * A title that follows the work must change when the work changes — not on a
 * fixed timer, and not after every model step. This scheduler watches completed
 * steps and turns, and asks the session-title service for a revision only when
 * three independent conditions hold:
 *
 * 1. **Progress.** At least one completed turn, or the configured number of
 *    completed steps within the running turn.
 * 2. **Rest.** The minimum wall-clock gap since the last attempt has passed, so
 *    a long session does not pay for a title call every few seconds.
 * 3. **Novelty.** The digest fingerprint differs from the one that produced the
 *    current title, so an idle session is never retitled.
 *
 * A session whose title the user renamed is left alone: the service marks that
 * title `user`-sourced and pins it, and this scheduler does not unpin it.
 *
 * @module dsh-session-title/scheduler
 */

import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title'
import type { Settings } from './config.ts'
import { buildWorkDigest } from './digest.ts'

/** Services this scheduler reaches, supplied by the plugin entry. */
export interface SchedulerDeps {
  /** Validated policy for this mount. */
  readonly settings: Settings
  /** Exact live session for an id, or `undefined` once it is gone. */
  getSession(id: SessionId): Session | undefined
  /** Current folded title of one live session. */
  getTitle(session: Session): SessionTitleSnapshot | undefined
  /** Ask the title service for one revision; rejects when generation fails. */
  refreshTitle(session: Session, signal: AbortSignal): Promise<SessionTitleSnapshot | undefined>
  /** Host logger. */
  readonly log: {
    info(message: string): void
    warn(message: string): void
  }
}

/** The scheduler handle the plugin entry wires to host events. */
export interface Scheduler {
  /** Observe one committed session event. */
  onEvent(session: Session, event: SessionEvent): void
  /** Forget a session that left the store. */
  onDisposed(session: Session): void
  /** Clear timers, cancel in-flight work, and forget every session. */
  close(): void
  /** Number of sessions the scheduler is tracking. */
  pendingCount(): number
}

/** Per-session scheduling state. */
interface SessionState {
  /** Completed turns since the last attempt. */
  turns: number
  /** Completed steps since the last attempt. */
  steps: number
  /** `Date.now()` of the last attempt, successful or not. */
  lastAt: number
  /** Digest fingerprint of the work the current title describes. */
  lastKey: string
  /** Armed timer, when one is waiting for the rest interval. */
  timer?: ReturnType<typeof setTimeout>
  /** Whether one revision is in flight. */
  running: boolean
  /** Cancellation for the in-flight revision. */
  controller?: AbortController
}

/** Turn one unknown rejection into a log line. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Create the scheduler for one plugin mount.
 * @param deps - session lookup, title access, refresh, and logging.
 * @returns the handle the plugin entry feeds session events to.
 */
export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { settings } = deps
  const states = new Map<SessionId, SessionState>()
  let closed = false

  /** Clear one session's timer, abort its revision, and drop its state. */
  const discard = (id: SessionId): void => {
    const state = states.get(id)
    if (state === undefined) return
    if (state.timer !== undefined) clearTimeout(state.timer)
    state.controller?.abort(new Error('session-title: session is no longer tracked'))
    states.delete(id)
  }

  /** Whether the per-session progress gates are satisfied. */
  const progressed = (state: SessionState): boolean =>
    state.turns >= settings.minTurnsBetweenUpdates || state.steps >= settings.minStepsBetweenUpdates

  /** Ask for one revision, updating the state from its outcome. */
  const attempt = async (session: Session): Promise<void> => {
    if (closed) return
    const state = states.get(session.id)
    if (state === undefined || state.running) return
    if (deps.getSession(session.id) !== session) {
      discard(session.id)
      return
    }
    if (!progressed(state)) return

    const current = deps.getTitle(session)
    if (current?.source.kind === 'user') {
      // The user named this session. The service pins that title; do not unpin it.
      state.turns = 0
      state.steps = 0
      state.lastAt = Date.now()
      return
    }

    const digest = buildWorkDigest(session.snapshotEvents(), { maxTurns: settings.maxTurnsInDigest })
    if (digest.turns.length === 0) return
    if (digest.key === state.lastKey) {
      // The log grew without new work: nothing a title could say differently.
      state.turns = 0
      state.steps = 0
      return
    }

    state.running = true
    const controller = new AbortController()
    state.controller = controller
    try {
      const snapshot = await deps.refreshTitle(session, controller.signal)
      state.lastKey = digest.key
      if (snapshot !== undefined) {
        deps.log.info(
          `dsh-session-title: titled session ${session.id} after ${digest.totalTurns} turns: ${snapshot.title}`,
        )
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        deps.log.warn(`dsh-session-title: title update failed for session ${session.id}: ${messageOf(error)}`)
      }
    } finally {
      state.running = false
      delete state.controller
      state.turns = 0
      state.steps = 0
      state.lastAt = Date.now()
    }
  }

  /** Arm the rest-interval timer for one session, when a timer is not already armed. */
  const schedule = (session: Session, state: SessionState): void => {
    if (closed || state.running || state.timer !== undefined) return
    if (!progressed(state)) return
    const wait = Math.max(0, settings.minUpdateIntervalMs - (Date.now() - state.lastAt))
    const timer = setTimeout(() => {
      state.timer = undefined
      void attempt(session)
    }, wait)
    timer.unref?.()
    state.timer = timer
  }

  /** Return the state for one session, creating it on first use. */
  const stateFor = (id: SessionId): SessionState => {
    let state = states.get(id)
    if (state === undefined) {
      state = { turns: 0, steps: 0, lastAt: 0, lastKey: '', running: false }
      states.set(id, state)
    }
    return state
  }

  return {
    onEvent(session, event): void {
      if (closed) return
      if (event.type !== 'turn/end' && event.type !== 'step/end') return
      if (event.type === 'turn/end' && !settings.updateOnTurnEnd) return
      if (event.type === 'step/end' && !settings.updateOnStepEnd) return
      if (session.header.parentSession !== undefined && !settings.includeChildSessions) return

      const state = stateFor(session.id)
      if (event.type === 'turn/end') state.turns += 1
      else state.steps += 1
      schedule(session, state)
    },
    onDisposed(session): void {
      discard(session.id)
    },
    close(): void {
      closed = true
      for (const id of [...states.keys()]) discard(id)
    },
    pendingCount(): number {
      return states.size
    },
  }
}