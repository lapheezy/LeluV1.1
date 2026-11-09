# Attribution — acquired.bounded-memory-cache

LÉLU's bounded cache capability was adapted from:

- **quick-lru** — https://github.com/sindresorhus/quick-lru
- Copyright Sindre Sorhus
- Licensed under the MIT License

The original repository was acquired on 2026-11-09 through LÉLU's Repo
Executive and Repo Executor and recorded as an acquisition in
`.lelu-acquisitions/`. The upstream source was read from the clone; this
implementation reproduces its LRU + optional-max-age semantics in LÉLU's
own TypeScript with explicit statistics and no timers.

## What was changed

- Reimplemented as `BoundedCache` with an explicit `CacheStats` record
  (hits, misses, evictions, expired) instead of relying on callbacks.
- Expiry is evaluated on read rather than by scheduled timers, so the
  capability is safe in a browser and deterministic in tests.
- Added `selftestBoundedCache()` so the USE stage can prove insert, read,
  expiry and LRU eviction behaviour.

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
