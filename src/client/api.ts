/**
 * The host call this page makes: the model catalog.
 *
 * `CLIENT_API` keeps the path relative to `document.baseURI`, so the page keeps
 * working under a path-mounted deployment. A non-JSON success is treated as a
 * failure rather than letting `response.json()` throw a parser error the reader
 * cannot act on.
 *
 * @module dsh-session-title/client/api
 */

import { CLIENT_API, type CatalogPayload } from '../protocol.ts'

/**
 * Read the provider/model catalog from the host.
 * @returns the advertised providers and their models.
 * @throws {Error} on a non-200 answer, a non-JSON body, or a malformed payload.
 */
export async function fetchCatalog(): Promise<CatalogPayload> {
  const response = await fetch(CLIENT_API.catalog, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok) {
    const body = (await response.text()) || `HTTP ${response.status}`
    throw new Error(body.slice(0, 200))
  }
  if (!contentType.includes('application/json')) {
    throw new Error('the host answered with a non-JSON body')
  }
  const payload = (await response.json()) as CatalogPayload
  if (!Array.isArray(payload.providers)) {
    throw new Error('the catalog payload carries no providers')
  }
  return payload
}