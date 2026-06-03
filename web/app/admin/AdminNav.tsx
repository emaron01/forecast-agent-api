"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminHelpSearch } from "../_components/HelpSearchDropdown";

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2 py-1.5 text-[13px] font-medium text-[color:var(--sf-nav-text)] hover:bg-[color:var(--sf-surface-alt)] hover:text-[color:var(--sf-nav-hover)]"
    >
      {label}
    </Link>
  );
}

export function AdminNav({
  isMaster,
  isSalesLeader,
  isAdminUser,
  hasQuotaSetupAccess,
}: {
  isMaster: boolean;
  isSalesLeader: boolean;
  isAdminUser: boolean;
  hasQuotaSetupAccess: boolean;
}) {
  const pathname = usePathname();
  const hideAnalyticsAndHygiene = pathname === "/admin";

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {isMaster ? (
        <>
          <NavLink href="/admin/control-center" label="Control Center" />
          <NavLink href="/admin/organizations" label="Organizations" />
          <NavLink href="/admin/integrations" label="Integrations" />
          <NavLink href="/admin/all-users" label="All Users" />
          <NavLink href="/admin/email-templates" label="Email Templates" />
          <NavLink href="/admin/ingestion" label="Ingestion" />
          <NavLink href="/admin/ingestion-health" label="Ingestion Health" />
          <NavLink href="/admin/health" label="Health" />
        </>
      ) : null}
      <NavLink href="/admin/users" label="Users" />
      <NavLink href="/admin/integrations/hubspot" label="HubSpot" />
      <NavLink href="/admin/integrations/salesforce" label="Salesforce" />
      <NavLink href="/admin/excel-opportunities" label="Excel Upload" />
      <NavLink href="/admin/ingest-comments" label="Ingest Comments" />
      {isSalesLeader ? (
        <NavLink href="/admin/hierarchy" label="Sales Organization" />
      ) : (
        <>
          <NavLink href="/admin/org-profile" label="Org Profile" />
          {isAdminUser ? (
            <>
              <NavLink href="/admin/stage-mapping" label="Stage Mapping" />
              <NavLink href="/admin/ingestion-health" label="Ingestion Health" />
            </>
          ) : null}
          <NavLink href="/admin/hierarchy" label="Sales Organization" />
          <NavLink href="/admin/channel-alignment" label="Channel Alignment" />
          <NavLink href="/admin/partner-assignments" label="Partner Assignments" />
          {isMaster ? <NavLink href="/admin/mapping-sets" label="Mapping Sets" /> : null}
          {hasQuotaSetupAccess ? (
            <>
              {!hideAnalyticsAndHygiene ? <NavLink href="/admin/analytics" label="Analytics" /> : null}
              <NavLink href="/admin/analytics/quota-periods" label="Quota Periods" />
              <NavLink href="/admin/analytics/quotas" label="Quotas" />
              {!hideAnalyticsAndHygiene ? (
                <NavLink href="/dashboard/executive?tab=forecast" label="Forecast Hygiene" />
              ) : null}
            </>
          ) : null}
        </>
      )}
      <AdminHelpSearch />
    </nav>
  );
}
