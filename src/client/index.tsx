/**
 * dsh-session-title — browser half.
 *
 * Contributes one page to the Settings navigation (`settings.section`). The page
 * edits this plugin's own Loader-entry Config through the shared `configForms`
 * service, so a model change lands in the same Host document the running row
 * reads, and the row's volatile fields pick it up on the next title request.
 *
 * The registration waits for two things: the Settings bundle must declare the
 * seat, and the host must actually serve this settings namespace
 * (`whileServed`). A deployment that never composed the host half therefore
 * shows no page at all, instead of a page whose save button cannot work.
 *
 * `immediately: true` in `package.json` loads this bundle at boot: the settings
 * navigation is built from registrations, so a lazily loaded bundle would leave
 * its own section missing until something else happened to load it.
 *
 * @module dsh-session-title/client
 */

import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only imports for their declaration merging: these declare
// `settings.section` and the locale namespace map.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { CatalogPayload } from '../protocol.ts'
import { fetchCatalog } from './api.ts'
import { en, zh, type MessageKey } from './locales.ts'
import { SettingsSection } from './SettingsSection.tsx'
import { injectStyles } from './styles.ts'
import { NS, SECTION_ID, SETTINGS_NS, inject, type SettingsValue } from './plugin.ts'

export { NS, SECTION_ID, inject }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Keys of this plugin's own dictionary. */
    'dsh-session-title': MessageKey
  }
}

/** Structural face of the client locale service. */
interface LocaleService {
  register(namespace: typeof NS, dictionaries: { en: typeof en; zh: typeof zh }): () => void
  bind(namespace: typeof NS): (key: MessageKey) => string
}

/** Structural face of the settings-form service this page reads and writes. */
interface ConfigFormsService {
  get<T>(entryId: string): ConfigForm<T>
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void
}

/** Structural face of the client slot service. */
interface SlotsService {
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(key: string, callback: () => () => void): () => void
}

/** Structural face of the client root context this plugin uses. */
interface ClientContext {
  effect(callback: () => (() => void) | void, label?: string): void
  slots: SlotsService
  locale: LocaleService
  configForms: ConfigFormsService
  logger?: { error?: (message: string, error?: unknown) => void }
}

/**
 * Where the section sits in the settings navigation.
 *
 * The shell's own sections use `-10` (Account) and `0` (General); a positive
 * order puts a plugin's section after the built-ins rather than between them.
 */
const SECTION_ORDER = 42

/**
 * Register the settings page.
 *
 * An external plugin must never take the web shell down with it, so a mounting
 * failure is logged rather than thrown: the shell fails the whole boot when a
 * plugin's `apply` throws.
 *
 * @param ctx - client root context carrying the slot, locale and settings services.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { en, zh }), `${NS}: dictionaries`)
    const t = ctx.locale.bind(NS)
    const form = ctx.configForms.get<SettingsValue>(SETTINGS_NS)
    const loadCatalog = (): Promise<CatalogPayload> => fetchCatalog()

    ctx.effect(
      () =>
        ctx.configForms.whileServed([SETTINGS_NS], () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: SECTION_ID,
                order: SECTION_ORDER,
                label: () => t('nav'),
                locale: NS,
                inject: () => ({ form, loadCatalog }),
              },
              SettingsSection,
            ),
          ),
        ),
      `${NS}: settings section`,
    )
  } catch (error) {
    ctx.logger?.error?.(`[${NS}] the settings page could not mount`, error)
  }
}

// Materialization runs this: the client module system claims a style tag created
// from the bundle's factory body and removes it again when the plugin unloads.
injectStyles()