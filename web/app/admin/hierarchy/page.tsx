import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "../../../lib/auth";
import { listUsers } from "../../../lib/db";

export const runtime = "nodejs";

type Node = {
  id: number;
  label: string;
  children: Node[];
};

function buildTree(users: Awaited<ReturnType<typeof listUsers>>) {
  const byId = new Map<number, Node>();
  const roots: Node[] = [];
  const publicIdById = new Map<number, string>(users.map((u) => [u.id, u.public_id]));

  for (const u of users) {
    byId.set(u.id, {
      id: u.id,
      label: `${u.display_name} · ${u.role} · L${u.hierarchy_level} · ${u.public_id}${
        u.manager_user_id ? ` (mgr ${publicIdById.get(u.manager_user_id) || ""})` : ""
      }`,
      children: [],
    });
  }

  for (const u of users) {
    const node = byId.get(u.id)!;
    if (u.manager_user_id && byId.has(u.manager_user_id)) {
      byId.get(u.manager_user_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sort = (n: Node) => {
    n.children.sort((a, b) => a.label.localeCompare(b.label));
    for (const c of n.children) sort(c);
  };
  for (const r of roots) sort(r);

  return roots;
}

function Tree({ nodes, depth = 0 }: { nodes: Node[]; depth?: number }) {
  return (
    <ul className={depth ? "ml-4 border-l border-slate-200 pl-4" : ""}>
      {nodes.map((n) => (
        <li key={n.id} className="py-1">
          <div className="text-sm text-slate-900">{n.label}</div>
          {n.children.length ? <Tree nodes={n.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

export default async function HierarchyPage() {
  const { ctx, orgId } = await requireOrgContext();
  if (ctx.kind === "user" && ctx.user.role !== "ADMIN") redirect("/admin/users");

  const users = await listUsers({ orgId, includeInactive: true }).catch(() => []);
  const tree = buildTree(users);

  return (
    <main className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Hierarchy tree</h1>
          <p className="mt-1 text-sm text-slate-600">Visibility flows down the manager chain.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/users" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
            Users
          </Link>
          <Link href="/admin/org-profile" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
            Org profile
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {tree.length ? <Tree nodes={tree} /> : <p className="text-sm text-slate-600">No users found.</p>}
      </div>
    </main>
  );
}

