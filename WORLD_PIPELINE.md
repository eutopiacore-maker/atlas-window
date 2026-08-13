# Atlas World Reconstruction Pipeline

This repository is the public, read-only rendering window. It must never contain Atlas Core credentials, private memory, unrestricted write APIs, or private source material.

## World representation

Atlas treats a place as a persistent spatial memory cell, not as a hand-built scene:

`coordinates + terrain + structures + imagery + semantics + time + provenance`

## Source priority

1. Official Panamanian geospatial services (IGN Tommy Guardia / ANATI and competent agencies).
2. Licensed Google Maps Platform runtime data when a restricted API key and billing are available.
3. Open global terrain / Earth-observation sources (for example Copernicus DEM) where appropriate.
4. Public imagery only when its license allows the intended use and attribution.

Google Street View imagery must not be scraped, prefetched, indexed, or persistently cached outside the allowances of Google Maps Platform. Google Photorealistic 3D Tiles are requested at runtime and attribution must remain visible.

## Rendering strategy

- Preferred: Google Photorealistic 3D Tiles + compliant renderer when coverage and credentials exist.
- Fallback: image-driven spatial projection anchored to verified geospatial coordinates, using stable master imagery and continuous parallax / lighting / environmental simulation.
- No invented building geometry is allowed to be promoted as verified reality.

## Cell rollout

Penonomé is the pilot cell. A cell graduates only when:

- coordinates and administrative identity are verified;
- source provenance is stored;
- the renderer remains stable on iPhone;
- public/private boundaries are enforced;
- visual fallback and geospatial mode share the same world-cell identity;
- missing data is represented as unknown rather than fabricated.

Once the pipeline is validated, new cells can be added by data, not by rewriting the engine.
