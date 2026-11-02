/**
 * The package as it ships: manifest fields, the profile patch, and the built
 * host artifact.
 *
 * A bundle is only installable when three ids agree — package name, patch row
 * id, and the plugin's own `name` export — and only loadable when the patch
 * removes the shipped provider it replaces.
 *
 * @module dsh-session-title/test/manifest
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', root)), 'utf8')) as {
  name: string
  version: string
  exports: Record<string, unknown>
  engines: Record<string, string>
  dsh: {
    manifestVersion: number
    bundle: { patch: string }
    client?: { platform: string; immediately?: boolean; inject: string[] }
  }
  peerDependencies: Record<string, string>
}
const patch = readFileSync(fileURLToPath(new URL('cordis.patch.yml', root)), 'utf8')
const builtPath = fileURLToPath(new URL('lib/index.js', root))
const built = existsSync(builtPath)

describe('package manifest', () => {
  it('declares a bundle whose patch file exists', () => {
    expect(packageJson.dsh.manifestVersion).toBe(1)
    expect(packageJson.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(packageJson.exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
  })

  it('declares a boot-loaded settings bundle beside the host half', () => {
    expect(packageJson.dsh.client?.platform).toBe('web')
    expect(packageJson.dsh.client?.immediately).toBe(true)
    expect(packageJson.exports['./client']).toBe('./lib/client.js')
    for (const dependency of [
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-settings-general',
    ]) {
      expect(packageJson.dsh.client?.inject).toContain(dependency)
    }
  })

  it('pins the peer packages it imports at runtime', () => {
    for (const dependency of [
      '@deepseek-ai/dsh-session-title',
      '@deepseek-ai/dsh-session-title-llm',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-host-webserver',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
    ]) {
      expect(packageJson.peerDependencies[dependency]).toBe(packageJson.engines.dsh)
    }
    expect(packageJson.peerDependencies['react']).toBeDefined()
  })
})

describe('cordis.patch.yml', () => {
  it('turns off the shipped first-prompt provider, which owns the single slot', () => {
    expect(patch).toMatch(/^- id: session-title-llm$/mu)
    expect(patch).toMatch(/^\s+disabled: true$/mu)
  })

  it('inserts this package under its own row id', () => {
    expect(patch).toContain('- insert:')
    expect(patch).toMatch(/^\s+- id: dsh-session-title$/mu)
    expect(patch).toMatch(/^\s+name: 'dsh-session-title'$/mu)
  })

  it('carries the cadence settings the plugin documents', () => {
    for (const key of [
      'minTurnsBetweenUpdates',
      'minStepsBetweenUpdates',
      'minUpdateIntervalMs',
      'maxTurnsInDigest',
    ]) {
      expect(patch).toContain(`${key}:`)
    }
  })
})

describe.skipIf(!built)('built host bundle', () => {
  it('exports the entry face the Loader mounts, under the package name', async () => {
    const module = (await import(/* @vite-ignore */ builtPath)) as Record<string, unknown>

    expect(module['name']).toBe(packageJson.name)
    expect(typeof module['apply']).toBe('function')
    expect(module['inject']).toEqual(['sessionTitle', 'llm', 'sessions'])
    expect(module['Config']).toBeDefined()
  })
})