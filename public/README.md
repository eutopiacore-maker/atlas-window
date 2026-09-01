# ATLAS // Public Instruments

Concrete, zero-spend tools for observing real systems without blurring evidence into interpretation.

## Street Shade Audit v0.1

Treats shade as pedestrian infrastructure and preserves the boundary between what was observed, what was directly derived, what is only inferred, and what remains unknown.

- **Protocol:** [`ATLAS_SHADE_AUDIT_v0.1.md`](./ATLAS_SHADE_AUDIT_v0.1.md)
- **Offline field recorder:** [`ATLAS_SHADE_FIELD_RECORDER_v0.1.html`](./ATLAS_SHADE_FIELD_RECORDER_v0.1.html)
- **Field template:** [`ATLAS_SHADE_AUDIT_TEMPLATE_v0.1.csv`](./ATLAS_SHADE_AUDIT_TEMPLATE_v0.1.csv)
- **Local analyzer:** [`ATLAS_SHADE_ANALYZER_v0.1.html`](./ATLAS_SHADE_ANALYZER_v0.1.html)

### How to use

1. Follow the sampling method declared in the protocol; do not silently mix fixed-distance and decision-point sampling.
2. Record observations with the offline HTML recorder, or fill the CSV template manually. The recorder requires no server and makes coordinates optional.
3. Export the observations as CSV. Review the file before publishing it, especially if it contains coordinates.
4. Download/open the HTML analyzer in any modern browser and load the CSV locally. No upload or external service is required.
5. Publish the raw observations with the derived summary if you make a public claim.

### Evidence contract

ATLAS public instruments separate four layers:

- **Observed** — direct field records.
- **Derived** — calculations reproducible from those records.
- **Inferred** — hypotheses that need separate validation.
- **Unknown** — important variables not measured.

A polished visualization does not upgrade an inference into a fact.

---

**ATLAS** — observe → distinguish evidence from inference → intervene → measure again.
