import test from "node:test";
import assert from "node:assert/strict";

// server-only is stubbed via web/test-node-setup/server-only.cjs — see web/package.json `test` script.
import * as authModule from "../../../../../lib/auth";
import * as poolModule from "../../../../../lib/pool";
import * as dbModule from "../../../../../lib/db";

let PATCH: ((req: any) => Promise<any>) | null = null;

// Shared mutable scenario state so we don't need a full mocking framework.
let currentAuth: any = null;
let poolCallCount = 0;
let currentExistingRes: any = null;
let currentUpdateRes: any = null;
let syncShouldThrow = false;

// Monkeypatch module exports for the duration of this test file.
(authModule as any).getAuth = async () => currentAuth;

// `pool` is an exported pg Pool instance. Overriding `pool.query` is enough for these tests.
(poolModule as any).pool.query = async () => {
  poolCallCount += 1;
  if (poolCallCount === 1) return currentExistingRes;
  if (poolCallCount === 2) return currentUpdateRes;
  throw new Error(`Unexpected pool.query call #${poolCallCount}`);
};

(dbModule as any).syncRepsFromUsers = async () => {
  if (syncShouldThrow) throw new Error("syncRepsFromUsers failed");
  return { ok: true };
};

async function getPatchHandler() {
  if (PATCH) return PATCH;
  const mod = await import("./route");
  PATCH = mod.PATCH;
  return PATCH!;
}

function mkReq(body: any) {
  return { json: async () => body } as any;
}

test("Happy path — REP (no manager_user_id) -> MANAGER", async () => {
  currentAuth = { kind: "user", user: { role: "ADMIN", org_id: 1 } };
  poolCallCount = 0;
  currentExistingRes = {
    rows: [
      {
        id: 10,
        role: "REP",
        manager_user_id: null,
        admin_has_full_analytics_access: false,
        see_all_visibility: false,
        manager_role: null,
      },
    ],
  };
  currentUpdateRes = {
    rowCount: 1,
    rows: [
      {
        id: 10,
        public_id: "user-rep-10",
        role: "MANAGER",
        hierarchy_level: 2,
        manager_user_id: null,
        admin_has_full_analytics_access: false,
        see_all_visibility: false,
      },
    ],
  };
  syncShouldThrow = false;

  const patch = await getPatchHandler();
  const res = await patch(
    mkReq({
      userId: "00000000-0000-4000-8000-000000000001",
      role: "MANAGER",
      orgId: 1,
    })
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.user.role, "MANAGER");
  assert.equal(body.user.admin_has_full_analytics_access, false);
  assert.equal(body.user.see_all_visibility, false);
});

test("Happy path — REP (no manager_user_id) -> FORECAST_AGENT", async () => {
  currentAuth = { kind: "user", user: { role: "ADMIN", org_id: 1 } };
  poolCallCount = 0;
  currentExistingRes = {
    rows: [
      {
        id: 12,
        role: "REP",
        manager_user_id: null,
        admin_has_full_analytics_access: false,
        see_all_visibility: false,
        manager_role: null,
      },
    ],
  };
  currentUpdateRes = {
    rowCount: 1,
    rows: [
      {
        id: 12,
        public_id: "user-forecast-12",
        role: "FORECAST_AGENT",
        hierarchy_level: 3,
        manager_user_id: null,
        admin_has_full_analytics_access: false,
        see_all_visibility: false,
      },
    ],
  };
  syncShouldThrow = false;

  const patch = await getPatchHandler();
  const res = await patch(
    mkReq({
      userId: "00000000-0000-4000-8000-000000000003",
      role: "FORECAST_AGENT",
      orgId: 1,
    })
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.user.role, "FORECAST_AGENT");
  assert.equal(body.user.hierarchy_level, 3);
  assert.equal(body.user.admin_has_full_analytics_access, false);
  assert.equal(body.user.see_all_visibility, false);
});

test("Happy path — MANAGER (with manager_user_id) -> ADMIN clears manager_user_id", async () => {
  currentAuth = { kind: "user", user: { role: "ADMIN", org_id: 1 } };
  poolCallCount = 0;
  currentExistingRes = {
    rows: [
      {
        id: 11,
        role: "MANAGER",
        manager_user_id: 99,
        admin_has_full_analytics_access: false,
        see_all_visibility: false,
        manager_role: "EXEC_MANAGER",
      },
    ],
  };
  currentUpdateRes = {
    rowCount: 1,
    rows: [
      {
        id: 11,
        public_id: "user-mgr-11",
        role: "ADMIN",
        hierarchy_level: 0,
        manager_user_id: null,
        admin_has_full_analytics_access: true,
        see_all_visibility: true,
      },
    ],
  };
  syncShouldThrow = false;

  const patch = await getPatchHandler();
  const res = await patch(
    mkReq({
      userId: "00000000-0000-4000-8000-000000000002",
      role: "ADMIN",
      orgId: 1,
    })
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.user.role, "ADMIN");
  assert.equal(body.user.manager_user_id, null);
  assert.equal(body.user.admin_has_full_analytics_access, true);
  assert.equal(body.user.see_all_visibility, true);
});

test("Validation failure — incompatible manager_user_id (REP manager) rejects MANAGER promotion", async () => {
  currentAuth = { kind: "user", user: { role: "ADMIN", org_id: 1 } };
  poolCallCount = 0;
  currentExistingRes = {
    rows: [
      {
        id: 12,
        role: "REP",
        manager_user_id: 55,
        admin_has_full_analytics_access: false,
        see_all_visibility: false,
        manager_role: "REP",
      },
    ],
  };
  currentUpdateRes = null;
  syncShouldThrow = false;

  const patch = await getPatchHandler();
  const res = await patch(
    mkReq({
      userId: "00000000-0000-4000-8000-000000000003",
      role: "MANAGER",
      orgId: 1,
    })
  );

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(typeof body.error === "string");
  assert.ok(String(body.error).includes("invalid_manager_user_id_for_role"));
});

test("Validation failure — invalid role value returns Invalid role", async () => {
  currentAuth = { kind: "user", user: { role: "ADMIN", org_id: 1 } };
  poolCallCount = 0;
  currentExistingRes = null;
  currentUpdateRes = null;
  syncShouldThrow = false;

  const patch = await getPatchHandler();
  const res = await patch(
    mkReq({
      userId: "00000000-0000-4000-8000-000000000004",
      role: "SUPERUSER",
      orgId: 1,
    })
  );

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.deepEqual(body, { error: "Invalid role" });
});

test("Cross-org guard — ADMIN cannot write orgId override", async () => {
  currentAuth = { kind: "user", user: { role: "ADMIN", org_id: 1 } };
  poolCallCount = 0;
  currentExistingRes = null;
  currentUpdateRes = null;
  syncShouldThrow = false;

  const patch = await getPatchHandler();
  const res = await patch(
    mkReq({
      userId: "00000000-0000-4000-8000-000000000005",
      role: "REP",
      orgId: 2, // mismatch with auth.user.org_id
    })
  );

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, "forbidden_org_override");
});

test("syncRepsFromUsers failure does not fail the request", async () => {
  currentAuth = { kind: "user", user: { role: "ADMIN", org_id: 1 } };
  poolCallCount = 0;
  currentExistingRes = {
    rows: [
      {
        id: 13,
        role: "REP",
        manager_user_id: null,
        admin_has_full_analytics_access: false,
        see_all_visibility: false,
        manager_role: null,
      },
    ],
  };
  currentUpdateRes = {
    rowCount: 1,
    rows: [
      {
        id: 13,
        public_id: "user-rep-13",
        role: "MANAGER",
        hierarchy_level: 2,
        manager_user_id: null,
        admin_has_full_analytics_access: false,
        see_all_visibility: false,
      },
    ],
  };
  syncShouldThrow = true;

  const patch = await getPatchHandler();
  const res = await patch(
    mkReq({
      userId: "00000000-0000-4000-8000-000000000006",
      role: "MANAGER",
      orgId: 1,
    })
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.user.role, "MANAGER");
});

