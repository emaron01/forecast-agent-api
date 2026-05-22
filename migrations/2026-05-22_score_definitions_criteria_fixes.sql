-- Score definitions criteria fixes
-- Fixes 4 rubric criteria that cause systematic under-scoring:
-- 1. Pain 3: "quantified" was too narrow — excluded regulatory/compliance consequences
-- 2. Metrics 3: no contract exception — signed contracts are buyer validation
-- 3. Metrics 1: floor too low — allowed pure vague-value statements at score 1
-- 4. Criteria 3: rep-assertion framing — no buyer confirmation test
UPDATE score_definitions
SET criteria = 'Pain is quantified with a high cost of doing nothing. Quantified impact includes: a specific dollar amount or financial exposure, a named regulatory or compliance consequence (e.g. audit failure, fines, operational shutdown), an explicit operational or data risk stated by rep or buyer, or a contractual obligation with a stated consequence of non-compliance. A timeline, project milestone, or "they want to get it done by X" alone does not qualify.'
WHERE category = 'pain' AND score = 3;
UPDATE score_definitions
SET criteria = 'Customer has validated the economic impact and ROI. Validation includes: (a) a named buyer contact who confirmed specific ROI figures or economic impact, OR (b) a signed contract, MSA, or multi-year agreement predicated on economic impact, compliance requirement, cost avoidance, or operational SLA — a signed contract IS buyer validation and does not require a separate named-person confirmation. Rep-estimated ROI without buyer validation or contract = score 2 max.'
WHERE category = 'metrics' AND score = 3;
UPDATE score_definitions
SET criteria = 'Rep asserts metrics or ROI matter but provides no specific figures, no buyer validation, and no contract reference. Score 1 requires at minimum a description of what the buyer tracks or measures — a named KPI, process, or outcome area. Pure vague-value acknowledgment with no content ("they care about ROI", "metrics are important", "they want to see value") = score 0, not score 1.'
WHERE category = 'metrics' AND score = 1;
UPDATE score_definitions
SET criteria = 'Criteria are confirmed in our favor by the buying team — not rep-asserted. Buyer has explicitly confirmed evaluation criteria favor our solution, OR criteria were formally evaluated and locked at contract signing (signing constitutes buyer confirmation). Rep belief that criteria favor us without buyer confirmation or contract = score 2 max.'
WHERE category = 'criteria' AND score = 3;
-- Verify
SELECT category, score, label, criteria
FROM score_definitions
WHERE (category = 'pain' AND score = 3)
OR (category = 'metrics' AND score IN (1, 3))
OR (category = 'criteria' AND score = 3)
ORDER BY category, score;
