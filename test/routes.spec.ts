/**
 * The catalog route, served from a real loopback HTTP server and driven with
 * `fetch`. The fences, the status codes and the payload shape are the shipped
 * handler's own; only the LLM registry is a double.
 *
 * @module dsh-session-title/test/routes
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { API, type CatalogPayload } from '../src/protocol.ts'
import { buildCatalog, makeRoutes } from '../src/routes.ts'

/** One fake provider/model registry. */
function llmOf(
  providers: Array<{ id: string; name: string }>,
  models: Record<string, Array<{ id: string; name: string }> | Error>,
) {
  return {
    listProviders: () => providers,
    listModels: async (provider: string) => {
      const entry = models[provider] ?? []
      if (entry instanceof Error) throw entry
      return entry.map((model) => ({ provider, ...model }))
    },
  }
}

/** Minimal host context: the route family reads `llm` and `logger`. */
function ctxOf(llm: ReturnType<typeof llmOf>, warnings: string[] = []): Context {
  return {
    llm,
    logger: {
      debug() {},
      info() {},
      warn(message: string) {
        warnings.push(message)
      },
      error() {},
    },
  } as unknown as Context
}

const CTX = ctxOf(
  llmOf(
    [
      { id: 'stub', name: 'Stub Local' },
      { id: 'silent', name: 'Silent Provider' },
    ],
    {
      stub: [
        { id: 'stub-model', name: 'Stub Model' },
        { id: 'stub-large', name: 'Stub Large' },
      ],
      silent: new Error('no adapter models'),
    },
  ),
)

const routes = makeRoutes(CTX)

let server: Server
let origin: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const route = routes.find((candidate) => candidate.path === path)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void route.handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the test server bound no TCP port')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('GET API.catalog', () => {
  it('lists every provider with the models it advertises', async () => {
    const response = await fetch(`${origin}${API.catalog}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('application/json')

    const payload = (await response.json()) as CatalogPayload
    expect(payload.providers).toEqual([
      {
        id: 'stub',
        name: 'Stub Local',
        models: [
          { id: 'stub-model', name: 'Stub Model' },
          { id: 'stub-large', name: 'Stub Large' },
        ],
      },
      { id: 'silent', name: 'Silent Provider', models: [], error: 'no adapter models' },
    ])
    expect(Number.isNaN(Date.parse(payload.time))).toBe(false)
  })

  it('rejects a non-GET method', async () => {
    const response = await fetch(`${origin}${API.catalog}`, { method: 'POST' })
    expect(response.status).toBe(405)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toContain('method not allowed')
  })
})

describe('buildCatalog', () => {
  it('keeps a provider whose model list fails, with the reason attached', async () => {
    const catalog = await buildCatalog(CTX)

    expect(catalog.map((entry) => entry.id)).toEqual(['stub', 'silent'])
    expect(catalog[1]?.error).toBe('no adapter models')
  })

  it('reports nothing when the host has no provider at all', async () => {
    const empty = ctxOf(llmOf([], {}))
    await expect(buildCatalog(empty)).resolves.toEqual([])
  })
})