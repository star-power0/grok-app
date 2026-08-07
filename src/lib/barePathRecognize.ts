/**
 * Recognize bare absolute paths the user pasted/typed (Windows: `D:\…`,
 * `"D:\…"`, `D:/…`) and turn them into `@path` references so the agent sees
 * them as file/folder references instead of inert text.
 *
 * Rationale (aligns with Goose `detect_image_path` / Claude Code @-mentions):
 * - A pasted Explorer path (`"D:\Manual\OneDrive\桌面\角色卡"`) is not an `@`
 *   reference and the CLI only treats `@…` tokens as file refs.
 * - Turning it into `@path` lets the existing pipeline do the rest:
 *   - images → Host `split_prompt_images` → ACP image block (multimodal reading)
 *   - folders → CLI leaves the ref for the model's `list_dir` exploration
 *   - PDF/Office → CLI `read_file` parses them (built-in pdf/pptx extractors)
 *
 * Only paths that actually exist are converted (verified via `paths_classify`),
 * so ordinary prose like `C:盘` or a drive letter is never touched.
 */

import { isTauri } from "@/lib/api/host";
import { pathsClassify } from "@/lib/api/fs";

/** One candidate bare path found in user text. */
interface BarePathHit {
  /** Raw text span as it appears (includes wrapping quotes). */
  raw: string;
  /** The path itself, quotes stripped, leading `@` stripped. */
  path: string;
  /** Byte offset into the source text. */
  index: number;
}

/** Quoted Explorer-copied absolute path: `"D:\a b\角色卡"`. */
const QUOTED_PATH_RE = /"([A-Za-z]:[\\/][^"]+)"/g;

/**
 * Unquoted absolute path, tolerant of spaces / CJK. Boundary rules:
 * - must not follow `@` (already a reference) or a quote/paren (URL-ish)
 * - ends at whitespace, quotes, angle brackets, pipe, `?`, or CJK punctuation
 */
const BARE_PATH_RE =
  /(?<!@)(?<!["')\]）】])([A-Za-z]:[\\/][^\s"'<>|*?，。；：、！？（）【】《》]+)/g;

/**
 * Scan user text for candidate bare absolute Windows paths.
 * Quoted matches win; unquoted matches that overlap a quoted one are dropped.
 */
export function extractBarePathCandidates(text: string): BarePathHit[] {
  const hits: BarePathHit[] = [];
  const quotedSpans: Array<[number, number]> = [];

  let m: RegExpExecArray | null;
  const quotedRe = new RegExp(QUOTED_PATH_RE.source, "g");
  while ((m = quotedRe.exec(text)) !== null) {
    quotedSpans.push([m.index, m.index + m[0].length]);
    hits.push({ raw: m[0], path: m[1]!, index: m.index });
  }

  const bareRe = new RegExp(BARE_PATH_RE.source, "g");
  while ((m = bareRe.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    // Skip if inside a quoted path span (already captured).
    if (quotedSpans.some(([s, e]) => start >= s && end <= e)) continue;
    // Skip tokens that are already a reference (`@D:\…`).
    if (start > 0 && text[start - 1] === "@") continue;
    // Skip URL-ish tokens: `https://D:/…` makes `s:/…` look like a drive.
    if (m[1]!.includes("://")) continue;
    hits.push({ raw: m[0], path: m[1]!, index: start });
  }

  // Dedupe by path (keep first occurrence).
  const seen = new Set<string>();
  return hits.filter((h) => {
    if (seen.has(h.path)) return false;
    seen.add(h.path);
    return true;
  });
}

function normalizeKey(p: string): string {
  // paths_classify normalizes the path; compare case-insensitively + same
  // separator so `D:\foo` and `d:/foo` both hit.
  return p.replace(/\//g, "\\").toLowerCase();
}

/**
 * Turn bare absolute paths in `text` into `@path` references.
 * Non-Tauri / no candidates / no existing paths → returns input unchanged.
 * Never throws: classification failures leave the text untouched.
 */
export async function recognizeBarePathsInText(text: string): Promise<string> {
  const t = text ?? "";
  if (!t.trim() || !isTauri()) return t;

  const hits = extractBarePathCandidates(t);
  if (!hits.length) return t;

  let entries: { path: string; exists: boolean }[] = [];
  try {
    entries = await pathsClassify(hits.map((h) => h.path));
  } catch {
    return t; // Host unavailable — leave prose as-is.
  }
  const existing = new Set(
    entries.filter((e) => e.exists).map((e) => normalizeKey(e.path)),
  );

  // Replace from the end so earlier offsets stay valid.
  let out = t;
  for (const hit of [...hits].reverse()) {
    if (!existing.has(normalizeKey(hit.path))) continue;
    const before = out.slice(0, hit.index);
    const alreadyRef = before.endsWith("@");
    // Use the quote-stripped path: `"D:\…"` → `@D:\…` (the `@`-ref parser
    // requires the drive letter right after `@`; quotes would break it).
    const replacement = alreadyRef ? hit.path : `@${hit.path}`;
    out = before + replacement + out.slice(hit.index + hit.raw.length);
  }
  return out;
}
