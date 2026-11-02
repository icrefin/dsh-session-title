/**
 * The settings page.
 *
 * One page, three groups, one sticky save. The page edits this plugin's own
 * Loader-entry Config through the shared `configForms` service, so a save lands
 * in the same Host settings document the running row reads — no second copy of
 * the settings exists anywhere.
 *
 * The naming model is the point of the page. Its route is a pair, so the two
 * fields are written atomically: `mutate` applies both or neither, and a
 * half-supplied pair can never reach the host. "Follow the session's model"
 * clears the pair and restores inheritance.
 *
 * @module dsh-session-title/client/SettingsSection
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CatalogPayload, CatalogProvider } from '../protocol.ts'
import type { MessageKey } from './locales.ts'
import type { SettingsValue } from './plugin.ts'
import { AUTHORS, VERSION } from './version.ts'

/** Props composed by the slot framework plus this plugin's own injection. */
export interface SettingsSectionProps {
  /** Translate seat bound to the plugin's locale namespace. */
  readonly t: (key: MessageKey) => string
  /** Shared settings form for this plugin's Loader entry. */
  readonly form: ConfigForm<SettingsValue>
  /** Read the host's provider/model catalog. */
  readonly loadCatalog: () => Promise<CatalogPayload>
}

/** Settings used until the host's section arrives. */
const EMPTY: SettingsValue = {
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

/** Local edits, kept as strings for the numeric fields so typing is free. */
interface Draft {
  provider?: string
  model?: string
  targetWords?: string
  targetCjkCharacters?: string
  minTurnsBetweenUpdates?: string
  minStepsBetweenUpdates?: string
  intervalSeconds?: string
  maxTurnsInDigest?: string
  updateOnTurnEnd?: boolean
  updateOnStepEnd?: boolean
  includeChildSessions?: boolean
}

/** One field operation sent to the settings transport. */
type Op = { op: 'set'; path: string[]; value: string | number | boolean } | { op: 'unset'; path: string[] }

/** Route mode chosen in the page. */
type Mode = 'inherit' | 'pinned'

/** A parsed numeric field, or the reason it cannot be saved. */
type Parsed = { value: number } | { invalid: true }

/**
 * Parse one whole-number field inside its accepted range.
 * @param raw - the draft string.
 * @param min - smallest accepted value.
 * @param max - largest accepted value.
 * @returns the parsed value, or `{ invalid: true }`.
 */
function parseInteger(raw: string, min: number, max: number): Parsed {
  const trimmed = raw.trim()
  if (!/^-?\d+$/u.test(trimmed)) return { invalid: true }
  const value = Number(trimmed)
  if (!Number.isSafeInteger(value) || value < min || value > max) return { invalid: true }
  return { value }
}

/** One unknown rejection as a readable line. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Subscribe to the shared settings form.
 * @param form - the plugin's config form.
 * @returns the current snapshot, re-rendering on each accepted change.
 */
function useSnapshot(form: ConfigForm<SettingsValue>): ConfigFormSnapshot<SettingsValue> {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Props of one labelled control row. */
interface RowProps {
  label: string
  controlId: string
  hint?: string
  children: ReactNode
}

/**
 * Render one labelled row.
 * @param props - label, control id, optional hint and the control.
 * @returns the row element.
 */
function Row({ label, controlId, hint, children }: RowProps): ReactElement {
  return (
    <div className="dst-row">
      <label className="dst-label" htmlFor={controlId}>
        {label}
      </label>
      <div className="dst-control">
        {children}
        {hint === undefined ? null : <p className="dst-hint">{hint}</p>}
      </div>
    </div>
  )
}

/** Props of one switch row. */
interface SwitchRowProps {
  id: string
  label: string
  checked: boolean
  disabled: boolean
  onChange(next: boolean): void
}

/**
 * Render a switch with its label, using the style contract's pill shape.
 * @param props - id, label, state, disable flag and the change handler.
 * @returns the switch row element.
 */
function SwitchRow({ id, label, checked, disabled, onChange }: SwitchRowProps): ReactElement {
  return (
    <div className="dst-switch-row">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="dst-switch"
        disabled={disabled}
        onClick={() => {
          onChange(!checked)
        }}
      />
      <span className="dst-switch-text">
        <label htmlFor={id} className="dst-option-title">
          {label}
        </label>
      </span>
    </div>
  )
}

/**
 * Render the settings page.
 * @param props - translate seat, settings form and the catalog loader.
 * @returns the page element.
 */
export function SettingsSection({ t, form, loadCatalog }: SettingsSectionProps): ReactElement {
  const snapshot = useSnapshot(form)
  const [draft, setDraft] = useState<Draft>({})
  const [modeDraft, setModeDraft] = useState<Mode | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>(undefined)
  const [invalidField, setInvalidField] = useState<string | undefined>(undefined)
  const [catalog, setCatalog] = useState<CatalogPayload | undefined>(undefined)
  const [catalogError, setCatalogError] = useState<string | undefined>(undefined)

  const value = useMemo<SettingsValue>(() => ({ ...EMPTY, ...(snapshot.value ?? {}) }), [snapshot.value])
  const readOnly = snapshot.writable === false
  const pinnedSaved = (value.provider ?? '') !== '' && (value.model ?? '') !== ''
  const mode: Mode = modeDraft ?? (pinnedSaved ? 'pinned' : 'inherit')

  const provider = draft.provider ?? value.provider ?? ''
  const model = draft.model ?? value.model ?? ''

  const catalogProviders: CatalogProvider[] = catalog?.providers ?? []
  const providerOptions = useMemo(() => {
    const options = catalogProviders.map((entry) => ({ id: entry.id, name: entry.name }))
    // A pinned provider the catalog does not list still needs a row; dedupe so
    // the select never carries the same key twice before the catalog arrives.
    const missing = new Set(
      [provider, value.provider ?? ''].filter(
        (id) => id !== '' && !options.some((option) => option.id === id),
      ),
    )
    for (const id of missing) options.push({ id, name: `${id} — ${t('providerNotListed')}` })
    return options
  }, [catalogProviders, provider, value.provider, t])

  const modelsForProvider = useMemo(() => {
    const entry = catalogProviders.find((candidate) => candidate.id === provider)
    return entry?.models ?? []
  }, [catalogProviders, provider])

  const dirty =
    Object.keys(draft).length > 0 || modeDraft !== undefined

  useEffect(() => {
    let cancelled = false
    setCatalogError(undefined)
    void loadCatalog()
      .then((payload) => {
        if (!cancelled) setCatalog(payload)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalog(undefined)
          setCatalogError(messageOf(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [loadCatalog])

  const update = useCallback((key: keyof Draft, next: string | boolean): void => {
    setDraft((current) => ({ ...current, [key]: next }))
    setInvalidField(undefined)
    setNotice(undefined)
  }, [])

  const chooseMode = useCallback(
    (next: Mode): void => {
      setModeDraft(next)
      setNotice(undefined)
      if (next === 'pinned' && provider === '' && catalogProviders.length > 0) {
        const first = catalogProviders[0]
        if (first !== undefined) {
          setDraft((current) => ({ ...current, provider: first.id, model: '' }))
        }
      }
    },
    [catalogProviders, provider],
  )

  const reset = useCallback((): void => {
    setDraft({})
    setModeDraft(undefined)
    setInvalidField(undefined)
    setNotice(undefined)
  }, [])

  const save = useCallback(async (): Promise<void> => {
    const ops: Op[] = []
    setNotice(undefined)
    setInvalidField(undefined)

    if (mode === 'inherit') {
      if ((value.provider ?? '') !== '') ops.push({ op: 'unset', path: ['provider'] })
      if ((value.model ?? '') !== '') ops.push({ op: 'unset', path: ['model'] })
    } else {
      if (provider === '' || model === '') {
        setNotice({ kind: 'error', text: t('pinnedIncomplete') })
        return
      }
      if (provider !== (value.provider ?? '')) ops.push({ op: 'set', path: ['provider'], value: provider })
      if (model !== (value.model ?? '')) ops.push({ op: 'set', path: ['model'], value: model })
    }

    const numbers: Array<{ key: keyof Draft; field: keyof SettingsValue; raw: string; min: number; max: number; scale: number }> = [
      {
        key: 'targetWords',
        field: 'targetWords',
        raw: draft.targetWords ?? String(value.targetWords),
        min: 1,
        max: 40,
        scale: 1,
      },
      {
        key: 'targetCjkCharacters',
        field: 'targetCjkCharacters',
        raw: draft.targetCjkCharacters ?? String(value.targetCjkCharacters),
        min: 1,
        max: 80,
        scale: 1,
      },
      {
        key: 'minTurnsBetweenUpdates',
        field: 'minTurnsBetweenUpdates',
        raw: draft.minTurnsBetweenUpdates ?? String(value.minTurnsBetweenUpdates),
        min: 1,
        max: 50,
        scale: 1,
      },
      {
        key: 'minStepsBetweenUpdates',
        field: 'minStepsBetweenUpdates',
        raw: draft.minStepsBetweenUpdates ?? String(value.minStepsBetweenUpdates),
        min: 1,
        max: 100,
        scale: 1,
      },
      {
        key: 'intervalSeconds',
        field: 'minUpdateIntervalMs',
        raw: draft.intervalSeconds ?? String(Math.round(value.minUpdateIntervalMs / 1000)),
        min: 0,
        max: 3600,
        scale: 1000,
      },
      {
        key: 'maxTurnsInDigest',
        field: 'maxTurnsInDigest',
        raw: draft.maxTurnsInDigest ?? String(value.maxTurnsInDigest),
        min: 1,
        max: 40,
        scale: 1,
      },
    ]

    for (const entry of numbers) {
      const parsed = parseInteger(entry.raw, entry.min, entry.max)
      if ('invalid' in parsed) {
        setInvalidField(String(entry.key))
        setNotice({ kind: 'error', text: t('invalidNumber') })
        return
      }
      if (parsed.value * entry.scale !== value[entry.field]) {
        ops.push({ op: 'set', path: [String(entry.field)], value: parsed.value * entry.scale })
      }
    }

    const switches: Array<{ key: keyof Draft; field: keyof SettingsValue; next: boolean }> = [
      {
        key: 'updateOnTurnEnd',
        field: 'updateOnTurnEnd',
        next: draft.updateOnTurnEnd ?? value.updateOnTurnEnd,
      },
      {
        key: 'updateOnStepEnd',
        field: 'updateOnStepEnd',
        next: draft.updateOnStepEnd ?? value.updateOnStepEnd,
      },
      {
        key: 'includeChildSessions',
        field: 'includeChildSessions',
        next: draft.includeChildSessions ?? value.includeChildSessions,
      },
    ]
    for (const entry of switches) {
      if (entry.next !== value[entry.field]) {
        ops.push({ op: 'set', path: [String(entry.field)], value: entry.next })
      }
    }

    if (ops.length === 0) {
      setNotice({ kind: 'ok', text: t('saved') })
      reset()
      return
    }

    setBusy(true)
    try {
      const ok = await form.mutate(ops)
      if (ok) {
        setDraft({})
        setModeDraft(undefined)
        setNotice({ kind: 'ok', text: t('saved') })
      } else {
        setNotice({ kind: 'error', text: t('saveFailed') })
      }
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }, [draft, form, mode, model, provider, reset, t, value])

  const effective = mode === 'pinned' && provider !== '' && model !== '' ? `${t('effectivePinned')}: ${provider} / ${model}` : t('effectiveInherited')

  return (
    <div className="dst-page">
      <header className="dst-head">
        <div className="dst-head-line">
          <h2 className="dst-title">{t('title')}</h2>
          <span className="dst-credit">{`v${VERSION} | Author: ${AUTHORS}`}</span>
        </div>
        <p className="dst-description">{t('description')}</p>
        <p className="dst-effective">{effective}</p>
        {readOnly ? <p className="dst-error">{t('readOnly')}</p> : null}
      </header>

      <section className="dst-group">
        <div className="dst-group-head">
          <h3 className="dst-group-title">{t('modelGroup')}</h3>
          <p className="dst-group-hint">{t('modelGroupHint')}</p>
        </div>
        <div className="dst-choice">
          <label className="dst-option">
            <input
              type="radio"
              name="dst-mode"
              checked={mode === 'inherit'}
              disabled={readOnly || busy}
              onChange={() => {
                chooseMode('inherit')
              }}
            />
            <span className="dst-option-title">{t('modeInherit')}</span>
            <span className="dst-option-hint">{t('modeInheritHint')}</span>
          </label>
          <label className="dst-option">
            <input
              type="radio"
              name="dst-mode"
              checked={mode === 'pinned'}
              disabled={readOnly || busy}
              onChange={() => {
                chooseMode('pinned')
              }}
            />
            <span className="dst-option-title">{t('modePinned')}</span>
            <span className="dst-option-hint">{t('modePinnedHint')}</span>
          </label>
        </div>

        {mode === 'pinned' ? (
          <>
            <Row label={t('providerLabel')} controlId="dst-provider">
              <select
                id="dst-provider"
                className="dst-select"
                value={provider}
                disabled={readOnly || busy}
                onChange={(event) => {
                  const next = event.target.value
                  setDraft((current) => ({ ...current, provider: next, model: '' }))
                  setNotice(undefined)
                }}
              >
                <option value="">—</option>
                {providerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('modelLabel')} controlId="dst-model" hint={t('modelHint')}>
              <input
                id="dst-model"
                className="dst-input"
                list="dst-model-options"
                value={model}
                placeholder={modelsForProvider[0]?.id ?? ''}
                disabled={readOnly || busy}
                onChange={(event) => {
                  update('model', event.target.value)
                }}
              />
              <datalist id="dst-model-options">
                {modelsForProvider.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </datalist>
            </Row>
          </>
        ) : null}

        {catalogError === undefined && catalog === undefined ? (
          <p className="dst-note">{t('catalogLoading')}</p>
        ) : null}
        {catalogError !== undefined ? (
          <p className="dst-error">{`${t('catalogFailed')} — ${catalogError}`}</p>
        ) : null}
        {catalog !== undefined && mode === 'pinned' && modelsForProvider.length === 0 ? (
          <p className="dst-note">{t('modelNotListed')}</p>
        ) : null}
      </section>

      <section className="dst-group">
        <div className="dst-group-head">
          <h3 className="dst-group-title">{t('titleGroup')}</h3>
          <p className="dst-group-hint">{t('titleGroupHint')}</p>
        </div>
        <Row label={t('wordsLabel')} controlId="dst-words">
          <input
            id="dst-words"
            className="dst-input"
            type="number"
            min={1}
            max={40}
            value={draft.targetWords ?? String(value.targetWords)}
            data-invalid={invalidField === 'targetWords'}
            disabled={readOnly || busy}
            onChange={(event) => {
              update('targetWords', event.target.value)
            }}
          />
        </Row>
        <Row label={t('cjkLabel')} controlId="dst-cjk">
          <input
            id="dst-cjk"
            className="dst-input"
            type="number"
            min={1}
            max={80}
            value={draft.targetCjkCharacters ?? String(value.targetCjkCharacters)}
            data-invalid={invalidField === 'targetCjkCharacters'}
            disabled={readOnly || busy}
            onChange={(event) => {
              update('targetCjkCharacters', event.target.value)
            }}
          />
        </Row>
      </section>

      <section className="dst-group">
        <div className="dst-group-head">
          <h3 className="dst-group-title">{t('cadenceGroup')}</h3>
          <p className="dst-group-hint">{t('cadenceGroupHint')}</p>
        </div>
        <Row label={t('turnsLabel')} controlId="dst-turns">
          <input
            id="dst-turns"
            className="dst-input"
            type="number"
            min={1}
            max={50}
            value={draft.minTurnsBetweenUpdates ?? String(value.minTurnsBetweenUpdates)}
            data-invalid={invalidField === 'minTurnsBetweenUpdates'}
            disabled={readOnly || busy}
            onChange={(event) => {
              update('minTurnsBetweenUpdates', event.target.value)
            }}
          />
        </Row>
        <Row label={t('stepsLabel')} controlId="dst-steps">
          <input
            id="dst-steps"
            className="dst-input"
            type="number"
            min={1}
            max={100}
            value={draft.minStepsBetweenUpdates ?? String(value.minStepsBetweenUpdates)}
            data-invalid={invalidField === 'minStepsBetweenUpdates'}
            disabled={readOnly || busy}
            onChange={(event) => {
              update('minStepsBetweenUpdates', event.target.value)
            }}
          />
        </Row>
        <Row label={t('intervalLabel')} controlId="dst-interval">
          <input
            id="dst-interval"
            className="dst-input"
            type="number"
            min={0}
            max={3600}
            value={draft.intervalSeconds ?? String(Math.round(value.minUpdateIntervalMs / 1000))}
            data-invalid={invalidField === 'intervalSeconds'}
            disabled={readOnly || busy}
            onChange={(event) => {
              update('intervalSeconds', event.target.value)
            }}
          />
        </Row>
        <Row label={t('digestTurnsLabel')} controlId="dst-digest">
          <input
            id="dst-digest"
            className="dst-input"
            type="number"
            min={1}
            max={40}
            value={draft.maxTurnsInDigest ?? String(value.maxTurnsInDigest)}
            data-invalid={invalidField === 'maxTurnsInDigest'}
            disabled={readOnly || busy}
            onChange={(event) => {
              update('maxTurnsInDigest', event.target.value)
            }}
          />
        </Row>
        <SwitchRow
          id="dst-on-turn"
          label={t('onTurnEndLabel')}
          checked={draft.updateOnTurnEnd ?? value.updateOnTurnEnd}
          disabled={readOnly || busy}
          onChange={(next) => {
            update('updateOnTurnEnd', next)
          }}
        />
        <SwitchRow
          id="dst-on-step"
          label={t('onStepEndLabel')}
          checked={draft.updateOnStepEnd ?? value.updateOnStepEnd}
          disabled={readOnly || busy}
          onChange={(next) => {
            update('updateOnStepEnd', next)
          }}
        />
        <SwitchRow
          id="dst-children"
          label={t('childSessionsLabel')}
          checked={draft.includeChildSessions ?? value.includeChildSessions}
          disabled={readOnly || busy}
          onChange={(next) => {
            update('includeChildSessions', next)
          }}
        />
      </section>

      <footer className="dst-footer">
        <button
          type="button"
          className="dst-button dst-button-primary"
          disabled={readOnly || busy || !dirty}
          onClick={() => {
            void save()
          }}
        >
          {t('save')}
        </button>
        <button type="button" className="dst-button" disabled={busy || !dirty} onClick={reset}>
          {t('reset')}
        </button>
        {dirty ? <span className="dst-dirty">{t('unsaved')}</span> : null}
        {notice === undefined ? null : (
          <span className={notice.kind === 'ok' ? 'dst-ok' : 'dst-error'}>{notice.text}</span>
        )}
      </footer>
    </div>
  )
}