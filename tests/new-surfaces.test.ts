// Contract guards for /players, /prediction-markets, /settlements and
// /parlay/price, plus the parlay error codes.
//
// Fixture provenance
// ------------------
// Unlike the other fixtures in this directory, the `*-contract.json` files
// were NOT captured from a live call. They are transcribed from the server's
// response structs on `sharp-api-go` main — `players.go` (`PlayerResult`),
// `prediction_markets.go` (`PMMarket` / `PMCategory`),
// `pkg/settlements/settlements.go` (`Settlement` + the handler envelope) and
// `endpoints_parlay.go` (`parlayLegEcho` / `parlayModel`). None of those types
// declares a `MarshalJSON`, so the struct tags ARE the wire format.
//
// Values are illustrative, not observed: no real sportsbook price, player, or
// event appears here. What the fixtures pin is SHAPE — key names, which keys
// are omitted when empty (`omitempty`) and which arrive as an explicit `null`
// (pointer fields without `omitempty`: `line`, `bid`/`ask`/`last`,
// `linked_event_id`, `parlay.price`).
//
// TypeScript types are erased at runtime, so a wrong interface does not throw;
// it hands back `undefined`. The drift checks below are therefore the real
// guard — they compare each declared field against the wire keys, and unlike
// the pinned legacy interfaces in `wire-contract.test.ts`, these must have
// ZERO drift.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_ERROR_CODES, SharpAPI } from '../src/index'
import type { APIErrorCode } from '../src/index'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8'))

const respondWith = (body: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )

const client = () => new SharpAPI('sk_test_key')

afterEach(() => vi.unstubAllGlobals())

// --------------------------------------------------------------------------- //
// 1. Error codes — the five parlay rejections plus /settlements' 503
// --------------------------------------------------------------------------- //

const PARLAY_CODES = [
  'correlation_unsupported',
  'too_few_legs',
  'too_many_legs',
  'unknown_leg',
  'ambiguous_leg',
] as const

describe('parlay error codes', () => {
  it.each(PARLAY_CODES)('%s is in the runtime code table', (code) => {
    // The table is `Record<APIErrorCode, APIErrorCode>`, so a code missing
    // from the union fails to compile AND is absent here at runtime — the
    // second is what this asserts, since types are erased.
    expect(API_ERROR_CODES[code]).toBe(code)
  })

  it('service_unavailable is carried too — /settlements answers it on a degraded store', () => {
    expect(API_ERROR_CODES.service_unavailable).toBe('service_unavailable')
  })

  it('every table key round-trips to itself', () => {
    for (const [key, value] of Object.entries(API_ERROR_CODES)) {
      expect(value).toBe(key)
    }
  })

  it.each(PARLAY_CODES)('a 400 carrying %s surfaces the code on the thrown error', async (code) => {
    respondWith({ error: { code, message: 'rejected' } }, 400)
    const err = await client()
      .parlay.price('example_book', [
        { event_id: 'e1', market_type: 'moneyline', selection: 'Home' },
      ])
      .then(
        () => null,
        (e: Error & { code?: string; status?: number }) => e,
      )
    expect(err).not.toBeNull()
    expect(err?.code).toBe(code)
    expect(err?.status).toBe(400)
  })
})

// --------------------------------------------------------------------------- //
// 2. The drift ratchet, pointed at the new interfaces — must be ZERO
// --------------------------------------------------------------------------- //

const SOURCE = readFileSync(join(HERE, '..', 'src', 'index.ts'), 'utf8')

/** Field names declared on an interface, comments stripped. */
function declaredFields(name: string): string[] {
  const m = new RegExp(
    `export interface ${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`,
  ).exec(SOURCE)
  if (!m) throw new Error(`interface ${name} not found`)
  const body = m[1].replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
  return body
    .split('\n')
    .map((line) => /^\s*([A-Za-z_]\w*)\??\s*:/.exec(line)?.[1])
    .filter((f): f is string => Boolean(f))
}

/** Union of keys seen across every row, so an `omitempty` key still counts. */
function wireKeys(rows: Record<string, unknown>[]): Set<string> {
  const keys = new Set<string>()
  for (const row of rows) for (const k of Object.keys(row)) keys.add(k)
  return keys
}

const NEW_SURFACES: Record<string, () => Record<string, unknown>[]> = {
  Player: () => fixture('players-contract.json').data,
  PredictionMarket: () => fixture('prediction-markets-contract.json').data,
  PredictionMarketCategory: () =>
    fixture('prediction-market-categories-contract.json').data,
  Settlement: () => fixture('settlements-contract.json').data.settlements,
  ParlayLeg: () => fixture('parlay-price-contract.json').data.legs,
  ParlayModel: () => [
    fixture('parlay-price-contract.json').data.parlay,
    fixture('parlay-price-unpriced-contract.json').data.parlay,
  ],
}

describe('new interfaces vs the wire', () => {
  it('the extractor works on a new interface', () => {
    expect(declaredFields('Player')).toContain('display_name')
    // The \b guard: Settlement must not be measured as SettlementsPage.
    expect(declaredFields('Settlement')).not.toEqual(
      declaredFields('SettlementsPage'),
    )
  })

  it.each(Object.entries(NEW_SURFACES))(
    '%s declares no field the wire never sends',
    (iface, rows) => {
      const wire = wireKeys(rows())
      const drifted = declaredFields(iface)
        .filter((f) => !wire.has(f))
        .sort()
      expect(drifted).toEqual([])
    },
  )
})

// --------------------------------------------------------------------------- //
// 3. Runtime shape — the values a caller actually reads back
// --------------------------------------------------------------------------- //

describe('/players', () => {
  it('returns rows and the top-level pagination block', async () => {
    respondWith(fixture('players-contract.json'))
    const res = await client().players.list({ sport: 'baseball' })
    expect(res.data).toHaveLength(2)
    expect(res.data[0].display_name).toBe('Example Player')
    expect(res.data[0].leagues).toEqual(['mlb'])
    // `pagination` rides at the top level, not under `meta` — declaring it on
    // `APIResponse.meta` alone would read back undefined.
    expect(res.pagination?.total).toBe(2)
    expect(res.pagination?.has_more).toBe(false)
  })

  it('omitempty fields read as undefined, not null', async () => {
    respondWith(fixture('players-contract.json'))
    const res = await client().players.list()
    expect(res.data[1].first_name).toBeUndefined()
    expect(res.data[1].team_id).toBeUndefined()
    expect(res.data[1].leagues).toEqual([])
  })
})

describe('/prediction-markets', () => {
  it('parses a game-tied market', async () => {
    respondWith(fixture('prediction-markets-contract.json'))
    const res = await client().predictionMarkets.list({ category: 'sports' })
    const m = res.data[0]
    expect(m.market_id).toBe('kalshi:KXEXAMPLEGAME-26SEP09')
    expect(m.source_ids.market_id).toBe('KXEXAMPLEGAME-26SEP09')
    expect(m.outcomes[0].price.american).toBe(-122)
    expect(m.sportsbook_ref?.id).toBe('kalshi')
  })

  it('linked_event_id is null on a futures contract, not undefined', async () => {
    // Sent without omitempty precisely so a caller can tell "no join key"
    // from "key not in this response".
    respondWith(fixture('prediction-markets-contract.json'))
    const res = await client().predictionMarkets.list()
    expect(res.data[0].linked_event_id).toBe('baseball_mlb_example_event')
    expect(res.data[1].linked_event_id).toBeNull()
  })

  it('absent quotes are explicit nulls', async () => {
    respondWith(fixture('prediction-markets-contract.json'))
    const res = await client().predictionMarkets.list()
    const noSide = res.data[0].outcomes[1]
    expect(noSide.bid).toBeNull()
    expect(noSide.ask).toBeNull()
    expect(noSide.last).toBeNull()
  })

  it('categories carry per-book counts', async () => {
    respondWith(fixture('prediction-market-categories-contract.json'))
    const res = await client().predictionMarkets.categories()
    expect(res.data[0].id).toBe('sports')
    expect(res.data[0].books.map((b) => b.id)).toEqual([
      'kalshi',
      'polymarket',
    ])
    expect(res.data[0].books[0].market_count).toBe(260)
  })
})

describe('/settlements', () => {
  it('data is an OBJECT — rows plus paging state, not a bare list', async () => {
    respondWith(fixture('settlements-contract.json'))
    const res = await client().settlements.get({
      game_id: 'baseball_mlb_example_event',
    })
    expect(res.data.total_settlements).toBe(2)
    expect(res.data.truncated).toBe(false)
    expect(res.data.next_offset).toBeNull()
    expect(res.data.settlements).toHaveLength(2)
    expect(res.data.settlements[0].outcome).toBe('won')
    expect(res.data.settlements[1].outcome).toBe('push')
    expect(res.data.settlements[1].hash_id).toBeUndefined()
  })

  it('meta carries the window and the grading cutoff', async () => {
    respondWith(fixture('settlements-contract.json'))
    const res = await client().settlements.get({ hash_id: 'a1b2c3d4e5f60718' })
    expect(res.meta?.source).toBe('ev_grading')
    expect(res.meta?.limit).toBe(100)
    expect(res.meta?.grading_cutoff).toBe('2026-07-19')
  })
})

describe('/parlay/price', () => {
  it('returns the model price and echoes each resolved leg', async () => {
    respondWith(fixture('parlay-price-contract.json'))
    const res = await client().parlay.price('example_book', [
      { event_id: 'baseball_mlb_example_event', market_type: 'moneyline', selection: 'Example Home' },
      { event_id: 'baseball_mlb_other_event', market_type: 'total_points', selection: 'over', line: 8.5 },
    ])
    expect(res.data.legs).toHaveLength(3)
    expect(res.data.legs[0].line).toBeNull()
    expect(res.data.legs[1].line).toBe(8.5)
    expect(res.data.legs[2].player_name).toBe('Example Player')
    expect(res.data.parlay.leg_count).toBe(3)
    expect(res.data.parlay.price?.odds_american).toBe(557)
    expect(res.data.parlay.source).toBe('sharpapi_model')
    expect(res.data.warnings).toBeUndefined()
  })

  it('an unpriceable slip returns price: null with a reason', async () => {
    respondWith(fixture('parlay-price-unpriced-contract.json'))
    const res = await client().parlay.price('example_book', [
      { event_id: 'e', market_type: 'moneyline', selection: 'Example Home' },
      { event_id: 'e', market_type: 'moneyline', selection: 'Example Away' },
    ])
    expect(res.data.parlay.price).toBeNull()
    expect(res.data.parlay.reason).toBe('mutually_exclusive')
    expect(res.data.parlay.conflicting_legs).toEqual([[0, 1]])
    expect(res.data.warnings).toHaveLength(1)
  })

  it('the model note rides every response', () => {
    for (const f of ['parlay-price-contract.json', 'parlay-price-unpriced-contract.json']) {
      expect(fixture(f).data.parlay.note).toContain(
        'not a sportsbook parlay quote',
      )
    }
  })

  it('POSTs the slip as {sportsbook, legs}', async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify(fixture('parlay-price-contract.json')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', spy)
    await client().parlay.price('example_book', [
      { event_id: 'e1', market_type: 'moneyline', selection: 'Home' },
    ])
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/v1/parlay/price')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      sportsbook: 'example_book',
      legs: [{ event_id: 'e1', market_type: 'moneyline', selection: 'Home' }],
    })
  })
})

// A compile-time assertion: each new code must be assignable to APIErrorCode.
const _codes: APIErrorCode[] = [...PARLAY_CODES, 'service_unavailable']
void _codes
