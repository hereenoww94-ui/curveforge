# CurveForge

**Configure, simulate and ship Meteora Dynamic Bonding Curve launches.**

CurveForge is a design and verification studio for DBC launches. It lets a launch team shape a
bonding curve, watch exactly what a given amount of buy pressure does to price, check the
economics at graduation, and — when satisfied — export Meteora's own `ConfigParameters`, ready to
be passed to the official SDK.

It holds no keys and never submits transactions. It is a planning tool that stops you from paying
a transaction fee for a config the program would have rejected anyway.

Built for the **Crypto World's Fair / Meteora DBC sidetrack**.

---

## What it does

| Section | What you get |
| --- | --- |
| **Curve studio** | Start price, migration price, segment count, liquidity profile, liquidity bias |
| **Live chart** | Hand-drawn SVG of quote reserve vs price (log axis), with the graduation threshold and your simulated position marked |
| **What-if simulator** | Pick any buy size, get price reached, price impact, tokens received, average price, and whether it filled |
| **Fee split** | Trading fee, protocol 20%, referral (20% of protocol), creator share, partner remainder — all as real quote amounts |
| **Graduation & migration** | Threshold, migration price, migration quote amount, creator migration fee, surplus 80/20 split, base sold vs leftover |
| **On-chain validation** | Errors for anything the program rejects, warnings for anything legal but unwise |
| **Preset library** | Six opinionated configurations, each with a written rationale |
| **Deploy payload** | Server-side call to Meteora's `buildCurveWithCustomSqrtPrices()` returning ready-to-use `ConfigParameters` |

---

## On-chain constraints it enforces

These are not stylistic choices — they come from the DBC program and the official SDK, and
CurveForge refuses to produce a config that violates them.

| Constraint | Source |
| --- | --- |
| 1–16 curve points, ascending prices, positive liquidity | [DBC Universal Curve](https://docs.meteora.ag/core-products/dbc/universal-curve) |
| Sqrt price within `[4295048016, 79226673521066979257578248091]` (Q64) ⇒ price ∈ `[2⁻⁶⁴, 2⁶⁴]` | universal-curve |
| Trading fee 25–9900 bps (`MIN_FEE_BPS` / `MAX_FEE_BPS`) | SDK constants |
| Total trading fee capped at `990,000,000 / 1e9 = 99%` | [DBC Fees](https://docs.meteora.ag/core-products/dbc/fees/overview) |
| Migration fee 0–99% | [Launch Configuration](https://docs.meteora.ag/core-products/dbc/launch-configurations) |
| Pool creation fee 0, or 0.001–100 SOL, split 10% protocol / 90% partner | launch-configurations |
| Token decimals 6–9 | launch-configurations |
| Migrated liquidity distribution sums to 100%, ≥10% locked after one day | launch-configurations |
| Curve must be able to sell enough base to reach the migration threshold | universal-curve |

### Fee numerators

On-chain fees use a denominator of `1,000,000,000`, so `2,500,000` is `0.25%` and `990,000,000`
is `99%`. CurveForge converts basis points to that numerator and displays both.

### Migrated-pool fee

Set to 100 bps (1%), inside the `0.1%–10%` band the program accepts for custom DAMM v2 fees.

---

## The preset library

Every preset targets a launch shape Meteora explicitly asked builders to explore — equity pairs,
novel curve configurations, and end-to-end launch flows — and each carries a written rationale.

| Preset | Profile | Idea it serves |
| --- | --- | --- |
| **Tokenized Equity** | `rwa` | Launch mechanics tuned for equity/stock pairs — tight band, deep liquidity, minimum legal fee |
| **Stock-Paired Launch** | `rwa` | A launchpad spinning many pairs from one template at Meteora's real 750 USDC threshold |
| **Fast Discovery** | `discovery` | Thin liquidity early so price finds its level in the first minutes |
| **Gradual Accumulation** | `accumulation` | Deep liquidity early — even entry, dump-resistant climb |
| **Long Conviction Tail** | `accumulation` | The maximum 16 ranges, weighted late — graduating takes sustained demand |
| **Flat Curve** | `uniform` | The neutral control for benchmarking any custom shape against |

Liquidity is the shaping lever: **lower liquidity in a range means price moves faster there,
higher liquidity means it moves slower.** The profile sets where liquidity sits, and the bias
slider tilts any profile toward early or late.

---

## Two thresholds, honestly reconciled

CurveForge and Meteora's SDK start from opposite ends, and the tool says so rather than papering
over it.

* **CurveForge** fixes the *migration quote threshold* (what a launch team picks — 750 USDC,
  10 SOL, 1500 JUP…) and solves for the virtual liquidity that reaches it.
* **Meteora's `buildCurveWithCustomSqrtPrices`** fixes liquidity from
  `totalSupply − vesting − leftover` and derives the threshold from the resulting curve.

The deploy payload panel reports the threshold you asked for, the fixed point both derivations
agree on, the SDK's confirming value, and the round count needed to reach it.

The gap is not caused by supply. Meteora's derivation folds in a migration-fee factor term
(`w2 = Δ√p · (100 − fee%) / pmax²`) that CurveForge's simulator does not apply, so one pass
never matches — and changing `baseSupply` leaves the SDK's number unchanged, because `leftover`
absorbs the difference. Verified empirically: supplying `10`, `9.2` or `100` all produce the same
`sdkThreshold`.

So the API iterates `T ← sdkThreshold(T)` until both sides agree (tolerance 0.5%, cap 8 rounds).
Measured on the tokenized-equity preset, threshold `750`:

```
750 -> 413.8087 -> 258.6304 -> 155.1783 -> 103.4522 -> 103.4522   (delta 1.4e-14, 5 rounds)
```

**Apply converged threshold** writes the fixed point back into the studio, after which the
simulator reflects the graduation cost the on-chain program would actually enforce. The panel
also reports the initial supply the dynamic-supply model would mint (`sellable × 1.25`, the
buffer documented on the launch-configuration page), which is a separate concern from
reconciliation.

---

## Testing

```bash
npm test     # 33 tests
```

The suite validates the math against the published formulas rather than against itself:

* every segment tiles the price axis without gaps
* total quote to complete the curve **equals** the configured threshold, for every profile
* reshaping the profile changes *where* quote is spent but **not** the graduation cost
* price starts at `startPrice` and lands exactly on `endPrice` at graduation, monotonically
* fee numerators match Meteora's `1e9` denominator exactly, including the 99% cap and the
  referral fee coming *out of* the protocol fee rather than added on top
* migration quote amount uses `ceil`, surplus splits 80/20, pool creation splits 90/10
* every preset passes on-chain validation with zero errors
* the validator rejects 17+ segments, sub-25 bps fees, non-increasing prices, migration fees over
  99%, out-of-band pool creation fees, bad decimals, and supplies too small to graduate

---

## Architecture

```
app/
  page.tsx                    the studio (client)
  api/build-config/route.ts   server-side SDK bridge
lib/dbc/
  formulas.ts                 curve math + on-chain validation
  presets.ts                  preset library with rationales
  export.ts                   CurveForge config -> SDK ConfigParameters
components/
  CurveChart.tsx              hand-written SVG chart, no chart library
  ConfigPanel.tsx             every tunable
  Simulator.tsx               what-if, fees, migration, validation
  PresetLibrary.tsx           preset cards
  DeployPayload.tsx           SDK bridge UI
tests/
  formulas.test.ts            curve + fee math
  validation.test.ts          on-chain constraint coverage
```

No chart library, no UI kit — the chart is ~200 lines of SVG so the graduation threshold,
surplus zone and simulated position can be annotated precisely.

---

## A note on reading live mainnet state

CurveForge deliberately does **not** enumerate live DBC pools. The `dynamic_bonding_curve` program
owns **2,346,792 accounts** on mainnet; a bare `getProgramAccounts` with `dataSlice: {length: 0}`
— no data at all, just addresses — took **217 seconds** against the public RPC, and
`client.state.getPools()` on the same endpoint overflows the response buffer entirely.

Every enumerator in the SDK (`getPools`, `getPoolConfigs`, `getPoolMetadata`) is a full-program
scan, so a live pool browser needs an indexed RPC or Meteora's own data infrastructure. A single
account read — `client.state.getPool(address)` — is cheap and fine; scanning is not.

The rest of the product is deliberately offline: all curve math runs locally and only the deploy
payload touches the SDK, which needs no RPC at all.

---

## Getting started

```bash
npm install
npm test
npm run build
npm start          # http://localhost:3111
```

Optional: `SOLANA_RPC_URL` if you later add address-based reads.

### Using the payload

```ts
import { Connection } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";

const client = DynamicBondingCurveClient.create(connection, "confirmed");
const tx = await client.partner.createConfig({
  config, feeClaimer, leftoverReceiver, payer, quoteMint,
  ...params,          // <- CurveForge's ConfigParameters
});
tx.feePayer = payer;
// sign with payer and the new config keypair, then send
```

---

## Docs

* [DBC Formulas](https://docs.meteora.ag/core-products/dbc/formulas)
* [DBC Universal Curve](https://docs.meteora.ag/core-products/dbc/universal-curve)
* [DBC Launch Configuration](https://docs.meteora.ag/core-products/dbc/launch-configurations)
* [DBC TS SDK Getting Started](https://docs.meteora.ag/developer-guides/dbc/typescript-sdk/getting-started)
* [DBC TS SDK Examples](https://docs.meteora.ag/developer-guides/dbc/typescript-sdk/examples)
