# Manual Test Plan: Comment Ingestion (Phase 1)

## Prerequisites

1. Run migration: `DATABASE_URL=... npm run migrate`
2. Start dev server: `npm run dev`
3. Be logged in as a user with an org

---

## 1. curl: POST /api/opportunities/:id/ingest-comments

Replace `OPP_PUBLIC_ID` with a real opportunity public ID from your DB. Replace `SESSION_COOKIE` with your auth cookie if using cookie-based auth.

```bash
curl -X POST "http://localhost:3000/api/opportunities/OPP_PUBLIC_ID/ingest-comments" \
  -H "Content-Type: application/json" \
  -H "Cookie: SESSION_COOKIE" \
  -d '{"sourceType":"manual","rawText":"Met with CFO. Budget approved for Q2. Champion is Sarah in IT. Competition: incumbent vendor. Close target: March 15."}'
```

Expected: `{"ok":true,"extracted":{...}}` with summary, meddpicc, risk_flags, next_steps, follow_up_questions, extraction_confidence.

---

## 2. Excel Upload Path

1. Create an Excel file with columns: `crm_opp_id`, `comments` (or `notes`)
2. Add rows: each row = one opportunity (crm_opp_id must match an existing opportunity in your org) + comments text
3. Go to **Admin → Ingest Comments** (nav link)
4. Select the file, click **Upload & Ingest**
5. Verify: table shows per-row success/failure; counts show total, OK, errors

---

## 3. UI Click Path (Paste Notes on Deal Review)

1. Go to an opportunity's deal review page: `/opportunities/[id]/deal-review`
2. Scroll to the **Paste Notes** panel (between Risk Summary/Next Steps and the category tiles)
3. Paste CRM notes into the textarea
4. Click **Analyze Notes**
5. Verify: summary, risk flags, next steps, and top follow-up questions appear below

---

## 4. Unit Tests

```bash
cd web && npm run test
```

All 11 tests should pass, including 8 for comment ingestion parser/validator.
