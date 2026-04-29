# Product Requirements Document — IronSight MVP

## 1. Product Summary
- IronSight is an internal B2B sales pipeline system for tracking accounts, deals, interactions, next steps, manager coaching signals, and pipeline health.
- The system is interaction-driven. Sales progress is inferred from logged activity rather than manually edited stage fields.
- The current system includes:
  - Account request, approval, assignment, import, and search flows.
  - Deal creation against approved assigned accounts.
  - Structured interaction logging.
  - Derived pipeline stages.
  - Momentum and Today prioritization.
  - Deal expiry after long inactivity.
  - Product filtering in deal and pipeline views.
  - Role-based data access for administrators, managers, and representatives.

## 2. System Philosophy
- The system is designed to enforce consistent sales execution rather than passively track deals.
- Key principles:
  - **No passive pipeline:** Deals without activity are automatically expired after 45 days.
  - **No manual progression:** Pipeline stage is derived only from interaction logs.
  - **No hidden work:** Deals must have a defined next step to remain actionable.
  - **Single source of truth:** All endpoints reflect the same deal state, including expiry.
  - **Behavior over data entry:** The system prioritizes real activity over manual updates.

## 3. Daily Workflow (Representative)
1. Open Today view at the start of the day.
2. Work all **CRITICAL** deals first.
3. Then work **ATTENTION** deals.
4. For each action taken, log an interaction immediately.
5. Always define a next step with a date.
6. Ensure no deal is left without recent activity.
7. Monitor deals approaching expiry and act before 45 days.

## 4. Common Mistakes To Avoid
- Logging interactions without defining next steps.
- Allowing deals to sit without updates.
- Attempting to bypass stage progression without required outcomes.
- Treating the system as a reporting tool instead of an execution tool.

## 5. System Guarantees
- A deal always has exactly one derived stage.
- **Stage cannot be manually overridden.**
- Expired deals are consistently excluded from active views.
- Access control is enforced at API level for all endpoints.

## 6. Technology And Runtime
- Application framework: Next.js App Router with React and TypeScript.
- Database access: Prisma.
- Production schema: `prisma/schema.prisma`.
- Test schema: `prisma/schema.test.prisma`.
- Production database provider: PostgreSQL.
- Test database provider: SQLite.
- Runtime Prisma client: `lib/prisma.ts`.
- Test Prisma client: `lib/test-prisma.ts`.
- Tests use real SQLite database operations and do not mock Prisma.

## 7. Core Roles
- **ADMIN**
  - Sees all users, accounts, and deals.
  - Can approve, reject, and assign accounts.
  - Can manage users.
  - Can view global pipeline totals and manager breakdown.
- **MANAGER**
  - Sees own assigned deals and direct-report representative deals.
  - Can view manager Today summaries and direct-report drilldowns.
  - Can view team pipeline.
- **REP**
  - Sees only own assigned accounts and deals.
  - Can create deals only on approved accounts assigned to self.
  - Can log interactions only on deals whose account is assigned to self.

## 8. Access Control
- Access is enforced through `buildDealWhere()` and related access helpers.
- Deal list and pipeline APIs scope data by account assignment.
- Scope rules:
  - **ADMIN**: unrestricted deal visibility.
  - **MANAGER**: manager user plus direct-report representative users.
  - **REP**: current representative only.
- Direct deal access uses account assignment checks.
- Out-of-scope deal access returns forbidden responses.
- Unauthenticated API access returns unauthorized responses.

## 9. Data Model Decisions
- There is no manual stage field on `Deal`.
- There is no separate product field on `Deal`.
- `Deal.name` stores the selected product.
- `Deal.status` stores lifecycle status:
  - `ACTIVE`
  - `EXPIRED`
- Stage and lifecycle are separate concepts:
  - Stage describes sales progress.
  - Status describes active versus expired lifecycle.
- Expiry does not create a new stage.
- Expiry does not convert deals to `LOST`.
- There is no background expiry job yet.
- Expiry is enforced on read.

## 10. Product System
- Product is stored in `Deal.name`.
- Allowed product values come from `PRODUCT_OPTIONS`.
- Allowed values:
  - Geneo ONE
  - Geneo EDGE
  - Geneo IL
  - Geneo Touch
  - Geneo Test Prep
- **Product validation is strict.**
- Invalid product names are rejected.
- Product filtering uses exact equality:
  - `deal.name === selectedProduct`
- Product filtering does not use fuzzy matching.
- Product filtering does not use partial matching.

### Design Tradeoff
- Product is stored in `Deal.name` instead of a dedicated field.
- Implication:
  - Prevents custom deal naming.
  - Limits flexibility for multi-product or bundled deals.
- Reason:
  - Simplifies validation and filtering for the minimum viable product.
- Future direction:
  - Introduce a dedicated product field while allowing flexible deal naming.

## 11. Pipeline Logic
- Pipeline stages are:
  - `ACCESS`
  - `QUALIFIED`
  - `EVALUATION`
  - `COMMITTED`
  - `CLOSED`
  - `LOST`
- Normal progression is:
  - `ACCESS` → `QUALIFIED` → `EVALUATION` → `COMMITTED` → `CLOSED`
- Loss progression is:
  - `ACCESS` → `QUALIFIED` → `EVALUATION` → `COMMITTED` → `LOST`
- **Stage is derived only from interaction logs.**
- **There is no manual stage override.**
- Stage is recalculated from logged outcomes whenever a stage-dependent endpoint reads the deal.
- Duplicate logs do not corrupt stage because stage is computed from outcome presence, not raw count.
- Out-of-order logs do not incorrectly regress stage because stage is derived from the set of outcomes, not timestamp order.

### Example
- A representative creates a new deal.
- No qualifying outcomes exist yet.
- The deal appears in `ACCESS`.
- After the representative logs `MET_DECISION_MAKER` and `BUDGET_DISCUSSED`, the deal appears in `QUALIFIED`.

## 12. Stage Rules
- `ACCESS`
  - Default stage when no higher-stage signal is present.
- `QUALIFIED`
  - Requires:
    - `MET_DECISION_MAKER`
    - `BUDGET_DISCUSSED`
- `EVALUATION`
  - Any of these outcomes can move a deal into evaluation:
    - `DEMO_DONE`
    - `PRICING_REQUESTED`
    - `PROPOSAL_SHARED`
    - `BUDGET_CONFIRMED`
    - `NEGOTIATION_STARTED`
- `COMMITTED`
  - Requires:
    - `MET_DECISION_MAKER`
    - `BUDGET_DISCUSSED`
    - `PROPOSAL_SHARED`
    - `DEAL_CONFIRMED`
- `CLOSED`
  - Requires:
    - `DEAL_CONFIRMED`
    - `PO_RECEIVED`
- `LOST`
  - Triggered by:
    - `LOST_TO_COMPETITOR`
    - `DEAL_DROPPED`

### Example
- A deal with `PROPOSAL_SHARED` is `EVALUATION`.
- If the same deal later receives `MET_DECISION_MAKER`, `BUDGET_DISCUSSED`, and `DEAL_CONFIRMED`, it becomes `COMMITTED`.
- If `PO_RECEIVED` is then logged, it becomes `CLOSED`.

## 13. Interaction-Driven System
- **All stage movement happens through interaction logs.**
- Representatives do not manually choose pipeline stage.
- Interaction logs include:
  - Interaction type.
  - Outcome.
  - Stakeholder type.
  - Risk categories.
  - Notes.
  - Next step information.
- Outcomes drive stage progression.
- Risk rules depend on the resulting stage after the new interaction.
- Interaction logging updates:
  - `lastActivityAt`
  - `nextStepType`
  - `nextStepDate`
  - `nextStepSource`
- Interaction logging can revive expired deals.

### Example
- A representative cannot drag a deal from `ACCESS` to `COMMITTED`.
- The representative must log the required outcomes.
- The system then derives the new stage from those logged outcomes.

## 14. Momentum System
- Momentum is calculated when the system reads deals and is used to decide what users should work on first.
- Momentum is not stored as a database field.
- Momentum is based on:
  - `lastActivityAt`
  - latest interaction timestamp when logs exist
  - `nextStepDate`
  - recent outcome context
- Momentum states:
  - `ON_TRACK`
  - `AT_RISK`
  - `STALE`
  - `CRITICAL`

## 15. Momentum Definitions
- **ON_TRACK**
  - Deal has recent activity.
  - Next step is not overdue.
  - No recent outcome pattern indicates risk.
- **AT_RISK**
  - Deal has a risk-prone recent outcome and enough time has passed without follow-up.
  - Examples include proposal, demo, or negotiation activity without timely follow-up.
- **STALE**
  - Deal has 7 or more days of inactivity.
  - Deal is not yet critical.
- **CRITICAL**
  - Deal has 10 or more days of inactivity.
  - Or next step is overdue.

## 16. Today View Logic
- Today is the prioritization view for reps and managers.
- Today uses active, non-expired deals only.
- Today requires `nextStepDate` to be present.
- Deals without `nextStepDate` do not appear in Today buckets.
- Today excludes terminal deals:
  - Closed deals.
  - Lost deals.
- Today buckets:
  - `critical`
  - `attention`
  - `upcoming`
- `critical`
  - Includes deals with `CRITICAL` momentum.
  - Includes overdue next steps and long inactivity.
- `attention`
  - Includes deals with `STALE` or `AT_RISK` momentum.
- `upcoming`
  - Includes active deals with near-term next steps.
  - Used for planned follow-up execution.
- Managers see:
  - Rep summaries.
  - Rep color states.
  - Selected-rep drilldown.
- Rep color states:
  - Red when critical work exists.
  - Yellow when stale or attention work exists.
  - Green when no urgent issues exist.

### Behavioral Risk
- Deals without `nextStepDate` are excluded from Today.
- Implication:
  - If a representative fails to set a next step, the deal may disappear from their active work view.
- Mitigation:
  - Interaction logging is expected to always include next step definition.
  - Missing signals and coaching should surface this gap.
- Future enforcement:
  - Deals without `nextStepDate` may be flagged or restricted from further progression.

## 17. Expiry System
- Purpose:
  - Expiry ensures that pipeline reflects only actively worked deals.
  - It prevents inflated pipeline and forces continuous engagement.
- Expiry controls whether a deal is active work. It does not describe sales progress.
- Rule:
  - 45 days of inactivity means `Deal.status = EXPIRED`.
- Inactivity is based on `lastActivityAt`.
- **Expiry is automatically enforced.**
- **Expiry is persisted in the database.**
- **Expiry is applied across read endpoints.**
- **Expiry is triggered on read.**
- There is no scheduled background job yet.
- Expiry enforcement is idempotent:
  - Repeated reads do not create duplicate side effects.
  - Already expired deals are not repeatedly updated.
- Expired deals are removed from active pipeline, active deal lists, and Today worklists.
- Expired deals can still be listed through the expired deals endpoint and expired deals UI.

### Design Tradeoff
- Expiry is currently enforced on read rather than through a background job.
- Implication:
  - A deal may remain marked `ACTIVE` in storage until it is accessed by a read endpoint.
- Reason:
  - Simplifies system design at current scale.
  - Ensures expiry is always applied before user-facing responses.
- Future direction:
  - A scheduled background process may be introduced to proactively mark deals as expired.

## 18. Expiry Enforcement
- Shared expiry behavior lives in `lib/expiry.ts`.
- `enforceExpiry()`:
  - Reads deal `lastActivityAt`.
  - Detects deals inactive for 45 or more days.
  - Updates only deals whose status is not already `EXPIRED`.
  - Returns deal objects with expired status reflected.
- `getActiveDeals()`:
  - Keeps only `ACTIVE` deals that are not read-time expired.
- Read endpoints enforce expiry before returning active deal data.

## 19. Resurrection Logic
- **Adding a new interaction revives an expired deal.**
- On successful interaction logging:
  - `status` becomes `ACTIVE`.
  - `lastActivityAt` is updated to current time.
  - Next step fields are updated.
  - Stage remains derived from interaction logs.
  - Stage is recalculated by stage-reading endpoints.
- Resurrection is only triggered by logging an interaction.
- There is no direct status edit button.
- There is no manual revive button.

## 20. Product Filtering
- Product filtering is available in the pipeline UI.
- Product filtering uses `Deal.name`.
- Product filtering sends a product query parameter to APIs.
- Filtering is strict:
  - `deal.name === selectedProduct`
- Product filtering works with:
  - Stage filters.
  - Owner filters.
  - Manager scope.
  - Unassigned filters where supported.
- Empty product filter means all products.
- Invalid product query values return a bad request response.

## 21. Pipeline API Behavior
- `GET /api/pipeline`
  - Authenticated.
  - Scoped through `buildDealWhere()`.
  - Enforces expiry before response.
  - Excludes expired deals from active totals.
  - Returns count and value by active pipeline stage.
  - Supports outcome summaries for `CLOSED` and `LOST`.
  - Supports manager rep breakdown for managers.
  - Supports product filtering.
- `GET /api/pipeline/manager-breakdown`
  - Administrator only.
  - Enforces expiry before response.
  - Groups pipeline by manager ownership tree.
  - Includes unassigned bucket.
  - Supports product filtering.

## 22. Deals API Behavior
- `GET /api/deals`
  - Authenticated.
  - Scoped through `buildDealWhere()`.
  - Enforces expiry before response.
  - Returns active non-expired deals.
  - Enriches each deal with:
    - Stage.
    - Missing signals.
    - Momentum status.
    - Expiry warning.
    - Days to expiry.
    - Priority score.
  - Supports filters:
    - Stage.
    - Multiple stages.
    - Owner.
    - Manager.
    - Unassigned.
    - Product.
- `GET /api/deals/:id`
  - Enforces expiry on the fetched deal.
  - Enforces access control.
  - Returns deal detail, logs, stage, missing signals, and expiry warning.
- `POST /api/deals`
  - Requires valid product.
  - Requires approved assigned account.
  - Requires current user to be assigned to the account.
  - Creates deal as `ACTIVE`.
- `GET /api/deals/expired`
  - Enforces expiry before listing expired deals.
  - Returns scoped expired deals.
  - Includes days since last activity.

## 23. Today API Behavior
- `GET /api/today`
  - Authenticated.
  - Scoped through `buildDealWhere()`.
  - Enforces expiry before response.
  - Excludes expired deals.
  - Excludes deals with missing `nextStepDate`.
- Returns:
    - Representative mode for reps and administrators.
    - Manager mode for managers.
- Expiring soon deals keep their classification bucket.
- Expiring soon deals override displayed message:
  - Reason: `Deal nearing expiry due to inactivity`
  - Action: `Take action before deal expires`

## 24. Manager Insights Behavior
- `GET /api/manager/insights`
  - Administrator or manager only.
  - Scoped through `buildDealWhere()`.
  - Enforces expiry before response.
  - Returns:
    - At-risk deals.
    - Rep health.
    - Suggested interventions.
    - Expired deals summary.
    - Expiring soon deals summary.
- Expired deals summary includes:
  - Total expired deals.
  - Total expired value.
  - Rep-wise expired counts and value.
- Expiring soon summary includes:
  - Total expiring soon deals.
  - Total value.
  - Rep-wise counts and value.

## 25. Missing Signals
- Missing signals are computed from interaction outcomes.
- Signals include:
  - Missing decision maker.
  - Missing budget discussion.
  - Missing proposal.
  - No recent activity.
- Missing signals are read-time helpers.
- Missing signals do not change stage by themselves.

## 26. Account Rules
- Deals can be created only on approved accounts.
- Deals can be created only when the account is assigned.
- Representatives can create deals only for accounts assigned to themselves.
- Managers and administrators cannot bypass assigned-user restrictions for deal creation.
- Account assignment is the main ownership boundary for active work.

## 27. Key Endpoints
- `/api/deals`
  - Deal list and deal creation.
  - Expiry enforced before returning deal list.
- `/api/deals/:id`
  - Deal detail, update, delete.
  - Expiry enforced on read.
- `/api/deals/:id/stage`
  - Derived stage read.
  - Expiry enforced on deal read.
- `/api/deals/:id/missing-signals`
  - Missing sales signals.
  - Expiry enforced on deal read.
- `/api/deals/expired`
  - Expired deal list.
  - Expiry enforced before listing.
- `/api/logs`
  - Interaction creation.
  - Revives expired deals.
- `/api/logs/:dealId`
  - Interaction history.
  - Expiry enforced on deal read.
- `/api/pipeline`
  - Pipeline totals and manager rep breakdown.
  - Expiry enforced before response.
- `/api/pipeline/manager-breakdown`
  - Administrator manager breakdown.
  - Expiry enforced before response.
- `/api/today`
  - Rep and manager Today prioritization.
  - Expiry enforced before response.
- `/api/manager/insights`
  - Manager coaching and pipeline leakage insights.
  - Expiry enforced before response.
- `/api/export`
  - CSV export.
  - Expiry enforced before export rows are produced.

## 28. Edge Cases Handled
- Out-of-order interaction logs:
  - Stage does not regress incorrectly.
- Duplicate interaction logs:
  - Stage is not inflated or corrupted.
- Missing `nextStepDate`:
  - Deal is excluded from Today buckets.
  - Today API still returns successfully.
- 44-day inactivity:
  - Deal remains `ACTIVE`.
  - Deal can show expiring soon warning.
- 45-day inactivity:
  - Deal becomes `EXPIRED`.
  - Deal is excluded from active worklists.
- Access isolation:
  - Representatives cannot read other representatives’ deals.
  - Managers cannot read outside their team.
  - Administrators can read all.
- Product filtering:
  - Exact product matching only.
  - Invalid product filters return bad request.

## 29. Testing Requirements
- Tests use SQLite through `lib/test-prisma.ts`.
- Tests use real database operations.
- Prisma is not mocked.
- Core flow tests cover:
  - Deal creation.
  - Stage progression.
  - Expiry.
  - Resurrection.
  - Product filtering.
  - Today classification.
  - Access control.
- Dirty scenario tests cover:
  - Out-of-order logs.
  - Duplicate logs.
  - Missing next step date.
  - Expiry persistence through non-deal-list endpoints.
  - 44-day and 45-day expiry boundary.


## 30. Performance Considerations
- Expiry enforcement may trigger database updates during read operations.
- At current scale, this is acceptable and ensures correctness.
- At larger scale, expiry enforcement may need to be moved to a background job.
- Repeated expiry checks are idempotent and only update when necessary.

## 31. Explicit Non-Goals
- No manual stage editing.
- No separate product column.
- No background expiry worker yet.
- No direct revive button.
- No fuzzy product search in pipeline filtering.
- No conversion of expired deals into lost deals.

## 32. Current Known Operational Notes
- Expiry is read-triggered, so a stale active deal becomes expired when a read endpoint touches it.
- If no read endpoint touches a stale deal, it can remain `ACTIVE` in storage until the next read.
- Browser pages may not block every route before loading.
- API-level access control is the source of truth for data access.
- Interaction logging is the only supported reactivation path for expired deals.


## 33. Future Evolution
- The following improvements are expected as the system scales:
  - Background expiry job to proactively mark inactive deals as expired.
  - Dedicated product field separate from deal name.
  - Enhanced analytics and reporting layer across stage, product, and expiry.
  - Improved enforcement of next step completeness.
  - Performance optimization for high-frequency read endpoints.

---

This document reflects the current implemented system behavior in the repository.
