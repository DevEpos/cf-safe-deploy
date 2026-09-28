# Cloud Foundry Deploy Safe-Guard

[![npm version](https://img.shields.io/npm/v/cf-safe-deploy.svg?style=flat)](https://www.npmjs.com/package/cf-safe-deploy)

A safety net for manual Cloud Foundry MTA deployments, meant to run as an npm `predeploy`
hook. Before your `cf deploy` starts, it

- verifies the **currently targeted CF org/space** (`cf target`) against a whitelist committed
  to your repository,
- optionally enforces **git branch rules** for protected targets (must be on a specific branch,
  must not be behind the upstream),
- prints a prominent warning banner for **production** targets, and
- asks for **interactive confirmation** before the deploy proceeds.

It exists because `cf deploy` happily ships whatever you are currently targeting — one stale
`cf target` and your feature branch lands in production.

> **This is a client-side convenience guard, not a security boundary.** It protects against
> accidents, not intent (anyone can run `cf deploy` directly). Protect production with CF
> space roles / restricted space developers and CI-only production deployments; use this tool
> as an additional local safety net.

## Install

```sh
npm i -D cf-safe-deploy
```

Requirements:

- Node.js >= 18
- [cf CLI](https://docs.cloudfoundry.org/cf-cli/) installed and logged in (`cf login`)
- `git` on the PATH if you use `requireBranch` / `requireUpToDate`

The package has zero runtime dependencies.

## Wiring it up

npm runs the `predeploy` script automatically before `deploy`. If `predeploy` exits non-zero,
the deploy never starts:

```jsonc
// package.json
{
  "scripts": {
    "predeploy": "cf-safe-deploy",
    "deploy": "cf deploy mta_archives/archive.mtar"
  }
}
```

Then create a `.cf-safe-deploy.json` next to your `package.json` (any parent directory works —
the file is searched upward from the current working directory):

```jsonc
{
  "allowedTargets": [
    { "org": "acme-dev", "space": "web-apps" },
    { "org": "acme-test", "space": "web-apps" },
    {
      "org": "acme-prod",
      "space": "web-apps",
      "region": "eu10-004",
      "requireBranch": "release",
      "requireUpToDate": true,
      "warnProduction": true
    }
  ]
}
```

With this config, `npm run deploy`:

- is **blocked** for any org/space not in the list,
- for `acme-prod/web-apps` additionally requires the targeted API endpoint to be on the
  `eu10-004` region, you to be on the `release` branch and not behind its remote tracking
  branch (a `git fetch` is run first), and shows a red `PRODUCTION` banner,
- always ends with `Continue with deploy to <org>/<space>? (y/N):` — only `y`/`yes`
  (case-insensitive) proceeds.

## Configuration reference

`.cf-safe-deploy.json` — unknown keys are rejected (typo protection, fail closed).

| Key                                | Type    | Required        | Default | Description                                                                                                                                                                                                                        |
| ---------------------------------- | ------- | --------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedTargets`                   | array   | yes (non-empty) | –       | List of org/space combinations that may be deployed to.                                                                                                                                                                            |
| `allowedTargets[].org`             | string  | yes             | –       | CF org name; must exactly match the `org:` line of `cf target`.                                                                                                                                                                    |
| `allowedTargets[].space`           | string  | yes             | –       | CF space name; must exactly match the `space:` line of `cf target`.                                                                                                                                                                |
| `allowedTargets[].region`          | string  | no              | –       | CF region/landscape id (e.g. `eu10-004`), compared case-insensitively against the region extracted from the `API endpoint:` line (`https://api.cf.<region>.<domain>`). Fails closed when the endpoint does not match that pattern. |
| `allowedTargets[].requireBranch`   | string  | no              | –       | Current git branch must equal this value. Not being in a git repository counts as a failure.                                                                                                                                       |
| `allowedTargets[].requireUpToDate` | boolean | no              | `false` | Runs `git fetch`, then fails if the local branch is behind its upstream tracking branch (or has none, or the fetch fails).                                                                                                         |
| `allowedTargets[].warnProduction`  | boolean | no              | `false` | Prints a prominent red `PRODUCTION` warning banner before the confirmation prompt.                                                                                                                                                 |
| `allowedTargets[].confirm`         | boolean | no              | `true`  | Asks `Continue with deploy to <org>/<space>? (y/N)`. Set to `false` to skip the prompt for this target.                                                                                                                            |

A missing or invalid configuration always blocks the deploy (exit code 1).

> **Why `region`?** CF org and space names are only unique per CF instance/region (API endpoint) —
> an org called `acme-prod` may exist on several landscapes. If you work with more than one region,
> pin protected targets to their region so being logged in against the wrong API endpoint cannot
> slip through the org/space whitelist.

## CLI

```
Usage: cf-safe-deploy [options]

  -y, --yes            skip the interactive confirmation prompt
      --config <path>  use this config file instead of searching for .cf-safe-deploy.json
  -h, --help           show this help
  -v, --version        print the version
```

### `add-target`

Adds the currently targeted CF org/space (from `cf target`) to the whitelist in
`.cf-safe-deploy.json`, so you don't have to hand-edit JSON after `cf target -o ... -s ...`:

```sh
cf target -o acme-prod -s web-apps
cf-safe-deploy add-target --require-branch release --require-up-to-date --warn-production
```

```
Usage: cf-safe-deploy add-target [options]

      --region <region>          pin a region (default: auto-detected from the API endpoint)
      --require-branch <branch>  require this git branch for deploys to this target
      --require-up-to-date       require the branch to be up to date with its upstream
      --warn-production          show the production warning banner for this target
      --no-confirm               skip the confirmation prompt for this target
      --config <path>            use/create this config file instead of searching for one
  -h, --help                     show this help
```

If no `.cf-safe-deploy.json` is found (searching upward from the current directory, same as
elsewhere), a new one is created in the current directory. Only the flags you actually pass are
written — e.g. without `--require-up-to-date`, the entry won't contain
`"requireUpToDate": false`. If an entry for the same org/space (and, if given, region) is already
whitelisted, `add-target` fails with exit code 1 and leaves the file untouched.

### CI usage

In CI there is no TTY to answer the prompt. `cf-safe-deploy` never hangs on a non-interactive
stdin — it exits 1 with a hint instead. Pass `--yes` to skip the confirmation:

```sh
npm run deploy -- # blocked in CI unless confirm is false or --yes is passed
cf-safe-deploy --yes && cf deploy mta_archives/archive.mtar
```

or in `package.json`, e.g. as a dedicated CI script:

```jsonc
{
  "scripts": {
    "deploy:ci": "cf-safe-deploy --yes && cf deploy mta_archives/archive.mtar"
  }
}
```

All other checks (whitelist, branch rules) still apply with `--yes`.

Colored output is disabled automatically when stdout is not a TTY or when the
[`NO_COLOR`](https://no-color.org) environment variable is set.

## Exit codes

| Code | Meaning                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | All checks passed (and the user confirmed, if required) — the deploy may proceed.                                                                                                            |
| `1`  | Blocked: target not whitelisted, branch rule violated, `cf`/`git` error, missing/invalid config, confirmation declined, or confirmation required on a non-interactive stdin without `--yes`. |

## License

[MIT](./LICENSE) © Ludwig Stockbauer-Muhr
