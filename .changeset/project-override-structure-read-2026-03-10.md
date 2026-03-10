---
"@aliou/pi-guardrails": patch
---

Support project-level allowlist overrides for structure-only read.

- Add `structureOnlyRead.allowedPatterns` to config schema and defaults.
- Skip redaction when a read target matches `allowedPatterns`.
- Document `allowedPatterns` and provide a project-level config example in README.
