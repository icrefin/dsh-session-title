/**
 * The session-title provider this plugin registers.
 *
 * A title provider is the harness's own extension point: the session-title
 * service owns scheduling, supersession, normalization, and durable
 * `session/title` events, and a provider owns only *what the title says*. This
 * provider therefore does one job — turn the session log into a work digest and
 * a model call that names the work.
 *
 * Only one provider may be registered at a time, so the bundle patch in
 * `cordis.patch.yml` disables the shipped first-prompt provider before inserting
 * this row. A second registration throws with that guidance.
 *
 * @module dsh-session-title/provider
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
// Type-only import for the `sessionTitle` Context augmentation.
import type {} from '@deepseek-ai/dsh-session-title'
import {
  SessionTitleProviderId,
  normalizeSessionTitle,
  type SessionTitleProvider,
  type SessionTitleProviderId as ProviderId,
  type SessionTitleProviderResult,
} from '@deepseek-ai/dsh-session-title'
import {
  executeSessionTitleLlm,
  type SessionTitleLlmPreparedRequest,
  type SessionTitleLlmResponse,
} from '@deepseek-ai/dsh-session-title-llm'
import { resolveExecution, type Settings } from './config.ts'
import { buildWorkDigest } from './digest.ts'
import { frameDigest, systemPrompt, titleFromOutput } from './prompt.ts'

/** Stable provider id recorded on every title this plugin accepts. */
export const PROVIDER_ID = 'session-title'

/**
 * Automatic cadence owned by this provider.
 *
 * `first-prompt` keeps the shipped fast first title: the service runs this
 * provider once, as soon as the session's first prompt has a logged route.
 * Later revisions are not prompt-driven — the scheduler asks for them when the
 * session has actually finished work, which is the point of the plugin.
 */
export const PROVIDER_CADENCE = 'first-prompt'

/**
 * Pick the route's least supported reasoning effort for a title call.
 *
 * Naming a task does not need deep reasoning, and a reasoning model that
 * cannot switch off still spends output tokens on it.
 */
const selectReasoningEffort: SessionTitleLlmPreparedRequest['selectReasoningEffort'] = (model) =>
  model.reasoning?.efforts[0]?.id

/** Join the text blocks of an assembled response. */
function textOfBlocks(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join(' ')
}

/**
 * Interpret one assembled auxiliary response as a title.
 *
 * Operational failures are already rejected by the executor. What remains here
 * is output the model should not have produced — tool calls or a truncated
 * answer — and the plain text case.
 *
 * @param response - assembled blocks, terminal finish, and the exact model route.
 * @returns one normalized, non-empty title.
 * @throws {Error} when the response cannot be a title.
 */
export function titleFromResponse(response: SessionTitleLlmResponse): string {
  if (response.finish.kind === 'tool-calls') {
    throw new Error('dsh-session-title: title output must contain text only')
  }
  if (response.finish.kind === 'max-tokens') {
    throw new Error('dsh-session-title: title output reached maxOutputTokens')
  }
  if (response.blocks.some((block) => block.type === 'tool-call')) {
    throw new Error('dsh-session-title: title output must contain text only')
  }
  const title = normalizeSessionTitle(titleFromOutput(textOfBlocks(response.blocks)), Number.MAX_SAFE_INTEGER)
  if (title.length === 0) throw new Error('dsh-session-title: title model produced no text')
  return title
}

/**
 * Register the work-shaped title provider.
 * @param ctx - context exposing the session-title service and the LLM seam.
 * @param settings - validated policy for this mount.
 * @returns the exact Cordis effect disposer from the service registration.
 * @throws {Error} when another provider already occupies the single registration slot.
 */
export function registerWorkTitleProvider(ctx: Context, settings: Settings): () => Promise<void> {
  const id: ProviderId = SessionTitleProviderId(PROVIDER_ID)
  const provider: SessionTitleProvider = {
    id,
    automatic: PROVIDER_CADENCE,
    async generate(request): Promise<SessionTitleProviderResult> {
      const messageSeqs = request.messages.map((message) => message.seq)
      const digest = buildWorkDigest(request.session.snapshotEvents(), {
        maxTurns: settings.maxTurnsInDigest,
      })
      // The route and the bounds are read here, not at mount: the settings page
      // writes them as volatile fields, so this call must see the newest values.
      const execution = resolveExecution(settings)
      const anchor =
        request.currentTitle?.source.kind === 'provider' ? request.currentTitle.title : undefined
      const framed = frameDigest(digest, anchor, execution.maxInputBytes)
      const response = await executeSessionTitleLlm(ctx, execution, request, id, {
        system: systemPrompt(settings, anchor !== undefined),
        input: framed.input,
        messageSeqs,
        selectReasoningEffort,
      })
      return { title: titleFromResponse(response), messageSeqs, model: response.model }
    },
  }
  try {
    return ctx.sessionTitle.register(provider)
  } catch (error) {
    throw new Error(
      'dsh-session-title: cannot register its title provider, because the single ' +
        'session-title provider slot is already taken. Disable the "session-title-llm" row ' +
        '(the shipped first-prompt provider) in the profile patch — only one title provider ' +
        'may be registered at a time.',
      { cause: error },
    )
  }
}