/**
 * Loader configuration for `dsh-session-title`.
 *
 * Every field is **volatile**: the settings page writes through the Host's
 * settings transport, the Loader updates the running row in place, and the
 * provider and scheduler read the current value on their next use. That is what
 * makes "change the naming model" a live decision instead of an edit that waits
 * for a restart.
 *
 * The schema is also the namespace the settings page reads and writes, so a
 * field added here appears in the page's own form with no second copy.
 *
 * @module dsh-session-title/config
 */

import z from '@deepseek-ai/schemastery'
import { resolveSessionTitleLlmConfig, type SessionTitleLlmConfig } from '@deepseek-ai/dsh-session-title-llm'

/**
 * Loader schema for this plugin's row.
 *
 * `targetWords` and `targetCjkCharacters` bound the title length. The
 * `maxInputBytes` / `maxOutputTokens` / `timeoutMs` trio plus the optional
 * `provider`/`model` pair are the shared auxiliary-request controls. The
 * remaining fields decide *when* a title revision is worth a model call.
 */
export const Config = z.object({
  /** Target word count for a non-CJK title. */
  targetWords: z.number().step(1).min(1).max(40).default(6).volatile(),
  /** Target character count for a CJK title. */
  targetCjkCharacters: z.number().step(1).min(1).max(80).default(12).volatile(),
  /** UTF-8 byte ceiling for the prepared digest input. */
  maxInputBytes: z.number().step(1).min(256).max(400000).default(8192).volatile(),
  /** Output-token cap for one title request. */
  maxOutputTokens: z.number().step(1).min(16).max(100000).default(2048).volatile(),
  /** End-to-end deadline for one title request, in milliseconds. */
  timeoutMs: z.number().step(1).min(1000).max(600000).default(30000).volatile(),
  /** Explicit LLM provider route; empty inherits the session's own route. */
  provider: z.string().volatile(),
  /** Explicit LLM model id; empty inherits the session's own route. */
  model: z.string().volatile(),
  /** How many of the newest turns the digest carries. */
  maxTurnsInDigest: z.number().step(1).min(1).max(40).default(10).volatile(),
  /** Completed turns required before another automatic revision. */
  minTurnsBetweenUpdates: z.number().step(1).min(1).max(50).default(1).volatile(),
  /** Completed steps required before a mid-turn revision. */
  minStepsBetweenUpdates: z.number().step(1).min(1).max(100).default(2).volatile(),
  /** Minimum wall-clock gap between two automatic revisions, in milliseconds. */
  minUpdateIntervalMs: z.number().step(500).min(0).max(3600000).default(120000).volatile(),
  /** Refresh a title when a turn ends. */
  updateOnTurnEnd: z.boolean().default(true).volatile(),
  /** Allow mid-turn refreshes at step boundaries. */
  updateOnStepEnd: z.boolean().default(true).volatile(),
  /** Title sessions that a parent session spawned (subagent forks). */
  includeChildSessions: z.boolean().default(false).volatile(),
})

/** Explicit route override; both fields or neither. */
export interface RouteOverride {
  /** Provider route key, when the user pinned one. */
  readonly provider?: string
  /** Model id, when the user pinned one. */
  readonly model?: string
}

/** The auxiliary-request bounds this plugin controls directly. */
export interface ExecutionBounds {
  /** UTF-8 byte ceiling for the prepared digest input. */
  readonly maxInputBytes: number
  /** Output-token cap for one title request. */
  readonly maxOutputTokens: number
  /** End-to-end deadline for one title request. */
  readonly timeoutMs: number
}

/**
 * Live view of one plugin mount's policy.
 *
 * Every member is a getter over the raw Loader config, so a settings write that
 * touches a volatile field is visible to the next title request without
 * re-mounting the plugin.
 */
export interface Settings {
  /** Title-length target in words for non-CJK text. */
  readonly targetWords: number
  /** Title-length target in characters for CJK text. */
  readonly targetCjkCharacters: number
  /** Current request bounds. */
  readonly execution: ExecutionBounds
  /** Current explicit route override, empty when inherited. */
  readonly route: RouteOverride
  /** Newest-turns window carried by the digest. */
  readonly maxTurnsInDigest: number
  /** Completed-turn gate for an automatic revision. */
  readonly minTurnsBetweenUpdates: number
  /** Completed-step gate for a mid-turn revision. */
  readonly minStepsBetweenUpdates: number
  /** Minimum gap between two automatic revisions. */
  readonly minUpdateIntervalMs: number
  /** Whether a turn boundary is an update opportunity. */
  readonly updateOnTurnEnd: boolean
  /** Whether a step boundary is an update opportunity. */
  readonly updateOnStepEnd: boolean
  /** Whether child (subagent) sessions are titled too. */
  readonly includeChildSessions: boolean
}

/** Read the plain value a Loader config holds, following a volatile holder when present. */
function readField(value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as { get(): unknown }).get()
  }
  return value
}

/** Reject a field that is not a safe integer inside its accepted range. */
function readInteger(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = readField(record[key])
  const value = raw === undefined ? fallback : raw
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`dsh-session-title: ${key} must be an integer between ${min} and ${max}`)
  }
  return value
}

/** Read a boolean field, with the schema default as the fallback. */
function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = readField(record[key])
  const value = raw === undefined ? fallback : raw
  if (typeof value !== 'boolean') throw new Error(`dsh-session-title: ${key} must be a boolean`)
  return value
}

/** Read a non-empty string field, treating an empty string as unset. */
function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const raw = readField(record[key])
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string') {
    throw new Error(`dsh-session-title: ${key} must be a string`)
  }
  return raw
}

/** Read the optional provider/model route pair, rejecting a half-supplied pair. */
export function readRoute(record: Record<string, unknown>): RouteOverride {
  const provider = readOptionalString(record, 'provider')
  const model = readOptionalString(record, 'model')
  if (provider === undefined && model === undefined) return {}
  if (provider === undefined || model === undefined) {
    throw new Error('dsh-session-title: provider and model must be supplied together')
  }
  return { provider, model }
}

/**
 * Build the live policy view over one raw Loader config.
 *
 * The values are validated once at mount so a malformed profile patch fails
 * loudly here instead of silently keeping the old title forever. Later writes
 * are re-validated on read: a value the Host accepted is still re-checked at the
 * exact point it would be used.
 *
 * @param config - the value the Loader passes to `apply()`.
 * @returns a frozen object whose members are live getters.
 * @throws {Error} when a field is malformed or outside its accepted range.
 */
export function resolveSettings(config: unknown): Settings {
  if (config === null || typeof config !== 'object') {
    throw new Error('dsh-session-title: configuration is required')
  }
  const record = config as Record<string, unknown>

  const settings: Settings = {
    get targetWords(): number {
      return readInteger(record, 'targetWords', 6, 1, 40)
    },
    get targetCjkCharacters(): number {
      return readInteger(record, 'targetCjkCharacters', 12, 1, 80)
    },
    get execution(): ExecutionBounds {
      return {
        maxInputBytes: readInteger(record, 'maxInputBytes', 8192, 256, 400000),
        maxOutputTokens: readInteger(record, 'maxOutputTokens', 2048, 16, 100000),
        timeoutMs: readInteger(record, 'timeoutMs', 30000, 1000, 600000),
      }
    },
    get route(): RouteOverride {
      return readRoute(record)
    },
    get maxTurnsInDigest(): number {
      return readInteger(record, 'maxTurnsInDigest', 10, 1, 40)
    },
    get minTurnsBetweenUpdates(): number {
      return readInteger(record, 'minTurnsBetweenUpdates', 1, 1, 50)
    },
    get minStepsBetweenUpdates(): number {
      return readInteger(record, 'minStepsBetweenUpdates', 2, 1, 100)
    },
    get minUpdateIntervalMs(): number {
      return readInteger(record, 'minUpdateIntervalMs', 120000, 0, 3600000)
    },
    get updateOnTurnEnd(): boolean {
      return readBoolean(record, 'updateOnTurnEnd', true)
    },
    get updateOnStepEnd(): boolean {
      return readBoolean(record, 'updateOnStepEnd', true)
    },
    get includeChildSessions(): boolean {
      return readBoolean(record, 'includeChildSessions', false)
    },
  }

  // Touch every getter once: a bad composition now fails at mount.
  validateSettings(settings)

  return Object.freeze(settings)
}

/**
 * Read every member once so a malformed composition fails at mount instead of
 * at the first title request.
 * @param settings - the live policy view.
 * @throws {Error} when any member is malformed or outside its accepted range.
 */
function validateSettings(settings: Settings): void {
  const read = [
    settings.targetWords,
    settings.targetCjkCharacters,
    settings.maxTurnsInDigest,
    settings.minTurnsBetweenUpdates,
    settings.minStepsBetweenUpdates,
    settings.minUpdateIntervalMs,
    settings.updateOnTurnEnd,
    settings.updateOnStepEnd,
    settings.includeChildSessions,
  ]
  if (read.length !== 9) throw new Error('dsh-session-title: configuration validation is incomplete')
  resolveExecution(settings)
}

/**
 * Compose the current bounds and route override into the executor's config.
 *
 * Read at every title request, never cached, so the settings page's model choice
 * applies to the next title instead of the next harness start.
 *
 * @param settings - the live policy view.
 * @returns the validated, frozen auxiliary-request configuration.
 * @throws {Error} when the bounds or the route pair are invalid.
 */
export function resolveExecution(settings: Settings): SessionTitleLlmConfig {
  const { maxInputBytes, maxOutputTokens, timeoutMs } = settings.execution
  const route = settings.route
  return resolveSessionTitleLlmConfig({
    maxInputBytes,
    maxOutputTokens,
    timeoutMs,
    ...route,
  })
}