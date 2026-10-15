# FVIS Documentation Index

Phase 0 — Foundation and Architecture. Governance: [`../CLAUDE.md`](../CLAUDE.md).

| # | Document | Purpose |
|---|---|---|
| 00 | [Repository audit](00-repository-audit.md) | Verified starting state of the repository |
| 01 | [Product specification](01-product-specification.md) | What FVIS does and does not do |
| 02 | [Architecture](02-architecture.md) | Modules, data flows, runtime topology |
| 03 | [Technology decisions](03-technology-decisions.md) | ADR log (approved / candidate / proposed) |
| 04 | [Quantitative model specification](04-quantitative-model-spec.md) | Independent Poisson baseline, markets, EV |
| 05 | [Data dictionary](05-data-dictionary.md) | Persisted entities and fields |
| 06 | [Risk and eligibility policy](06-risk-policy.md) | Statuses and gates |
| 07 | [Security policy](07-security-policy.md) | Access control, secrets, input validation |
| 08 | [Source register](08-source-register.md) | External claims and their verification status |
| 09 | [Operational constraints](09-operational-constraints.md) | Free-tier limits, quotas, failure recovery |
| 10 | [Implementation roadmap](10-implementation-roadmap.md) | Phases 1–6 and deliverables |
| 11 | [Acceptance criteria](11-acceptance-criteria.md) | Exit criteria per phase |
| 12 | [Validation plan](12-validation-plan.md) | Model evaluation methodology |
| 13 | [Open decisions](13-open-decisions.md) | Decisions awaiting the Product Owner |

## Conventions used in all documents

- **VERIFIED** — confirmed from a primary source or from the repository itself, with date.
- **SECONDARY** — reported by a secondary or vendor-marketing source; not yet confirmed first-hand.
- **UNVERIFIED** — assumption or recollection; must be confirmed before it drives a decision.
- **RECOMMENDATION** — Claude's proposal; not binding until approved by the Product Owner.
- **APPROVED** — decided by the Product Owner (see `CLAUDE.md` §3 or `13-open-decisions.md`).

Parameter classification (from `CLAUDE.md` §5): `EMPIRICAL`, `PROVISIONAL`, `PROVIDER`, `AWAITING_VALIDATION`.
