/**
 * The title provider, exercised through the real shared LLM executor.
 *
 * Nothing here stubs `executeSessionTitleLlm`: the provider builds its digest,
 * hands the shared executor a framed request, the executor appends the
 * `session/title-llm-request` record to the session log, and the provider parses
 * the assembled answer. Only the adapter stream and the service are doubles.
 *
 * @module dsh-session-title/test/provider
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import { SessionSeq as brandSeq } from '@deepseek-ai/dsh-session'
import type {
  SessionTitleProvider,
  SessionTitleProviderRequest,
} from '@deepseek-ai/dsh-session-title'
import { resolveSettings } from '../src/config.ts'
import { PROVIDER_CADENCE, PROVIDER_ID, registerWorkTitleProvider, titleFromResponse } from '../src/provider.ts'
import { assistantMessage, toolCall, turnEnd, turnStart, userMessage, type FixtureEvent } from './fixtures.ts'

/** One chunk the fake adapter streams. */
type FakeChunk = Record<string, unknown>

/** Everything one provider round needs: a session double, a fake adapter, and the capture. */
function setup(chunks: readonly FakeChunk[], overrides: Record<string, unknown> = {}) {
  const events: FixtureEvent[] = [
    turnStart(1, 1),
    userMessage(2, 'Fix the login redirect loop'),
    toolCall(3, 'read', { file_path: 'src/login.ts' }),
    assistantMessage(4, 'Found the recursive redirect in the login callback.'),
    turnEnd(5, 1),
  ]
  const appended: Array<{ type: string; data: unknown }> = []
  const session = {
    id: 'session-1',
    header: {},
    snapshotEvents: () => events,
    append: (type: string, data: unknown) => {
      appended.push({ type, data })
    },
  }
  const callConfigs: Array<Record<string, unknown>> = []
  const llm = {
    prepareCall: async (
      config: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      configure?: (controls: Record<string, unknown>, model: unknown) => Record<string, unknown>,
    ) => {
      callConfigs.push(config)
      const controls =
        configure === undefined ? config : configure(config, { reasoning: { efforts: [{ id: 'low' }] } })
      return {
        config: { ...config, ...controls },
        stream: async function* stream() {
          yield* chunks
        },
      }
    },
  }
  let registered: SessionTitleProvider | undefined
  const ctx = {
    llm,
    sessionTitle: {
      register: (provider: SessionTitleProvider) => {
        if (registered !== undefined) throw new Error('a provider is already registered')
        registered = provider
        return async () => {}
      },
    },
    logger: { info() {}, warn() {}, debug() {}, error() {} },
  } as unknown as Context

  const settings = resolveSettings({
    provider: 'test-provider',
    model: 'test-model',
    maxOutputTokens: 256,
    timeoutMs: 5000,
    ...overrides,
  })
  return {
    appended,
    callConfigs,
    settings,
    session: session as unknown as Session,
    provider: () => {
      registerWorkTitleProvider(ctx, settings)
      if (registered === undefined) throw new Error('the provider was not registered')
      return registered
    },
  }
}

/** A well-formed text answer. */
const TEXT_CHUNKS: FakeChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'Fix login redirect loop' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'Fix login redirect loop' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

/** One provider request over the fixture log. */
function requestFor(session: Session, currentTitle?: SessionTitleProviderRequest['currentTitle']): SessionTitleProviderRequest {
  return {
    session,
    messages: [{ seq: brandSeq(2) as SessionSeq, text: 'Fix the login redirect loop' }],
    ...(currentTitle === undefined ? {} : { currentTitle }),
    signal: new AbortController().signal,
  }
}

describe('registerWorkTitleProvider', () => {
  it('registers one provider with a stable id and the first-prompt cadence', () => {
    const test = setup(TEXT_CHUNKS)
    const provider = test.provider()

    expect(provider.id).toBe(PROVIDER_ID)
    expect(provider.automatic).toBe(PROVIDER_CADENCE)
    expect(PROVIDER_CADENCE).toBe('first-prompt')
  })

  it('titles the session from the work digest and records the exact request', async () => {
    const test = setup(TEXT_CHUNKS)
    const provider = test.provider()

    const result = await provider.generate(requestFor(test.session))

    expect(result.title).toBe('Fix login redirect loop')
    expect(result.messageSeqs).toEqual([2])
    expect(result.model).toEqual({ provider: 'test-provider', model: 'test-model' })

    const record = test.appended.find((entry) => entry.type === 'session/title-llm-request')
    expect(record).toBeDefined()
    const data = record?.data as {
      titleProvider: string
      system: string
      messages: Array<{ content: Array<{ text: string }> }>
    }
    expect(data.titleProvider).toBe(PROVIDER_ID)
    expect(data.system).toContain('from the work it actually did')
    const input = data.messages[0]?.content[0]?.text ?? ''
    const payload = JSON.parse(input.slice(input.indexOf('\n') + 1)) as {
      turns: Array<{ prompt: string; work: string[]; outcome: string }>
    }
    expect(payload.turns[0]?.prompt).toBe('Fix the login redirect loop')
    expect(payload.turns[0]?.work).toEqual(['read: src/login.ts'])
    expect(payload.turns[0]?.outcome).toContain('recursive redirect')
  })

  it('anchors a provider-generated title so the model can keep it', async () => {
    const test = setup(TEXT_CHUNKS)
    const provider = test.provider()

    await provider.generate(
      requestFor(test.session, {
        title: 'Fix login redirect loop',
        messageSeqs: [],
        source: { kind: 'provider', provider: 'session-title' } as never,
        eventSeq: brandSeq(6) as SessionSeq,
        updatedAt: 0,
      }),
    )

    const record = test.appended.find((entry) => entry.type === 'session/title-llm-request')
    const data = record?.data as { system: string; messages: Array<{ content: Array<{ text: string }> }> }
    expect(data.system).toContain('currentTitle')
    const input = data.messages[0]?.content[0]?.text ?? ''
    expect(input).toContain('"currentTitle":"Fix login redirect loop"')
  })

  it('selects the least reasoning effort for the call', async () => {
    const test = setup(TEXT_CHUNKS)
    await test.provider().generate(requestFor(test.session))

    expect(test.callConfigs[0]?.['provider']).toBe('test-provider')
    expect(test.callConfigs[0]?.['model']).toBe('test-model')
  })
})

describe('titleFromResponse', () => {
  it('rejects a tool-call terminal finish', () => {
    expect(() =>
      titleFromResponse({
        blocks: [],
        finish: { kind: 'tool-calls' },
        model: { provider: 'p', model: 'm' },
      }),
    ).toThrow(/text only/u)
  })

  it('rejects a truncated answer', () => {
    expect(() =>
      titleFromResponse({
        blocks: [{ type: 'text', text: 'half a tit' }],
        finish: { kind: 'max-tokens' },
        model: { provider: 'p', model: 'm' },
      }),
    ).toThrow(/maxOutputTokens/u)
  })

  it('rejects a response that is only tool calls', () => {
    expect(() =>
      titleFromResponse({
        blocks: [{ type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' } as never],
        finish: { kind: 'stop' },
        model: { provider: 'p', model: 'm' },
      }),
    ).toThrow(/text only/u)
  })

  it('normalizes an answer that breaks the one-line instruction', () => {
    const title = titleFromResponse({
      blocks: [
        { type: 'text', text: '  **Fix   login redirect loop**\nextra commentary' },
      ],
      finish: { kind: 'stop' },
      model: { provider: 'p', model: 'm' },
    })

    expect(title).toBe('Fix login redirect loop')
  })

  it('rejects an empty answer', () => {
    expect(() =>
      titleFromResponse({
        blocks: [{ type: 'text', text: '   ' }],
        finish: { kind: 'stop' },
        model: { provider: 'p', model: 'm' },
      }),
    ).toThrow(/no text/u)
  })
})