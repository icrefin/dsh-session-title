/**
 * dsh-session-title — host half.
 *
 * Names a session after the tasks it actually worked on, and keeps the name
 * current as later rounds of work move it on. Three registrations make that
 * work:
 *
 * - a **session-title provider** (`./provider.ts`) that turns the session log
 *   into a work digest and one model call, with the shipped session-title
 *   service owning scheduling, supersession, and durable `session/title` events;
 * - a **scheduler** (`./scheduler.ts`) that watches completed steps and turns
 *   and asks that service for a revision when the work, not a clock, moved on;
 * - a **catalog route** (`./routes.ts`) that tells the settings page which
 *   providers and models this host can route a title request to.
 *
 * Every registration lives inside `ctx.effect`, so unload, a profile-patch
 * disable, and host shutdown all release them.
 *
 * @module dsh-session-title
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only imports for the `sessions` / `sessionTitle` / `webServer` Context
// augmentations.
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Config, resolveSettings } from './config.ts'
import { registerWorkTitleProvider } from './provider.ts'
import { makeRoutes } from './routes.ts'
import { createScheduler } from './scheduler.ts'

/** Loader row id; mirrors `cordis.patch.yml` and the package name. */
export const name = 'dsh-session-title'

/** Services required before this plugin may mount. */
export const inject = ['sessionTitle', 'llm', 'sessions']

export { Config }

/**
 * Mount the title provider, the update scheduler and the catalog route, and
 * release them on unload.
 *
 * @param ctx - host plugin context.
 * @param config - raw Loader config, validated by {@link resolveSettings}.
 */
export function apply(ctx: Context, config: unknown): void {
  const settings = resolveSettings(config)

  ctx.effect(() => {
    const dispose = registerWorkTitleProvider(ctx, settings)
    ctx.logger.info(
      'dsh-session-title: registered the work-shaped title provider ' +
        `(revision after ${settings.minTurnsBetweenUpdates} turn(s) or ${settings.minStepsBetweenUpdates} step(s), ` +
        `at most every ${settings.minUpdateIntervalMs} ms)`,
    )
    return dispose
  }, 'dsh-session-title: title provider')

  ctx.effect(() => {
    const scheduler = createScheduler({
      settings,
      getSession: (id) => ctx.sessions.get(id),
      getTitle: (session) => ctx.sessionTitle.get(session),
      refreshTitle: (session, signal) => ctx.sessionTitle.refresh(session, signal),
      log: {
        info: (message) => ctx.logger.info(message),
        warn: (message) => ctx.logger.warn(message),
      },
    })
    const offEvent = ctx.on('session/event', (session, event) => {
      scheduler.onEvent(session, event)
    })
    const offDisposed = ctx.on('session/disposed', (session) => {
      scheduler.onDisposed(session)
    })
    return () => {
      offEvent()
      offDisposed()
      scheduler.close()
    }
  }, 'dsh-session-title: update scheduler')

  // Optional: a host-only deployment without a web server (a terminal profile)
  // still titles sessions; only the settings page needs the catalog.
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const disposers = makeRoutes(scope).map((route) => scope.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-session-title: catalog route')
  })
}