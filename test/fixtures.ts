/**
 * Session-log fixtures shaped like the events a real DSH session writes.
 *
 * The digest and the prompt are only as good as their idea of a real log, so
 * these builders follow the recorded shapes: `turn/start`, human `user/message`
 * with `source.kind: 'user'`, `tool/call` with a JSON `arguments` string,
 * `assistant/message` with a `message.content` block array, and `turn/end`
 * with a `reason` union.
 *
 * @module dsh-session-title/test/fixtures
 */

/** One fixture event; a real `SessionEvent` is structurally wider. */
export interface FixtureEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

/** Build a `turn/start` event. */
export function turnStart(seq: number, turn: number): FixtureEvent {
  return { type: 'turn/start', seq, time: seq, data: { turn } }
}

/** Build a `step/start` event. */
export function stepStart(seq: number, turn: number, step: number): FixtureEvent {
  return { type: 'step/start', seq, time: seq, data: { turn, step } }
}

/** Build a `step/end` event. */
export function stepEnd(seq: number, turn: number, step: number): FixtureEvent {
  return { type: 'step/end', seq, time: seq, data: { turn, step } }
}

/** Build a `turn/end` event with a terminal reason. */
export function turnEnd(
  seq: number,
  turn: number,
  kind: 'completed' | 'aborted' | 'blocked' | 'failed' = 'completed',
): FixtureEvent {
  return {
    type: 'turn/end',
    seq,
    time: seq,
    data: { turn, reason: kind === 'completed' ? { kind } : { kind, reason: 'test' } },
  }
}

/**
 * Build a `user/message` event.
 * @param kind - message source: a human prompt, or injected context.
 */
export function userMessage(seq: number, text: string, kind: 'user' | 'agent' = 'user'): FixtureEvent {
  return {
    type: 'user/message',
    seq,
    time: seq,
    data: {
      content: [{ type: 'text', text }],
      source: kind === 'user' ? { kind: 'user' } : { kind: 'agent' },
      role: 'user',
      id: `user-${seq}`,
    },
  }
}

/** Build a `tool/call` event whose arguments are serialized as JSON. */
export function toolCall(
  seq: number,
  name: string,
  args: Record<string, unknown>,
  turn = 1,
  step = 1,
): FixtureEvent {
  return {
    type: 'tool/call',
    seq,
    time: seq,
    data: { turn, step, callId: `call-${seq}`, name, arguments: JSON.stringify(args) },
  }
}

/** Build an `assistant/message` event with one text block. */
export function assistantMessage(seq: number, text: string, turn = 1, step = 1): FixtureEvent {
  return {
    type: 'assistant/message',
    seq,
    time: seq,
    data: {
      turn,
      step,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'test', model: 'test-model' },
        id: `assistant-${seq}`,
      },
    },
  }
}

/** Build a `session/title` event, as the service would append it. */
export function titleEvent(seq: number, title: string, kind: 'provider' | 'user' | 'fallback'): FixtureEvent {
  return {
    type: 'session/title',
    seq,
    time: seq,
    data: {
      title,
      messageSeqs: [],
      source: kind === 'provider' ? { kind, provider: 'session-title' } : { kind },
    },
  }
}