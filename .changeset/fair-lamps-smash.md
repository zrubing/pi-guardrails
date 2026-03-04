---
"@aliou/pi-guardrails": patch
---

Fix policy file glob matching for nested paths like `drizzle/**/*.sql` by using native Node glob matching on normalized relative targets.

This keeps basename matching for simple patterns (for backward compatibility), while allowing patterns with `/` to match full relative paths as users expect.
