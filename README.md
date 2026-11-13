# dsh-session-title

DeepSeek Harness names a Session after its **first prompt** and stops there. That
is fine for a one-question session and wrong for every real one: the title sits in
the sidebar for an hour while the work moves from "Create a new plugin…" to a
provider, a scheduler, a test suite, and a tarball. This plugin names a Session
after the **tasks it actually worked on**, and keeps the name current as later
rounds of work move it on.

Tested against **dsh 0.2.2-rc.2** (desktop).

```
Before, after fourteen turns of work:      After:
  Create a new plugin that                   Session-title provider with turn scheduler
```

## What "based on the tasks" means here

A human prompt says what was *asked*. The session log says what was *done*: the
files that were edited, the commands that ran, the todos that were tracked, the
answer that settled the turn. This plugin folds that log into a small **work
digest** and asks the model to name the work from it:

```json
{
  "currentTitle": "Build a title provider",
  "totalTurns": 4,
  "toolCallCount": 31,
  "turns": [
    {
      "turn": 3,
      "prompt": "Add the update scheduler",
      "work": ["write: src/scheduler.ts", "read: lib/index.js", "bash: Run the test suite"],
      "outcome": "Scheduler gates on progress, rest, and novelty."
    }
  ]
}
```

Two tool calls are special-cased because they name tasks directly: `todo_write`
becomes the task list it records, and `exit_plan_mode` becomes the plan's title.
Everything else contributes a one-line "tool: target" summary, preferring the
call's own label (a bash `description`, a file path, a search pattern) over raw
JSON.

## How it plugs in

The harness already owns session titles properly: `dsh-session-title` owns
scheduling, supersession, normalization, and durable `session/title` events, and
accepts **one** provider through `ctx.sessionTitle.register()`. This plugin is
that provider, plus the part the shipped provider never does:

| Part | File | Job |
|---|---|---|
| Provider | `src/provider.ts` | fold the log into a digest, frame it under the byte bound, run one auxiliary model call through the shared `dsh-session-title-llm` executor |
| Digest | `src/digest.ts` | pure fold of `turn/start`, human `user/message`, `tool/call`, `assistant/message`, `turn/end` into per-turn work |
| Prompt | `src/prompt.ts` | instruction, JSON framing, deterministic trimming to `maxInputBytes`, one-line answer parsing |
| Scheduler | `src/scheduler.ts` | decide *when* a revision is worth a call |
| Catalog route | `src/routes.ts` | tell the settings page which providers and models this host offers |
| Settings page | `src/client/` | Settings → **Session titles**: pick the naming model and the cadence |
| Patch | `cordis.patch.yml` | disable the shipped first-prompt provider, insert this row |

Because a Session has exactly one provider, the bundle patch turns off the
shipped row `session-title-llm` before inserting its replacement. Removing this
bundle restores the shipped provider on the next restart.

## When a title is revised

Three gates, all of which must pass, so a title never churns and never costs a
model call for nothing:

1. **Progress** — a completed turn (`turn/end`), or `minStepsBetweenUpdates`
   completed steps inside the running turn. A long single turn still gets a
   current title.
2. **Rest** — `minUpdateIntervalMs` since the last attempt.
3. **Novelty** — the digest fingerprint (turns, tool calls, prompts) differs from
   the work the current title describes.

A Session the **user** renamed is left alone: the service marks that title
`user`-sourced and pins it, and the scheduler never unpins it. Child sessions
(subagent forks) are skipped unless `includeChildSessions` is on.

The provider also carries the service's `first-prompt` automatic cadence, so a
brand-new Session gets a fast first name from its first prompt — and the
scheduler takes over from there.

## Choosing the naming model

A title runs on one small auxiliary request, so it can use a smaller or cheaper
model than the conversation. Settings → **Session titles** owns that choice:

- **Follow each session's model** (default) — the route the session's own logged
  request used.
- **Always use one model** — a pinned provider and model, chosen from the
  catalog the running host advertises. The model control accepts any id the
  host resolves, so a model a provider does not list still works.

The page also edits the title length targets and the revision cadence. Every
field is **volatile**: the settings transport writes the Host document, the
Loader updates the running row in place, and the provider reads the current
value at its next title request. No restart, no re-mount, and no second copy of
the settings — the page reads and writes the same `Config` the profile patch
does.

The model list is a host fact, so the page asks the host over one read-only
loopback route, `GET /api/dsh-session-title/catalog`, which lists
`ctx.llm.listProviders()` with each provider's advertised models. A provider
whose list fails is still offered, with the reason attached; the page then falls
back to free text.

```
Settings
  Session titles        ← this page
    Naming model        ○ follow the session  ● pin provider + model
    Title length        words / CJK characters
    When a title is revised
      turns · steps · interval · boundaries · subagent sessions
```

## Configuration

Every field is a row setting; the Settings page edits them live, and the profile
patch sets the initial values. The bundle patch ships these values.

| Field | Default | Meaning |
|---|---|---|
| `targetWords` | `6` | target length for a non-CJK title |
| `targetCjkCharacters` | `12` | target length for a CJK title |
| `maxInputBytes` | `8192` | byte ceiling for the framed digest |
| `maxOutputTokens` | `2048` | output cap (a runaway guard that leaves room for reasoning) |
| `timeoutMs` | `30000` | end-to-end deadline for one title call |
| `provider`, `model` | — | optional explicit route; both or neither. Omitted inherits the session's own logged route |
| `maxTurnsInDigest` | `10` | how many newest turns the digest carries |
| `minTurnsBetweenUpdates` | `1` | completed turns needed before a revision |
| `minStepsBetweenUpdates` | `2` | completed steps needed for a mid-turn revision |
| `minUpdateIntervalMs` | `120000` | minimum gap between two attempts |
| `updateOnTurnEnd`, `updateOnStepEnd` | `true` | which boundaries are opportunities |
| `includeChildSessions` | `false` | also title subagent sessions |

**Cost.** One auxiliary request per revision, bounded by `maxInputBytes` and
`maxOutputTokens`, at the route's least reasoning effort. The main conversation
gains zero tokens and no latency: the title service runs this work after the
main request and appends only a log-only `session/title` event. Unchanged work
never triggers a call.

## Install

```sh
pnpm check            # typecheck, build, tests
scripts/install.sh    # packs dist/dsh-session-title-0.4.2.tgz
```

Install the tarball into the profile that runs the harness:

```sh
cd ~/.dsh/profiles/desktop
pnpm add file:/absolute/path/to/dsh-session-title-0.4.2.tgz
```

Then add `"dsh-session-title"` to `dsh.profile.bundles` in that profile's
`package.json` (immediately after the other plugin bundles). **Restart the
Harness**: a bundle layer is composed at boot, so the patch that swaps the title
provider applies on restart, not on reload. Existing sessions keep their current
title until their next completed turn; new work retitles them.

## Verification

- `pnpm test` (78 cases) runs the digest against recorded event shapes, the
  framing and trimming against a byte ceiling, the scheduler against fake
  timers, and the provider through the **real** shared executor (the fake is the
  adapter stream only), including the exact `session/title-llm-request` record it
  logs. The settings page is rendered from the real component in jsdom and
  driven: pinning writes the provider/model pair atomically, following clears
  both, and an invalid number never reaches the host. The catalog route is served
  from a real loopback HTTP server.
- `test/manifest.spec.ts` and `test/bundle.spec.ts` assert the ids agree (package
  name, row id, exported `name`, client bundle id), that the patch disables
  `session-title-llm`, and that the built client bundle registers under the
  package name without bundling a second React.
- The visual check — a sidebar row whose title changes — needs the installed
  plugin in a running Harness. The test suite does not claim it.

## Known limits

- **One provider per Session.** A profile that also enables an upstream title
  provider bundle (`dsh-experimental-session-titles-bundle`) composes two
  providers and this row fails loudly at mount with that guidance.
- **Title changes are revisions, not a live cursor.** A revision lands when the
  gates allow; a busy session can show a slightly stale name for up to
  `minUpdateIntervalMs`.
- **The model decides "still accurate".** The prompt asks the model to preserve
  an adequate title and change it only for materially different work; that is an
  instruction, not a semantic check.
- **Digest overflow rejects.** A digest that cannot fit `maxInputBytes` fails
  instead of truncating, and the previous title stands until the next revision.