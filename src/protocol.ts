/**
 * Wire contract shared by both halves.
 *
 * The settings page reads the model catalog from the host's own LLM registry,
 * so the two halves must agree on the route path and the payload. Keeping the
 * path here means a rename can never drift between the server that serves it and
 * the page that fetches it.
 *
 * @module dsh-session-title/protocol
 */

/** Route paths served by the host half under the web server's route table. */
export const API = {
  /** Provider/model catalog offered by the running harness. */
  catalog: '/api/dsh-session-title/catalog',
} as const

/**
 * Re-express a host route as the browser half must request it.
 *
 * Dropping the leading slash makes the request resolve against
 * `document.baseURI`, which is how the harness's own channels address the host
 * and what keeps the settings page working under a path-mounted deployment.
 *
 * @param route - a host route path from {@link API}.
 * @returns the same route, relative to the document.
 */
export function clientPath(route: string): string {
  return route.replace(/^\//, '')
}

/** The {@link API} routes as the browser half requests them. */
export const CLIENT_API = {
  catalog: clientPath(API.catalog),
} as const

/** One model the host can route a title request to. */
export interface CatalogModel {
  /** Model id passed as `model`. */
  id: string
  /** Human-readable model name. */
  name: string
}

/** One provider route and the models it advertises. */
export interface CatalogProvider {
  /** Provider route key passed as `provider`. */
  id: string
  /** Human-readable provider name. */
  name: string
  /** Models this provider lists; empty when it advertises none. */
  models: CatalogModel[]
  /** Why this provider's model list could not be read, when that happened. */
  error?: string
}

/** Body of a successful `GET API.catalog`. */
export interface CatalogPayload {
  /** Every provider route registered on this host, in registration order. */
  providers: CatalogProvider[]
  /** Host clock, ISO 8601. */
  time: string
}

/** Body of any failed request. */
export interface ErrorPayload {
  error: string
}