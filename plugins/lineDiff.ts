/**
 * ==========================================================
 * LÉLU — A LINE DIFF THAT SHOWS WHAT ACTUALLY CHANGED
 *
 * The workspace diff used to trim the common prefix and suffix of two
 * files and call everything between them "changed". Two small edits far
 * apart in one file — measured in self-improvement run 11: edits at
 * lines 60 and 590 of an 837-line file, about 20 lines in all — came
 * back as "+531/-523", one block truncated at 8,000 characters. Neither
 * LÉLU nor a reviewer could see her change in it.
 *
 * This is a longest-common-subsequence diff over the part between the
 * common prefix and suffix, emitted as unified hunks with 3 lines of
 * context. Shared by the Node and Deno engineer adapters. Pure: no I/O.
 * ==========================================================
 */

type Op = { kind: " " | "-" | "+"; line: string };

/**
 * Above this many cells (middle-of-A lines × middle-of-B lines) the LCS
 * table is not built and the middle is reported as one replaced block —
 * still exact about which lines differ, only coarser. 4M cells = 16 MB.
 */
const MAX_LCS_CELLS = 4_000_000;
const CONTEXT = 3;
const MAX_PATCH_CHARS = 8000;

function split(text: string): string[] {
  return text.length ? text.split("\n") : [];
}

function edits(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const ops: Op[] = a.slice(0, start).map((line) => ({ kind: " ", line }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS) {
    for (const line of midA) ops.push({ kind: "-", line });
    for (const line of midB) ops.push({ kind: "+", line });
  } else {
    // lcs[i][j] = LCS length of midA[i..] and midB[j..], row-major.
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lcs[i * width + j] = midA[i] === midB[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ kind: " ", line: midA[i] });
        i += 1;
        j += 1;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
        ops.push({ kind: "-", line: midA[i] });
        i += 1;
      } else {
        ops.push({ kind: "+", line: midB[j] });
        j += 1;
      }
    }
    for (; i < n; i += 1) ops.push({ kind: "-", line: midA[i] });
    for (; j < m; j += 1) ops.push({ kind: "+", line: midB[j] });
  }

  for (const line of a.slice(endA)) ops.push({ kind: " ", line });
  return ops;
}

/** How many lines a change really adds and removes. */
export function lineChangeCounts(before: string, after: string): { added: number; removed: number } {
  const ops = edits(split(before), split(after));
  return {
    added: ops.filter((op) => op.kind === "+").length,
    removed: ops.filter((op) => op.kind === "-").length,
  };
}

/** A unified patch: one hunk per separate change, 3 lines of context. */
export function unifiedPatch(relative: string, before: string, after: string): string {
  const ops = edits(split(before), split(after));
  const out = [`--- a/${relative}`, `+++ b/${relative}`];

  // Line numbers (1-based) of each op in A and in B.
  const posA: number[] = [];
  const posB: number[] = [];
  let lineA = 1;
  let lineB = 1;
  for (const op of ops) {
    posA.push(lineA);
    posB.push(lineB);
    if (op.kind !== "+") lineA += 1;
    if (op.kind !== "-") lineB += 1;
  }

  let k = 0;
  while (k < ops.length) {
    if (ops[k].kind === " ") {
      k += 1;
      continue;
    }
    // A hunk: from CONTEXT lines before this change to CONTEXT lines after
    // the last change that is within 2×CONTEXT of the previous one.
    const from = Math.max(0, k - CONTEXT);
    let last = k;
    let scan = k;
    while (scan < ops.length) {
      if (ops[scan].kind !== " ") last = scan;
      else if (scan - last > 2 * CONTEXT) break;
      scan += 1;
    }
    const to = Math.min(ops.length, last + 1 + CONTEXT);
    const slice = ops.slice(from, to);
    const lenA = slice.filter((op) => op.kind !== "+").length;
    const lenB = slice.filter((op) => op.kind !== "-").length;
    const startA = lenA ? posA[from] : posA[from] - 1;
    const startB = lenB ? posB[from] : posB[from] - 1;
    out.push(`@@ -${startA},${lenA} +${startB},${lenB} @@`);
    for (const op of slice) out.push(`${op.kind}${op.line}`);
    k = to;
  }

  const patch = out.join("\n");
  return patch.length > MAX_PATCH_CHARS ? `${patch.slice(0, MAX_PATCH_CHARS)}\n…[patch truncated]` : patch;
}
