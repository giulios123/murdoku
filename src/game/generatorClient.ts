import { fillBoardClues, generateLevel, selectBestLevel } from '../engine/generator/index.ts'
import type { FillBoardOptions, GenBudget, GenerateOptions } from '../engine/generator/index.ts'
import type { LevelJson } from '../engine/index.ts'
import { makeClueMatchers, requiredAttrSeeds, type Condition } from './editorClues.ts'

export interface GenHandle {
  promise: Promise<LevelJson>
  /** Terminate the worker(s) and reject the promise with a 'cancelled' error. */
  cancel: () => void
}

/** The ONE quality knob (pre-wired for a future UI toggle): it only picks the soft budget —
 *  how long each worker keeps hunting for a better candidate once it holds one. */
export type GenQuality = 'fast' | 'max'

type WorkerRequest =
  | { kind: 'generate'; opts: GenerateOptions }
  | { kind: 'fill'; board: LevelJson; opts: FillBoardOptions; palette?: Condition[] }

// In the WORKER, Cancel = worker.terminate(), which kills the thread instantly at any
// point — so we don't need tight time limits, just a high safety wall in case a config
// is impossible. The user stops it whenever they like.
const WORKER_BUDGET: GenBudget = { maxAttempts: 4000, softMs: 8000, hardMs: 90000 }
const FAST_BUDGET: GenBudget = { maxAttempts: 4000, softMs: 2500, hardMs: 90000 }

/**
 * How many workers hunt candidates IN PARALLEL. Level quality scales directly with the
 * number of candidates the score gets to choose from (measured: 1 candidate ⇒ the bars are
 * luck; 4+ ⇒ they are the norm), and candidates per second scale with cores. Capped at 4 —
 * beyond that the marginal candidate is cheaper than the thermal/battery cost on phones —
 * and `cores - 1` keeps one core for the UI thread. A 2-core device gets a pool of 1 =
 * exactly the old single-worker behaviour, so weak phones are NEVER worse off than before.
 */
function poolSize(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2
  return Math.min(4, Math.max(1, cores - 1))
}

/**
 * MAIN-THREAD fallback: the work runs synchronously and Cancel cannot interrupt it, so the
 * budget must self-cap or the UI freezes. But it also has to be big enough to actually FIND a
 * level — "kein Level gefunden" is worse than a slow one.
 *
 * The cap therefore scales with the board, because the cost of ONE attempt does: 6x6 lands in
 * ~0.8s, while 9x9 hard needs ~10s (a single attempt costs ~1.1s there, and roughly one in
 * eight clears the bar). A flat 8s was fine while an attempt cost ~140ms; once the generator's
 * dedup deadlock was fixed and attempts started doing real work, those same 8s bought seven
 * attempts instead of fifty-seven — and 9x9 hard failed 3 times out of 8 (measured). A
 * constant can break without anyone editing it, when the assumption underneath it moves.
 */
function fallbackBudget(request: WorkerRequest): GenBudget {
  const width = request.kind === 'generate' ? request.opts.width : request.board.size.width
  const hardMs = width <= 7 ? 8000 : width <= 10 ? 25000 : 40000
  return { maxAttempts: 4000, softMs: 2500, hardMs }
}

/** Return the request with a search budget merged into its opts.
 *  Branch on `kind` so each arm narrows `request` to one union member — spreading
 *  the union directly ({ ...request, opts: { ...request.opts, budget } }) loses the
 *  kind↔opts correlation and won't type-check, so the two arms must stay split. */
function withBudget(request: WorkerRequest, budget: GenBudget): WorkerRequest {
  return request.kind === 'fill'
    ? { ...request, opts: { ...request.opts, budget } }
    : { ...request, opts: { ...request.opts, budget } }
}

/** Same split-arm dance as `withBudget`, for the per-worker seed. */
function withSeed(request: WorkerRequest, seed: number): WorkerRequest {
  return request.kind === 'fill'
    ? { ...request, opts: { ...request.opts, seed } }
    : { ...request, opts: { ...request.opts, seed } }
}

/**
 * Run the request on the MAIN THREAD — the fallback for browsers that can't run
 * our module worker (notably some mobile browsers: older iOS Safari, Firefox for
 * Android, several in-app WebViews). The yield (setTimeout 0) gives the "generating"
 * overlay a chance to paint before the (blocking) CPU work begins. The generator is
 * imported statically: the screens that reach this code already pull it in, so a
 * dynamic import here would never split it into its own chunk anyway.
 */
function runInline(request: WorkerRequest, budget?: GenBudget): GenHandle {
  const req = withBudget(request, budget ?? fallbackBudget(request))
  let cancelled = false
  const promise = (async () => {
    await new Promise((r) => setTimeout(r, 0))
    if (cancelled) throw new Error('cancelled')
    let level: LevelJson | null
    if (req.kind === 'fill') {
      const requiredClues = makeClueMatchers(req.palette)
      const requiredAttributes = requiredAttrSeeds(req.palette)
      level = fillBoardClues(req.board, {
        ...req.opts,
        ...(requiredClues ? { requiredClues } : {}),
        ...(requiredAttributes.length ? { requiredAttributes } : {}),
      })
    } else {
      level = generateLevel(req.opts)
    }
    if (cancelled) throw new Error('cancelled')
    if (!level) throw new Error('generation failed')
    return level
  })()
  return { promise, cancel: () => void (cancelled = true) }
}

/** ONE worker, and nothing else: resolves with its level or REJECTS on any failure — no
 *  inline fallback here. The pool decides what a failure means (one worker of several dying
 *  is fine; N workers each falling back to N synchronous main-thread runs would freeze the
 *  UI N times over). Returns null when Workers are unavailable altogether. */
function spawnWorker(request: WorkerRequest): GenHandle | null {
  let worker: Worker
  try {
    worker = new Worker(new URL('./generator.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  let settled = false
  let resolveFn: (l: LevelJson) => void = () => {}
  let rejectFn: (e: Error) => void = () => {}
  const promise = new Promise<LevelJson>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })
  worker.onmessage = (e: MessageEvent) => {
    if (settled) return
    settled = true
    worker.terminate()
    const data = e.data as { ok: boolean; level?: LevelJson; error?: string }
    if (data.ok && data.level) resolveFn(data.level)
    else rejectFn(new Error(data.error ?? 'generation failed'))
  }
  worker.onerror = () => {
    if (settled) return
    settled = true
    worker.terminate()
    rejectFn(new Error('worker failed'))
  }
  worker.postMessage(request)
  const cancel = () => {
    if (settled) return
    settled = true
    worker.terminate()
    rejectFn(new Error('cancelled'))
  }
  return { promise, cancel }
}

/**
 * The candidate hunt, parallelised: N workers (see `poolSize`), each with its own DISJOINT
 * seed stream and the same budget, each returning its locally best level; the main thread
 * then picks the overall winner with `selectBestLevel` — the very scale each worker already
 * scored its own candidates with. Same wall time as one worker, N× the candidates.
 *
 * Failure ladder: a single dead worker just shrinks the pool; ALL workers dead (or Workers
 * unsupported) falls back to the synchronous main-thread run — today's behaviour, so no
 * device ends up worse than before. Cancel terminates every worker instantly.
 */
function runPool(request: WorkerRequest, quality: GenQuality): GenHandle {
  const budget = quality === 'fast' ? FAST_BUDGET : WORKER_BUDGET
  const size = poolSize()
  const explicitSeed = request.opts.seed
  const baseSeed = explicitSeed ?? Math.floor(Math.random() * 1e9)

  const handles: GenHandle[] = []
  for (let i = 0; i < size; i++) {
    // 10_000_019 (prime) keeps the workers' seed streams disjoint: pickBestLevel advances
    // its seed by a*7919 per attempt, so neighbouring streams never collide within a run.
    const h = spawnWorker(withBudget(withSeed(request, baseSeed + i * 10_000_019), budget))
    if (!h) break
    handles.push(h)
  }
  if (handles.length === 0) return runInline(request)

  let cancelled = false
  let fallback: GenHandle | null = null
  const promise = (async () => {
    // Do NOT wait for stragglers: every worker that HOLDS a candidate returns at its soft
    // deadline (~8s), so a stream still running past that has found NOTHING yet — waiting for
    // it gates the wall time on the unluckiest of N streams (measured: median 14.5s, worst
    // 35.6s, purely from tail-waiting). After the FIRST success, give the others a short
    // grace to hand in what they hold, then cut them loose. Only when EVERY stream is still
    // empty do we keep waiting — a slow level beats "kein Level" (the user's red line).
    // 2.5s: every worker that HOLDS a candidate breaks at softMs (8s) and only finishes its
    // in-flight attempt (~0.7–2s) — the grace must cover that overrun spread, or a second
    // worker's better level gets cut moments before arrival. Workers still empty past that
    // point stay empty for a long time (measured), so waiting longer buys nothing.
    const GRACE_MS = 2500
    const levels: LevelJson[] = []
    let signalFirst = () => {}
    const firstSuccess = new Promise<void>((resolve) => {
      signalFirst = resolve
    })
    const collected = Promise.allSettled(
      handles.map((h) =>
        h.promise.then((level) => {
          levels.push(level)
          signalFirst()
        }),
      ),
    )
    await Promise.race([
      collected,
      firstSuccess.then(() => new Promise((r) => setTimeout(r, GRACE_MS))),
    ])
    if (cancelled) throw new Error('cancelled')
    for (const h of handles) h.cancel() // stragglers hold nothing — see above
    if (levels.length === 0) {
      // Every worker failed (workers broken on this browser, or no board in budget on any
      // stream). One synchronous retry on the main thread — the pre-pool behaviour.
      fallback = runInline(request)
      return fallback.promise
    }
    if (levels.length === 1) return levels[0]
    return selectBestLevel(levels, request.opts.difficulty) ?? levels[0]
  })()

  const cancel = () => {
    if (cancelled) return
    cancelled = true
    for (const h of handles) h.cancel()
    fallback?.cancel()
  }
  return { promise, cancel }
}

/** Generate a brand-new level from scratch. */
export function generateLevelAsync(opts: GenerateOptions, quality: GenQuality = 'max'): GenHandle {
  return runPool({ kind: 'generate', opts }, quality)
}

/* ------------------------------------------------- Rätsel des Tages (daily) */

/**
 * The daily case must be IDENTICAL for every player, so its search may depend on
 * nothing but the seed: a fixed number of attempts (never "best in X seconds" —
 * a faster device sees more attempts and picks a different winner) spread over a
 * FIXED number of seed streams (never "one per CPU core"). More cores only make
 * the same result arrive sooner. softMs/hardMs are set beyond any real runtime so
 * the wall clock can never bind; the attempt caps bound the work instead.
 */
const DAILY_STREAMS = 4
const DAILY_NEVER_MS = 1e12
const DAILY_BUDGET: GenBudget = {
  maxAttempts: 14,
  softMs: DAILY_NEVER_MS,
  hardMs: DAILY_NEVER_MS,
  easyAttempts: 2000,
}

/**
 * Deterministic pool for the daily case. Differences to `runPool`:
 * - fixed stream count with seeds derived ONLY from `opts.seed` (which the caller
 *   derives from the date), never from the device;
 * - waits for ALL streams (no first-success grace cut — which streams make the
 *   deadline is a wall-clock lottery) and selects in STREAM order, so score ties
 *   break identically everywhere;
 * - a worker that CRASHES (environment) is re-run inline with the same seed and
 *   budget — same work, same result. A worker that RAN and found nothing is a
 *   deterministic empty stream (same on every device) and stays empty.
 */
export function generateDailyLevelAsync(opts: GenerateOptions): GenHandle {
  const baseSeed = opts.seed ?? 0
  const streams: WorkerRequest[] = []
  for (let i = 0; i < DAILY_STREAMS; i++) {
    // Same prime stride as runPool: keeps the streams disjoint (pickBestLevel
    // advances its seed by a*7919 per attempt, far below the stride).
    streams.push(
      withBudget(withSeed({ kind: 'generate', opts }, (baseSeed + i * 10_000_019) >>> 0), DAILY_BUDGET),
    )
  }
  const handles = streams.map((r) => spawnWorker(r))
  // Attach a no-op handler now: streams settle in any order while we await them
  // sequentially below, and a rejection must never surface as "unhandled".
  for (const h of handles) h?.promise.catch(() => {})

  let cancelled = false
  let inline: GenHandle | null = null
  const promise = (async () => {
    const found: LevelJson[] = []
    for (let i = 0; i < streams.length; i++) {
      if (cancelled) throw new Error('cancelled')
      const h = handles[i]
      let level: LevelJson | null = null
      try {
        if (h) {
          level = await h.promise
        } else {
          // Workers unavailable in this browser: run the stream inline (slow but
          // exactly the same computation).
          inline = runInline(streams[i], DAILY_BUDGET)
          level = await inline.promise
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg === 'cancelled') throw err
        if (msg === 'worker failed') {
          // Environmental death (never reached the generator) → same stream inline.
          inline = runInline(streams[i], DAILY_BUDGET)
          try {
            level = await inline.promise
          } catch (err2) {
            const msg2 = err2 instanceof Error ? err2.message : String(err2)
            if (msg2 === 'cancelled') throw err2
            level = null // deterministic no-find, just computed inline
          }
        }
        // Any other error came out of the generator itself → deterministic empty
        // stream (identical on every device) — contribute nothing.
      }
      if (level) found.push(level)
    }
    if (cancelled) throw new Error('cancelled')
    if (found.length === 0) throw new Error('generation failed')
    return selectBestLevel(found, opts.difficulty) ?? found[0]
  })()

  const cancel = () => {
    if (cancelled) return
    cancelled = true
    for (const h of handles) h?.cancel()
    inline?.cancel()
  }
  return { promise, cancel }
}

/** Keep the given board, (re)generate its people + clues at the chosen difficulty.
 *  An optional `palette` restricts which clue shapes may be used (the editor's
 *  "Zufällig setzen mit Vorgaben"). */
export function fillBoardCluesAsync(
  board: LevelJson,
  opts: FillBoardOptions,
  palette?: Condition[],
  quality: GenQuality = 'max',
): GenHandle {
  return runPool({ kind: 'fill', board, opts, palette }, quality)
}
