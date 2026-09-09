# Changelog

All notable changes to `@sharp-api/client` are documented here.

## 0.4.3 — Unreleased

### Added — typed surfaces for /players, /prediction-markets, /settlements and /parlay/price

- Four new resources on `SharpAPI`: `players` (list + by-id),
  `predictionMarkets` (list, by-id, `categories()`), `settlements` (graded
  outcomes by `hash_id`/`game_id`) and `parlay.price(sportsbook, legs)`
  (modeled combined price).
- Interfaces for each: `Player`, `PredictionMarket` (+
  `PredictionMarketOutcome`, `PredictionMarketPrice`,
  `PredictionMarketSourceIDs`, `PredictionMarketCategory`,
  `PredictionMarketCategoryBook`), `Settlement`, `SettlementsPage`,
  `SettlementsResponse`, `ParlayPriceResult` (+ `ParlayLeg`, `ParlayModel`,
  `ParlayModelPrice`, `ParlayLegRequest`), plus the params types
  `PlayersParams`, `PredictionMarketsParams`, `SettlementsParams`.
- `PaginatedResponse<T>` and `Pagination` describe the TOP-LEVEL `pagination`
  block the list surfaces actually send — `APIResponse.meta.pagination` alone
  reads back `undefined` there.
- Every new interface is snake_case, matching the wire; the drift ratchet in
  `tests/new-surfaces.test.ts` holds them at zero declared-but-unsent fields.

### Added — parlay error codes

- `APIErrorCode` and `API_ERROR_CODES` gain `correlation_unsupported`,
  `too_few_legs`, `too_many_legs`, `unknown_leg` and `ambiguous_leg`.
  (`service_unavailable`, which `/settlements` returns on a degraded grading
  store, was already present and is unchanged.)

### Security

- Authenticated REST requests now reject redirects, preventing credentials and request bodies from being forwarded to another origin.
- Package publishing requires approval through the protected release environment.

## 0.4.2 — 2026-07-02

### Added — suspended-opportunity state (issue #13)

- `EVOpportunity` gains optional `is_suspended` (`boolean`) and
  `suspended_since` (unix seconds, present only while suspended). When the
  sharp reference (Pinnacle) momentarily suspends a live market, the engine
  keeps the opp visible-but-suspended under the same stable `id` with the
  edge hidden, instead of dropping and re-adding it — consumers can grey the
  row and keep it in place across resume. Wire keys are snake_case.
- These fields are present only when suspended-opportunity state is enabled
  on the server. Additive optional fields — non-breaking, matching
  the `team_side` / `market_segment` precedent.

### Changed

- `package.json` now declares `engines: { node: ">=18" }`, matching the
  Node 18/20/22 CI matrix (metadata only; no runtime change).

## 0.4.1 — 2026-06-02

### Added — structured `team_side` + `market_segment`

- `NormalizedOdds`, `EVOpportunity`, and `ClosingOdd` gain optional `team_side`
  (`'home' | 'away' | 'draw' | 'over' | 'under'`) and `market_segment`
  (`string`). Wire keys are snake_case (the client returns raw JSON without key
  transforms), matching `is_active`.
- `team_side` is the raw structured side decomposed out of the compound
  `selectionType` / `selection_type` vocabulary — prefer it over parsing compound
  prefixes like `'home_over'`. `market_segment` is the canonical contest slice.
- `NormalizedOdds.selectionType` widened with `(string & {})` so it accepts the
  team-total compound forms (`'home_over'`, ...) the server emits without a major
  bump. Additive, non-breaking.

## 0.4.0 — 2026-06-02

### Changed

- `NormalizedOdds.timestamp` documented as the **delivery / last-refreshed**
  feed-freshness timestamp (advances every ingest cycle), rather than a
  price-last-changed time. The API now populates this field
  (previously always `null`). The removed `odds_changed_at` / `last_seen_at` /
  `wire_received_at` were never modeled by this SDK, so no type change is
  needed.

### Added

- `NormalizedOdds.is_active` (boolean). `false` indicates the market is
  suspended/closed with the price frozen, exposed as a queryable field.
  Absent on the wire is treated as `true`.
- `'odds:locked'` `WebSocketEventType` — supplementary stream event carrying the
  suspended subset of a delta. The rows also
  arrive in the normal odds update with `is_active: false`.

### Backward compatibility

- Additive optional field; existing code is unaffected.

## 0.3.2 — 2026-05-07

### Changed

- Update `repository.url` and `bugs` URLs in `package.json` to use the
  canonical `SharpAPI-TS` repo name (was lowercase `sharpapi-ts`,
  redirected by GitHub but worth making canonical on npm). Metadata-only
  release; no code changes.

## 0.3.1 — 2026-05-06

### Added — TeamRef metadata

`TeamRef` (and the `Team` reference-endpoint shape) gain five additional
optional fields:

- `logo` — full CDN URL. ~93% coverage.
- `city` — e.g. `"Arizona"` for the Diamondbacks.
- `mascot` — e.g. `"Diamondbacks"`.
- `conference` — e.g. `"NL"`, `"AFC"`, `"Western"`.
- `division` — e.g. `"West Division"`, `"NL East"`, `"Pacific Division"`.

All five default to `undefined` and are additive — older servers omit
them and 0.3.0 client code keeps working unchanged.

## 0.3.0 — 2026-05-06

### Added — nested refs

Every odds row, opportunity row, and reference-list row may now carry
optional structured reference objects alongside the existing flat fields.
All new fields are **optional and additive** — clients on older API
versions (or talking to older API servers) see `undefined` and behave
identically.

New interfaces:

- `TeamRef` — `{ id?, numerical_id?, name?, abbreviation? }` (latter only
  on team-sport competitors)
- `SportRef` — `{ id?, name?, numerical_id? }`
- `EntityRef` — `{ id?, label?, numerical_id? }` (used for league /
  market / sportsbook refs)
- `NestedRefs` — bundle (`home`, `away`, `sport_ref`, `league_ref`,
  `market_ref`, `sportsbook_ref`) extended onto row-shaped types
- `Market` — `{ market_type, market_label?, ..., numerical_id? }` for
  the `/markets` reference endpoint
- `Team` — `{ id, name?, sport?, league?, abbreviation?, numerical_id? }`
  for the `/teams` reference endpoint

Existing types now extend `NestedRefs`:

- `NormalizedOdds`, `EVOpportunity`, `ArbitrageOpportunity`,
  `MiddleOpportunity`
- `Event` extends a subset (`home`, `away`, `sport_ref`, `league_ref` —
  no per-book / per-market refs on the event row itself)

New optional fields on existing types:

- `ArbitrageLeg` — `sportsbook_ref?: EntityRef`
- `ClosingOdd` — `market_ref?: EntityRef`, `sportsbook_ref?: EntityRef`
- `ClosingSnapshot` — `home?`, `away?`, `sport_ref?`, `league_ref?`
- `Sport`, `League`, `Sportsbook` — `numerical_id?: number`

New typed shape:

- `LowHoldOpportunity` — was previously untyped. Now a typed interface
  so nested refs surface alongside the flat fields.

### Backward compatibility

No existing field was renamed, retyped, or removed. Code that does not
reference the new properties continues to compile without changes.
