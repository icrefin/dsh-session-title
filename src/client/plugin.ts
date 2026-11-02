/**
 * Identifiers and the wire-shaped settings type shared by the browser half and
 * its tests.
 *
 * The settings type mirrors the host's `Config` field by field. It is
 * re-declared instead of imported because `../config.ts` imports schemastery and
 * the title LLM executor, and a value import of the host's schema would drag
 * server code into the browser bundle. The two stay in step by hand: a field
 * that drifts shows up as a control that saves into nothing.
 *
 * @module dsh-session-title/client/plugin
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'dsh-session-title'

/** Section id inside the Settings navigation. */
export const SECTION_ID = 'session-title'

/** Settings namespace, which equals the Loader row id. */
export const SETTINGS_NS = 'dsh-session-title'

/**
 * Services required by the settings registration.
 *
 * `configForms` carries the settings document, `slots` the seat, and `locale` the
 * dictionary. The Settings bundle owns the seat this plugin registers into, so
 * `dsh.client.inject` in `package.json` orders this bundle after it.
 */
export const inject = ['slots', 'locale', 'configForms'] as const

/** Settings values as the browser reads and writes them. */
export interface SettingsValue {
  /** Target word count for a non-CJK title. */
  targetWords: number
  /** Target character count for a CJK title. */
  targetCjkCharacters: number
  /** UTF-8 byte ceiling for the prepared digest input. */
  maxInputBytes: number
  /** Output-token cap for one title request. */
  maxOutputTokens: number
  /** End-to-end deadline for one title request, in milliseconds. */
  timeoutMs: number
  /** Pinned provider route; absent means "follow the session's route". */
  provider?: string
  /** Pinned model id; absent means "follow the session's route". */
  model?: string
  /** How many of the newest turns the digest carries. */
  maxTurnsInDigest: number
  /** Completed turns required before another revision. */
  minTurnsBetweenUpdates: number
  /** Completed steps required before a mid-turn revision. */
  minStepsBetweenUpdates: number
  /** Minimum wall-clock gap between two revisions, in milliseconds. */
  minUpdateIntervalMs: number
  /** Refresh a title when a turn ends. */
  updateOnTurnEnd: boolean
  /** Allow mid-turn refreshes at step boundaries. */
  updateOnStepEnd: boolean
  /** Title subagent sessions too. */
  includeChildSessions: boolean
}