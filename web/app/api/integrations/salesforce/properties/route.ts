import { NextResponse } from "next/server";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { verifyWritebackFields } from "../../../../../lib/salesforceClient";

export const runtime = "nodejs";

// These are the custom field API names SalesForecaster.io writes to.
// The SFDC admin must create these on the Opportunity object before writeback can be enabled.
// Field type guidance (shown in UI):
//   SF_Health_Score_Initial__c  — Number(3, 0)  — Initial Matthew health score (0–100)
//   SF_Health_Score_Current__c  — Number(3, 0)  — Current Matthew health score (0–100)
//   SF_Risk_Summary__c          — Long Text Area(32768)
//   SF_Next_Steps__c            — Long Text Area(32768)
export const REQUIRED_WRITEBACK_FIELDS = [
  "SF_Health_Score_Initial__c",
  "SF_Health_Score_Current__c",
  "SF_Risk_Summary__c",
  "SF_Next_Steps__c",
] as const;

export async function GET() {
  const auth = await getAuth();
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let orgId = 0;
  if (auth.kind === "user") {
    if (!isAdmin(auth.user)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    orgId = auth.user.org_id;
  } else {
    const mid = getMasterOrgIdFromCookies();
    if (!mid) {
      return NextResponse.json(
        { ok: false, error: "Select an active organization first." },
        { status: 400 }
      );
    }
    orgId = mid;
  }

  const result = await verifyWritebackFields(orgId, [...REQUIRED_WRITEBACK_FIELDS]);
  if (result.ok === false) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    valid: result.data.valid,
    missingFields: result.data.missingFields,
    requiredFields: REQUIRED_WRITEBACK_FIELDS,
    instructions: result.data.valid
      ? null
      : {
          message:
            "Ask your Salesforce administrator to create the following custom fields on the Opportunity object before enabling writeback.",
          fields: result.data.missingFields.map((name) => {
            const fieldGuide: Record<string, { type: string; length: string }> = {
              SF_Health_Score_Initial__c: { type: "Number", length: "3, 0" },
              SF_Health_Score_Current__c: { type: "Number", length: "3, 0" },
              SF_Risk_Summary__c: { type: "Long Text Area", length: "32768" },
              SF_Next_Steps__c: { type: "Long Text Area", length: "32768" },
            };
            return {
              api_name: name,
              type: fieldGuide[name]?.type ?? "Text",
              length: fieldGuide[name]?.length ?? "255",
            };
          }),
        },
  });
}
