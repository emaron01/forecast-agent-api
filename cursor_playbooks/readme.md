Cursor Playbooks — README
This folder contains deterministic, step‑based instructions for Cursor.
Each playbook defines a multi‑step workflow with strict constraints to prevent:

Schema drift

Field invention

Unapproved table modifications

Unapproved code rewrites

Creativity or assumptions

Cross‑step contamination

Cursor must follow these playbooks exactly, step‑by‑step.

🔒 Rules for Cursor (Non‑Negotiable)
Cursor must:

Always consult the playbook before generating code.

Never modify existing tables unless explicitly instructed.

Never invent fields, rename fields, or add fields not listed.

Never combine steps — each step is isolated.

Never generate UI, models, or migrations unless the step explicitly requires it.

Never rewrite ingestion logic, identity logic, or hybrid ID logic.

Never “helpfully” optimize or refactor unrelated code.

Always use the canonical schema provided in each step.

Always use parameterized SQL.

Always produce deterministic, typed, validated output.

These rules ensure Cursor behaves predictably and safely.

📁 Playbooks Included
1. quota_system_playbook.md
A complete, unbreakable, multi‑step workflow for implementing:

Fiscal calendar (quota_periods)

Quotas (rep, manager, VP, CRO)

Roll‑ups (rep → manager → VP → CRO)

Quarterly + annual attainment

Carry‑forward logic

Admin UI

Forecasting comparisons (CRM vs AI vs Quota)

This playbook is designed to be executed in order, one step at a time.

🧱 How to Use a Playbook
Step 1 — Open Cursor
Open the repo in Cursor.

Step 2 — Copy the prompt for the step you’re working on
Each step has its own prompt.

Step 3 — Paste the prompt into Cursor
Paste the entire step prompt, including the canonical schema.

Step 4 — Let Cursor generate ONLY what the step requires
Cursor must not:

Jump ahead

Modify existing code

Add fields

Rewrite unrelated files

Step 5 — Review the diff
Ensure Cursor:

Only touched the files required

Did not modify existing tables

Did not invent fields

Did not drift

Step 6 — Commit the changes
Once the step is correct:

Code
git add .
git commit -m "Implement quota system step X"
git push origin main
Step 7 — Move to the next step
Repeat the process.

🧠 Why This Folder Exists
This folder is your source of truth for how Cursor must behave.

It ensures:

Deterministic output

No hallucinations

No schema drift

No accidental rewrites

No creativity

No surprises

It also ensures future developers understand:

How to safely use Cursor

How to extend the system

How to avoid breaking ingestion, identity, or forecasting logic

🛑 If Cursor Ever Drifts
If Cursor:

Invents fields

Modifies existing tables

Tries to refactor unrelated code

Ignores the schema

Ignores the step boundaries

Stop immediately and re‑run the step prompt.

Cursor must obey the playbook.