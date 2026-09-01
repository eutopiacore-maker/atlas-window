# ATLAS // Street Shade Audit v0.1

**A zero-cost field protocol for measuring whether a walking route protects people from heat exposure.**

ATLAS treats shade as infrastructure: not as a decorative proxy, but as something that can be observed at the exact places and times people walk.

## What this produces

A small, auditable dataset for one walking route. It can be collected with a phone, a clock, and direct observation. No proprietary sensor or paid software is required.

## Claim / evidence boundary

This protocol records **observations**, not thermal-comfort diagnoses. A shaded point is not automatically comfortable; an unshaded point is not automatically unsafe. Air temperature, humidity, wind, surface temperature, clothing, health, duration of exposure and other variables matter.

ATLAS may use the observations to generate hypotheses or priorities, but those must remain labeled as interpretations until independently validated.

## Sampling protocol

Choose a route people actually walk. Record the route name, date, start/end time and direction. Sample at a fixed interval (recommended: every 25 m) or at every meaningful pedestrian decision point if distance measurement is unavailable. Do not silently mix methods within one route.

At each point record:

| field | allowed value / format |
|---|---|
| `route_id` | stable text ID |
| `sample_id` | integer |
| `timestamp_local` | ISO 8601 local time |
| `lat` / `lon` | decimal degrees, if available |
| `location_note` | short human-readable description |
| `walking_surface` | sidewalk / shoulder / path / crossing / other |
| `shade_present` | yes / partial / no |
| `shade_source` | tree / building / structure / mixed / none |
| `shade_covers_walking_line` | yes / partial / no |
| `crossing_wait_shade` | yes / partial / no / n-a |
| `obstruction` | none / temporary / permanent / unknown |
| `photo_ref` | filename or URL, optional |
| `observer_note` | free text |

## The useful metric

For a route with fixed-distance sampling, calculate:

`effective_shade_ratio = samples where shade_covers_walking_line = yes / total valid samples`

Report partial shade separately. Do **not** quietly count partial as full shade.

For decision-point sampling, do not present the result as a percentage of route length. Report counts instead, because the sampling geometry does not justify a distance claim.

## Time matters

Shade moves. A route audited at 08:00 has not been audited at 13:00. Every published result must display its observation window. Comparing two routes is only defensible when their sampling methods and time windows are comparable.

## Minimal CSV template

```csv
route_id,sample_id,timestamp_local,lat,lon,location_note,walking_surface,shade_present,shade_source,shade_covers_walking_line,crossing_wait_shade,obstruction,photo_ref,observer_note
```

## ATLAS publication contract

Every public result should expose four layers:

1. **Observed:** the raw field records.
2. **Derived:** calculations directly reproducible from those records.
3. **Inferred:** hypotheses such as “this segment may be a priority for shade intervention.”
4. **Unknown:** important variables not measured.

Never collapse those four layers into one confident-looking map.

## Suggested first intervention test

If an audit identifies a repeatedly unshaded pedestrian segment, create a before/after comparison only after a real intervention exists. Repeat the same sampling method in a comparable time window. Publish both datasets, including results that fail to improve.

---

**ATLAS** — observe → distinguish evidence from inference → intervene → measure again.

Version: 0.1 · 2026-09-01 · ZERO SPEND
