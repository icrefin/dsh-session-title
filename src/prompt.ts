/**
 * The title prompt: instruction, input framing, and output parsing.
 *
 * These are the three places where a model can stop naming work and start
 * naming a conversation. The instruction asks for the task, not the talk; the
 * framing hands the model the work digest as JSON so no human text can break a
 * delimiter; the parser takes one title line and nothing else.
 *
 * @module dsh-session-title/prompt
 */

import type { DigestTurn, WorkDigest } from './digest.ts'

/** UTF-8 byte length of a string, as the auxiliary request bound measures it. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** Shortest usable prompt or outcome preview while trimming to fit the byte bound. */
const MIN_PREVIEW_CHARS = 40

/**
 * Build the system instruction for one title request.
 *
 * @param settings - the title-length targets to aim for.
 * @param hasCurrentTitle - whether a provider-generated title is being anchored.
 * @returns the exact system prompt.
 */
export function systemPrompt(
  settings: { readonly targetWords: number; readonly targetCjkCharacters: number },
  hasCurrentTitle: boolean,
): string {
  return [
    'You name a coding-assistant session from the work it actually did.',
    'The input is one JSON object with the session\'s newest turns. Each turn reports the human request (prompt), the tools the assistant ran (work), and the assistant\'s last settled words (outcome).',
    'Return only the title: one line of plain natural-language text, with no quotes, prefix, explanation, Markdown, XML, or terminal control codes. Do not return code.',
    'Name the task or tasks the session worked on — the subject and the action, not the conversation about it. When the session moved to a different substantial task, name the latest one.',
    'Use the language the work is written in.',
    `Aim for about ${settings.targetWords} words in non-CJK languages or ${settings.targetCjkCharacters} CJK characters.`,
    'When the input shows only a request and no work yet, title it from the request. Never answer with an explanation.',
    ...(hasCurrentTitle
      ? [
          'An existing title is supplied as currentTitle. Keep it exactly unchanged while it still names the work in progress or the main task.',
          'Acknowledgements, small follow-ups, and extra detail inside the same task do not justify a title change.',
          'Change the title only when the newer turns start a materially different task, or broaden the work so the existing title no longer covers it.',
        ]
      : []),
  ].join('\n')
}

/** One turn as framed for the model. */
interface FramedTurn {
  turn: number
  prompt: string
  work: string[]
  outcome: string
  failed?: true
}

/** Serialize the payload the model reads. */
function render(
  turns: readonly FramedTurn[],
  digest: WorkDigest,
  anchor: string | undefined,
): string {
  const payload: Record<string, unknown> = {
    ...(anchor === undefined ? {} : { currentTitle: anchor }),
    totalTurns: digest.totalTurns,
    toolCallCount: digest.toolCallCount,
    turns: turns.map((turn) => ({
      turn: turn.turn,
      prompt: turn.prompt,
      work: turn.work,
      outcome: turn.outcome,
      ...(turn.failed === true ? { failed: true } : {}),
    })),
  }
  return `Name the session from this JSON object:\n${JSON.stringify(payload)}`
}

/** Convert a digest turn into its framed shape. */
function frameTurn(turn: DigestTurn): FramedTurn {
  return {
    turn: turn.turn,
    prompt: turn.prompt,
    work: [...turn.work],
    outcome: turn.outcome,
    ...(turn.failed ? { failed: true as const } : {}),
  }
}

/** Whether any preview is still long enough to give up characters. */
function previewsShrinkable(turns: readonly FramedTurn[]): boolean {
  return turns.some(
    (turn) => turn.prompt.length > MIN_PREVIEW_CHARS || turn.outcome.length > MIN_PREVIEW_CHARS,
  )
}

/** Shrink one preview toward the floor, always by at least one character. */
function shrinkPreview(text: string): string {
  if (text.length <= MIN_PREVIEW_CHARS) return text
  return text.slice(0, Math.max(MIN_PREVIEW_CHARS, Math.floor(text.length * 0.75)))
}

/** Index of the turn with the longest work list, or -1. */
function longestWorkList(turns: readonly FramedTurn[]): number {
  let index = -1
  let length = 0
  for (const [position, turn] of turns.entries()) {
    if (turn.work.length > length) {
      length = turn.work.length
      index = position
    }
  }
  return index
}

/**
 * Frame a digest for the model inside the request's byte bound.
 *
 * Trimming is deterministic and ordered by information value: oldest turns go
 * first, then the tail of the longest work list, then the prompt and outcome
 * previews. Nothing is cut mid-code-point, and a digest that cannot fit at all
 * fails loudly instead of silently sending a truncated request.
 *
 * @param digest - the folded work digest.
 * @param anchor - provider-generated title to preserve, when the model should keep one.
 * @param maxInputBytes - the prepared-input ceiling.
 * @returns the framed input and the turns it kept.
 * @throws {Error} when even the smallest framing exceeds the ceiling.
 */
export function frameDigest(
  digest: WorkDigest,
  anchor: string | undefined,
  maxInputBytes: number,
): { input: string; turns: readonly FramedTurn[] } {
  let turns = digest.turns.map(frameTurn)
  let input = render(turns, digest, anchor)

  while (byteLength(input) > maxInputBytes && turns.length > 1) {
    turns = turns.slice(1)
    input = render(turns, digest, anchor)
  }

  while (byteLength(input) > maxInputBytes) {
    const index = longestWorkList(turns)
    const turn = index === -1 ? undefined : turns[index]
    if (turn === undefined || turn.work.length === 0) break
    turn.work = turn.work.slice(0, -1)
    input = render(turns, digest, anchor)
  }

  while (byteLength(input) > maxInputBytes && previewsShrinkable(turns)) {
    for (const turn of turns) {
      turn.prompt = shrinkPreview(turn.prompt)
      turn.outcome = shrinkPreview(turn.outcome)
    }
    input = render(turns, digest, anchor)
  }

  if (byteLength(input) > maxInputBytes) {
    throw new Error(
      `dsh-session-title: prepared digest is ${byteLength(input)} bytes, exceeding maxInputBytes ${maxInputBytes}`,
    )
  }
  return { input, turns }
}

/** Asterisk emphasis wrapping a whole line, such as `**Title**`. */
const EMPHASIS_WRAPPER = /^(?<marker>\*{1,3})(?<inner>\S(?:.*\S)?)\k<marker>$/u

/**
 * Take the title from model output: the first non-empty line, without asterisk
 * emphasis that wraps that whole line. Models that disregard the one-line
 * instruction put the title first and commentary after it.
 *
 * @param text - the assembled title-model text.
 * @returns the candidate title, possibly empty.
 */
export function titleFromOutput(text: string): string {
  const line =
    text
      .split(/\r?\n/u)
      .map((item) => item.trim())
      .find((item) => item.length > 0) ?? ''
  const groups = EMPHASIS_WRAPPER.exec(line)?.groups
  const marker = groups?.['marker']
  const inner = groups?.['inner']
  return marker === undefined || inner === undefined || inner.includes(marker) ? line : inner
}