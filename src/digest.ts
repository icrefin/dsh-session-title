/**
 * The work digest: a bounded, model-readable summary of what a session
 * actually did.
 *
 * A title that follows the work cannot be built from human prompts alone: the
 * interesting part is the work between them — the tools that ran, the files
 * they touched, the tasks tracked, and the words the assistant settled on. This
 * module folds a session log into a small per-turn record of exactly those
 * things. It is pure: the same events always produce the same digest, which is
 * what makes both the title prompt and its tests deterministic.
 *
 * @module dsh-session-title/digest
 */

/** The minimal event envelope this fold reads; a real `SessionEvent` satisfies it. */
export interface DigestEvent {
  /** Session event type, such as `turn/start` or `tool/call`. */
  readonly type: string
  /** Monotonic session sequence number. */
  readonly seq: number
  /** Event payload, narrowed by {@link digestEventData}. */
  readonly data: unknown
}

/** One turn as the title model sees it. */
export interface DigestTurn {
  /** Host-assigned turn number. */
  readonly turn: number
  /** Leading human text of the turn, clipped; `''` when the turn has none yet. */
  prompt: string
  /** Compact descriptions of the work done in the turn, newest last. */
  readonly work: string[]
  /** Last settled assistant text of the turn, clipped; `''` before any. */
  outcome: string
  /** Whether the turn ended in a non-successful state. */
  failed: boolean
}

/** A fold of the session log, bounded to the newest turns. */
export interface WorkDigest {
  /** The newest turns, oldest first. */
  readonly turns: DigestTurn[]
  /** Highest turn number observed in the log. */
  readonly totalTurns: number
  /** Number of `tool/call` events observed in the whole log. */
  readonly toolCallCount: number
  /** Number of eligible human messages observed in the whole log. */
  readonly promptCount: number
  /** Cheap fingerprint of the work observed; equal keys mean "no new work". */
  readonly key: string
}

/** Per-turn cap on the work list handed to the model. */
const WORK_PER_TURN = 8
/** Character cap for a turn's prompt preview. */
const PROMPT_CHARS = 280
/** Character cap for a turn's outcome preview. */
const OUTCOME_CHARS = 280
/** Character cap for one work description. */
const WORK_CHARS = 140
/** Character cap for a tool argument hint. */
const HINT_CHARS = 90

/** Narrow one unknown payload to a plain record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Read a string field. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Read a finite number field. */
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Collapse whitespace and clip one line to a character budget. */
export function clip(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim()
  if (collapsed.length <= maxChars) return collapsed
  return `${collapsed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

/** Join the text blocks of a message `content` array. */
function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    if (record?.type !== 'text') continue
    const text = asString(record.text)
    if (text !== undefined && text.length > 0) parts.push(text)
  }
  return parts.join('\n')
}

/** Parse a tool-call argument string without throwing on a partial payload. */
function parseArguments(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined || raw.length === 0) return undefined
  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/** Fields that name the object of a tool call, in decreasing usefulness. */
const HINT_KEYS = [
  'description',
  'file_path',
  'path',
  'pattern',
  'query',
  'command',
  'goal',
  'label',
  'url',
  'prompt',
  'skill',
  'name',
  'title',
  'topic',
  'symbol',
] as const

/**
 * Describe one tool call as the work it performed.
 *
 * The description prefers the call's own human label (a bash `description`, a
 * path, a query) over raw parameter text, so the digest reads as a list of
 * actions rather than as JSON. `todo_write` is special-cased because its
 * arguments are the task list itself — the strongest "tasks worked on" signal a
 * session log contains.
 *
 * @param name - tool name from the event.
 * @param arguments - raw argument JSON, when the event carries any.
 * @returns one bounded work line.
 */
export function describeToolCall(name: string, argumentText: string | undefined): string {
  const parsed = parseArguments(argumentText)
  if (parsed !== undefined) {
    if (name === 'todo_write' && Array.isArray(parsed.todos)) {
      const items: string[] = []
      for (const todo of parsed.todos) {
        const record = asRecord(todo)
        const content = asString(record?.content) ?? asString(record?.task)
        if (content !== undefined && content.length > 0) items.push(clip(content, 48))
      }
      if (items.length > 0) return clip(`${name}: ${items.slice(0, 5).join('; ')}`, WORK_CHARS)
    }
    if (name === 'exit_plan_mode' && typeof parsed.plan === 'string') {
      const heading = parsed.plan
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (heading !== undefined) return clip(`${name}: ${heading.replace(/^#+\s*/u, '')}`, WORK_CHARS)
    }
    for (const key of HINT_KEYS) {
      const value = asString(parsed[key])
      if (value === undefined || value.length === 0) continue
      return clip(`${name}: ${clip(value, HINT_CHARS)}`, WORK_CHARS)
    }
  }
  return clip(name, WORK_CHARS)
}

/** Create one empty turn record. */
function createTurn(turn: number): DigestTurn {
  return { turn, prompt: '', work: [], outcome: '', failed: false }
}

/**
 * Fold a session log into the work digest the title model reads.
 *
 * Only human prompts are eligible: injected context, skill dumps, and tool
 * results never become a "prompt". Tool calls are attributed to the turn open
 * at their seq, so work that lands after the newest prompt still counts.
 *
 * @param events - the session log, in seq order.
 * @param options - the newest-turns window to keep.
 * @returns the bounded digest.
 */
export function buildWorkDigest(
  events: readonly DigestEvent[],
  options: { readonly maxTurns: number },
): WorkDigest {
  const byTurn = new Map<number, DigestTurn>()
  let currentTurn = 0
  let toolCallCount = 0
  let promptCount = 0

  const turnAt = (turn: number): DigestTurn => {
    let turnRecord = byTurn.get(turn)
    if (turnRecord === undefined) {
      turnRecord = createTurn(turn)
      byTurn.set(turn, turnRecord)
    }
    return turnRecord
  }

  for (const event of events) {
    const data = asRecord(event.data)
    switch (event.type) {
      case 'turn/start': {
        const turn = asNumber(data?.turn)
        if (turn !== undefined) currentTurn = turn
        break
      }
      case 'user/message': {
        const source = asRecord(data?.source)
        if (source?.kind !== 'user') break
        const text = textOfContent(data?.content)
        if (text.length === 0) break
        promptCount += 1
        const turnRecord = turnAt(currentTurn)
        if (turnRecord.prompt.length === 0) turnRecord.prompt = clip(text, PROMPT_CHARS)
        break
      }
      case 'tool/call': {
        toolCallCount += 1
        const turnRecord = turnAt(currentTurn)
        if (turnRecord.work.length >= WORK_PER_TURN) break
        const name = asString(data?.name) ?? 'tool'
        turnRecord.work.push(describeToolCall(name, asString(data?.arguments)))
        break
      }
      case 'assistant/message': {
        const message = asRecord(data?.message)
        const text = textOfContent(message?.content)
        if (text.length === 0) break
        turnAt(currentTurn).outcome = clip(text, OUTCOME_CHARS)
        break
      }
      case 'turn/end': {
        const turn = asNumber(data?.turn) ?? currentTurn
        const reason = asRecord(data?.reason)
        if (reason?.kind !== undefined && reason.kind !== 'completed') {
          turnAt(turn).failed = true
        }
        break
      }
      default:
        break
    }
  }

  const allTurns = [...byTurn.values()]
    .filter((turn) => turn.prompt.length > 0 || turn.work.length > 0 || turn.outcome.length > 0)
    .sort((left, right) => left.turn - right.turn)
  const keptTurns = allTurns.slice(Math.max(0, allTurns.length - options.maxTurns))
  const highestTurn = allTurns.length === 0 ? 0 : (allTurns[allTurns.length - 1] as DigestTurn).turn

  return {
    turns: keptTurns,
    totalTurns: Math.max(highestTurn, currentTurn),
    toolCallCount,
    promptCount,
    key: `${Math.max(highestTurn, currentTurn)}:${toolCallCount}:${promptCount}`,
  }
}