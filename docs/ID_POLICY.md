## ID Policy (Hybrid IDs: internal int PK + external UUID `public_id`)

### Why this exists
We keep **integer primary keys** (`id`) for internal joins and FK performance, but expose stable, non-guessable **UUID public IDs** (`public_id`) for every external surface (APIs, URLs, CRM integrations, ingestion, admin UI).

This allows a future migration to UUID primary keys without breaking external contracts.

### Glossary (read this first)
- **Internal DB key** (sometimes folks say “ID key” / “UD key”):
  - Column names: usually `id`, sometimes foreign keys like `org_id`, `user_id`, `rep_id`, etc.
  - Type: `INT` (safe in JS as `number`) or `BIGINT` (not safe in JS; we represent as **text** in TS).
  - **Rule**: never appears in URLs or JSON responses; only used inside DB helpers / joins / FKs.
- **Public UUID key** (the “UUID key”):
  - Column name: `public_id`
  - Type: `UUID` (represented as `string` in TS)
  - **Rule**: the only identifier used in any external surface (URLs, APIs, UI routing, CRM integrations).

### Golden rules
- **External surface = UUID only**
  - URLs, API params, request bodies, query params, and response payloads must use **`public_id`** (UUID strings).
  - Do **not** expose internal integer IDs to clients.
- **Internal DB work = int IDs**
  - SQL joins, FK relations, and DB helper functions continue to use integer `id`.
- **Always resolve at the boundary**
  - When you receive a UUID from outside, immediately resolve:
    - `resolvePublicId("<table>", publicId) -> number`
    - For tables with BIGINT PKs (represented as text in TS), resolve:
      - `resolvePublicTextId("<table>", publicId) -> string`
  - After resolving, enforce tenant scope (org) via normal queries (e.g. `getUserById({ orgId, userId })`).

### Naming conventions (required)
- Use `...PublicId` in variables for UUIDs (e.g. `userPublicId`, `orgPublicId`)
- Use `...Id` in variables for internal ints (e.g. `userId`, `orgId`)
- For internal BIGINTs represented as text, use `...TextId` (e.g. `mappingSetTextId`) and keep them out of external surfaces.
- In forms/server actions:
  - UUID fields are named `*_public_id` (e.g. `public_id`, `org_public_id`, `manager_user_public_id`)
- In JSON APIs:
  - UUID fields are named `*_public_id` or `public_id` in payloads

### Zod validation
- Validate UUIDs with `z.string().uuid()`
- Reject integer IDs in external schemas

### Helper: resolvePublicId
Code location: `web/lib/publicId.ts`

Use it for all external UUID inputs:

```ts
const userId = await resolvePublicId("users", userPublicId); // -> internal int
```

### Common gotchas (avoid these)
- **Do not accept numeric IDs externally** (even “temporarily”):
  - No `/:id` where `id` is numeric.
  - No query params like `?orgId=123`.
- **BIGINT tables**
  - Some tables have BIGINT primary keys (we represent them as `string` in TS).
  - You still must expose/accept only UUID `public_id` externally; resolve to text id internally via `resolvePublicTextId()`.
- **Never return “raw DB rows” from API routes**
  - DB contract types may include internal keys for internal use. API handlers must map/sanitize and return only public-safe shapes.

### Quick checklist (PR review)
- [ ] No integer `id` or `org_id` is returned in any API response
- [ ] All `/:id` route params are UUIDs (public ids)
- [ ] All server actions accept UUID inputs and resolve internally
- [ ] All UI links/forms use UUIDs, never internal ints

