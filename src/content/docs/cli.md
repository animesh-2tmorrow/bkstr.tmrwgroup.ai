---
title: "CLI reference"
track: agent
role: SUBSCRIBER
order: 1
summary: "Install the bkstr CLI, authenticate, and every command, flag, and exit code."
---

The bkstr CLI is the command-line way to install books and skills and to see what your account owns. It is the npm package `@clawbot678/bkstr`, and it installs a `bkstr` binary. It needs Node 18 or newer.

Under the hood the CLI calls two bkstr endpoints — the install endpoint and the library endpoint. For the endpoints themselves, see the [API reference](/dashboard/docs/api).

## Install the CLI

```bash
# Run it without installing — good for one-off or CI use
npx -y @clawbot678/bkstr <command>

# Or install it globally
npm install -g @clawbot678/bkstr
bkstr <command>
```

Run `bkstr` with no arguments, or `bkstr --help`, for the command list.

<!-- capture: a-01 -->
![bkstr --help](/docs/screenshots/a-01-cli-help-root.png)

## Authentication

Free items install without any credentials. Paid items need an API key, and your account must hold a grant for the item.

Create a key at [/dashboard/api-keys](/dashboard/api-keys). The CLI finds your key in a fixed order: the `BKSTR_KEY` environment variable first, then a stored config file. Set the key once with `bkstr login`, which prompts for it — the input is hidden — and writes it to the config file, so nothing is left in your shell history.

<!-- capture: a-04 -->
![bkstr login --help](/docs/screenshots/a-04-cli-help-login.png)

<!-- capture: a-14 -->
![bkstr login (keyed) — stores the key, prints the account](/docs/screenshots/a-14-cli-login-success.png)

For CI and scripting, set `BKSTR_KEY` in the environment instead of running `bkstr login` — see [Scripting and CI](/dashboard/docs/scripting). `bkstr logout` clears the stored key.

## Commands

| Command | What it does |
|---|---|
| `install <slug>` | Download an item and extract it into the target directory. Alias: `read`. |
| `list` | List the items your account owns. |
| `whoami` | Show the account the current key belongs to. |
| `login` | Store an API key in the config file. |
| `logout` | Remove the stored key. |

### install

`bkstr install <slug>` downloads the item and extracts it. By default it unpacks into `~/.claude/skills/`; `--dir <path>` sends it anywhere else. A free item installs with no key; a paid item uses your resolved key. On success the CLI prints `OK Installed <slug> to <dir>`.

<!-- capture: a-02 -->
![bkstr install --help](/docs/screenshots/a-02-cli-help-install.png)

The CLI extracts archives with a safety pass — it inspects every entry before writing, and rejects absolute paths, `..` segments, symlinks, and anything that would resolve outside the target directory. If validation fails, nothing is written.

### list and whoami

`bkstr list` prints the items you own as a table — kind, slug, title, price, publisher. `bkstr whoami` prints the account your key belongs to and how many items it owns.

<!-- capture: a-03 -->
![bkstr list --help](/docs/screenshots/a-03-cli-help-list.png)

<!-- capture: a-05 -->
![bkstr whoami --help](/docs/screenshots/a-05-cli-help-whoami.png)

<!-- capture: a-15 -->
![bkstr whoami (keyed) — shows the signed-in account](/docs/screenshots/a-15-cli-whoami-keyed.png)

Both take `--json`, which prints the raw data instead of a table — use it when a script needs to parse the output.

<!-- capture: a-16 -->
![bkstr whoami --json (keyed)](/docs/screenshots/a-16-cli-whoami-json.png)

<!-- capture: a-17 -->
![bkstr list --json (keyed)](/docs/screenshots/a-17-cli-list-json.png)

A free item is never owned — `list` shows the items you hold a grant for, so free items do not appear there.

## Exit codes and errors

Every command exits `0` on success and `1` on failure. The CLI writes data to stdout and writes progress, warnings, and errors to stderr, so a script can separate them.

When a request fails, the CLI maps the HTTP status to a readable message:

| Status | Meaning |
|---|---|
| `401` | Not authenticated — the key is missing or invalid. Run `bkstr login`. |
| `403` | The key is valid, but your account has no grant for that item. |
| `404` | No item with that slug. |
| `429` | Rate limit hit — retry after the interval the message gives. |
| `5xx` | A server error — retry shortly. |

<!-- capture: a-09 -->
![bkstr whoami with no auth -> 401 / not authenticated](/docs/screenshots/a-09-cli-err-401-whoami.png)

<!-- capture: a-10 -->
![bkstr install of a nonexistent slug -> 404](/docs/screenshots/a-10-cli-err-404-install.png)

<!-- capture: a-11 -->
![bkstr install of a paid item with no auth -> 401](/docs/screenshots/a-11-cli-err-401-paid-install.png)

## Configuration

`bkstr login` writes a config file holding your key and, optionally, an alternate endpoint. The file location follows your platform:

- Windows — `%APPDATA%\bkstr\config.json`
- macOS and Linux — `$XDG_CONFIG_HOME/bkstr/config.json`, falling back to `~/.config/bkstr/config.json` or `~/.bkstr/config.json`

The `BKSTR_KEY` environment variable always takes precedence over the config file.

## Not yet implemented

> **Not yet implemented.** `bkstr memorize`, `bkstr learn`, and `bkstr follow` are reserved commands. Running them today prints a notice and exits cleanly (exit 0). The semantics are being finalized; this page will be updated when they ship.

The commands are registered — they appear in `--help` and accept a `<slug>` argument — but they do no work yet.

<!-- capture: a-06 -->
![bkstr memorize --help](/docs/screenshots/a-06-cli-help-memorize.png)

<!-- capture: a-07 -->
![bkstr learn --help](/docs/screenshots/a-07-cli-help-learn.png)

<!-- capture: a-08 -->
![bkstr follow --help](/docs/screenshots/a-08-cli-help-follow.png)

Running one today prints the not-yet-implemented notice and exits 0:

<!-- capture: a-12 -->
![bkstr memorize stub — not-yet-implemented notice, exit 0](/docs/screenshots/a-12-cli-stub-memorize.png)

<!-- capture: a-13 -->
![bkstr learn stub — not-yet-implemented notice, exit 0](/docs/screenshots/a-13-cli-stub-learn.png)

To install and use content today, use `bkstr install`. See [Installing](/dashboard/docs/installing) for the subscriber-side walkthrough and [Scripting and CI](/dashboard/docs/scripting) for unattended use.
