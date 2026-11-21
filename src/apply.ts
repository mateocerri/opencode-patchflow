/**
 * apply.ts — pure anchor-based batch editing.
 *
 * Rationale (Program-Aided LM literature): an LLM fails less when it can
 * express "find this anchor, assert it occurs N times, insert/replace this
 * text" as data in ONE call than when it must chain N `edit` calls with a
 * round-trip each. `patchflow_apply` is that one call, with the diff kept
 * auditable (unlike an opaque `python3 <<'EOF'` heredoc doing the same).
 */

export type EditMode = "insertAfter" | "replace";

export interface AnchorEdit {
  /** Anchor text that must occur `expectCount` times (default 1). */
  anchor: string;
  /** Text to insert after the anchor, or replacement when mode is replace. */
  text: string;
  mode?: EditMode;
  expectCount?: number;
}

export interface ApplyResult {
  content: string;
  /** Per-edit occurrence counts, in input order. */
  counts: number[];
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count++;
    from = idx + needle.length;
  }
}

/**
 * Validate every edit against the ORIGINAL content first, then apply all.
 * Atomic: on any count mismatch nothing is applied and an Error naming
 * the failing edit index is thrown.
 */
export function applyAnchorEdits(content: string, edits: AnchorEdit[]): ApplyResult {
  for (let i = 0; i < edits.length; i++) {
    if (!edits[i].anchor) throw new Error(`patchflow: edit ${i} has an empty anchor`);
  }
  // Models write "\n"; a CRLF file would never match a multi-line anchor.
  // Convert the edit's line endings to the file's so Windows files work.
  const crlf = content.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);

  const counts = edits.map((e) => countOccurrences(content, eol(e.anchor)));
  for (let i = 0; i < edits.length; i++) {
    const expected = edits[i].expectCount ?? 1;
    if (counts[i] !== expected) {
      throw new Error(
        `patchflow: edit ${i} anchor occurs ${counts[i]}x, expected ${expected}x`,
      );
    }
  }
  let out = content;
  for (let i = 0; i < edits.length; i++) {
    const { mode = "insertAfter" } = edits[i];
    const anchor = eol(edits[i].anchor);
    const text = eol(edits[i].text);
    // Edits apply in order, so an earlier edit can create or destroy
    // occurrences of a later anchor. Re-check against the current content,
    // otherwise expectCount would be silently violated.
    const expected = edits[i].expectCount ?? 1;
    const now = countOccurrences(out, anchor);
    if (now !== expected) {
      throw new Error(
        `patchflow: edit ${i} anchor occurs ${now}x after earlier edits, expected ${expected}x`,
      );
    }
    out =
      mode === "replace"
        ? out.split(anchor).join(text)
        : out.split(anchor).join(anchor + text);
  }
  return { content: out, counts };
}

/**
 * Compact diff for dry-run output: the changed block between the common
 * leading and trailing lines, capped so a large edit cannot flood the
 * model's context.
 */
export function previewDiff(before: string, after: string, maxLines = 40): string {
  if (before === after) return "(no change)";
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const removed = a.slice(start, endA).map((l) => `-${l}`);
  const added = b.slice(start, endB).map((l) => `+${l}`);
  const body = [...removed, ...added];
  const shown = body.slice(0, maxLines);
  if (body.length > shown.length) shown.push(`... ${body.length - shown.length} more lines`);
  return `@@ line ${start + 1} @@\n${shown.join("\n")}`;
}

/** Line-count change between two versions (negative = lines removed). */
export function previewStats(before: string, after: string): { addedLines: number } {
  const b = before.split("\n").length;
  const a = after.split("\n").length;
  return { addedLines: a - b };
}
