# Guardrails

Security hooks for Pi to reduce accidental destructive actions and secret-file access.

## Demo

<video src="https://assets.aliou.me/pi-extensions/demos/pi-guardrails.mp4" controls playsinline muted></video>

## Install

```bash
pi install npm:@aliou/pi-guardrails
```

Or from git:

```bash
pi install git:github.com/aliou/pi-guardrails
```

## What it does

- **policies**: named file-protection rules with per-rule protection levels.
- **permission-gate**: detects dangerous bash commands and asks for confirmation.
- **optional command explainer**: can call a small LLM to explain a dangerous command inline in the confirmation dialog.
- **optional structure-only read**: can transform matched YAML/Properties reads so only keys/shape are exposed and values are redacted.

## Config locations

Guardrails reads and merges config from:

- Global: `~/.pi/agent/extensions/guardrails.json`
- Project: `.pi/extensions/guardrails.json`
- Memory (session): internal temporary scope used by settings/commands

Priority: `memory > local > global > defaults`.

Use `/guardrails:settings` to edit config interactively.

## Current schema

```json
{
  "enabled": true,
  "features": {
    "policies": true,
    "permissionGate": true,
    "structureOnlyRead": false
  },
  "policies": {
    "rules": [
      {
        "id": "secret-files",
        "description": "Files containing secrets",
        "patterns": [
          { "pattern": ".env" },
          { "pattern": ".env.local" },
          { "pattern": ".env.production" },
          { "pattern": ".env.prod" },
          { "pattern": ".dev.vars" }
        ],
        "allowedPatterns": [
          { "pattern": ".env.example" },
          { "pattern": ".env.sample" },
          { "pattern": ".env.test" },
          { "pattern": "*.example.env" },
          { "pattern": "*.sample.env" },
          { "pattern": "*.test.env" }
        ],
        "protection": "noAccess",
        "onlyIfExists": true
      }
    ]
  },
  "permissionGate": {
    "patterns": [
      { "pattern": "rm -rf", "description": "recursive force delete" },
      { "pattern": "sudo", "description": "superuser command" }
    ],
    "customPatterns": [],
    "requireConfirmation": true,
    "allowedPatterns": [],
    "autoDenyPatterns": [],
    "explainCommands": false,
    "explainModel": null,
    "explainTimeout": 5000
  },
  "structureOnlyRead": {
    "patterns": [
      { "pattern": "*.yaml" },
      { "pattern": "*.yml" },
      { "pattern": "*.properties" }
    ],
    "allowedPatterns": [],
    "redactValue": "[REDACTED]"
  }
}
```

All fields optional. Missing fields use defaults.

## Policies

Each rule has:

- `id`: stable identifier used for overrides across scopes.
- `patterns`: files to match (glob by default, regex if `regex: true`). Glob semantics: patterns containing `/` match the full relative path; patterns without `/` match basename only.
- `allowedPatterns`: exceptions.
- `protection`:
  - `noAccess`: block `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`
  - `readOnly`: block `write`, `edit`, `bash`
  - `none`: explicit no protection
- `onlyIfExists` (default true)
- `blockMessage` with `{file}` placeholder
- `enabled` (default true)

When multiple rules match the same file, strongest protection wins:
`noAccess > readOnly > none`.

### Add rule with AI

Use:

```text
/guardrails:add-policy
```

This starts a subagent that helps build and save one policy rule.

## Permission gate

Detects dangerous bash commands and prompts user confirmation.

Built-in dangerous patterns are matched structurally (AST-based) for better accuracy:

- `rm -rf`
- `sudo`
- `dd if=`
- `mkfs.`
- `chmod -R 777`
- `chown -R`

You can also add custom dangerous patterns.

### Explain commands (opt-in)

If enabled, guardrails calls an LLM before showing the confirmation dialog and displays a short explanation.

Config fields:

- `permissionGate.explainCommands` (boolean)
- `permissionGate.explainModel` (`provider/model-id`)
- `permissionGate.explainTimeout` (ms)

Failures/timeouts degrade gracefully: dialog still shows without explanation.

## Structure-only read (opt-in)

When enabled, Guardrails intercepts `read` results for matched files and returns redacted structure instead of raw values.

Config fields:

- `features.structureOnlyRead` (boolean)
- `structureOnlyRead.patterns` (file glob/regex patterns)
- `structureOnlyRead.allowedPatterns` (exceptions; matched files return original read result)
- `structureOnlyRead.redactValue` (replacement value for scalar leaves)

Current behavior:

- `.yaml` / `.yml`: parses YAML, preserves nesting/arrays, redacts scalar values.
- `.properties`: preserves keys, returns `key=<redactValue>` lines.

Project-level override example (`.pi/extensions/guardrails.json`):

```json
{
  "features": { "structureOnlyRead": true },
  "structureOnlyRead": {
    "patterns": [{ "pattern": "*.yaml" }, { "pattern": "*.properties" }],
    "allowedPatterns": [{ "pattern": "config/dev-safe.yaml" }],
    "redactValue": "[REDACTED]"
  }
}
```

In this example, `config/dev-safe.yaml` will return normal content, while other matched files are still redacted.

## Migration notes

Legacy fields are auto-migrated:

- `features.protectEnvFiles` -> `features.policies`
- `envFiles` -> `policies.rules` (migrated into `secret-files`)

`config.version` is a schema marker, not npm package version.

Also note:

- `preventBrew`, `preventPython`, `enforcePackageManager`, `packageManager` were removed from guardrails and moved to `@aliou/pi-toolchain`.

## Events

Guardrails emits events for other extensions:

### `guardrails:blocked`

```ts
interface GuardrailsBlockedEvent {
  feature: "policies" | "permissionGate";
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  userDenied?: boolean;
}
```

### `guardrails:dangerous`

```ts
interface GuardrailsDangerousEvent {
  command: string;
  description: string;
  pattern: string;
}
```
