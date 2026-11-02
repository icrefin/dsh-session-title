// @vitest-environment jsdom
/**
 * The settings page, rendered from the real component and driven through its
 * controls.
 *
 * The model choice is the point: these tests prove that choosing "always use one
 * model" writes the provider and model as one atomic pair, and that choosing
 * "follow the session" clears both, so a half-supplied route can never reach the
 * host.
 *
 * @module dsh-session-title/test/settings-page
 */

import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsSection } from '../src/client/SettingsSection.tsx'
import { en, zh, type MessageKey } from '../src/client/locales.ts'
import type { SettingsValue } from '../src/client/plugin.ts'
import { AUTHORS, VERSION } from '../src/client/version.ts'
import type { CatalogPayload } from '../src/protocol.ts'

/** Settings the fake host serves before the page edits anything. */
const BASE: SettingsValue = {
  targetWords: 6,
  targetCjkCharacters: 12,
  maxInputBytes: 8192,
  maxOutputTokens: 2048,
  timeoutMs: 30000,
  maxTurnsInDigest: 10,
  minTurnsBetweenUpdates: 1,
  minStepsBetweenUpdates: 2,
  minUpdateIntervalMs: 120000,
  updateOnTurnEnd: true,
  updateOnStepEnd: true,
  includeChildSessions: false,
}

/** The catalog the fake host serves. */
const CATALOG: CatalogPayload = {
  providers: [
    {
      id: 'stub',
      name: 'Stub Local',
      models: [
        { id: 'stub-model', name: 'Stub Model' },
        { id: 'stub-large', name: 'Stub Large' },
      ],
    },
  ],
  time: '2026-11-01T00:00:00.000Z',
}

/** A settings form stand-in that records the operations it receives. */
function formOf(value: SettingsValue, ops: unknown[]) {
  // The real form keeps one stable snapshot until something changes; a fresh
  // object per call would make useSyncExternalStore re-render forever.
  const snapshot: ConfigFormSnapshot<SettingsValue> = {
    status: 'ready',
    value,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
  }
  const form: ConfigForm<SettingsValue> = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
    mutate: async (mutations) => {
      ops.push(...(mutations as unknown as unknown[]))
      return true
    },
  }
  return { form, ops }
}

/** The translate seat for one dictionary. */
function translate(dictionary: Record<MessageKey, string>) {
  return (key: MessageKey): string => dictionary[key]
}

/** Mounted page handle. */
interface Mounted {
  container: HTMLDivElement
  root: Root
}

let mounted: Mounted | undefined

/** Mount the page and flush its first render, effects and catalog read. */
async function mount(value: SettingsValue, ops: unknown[]): Promise<Mounted> {
  const { form } = formOf(value, ops)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(SettingsSection, {
        t: translate(en),
        form,
        loadCatalog: async () => CATALOG,
      }),
    )
  })
  expect(ops).toEqual([])
  mounted = { container, root }
  return mounted
}

/** Set an input's value the way a user's typing does. */
function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
  )
}

/** Find one control by id. */
function byId<T extends HTMLElement>(container: HTMLElement, id: string): T {
  const element = container.querySelector<T>(`#${id}`)
  if (element === null) throw new Error(`no control #${id}`)
  return element
}

/** Find the Save button. */
function saveButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(en.save),
  )
  if (button === undefined) throw new Error('no Save button')
  return button as HTMLButtonElement
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  if (mounted === undefined) return
  const handle = mounted
  mounted = undefined
  await act(async () => {
    handle.root.unmount()
  })
  handle.container.remove()
})

describe('the settings page', () => {
  it('shows the version chip, the credit and the inherited state by default', async () => {
    const page = await mount(BASE, [])

    const html = page.container.textContent ?? ''
    expect(html).toContain(`v${VERSION} | Author: ${AUTHORS}`)
    expect(html).toContain(en.effectiveInherited)
    const modes = page.container.querySelectorAll<HTMLInputElement>('input[name="dst-mode"]')
    expect(modes).toHaveLength(2)
    expect(modes[0]?.checked).toBe(true)
    expect(modes[1]?.checked).toBe(false)
  })

  it('writes a pinned provider and model as one atomic pair', async () => {
    const ops: unknown[] = []
    const page = await mount(BASE, ops)

    const pin = page.container.querySelectorAll<HTMLInputElement>('input[name="dst-mode"]')[1]
    if (pin === undefined) throw new Error('no pinned-mode radio')
    await act(async () => {
      pin.click()
    })

    const provider = byId<HTMLSelectElement>(page.container, 'dst-provider')
    expect(provider.value).toBe('stub')

    await act(async () => {
      setValue(byId<HTMLInputElement>(page.container, 'dst-model'), 'stub-model')
    })
    await act(async () => {
      saveButton(page.container).click()
    })

    expect(ops).toEqual([
      { op: 'set', path: ['provider'], value: 'stub' },
      { op: 'set', path: ['model'], value: 'stub-model' },
    ])
  })

  it('clears the pair when the session model is chosen again', async () => {
    const ops: unknown[] = []
    const page = await mount({ ...BASE, provider: 'stub', model: 'stub-model' }, ops)

    const inherit = page.container.querySelectorAll<HTMLInputElement>('input[name="dst-mode"]')[0]
    if (inherit === undefined) throw new Error('no inherit-mode radio')
    await act(async () => {
      inherit.click()
    })

    await act(async () => {
      saveButton(page.container).click()
    })

    expect(ops).toEqual([
      { op: 'unset', path: ['provider'] },
      { op: 'unset', path: ['model'] },
    ])
  })

  it('refuses a pinned mode without a model', async () => {
    const ops: unknown[] = []
    const page = await mount(BASE, ops)

    const pin = page.container.querySelectorAll<HTMLInputElement>('input[name="dst-mode"]')[1]
    if (pin === undefined) throw new Error('no pinned-mode radio')
    await act(async () => {
      pin.click()
    })

    await act(async () => {
      saveButton(page.container).click()
    })

    expect(ops).toEqual([])
    expect(page.container.textContent).toContain(en.pinnedIncomplete)
  })

  it('reports an out-of-range number instead of saving it', async () => {
    const ops: unknown[] = []
    const page = await mount(BASE, ops)

    await act(async () => {
      setValue(byId<HTMLInputElement>(page.container, 'dst-words'), '99')
    })
    await act(async () => {
      saveButton(page.container).click()
    })

    expect(ops).toEqual([])
    expect(page.container.textContent).toContain(en.invalidNumber)
    expect(byId<HTMLInputElement>(page.container, 'dst-words').dataset.invalid).toBe('true')
  })

  it('saves a changed cadence value in the host unit', async () => {
    const ops: unknown[] = []
    const page = await mount(BASE, ops)

    await act(async () => {
      setValue(byId<HTMLInputElement>(page.container, 'dst-interval'), '30')
    })
    await act(async () => {
      saveButton(page.container).click()
    })

    expect(ops).toEqual([{ op: 'set', path: ['minUpdateIntervalMs'], value: 30000 }])
  })
})

describe('dictionaries', () => {
  it('cover the same keys in both languages', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(zh[key].length).toBeGreaterThan(0)
    }
  })
})