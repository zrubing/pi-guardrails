import { isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { parse, stringify } from "yaml";
import type { ResolvedConfig } from "../config";
import {
  type CompiledPattern,
  compileFilePatterns,
  normalizeFilePath,
} from "../utils/matching";

function normalizeTargetForPolicy(filePath: string, cwd: string): string {
  const absolute = resolve(cwd, filePath);
  const rel = relative(cwd, absolute);
  const candidate =
    rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : absolute;
  return normalizeFilePath(candidate);
}

function shouldTransform(
  normalizedPath: string,
  patterns: CompiledPattern[],
): boolean {
  return patterns.some((pattern) => pattern.test(normalizedPath));
}

function redactTree(value: unknown, redactValue: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactTree(item, redactValue));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[key] = redactTree(nested, redactValue);
    }
    return result;
  }

  return redactValue;
}

function redactYaml(raw: string, redactValue: string): string | null {
  try {
    const parsed = parse(raw);
    const redacted = redactTree(parsed, redactValue);
    return stringify(redacted);
  } catch {
    return null;
  }
}

function decodePropertiesValue(raw: string): string {
  return raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) =>
      String.fromCharCode(Number.parseInt(h, 16)),
    )
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\f/g, "\f")
    .replace(/\\(.)/g, "$1");
}

function splitProperty(line: string): [string, string] {
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "=" || char === ":") {
      return [line.slice(0, i), line.slice(i + 1)];
    }
    if (char === " " || char === "\t") {
      const rest = line.slice(i).trimStart();
      if (!rest) return [line.slice(0, i), ""];
      if (rest[0] === "=" || rest[0] === ":") {
        return [line.slice(0, i), rest.slice(1)];
      }
      return [line.slice(0, i), rest];
    }
  }
  return [line, ""];
}

function redactProperties(raw: string, redactValue: string): string {
  const lines = raw.split(/\r?\n/);
  const redacted: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      continue;
    }

    const [rawKey] = splitProperty(line);
    const key = decodePropertiesValue(rawKey.trim());
    if (!key) continue;

    redacted.push(`${key}=${redactValue}`);
  }

  return redacted.join("\n");
}

function redactByExtension(
  filePath: string,
  raw: string,
  redactValue: string,
): string | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return redactYaml(raw, redactValue);
  }
  if (lower.endsWith(".properties")) {
    return redactProperties(raw, redactValue);
  }
  return null;
}

export function setupStructureOnlyReadHook(
  pi: ExtensionAPI,
  config: ResolvedConfig,
) {
  if (!config.features.structureOnlyRead) return;

  const patterns = compileFilePatterns(config.structureOnlyRead.patterns);
  const allowedPatterns = compileFilePatterns(
    config.structureOnlyRead.allowedPatterns,
  );
  const redactValue = config.structureOnlyRead.redactValue;

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "read" || event.isError) return;

    const pathInput = String(event.input.path ?? "").trim();
    if (!pathInput) return;

    const normalized = normalizeTargetForPolicy(pathInput, ctx.cwd);
    if (!shouldTransform(normalized, patterns)) return;
    if (shouldTransform(normalized, allowedPatterns)) return;

    const transformed = event.content.map((part) => {
      if (part.type !== "text") return part;
      const redacted = redactByExtension(pathInput, part.text, redactValue);
      if (redacted === null) return part;
      return { ...part, text: redacted };
    });

    return { content: transformed };
  });
}
