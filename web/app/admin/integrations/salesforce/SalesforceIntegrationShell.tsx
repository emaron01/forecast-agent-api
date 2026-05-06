import { pool } from "../../../../lib/pool";
import { SalesforceIntegrationClient } from "./SalesforceIntegrationClient";

const REQUIRED_SF = ["deal_name", "amount", "close_date", "stage", "owner"] as const;

export async function SalesforceIntegrationShell(props: { orgId: number }) {
  const orgId = props.orgId;

  const { rows: connRows } = await pool.query(
    `
    SELECT
      sf_org_id,
      sf_domain,
      instance_url,
      sandbox,
      connected_at::text    AS connected_at,
      last_synced_at::text  AS last_synced_at,
      writeback_enabled,
      api_version
    FROM salesforce_connections
    WHERE org_id = $1
    LIMIT 1
    `,
    [orgId]
  );
  const connection = (connRows?.[0] as any) || null;

  const { rows: mapCount } = await pool.query<{ c: string }>(
    `
    SELECT COUNT(DISTINCT sf_field)::text AS c
      FROM salesforce_field_mappings
     WHERE org_id = $1
       AND sf_field = ANY($2::text[])
    `,
    [orgId, [...REQUIRED_SF]]
  );
  const mappingsComplete = Number(mapCount?.[0]?.c || 0) >= REQUIRED_SF.length;

  const { rows: syncDone } = await pool.query(
    `
    SELECT 1
      FROM salesforce_sync_log
     WHERE org_id = $1
       AND sync_type = 'initial'
       AND status = 'completed'
     LIMIT 1
    `,
    [orgId]
  );
  const initialSyncComplete = !!(syncDone || []).length;

  const { rows: savedMappings } = await pool.query(
    `
    SELECT sf_field, sfdc_api_name, confidence::text AS confidence
      FROM salesforce_field_mappings
     WHERE org_id = $1
     ORDER BY sf_field ASC
    `,
    [orgId]
  );

  return (
    <SalesforceIntegrationClient
      orgId={orgId}
      connection={connection}
      mappingsComplete={mappingsComplete}
      initialSyncComplete={initialSyncComplete}
      savedMappings={(savedMappings || []) as any[]}
    />
  );
}
