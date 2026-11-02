/**
 * The `/api/dsh-session-title` route family.
 *
 * One read-only route: the provider/model catalog the settings page offers. It
 * exists because the model choice is a *host* fact — the running harness knows
 * which providers are registered and which models each one advertises, and a
 * page that guessed would offer routes that fail only when a title is generated.
 *
 * The route carries the loopback fence: a LAN-exposed `dsh web` deployment must
 * not serve plugin APIs to other machines.
 *
 * @module dsh-session-title/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only imports for the `llm` Context augmentation and `WebRoute`.
import type {} from '@deepseek-ai/dsh-llm'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { API, type CatalogPayload, type CatalogProvider, type ErrorPayload } from './protocol.ts'

/** Per-provider budget for reading its advertised models. */
const MODEL_LIST_TIMEOUT_MS = 5000

/** Write one JSON response body. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

/** Write one JSON error body. */
function writeError(res: ServerResponse, status: number, message: string): void {
  const body: ErrorPayload = { error: message }
  writeJson(res, status, body)
}

/** Whether the request arrived over the loopback interface. */
function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Race one model-list read against its own deadline. */
async function listModelsWithin(
  ctx: Context,
  provider: string,
): Promise<{ models: CatalogProvider['models']; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`listing models exceeded ${MODEL_LIST_TIMEOUT_MS} ms`))
      }, MODEL_LIST_TIMEOUT_MS)
      timer.unref?.()
    })
    const models = await Promise.race([ctx.llm.listModels(provider), deadline])
    return {
      models: models.map((model) => ({ id: model.id, name: model.name })),
    }
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Build the catalog from the host's own LLM registry.
 * @param ctx - host context exposing the LLM service.
 * @returns every registered provider, in registration order.
 */
export async function buildCatalog(ctx: Context): Promise<CatalogProvider[]> {
  const providers: CatalogProvider[] = []
  for (const provider of ctx.llm.listProviders()) {
    const listed = await listModelsWithin(ctx, provider.id)
    providers.push({
      id: provider.id,
      name: provider.name,
      models: listed.models,
      ...(listed.error === undefined ? {} : { error: listed.error }),
    })
  }
  return providers
}

/**
 * Build every route of the `/api/dsh-session-title` family.
 * @param ctx - host plugin context.
 * @returns the exact-path routes to register on `ctx.webServer`.
 */
export function makeRoutes(ctx: Context): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: API.catalog,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeError(res, 403, 'forbidden: loopback-only')
          return
        }
        if (req.method !== 'GET') {
          writeError(res, 405, `method not allowed: ${req.method ?? ''}`)
          return
        }
        try {
          const payload: CatalogPayload = {
            providers: await buildCatalog(ctx),
            time: new Date().toISOString(),
          }
          writeJson(res, 200, payload)
        } catch (error) {
          ctx.logger.warn(
            'dsh-session-title: the model catalog route failed: %s',
            error instanceof Error ? error.message : String(error),
          )
          writeError(res, 500, 'the model catalog could not be read')
        }
      },
    },
  ]
}