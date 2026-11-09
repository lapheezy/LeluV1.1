/**
 * ==========================================================
 * LÉLU — FUZZY TEXT SEARCH (acquired capability)
 *
 * SOURCE: krisk/Fuse — https://github.com/krisk/Fuse
 * COMMIT: edf2fb608eca0461508d1d71317e6e58309ffada  (v7.6.0-beta.0)
 * LICENSE: Apache-2.0 (see ./LICENSE-Apache-2.0.txt and ./NOTICE.md)
 *
 * ADAPTED FILES (its src/search/bitap/*.ts):
 *   index.ts, search.ts, computeScore.ts, constants.ts,
 *   createPatternAlphabet.ts, convertMaskToIndices.ts
 *
 * WHAT CHANGED
 *   • Ported from Fuse's default exports and Config singleton into one
 *     dependency-free module with explicit options.
 *   • TypeScript strict types; no `any`, no global config.
 *   • Added LÉLU's own tokenised multi-field search and a highlight
 *     helper (not present in Fuse), measured against Fuse's own scoring.
 *   • The Bitap algorithm, chunking, mask handling and score formula are
 *     Fuse's, unchanged.
 *
 * The algorithm is Bitap (Baeza-Yates–Gonnet): a bit-parallel approximate
 * match that reports the number of edit errors as a score in [0, 1].
 * ==========================================================
 */

export const MAX_BITS = 32;

export interface FuzzyOptions {
  /** Expected position of the match inside the text (0 = start). */
  location?: number;
  /** 0 = exact only, 1 = accept anything. */
  threshold?: number;
  /** Characters until a match is far enough away to score 1. */
  distance?: number;
  minMatchCharLength?: number;
  isCaseSensitive?: boolean;
  findAllMatches?: boolean;
  includeMatches?: boolean;
  ignoreDiacritics?: boolean;
  ignoreLocation?: boolean;
}

export type RangeTuple = [number, number];

export interface FuzzyMatchResult {
  isMatch: boolean;
  score: number;
  indices?: RangeTuple[];
}

const DEFAULTS: Required<FuzzyOptions> = {
  location: 0,
  threshold: 0.6,
  distance: 100,
  minMatchCharLength: 1,
  isCaseSensitive: false,
  findAllMatches: false,
  includeMatches: false,
  ignoreDiacritics: true,
  ignoreLocation: false,
};

function withDefaults(options: FuzzyOptions = {}): Required<FuzzyOptions> {
  return { ...DEFAULTS, ...options };
}

/** Diacritic folding (LÉLU addition: String.normalize, not Fuse's table). */
function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Fuse: src/search/bitap/createPatternAlphabet.ts */
function createPatternAlphabet(pattern: string): Record<string, number> {
  const mask: Record<string, number> = {};
  for (let index = 0, len = pattern.length; index < len; index += 1) {
    const char = pattern.charAt(index);
    mask[char] = (mask[char] ?? 0) | (1 << (len - index - 1));
  }
  return mask;
}

/** Fuse: src/search/bitap/convertMaskToIndices.ts */
function convertMaskToIndices(matchMask: number[] = [], minMatchCharLength = 1): RangeTuple[] {
  const indices: RangeTuple[] = [];
  let start = -1;
  let end = -1;
  let index = 0;

  for (const len = matchMask.length; index < len; index += 1) {
    const match = matchMask[index];
    if (match && start === -1) {
      start = index;
    } else if (!match && start !== -1) {
      end = index - 1;
      if (end - start + 1 >= minMatchCharLength) indices.push([start, end]);
      start = -1;
    }
  }

  if (matchMask[index - 1] && index - start >= minMatchCharLength) {
    indices.push([start, index - 1]);
  }

  return indices;
}

/** Fuse: src/search/bitap/computeScore.ts (inlined by Fuse in the hot loop). */
function computeScore(
  patternLength: number,
  errors: number,
  currentLocation: number,
  expectedLocation: number,
  distance: number,
  ignoreLocation: boolean,
): number {
  const accuracy = errors / patternLength;
  if (ignoreLocation) return accuracy;
  const proximity = Math.abs(expectedLocation - currentLocation);
  if (!distance) return proximity ? 1.0 : accuracy;
  return accuracy + proximity / distance;
}

/** Fuse: src/search/bitap/search.ts */
function bitapSearch(
  text: string,
  pattern: string,
  patternAlphabet: Record<string, number>,
  options: Required<FuzzyOptions>,
): FuzzyMatchResult & { bestErrors: number } {
  if (pattern.length > MAX_BITS) {
    throw new Error(`The pattern length is greater than ${MAX_BITS}.`);
  }

  const { location, distance, threshold, findAllMatches, minMatchCharLength, includeMatches, ignoreLocation } = options;
  const patternLen = pattern.length;
  const textLen = text.length;
  const expectedLocation = Math.max(0, Math.min(location, textLen));
  let currentThreshold = threshold;
  let bestLocation = expectedLocation;

  const calcScore = (errors: number, currentLocation: number): number =>
    computeScore(patternLen, errors, currentLocation, expectedLocation, distance, ignoreLocation);

  const computeMatches = minMatchCharLength > 1 || includeMatches;
  const matchMask: number[] = computeMatches ? Array(textLen).fill(0) : [];

  let index: number;
  while ((index = text.indexOf(pattern, bestLocation)) > -1) {
    const score = calcScore(0, index);
    currentThreshold = Math.min(score, currentThreshold);
    bestLocation = index + patternLen;
    if (computeMatches) {
      for (let offset = 0; offset < patternLen; offset += 1) matchMask[index + offset] = 1;
    }
  }

  bestLocation = -1;

  let lastBitArr: number[] = [];
  let finalScore = 1;
  let bestErrors = 0;
  let binMax = patternLen + textLen;
  const mask = 1 << (patternLen - 1);

  for (let errors = 0; errors < patternLen; errors += 1) {
    let binMin = 0;
    let binMid = binMax;

    while (binMin < binMid) {
      const score = calcScore(errors, expectedLocation + binMid);
      if (score <= currentThreshold) binMin = binMid;
      else binMax = binMid;
      binMid = Math.floor((binMax - binMin) / 2 + binMin);
    }

    binMax = binMid;
    let start = Math.max(1, expectedLocation - binMid + 1);
    const finish = findAllMatches
      ? textLen
      : Math.min(expectedLocation + binMid, textLen) + patternLen;

    const bitArr: number[] = Array(finish + 2).fill(0);
    bitArr[finish + 1] = (1 << errors) - 1;

    for (let position = finish; position >= start; position -= 1) {
      const currentLocation = position - 1;
      const charMatch = patternAlphabet[text[currentLocation] ?? ""] ?? 0;

      bitArr[position] = ((bitArr[position + 1] << 1) | 1) & charMatch;

      if (errors) {
        bitArr[position] |=
          ((lastBitArr[position + 1] | lastBitArr[position]) << 1) | 1 | lastBitArr[position + 1];
      }

      if (bitArr[position] & mask) {
        finalScore = calcScore(errors, currentLocation);
        if (finalScore <= currentThreshold) {
          currentThreshold = finalScore;
          bestLocation = currentLocation;
          bestErrors = errors;
          if (bestLocation <= expectedLocation) break;
          start = Math.max(1, 2 * expectedLocation - bestLocation);
        }
      }
    }

    const score = calcScore(errors + 1, expectedLocation);
    if (score > currentThreshold) break;
    lastBitArr = bitArr;
  }

  if (computeMatches && bestLocation >= 0) {
    const matchEnd = Math.min(textLen - 1, bestLocation + patternLen - 1 + bestErrors);
    for (let cursor = bestLocation; cursor <= matchEnd; cursor += 1) {
      if (patternAlphabet[text[cursor] ?? ""]) matchMask[cursor] = 1;
    }
  }

  const result: FuzzyMatchResult & { bestErrors: number } = {
    isMatch: bestLocation >= 0,
    score: Math.max(0.001, finalScore),
    bestErrors,
  };

  if (computeMatches) {
    const indices = convertMaskToIndices(matchMask, minMatchCharLength);
    if (indices.length === 0) result.isMatch = false;
    else if (includeMatches) result.indices = indices;
  }

  return result;
}

/** Fuse: src/search/bitap/index.ts (BitapSearch), ported as a class. */
export class BitapMatcher {
  readonly pattern: string;
  private readonly options: Required<FuzzyOptions>;
  private readonly chunks: Array<{ pattern: string; alphabet: Record<string, number>; startIndex: number }> = [];

  constructor(pattern: string, options: FuzzyOptions = {}) {
    this.options = withDefaults(options);
    const normalise = (value: string): string => {
      let next = this.options.isCaseSensitive ? value : value.toLowerCase();
      if (this.options.ignoreDiacritics) next = stripDiacritics(next);
      return next;
    };
    this.pattern = normalise(pattern);
    if (!this.pattern.length) return;

    const addChunk = (chunk: string, startIndex: number): void => {
      this.chunks.push({ pattern: chunk, alphabet: createPatternAlphabet(chunk), startIndex });
    };
    const len = this.pattern.length;
    if (len > MAX_BITS) {
      let index = 0;
      const remainder = len % MAX_BITS;
      const end = len - remainder;
      while (index < end) {
        addChunk(this.pattern.substr(index, MAX_BITS), index);
        index += MAX_BITS;
      }
      if (remainder) {
        const startIndex = len - MAX_BITS;
        addChunk(this.pattern.substr(startIndex), startIndex);
      }
    } else {
      addChunk(this.pattern, 0);
    }
  }

  searchIn(input: string): FuzzyMatchResult {
    let text = this.options.isCaseSensitive ? input : input.toLowerCase();
    if (this.options.ignoreDiacritics) text = stripDiacritics(text);

    if (this.pattern === text) {
      if (text.length < this.options.minMatchCharLength) return { isMatch: false, score: 1 };
      const exact: FuzzyMatchResult = { isMatch: true, score: 0 };
      if (this.options.includeMatches) exact.indices = [[0, text.length - 1]];
      return exact;
    }

    const allIndices: RangeTuple[] = [];
    let totalScore = 0;
    let hasMatches = false;

    for (const chunk of this.chunks) {
      const result = bitapSearch(text, chunk.pattern, chunk.alphabet, {
        ...this.options,
        location: this.options.location + chunk.startIndex,
      });
      if (result.isMatch) hasMatches = true;
      totalScore += result.score;
      if (result.isMatch && result.indices) allIndices.push(...result.indices);
    }

    const combined: FuzzyMatchResult = {
      isMatch: hasMatches,
      score: hasMatches ? totalScore / this.chunks.length : 1,
    };
    if (hasMatches && this.options.includeMatches) combined.indices = mergeRanges(allIndices);
    return combined;
  }
}

/** Overlapping/adjacent ranges merged, as Fuse's helpers/mergeIndices does. */
function mergeRanges(ranges: RangeTuple[]): RangeTuple[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: RangeTuple[] = [sorted[0]];
  for (const [start, end] of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Score one text against a pattern. 1 means "no match". */
export function fuzzyScore(pattern: string, text: string, options: FuzzyOptions = {}): number {
  return new BitapMatcher(pattern, options).searchIn(text).score;
}

export interface FuzzyFieldHit<T> {
  item: T;
  score: number;
  field: string;
  indices?: RangeTuple[];
}

/**
 * LÉLU addition: tokenised multi-field search.
 *
 * Each whitespace-separated token is scored against every field, the
 * worst token score is taken (so a query's terms must all be found),
 * and results are sorted by score then by the caller's stable order.
 */
export function fuzzySearch<T>(
  items: readonly T[],
  query: string,
  options: {
    keys: (item: T) => string[];
    threshold?: number;
    limit?: number;
    includeMatches?: boolean;
  },
): FuzzyFieldHit<T>[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const threshold = options.threshold ?? DEFAULTS.threshold;
  const hits: FuzzyFieldHit<T>[] = [];

  for (const item of items) {
    const fields = options.keys(item).filter((field) => field.trim().length > 0);
    if (fields.length === 0) continue;

    let worst = 0;
    let bestField = "";
    let bestIndices: RangeTuple[] | undefined;

    for (const token of tokens) {
      const matcher = new BitapMatcher(token, { threshold, includeMatches: options.includeMatches });
      let tokenBest = 1;
      let tokenField = "";
      let tokenIndices: RangeTuple[] | undefined;
      for (const field of fields) {
        const result = matcher.searchIn(field);
        if (result.score < tokenBest) {
          tokenBest = result.score;
          tokenField = field;
          tokenIndices = result.indices;
        }
      }
      if (tokenBest > worst || bestField === "") {
        if (bestField === "" || tokenBest >= worst) {
          bestField = tokenField;
          bestIndices = tokenIndices;
        }
        worst = Math.max(worst, tokenBest);
      }
    }

    if (worst <= threshold) {
      hits.push({
        item,
        score: worst,
        field: bestField,
        ...(options.includeMatches && bestIndices ? { indices: bestIndices } : {}),
      });
    }
  }

  hits.sort((a, b) => a.score - b.score);
  return typeof options.limit === "number" ? hits.slice(0, options.limit) : hits;
}

/** Render a text with its matched ranges wrapped in markers. */
export function highlightMatch(text: string, indices: RangeTuple[] | undefined, open = "«", close = "»"): string {
  if (!indices || indices.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const [start, end] of [...indices].sort((a, b) => a[0] - b[0])) {
    if (start > cursor) out += text.slice(cursor, start);
    out += `${open}${text.slice(start, end + 1)}${close}`;
    cursor = end + 1;
  }
  return out + text.slice(cursor);
}
