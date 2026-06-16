// Members + invitations for the active group. Admins+ can invite & change
// roles; non-admins see read-only.

import { useState, type FormEvent } from "react";

import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useFetch } from "../lib/useFetch";
import type { Invitation, Member, Role } from "../lib/types";

const ROLES: Role[] = ["viewer", "editor", "admin"];

export default function Members() {
  const { me } = useAuth();
  const groupId = me?.active_group.id ?? "";
  const canManage = me?.role === "admin" || me?.role === "owner";

  const members = useFetch<Member[]>(() => api.listMembers(groupId), [groupId]);
  const invites = useFetch<Invitation[]>(
    () => (canManage ? api.listInvitations(groupId) : Promise.resolve([])),
    [groupId, canManage],
  );

  const [inviting, setInviting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  void reloadKey;

  function reload() {
    setReloadKey((k) => k + 1);
    // Cheap full-page reload — keeps useFetch deps simple.
    window.location.reload();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="serif text-2xl font-semibold tracking-tight text-ink">Members</h1>
        <p className="mt-1 text-sm text-ink-dim">
          People with access to <span className="font-medium text-ink">{me?.active_group.name}</span>.
        </p>
      </div>

      {canManage && (
        <div>
          <button
            type="button"
            onClick={() => setInviting(true)}
            className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent/90"
          >
            Invite member
          </button>
        </div>
      )}

      <section>
        {members.status === "loading" && (
          <div className="h-10 animate-pulse rounded bg-ink/5" />
        )}
        {members.status === "error" && (
          <div className="rounded-md border border-pace-red/30 bg-pace-red/5 px-3 py-2 text-sm text-pace-red">
            Couldn’t load members.
          </div>
        )}
        {members.status === "ok" && (
          <ul className="divide-y divide-hairline rounded-md border border-hairline bg-white">
            {members.data.map((m) => (
              <MemberRow key={m.user_id} member={m} canManage={canManage} onChange={reload} />
            ))}
          </ul>
        )}
      </section>

      {canManage && invites.status === "ok" && invites.data.length > 0 && (
        <section>
          <h2 className="serif text-lg font-semibold tracking-tight text-ink">Pending invites</h2>
          <ul className="mt-3 divide-y divide-hairline rounded-md border border-hairline bg-white">
            {invites.data.map((inv) => (
              <InviteRow key={inv.id} invite={inv} onRevoked={reload} />
            ))}
          </ul>
        </section>
      )}

      {inviting && (
        <InviteModal
          groupId={groupId}
          onClose={() => setInviting(false)}
          onCreated={reload}
        />
      )}
    </div>
  );
}

function MemberRow({
  member,
  canManage,
  onChange,
}: {
  member:    Member;
  canManage: boolean;
  onChange:  () => void;
}) {
  const { me } = useAuth();
  const isSelf = me?.user.id === member.user_id;
  const isOwner = member.role === "owner";

  async function changeRole(role: Role) {
    if (role === member.role) return;
    try {
      await api.updateMemberRole(member.user_id ? me!.active_group.id : "", member.user_id, role);
      onChange();
    } catch (err) {
      alert(err instanceof ApiError ? err.code : String(err));
    }
  }

  async function remove() {
    if (!confirm(`Remove ${member.email} from this group?`)) return;
    try {
      await api.removeMember(me!.active_group.id, member.user_id);
      onChange();
    } catch (err) {
      alert(err instanceof ApiError ? err.code : String(err));
    }
  }

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">{member.email}</div>
        <div className="text-xs text-ink-faint">since {new Date(member.created_at).toLocaleDateString()}</div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {canManage && !isOwner && !isSelf ? (
          <select
            value={member.role}
            onChange={(e) => changeRole(e.target.value as Role)}
            className="h-8 rounded-md border border-hairline bg-white px-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-full border border-hairline px-2 py-0.5 text-xs font-medium text-ink-dim">
            {member.role}
          </span>
        )}
        {canManage && !isOwner && (
          <button
            type="button"
            onClick={remove}
            className="text-xs font-medium text-pace-red transition hover:underline"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

function InviteRow({ invite, onRevoked }: { invite: Invitation; onRevoked: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.invite_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }
  async function revoke() {
    if (!confirm(`Revoke invite for ${invite.email}?`)) return;
    try {
      await api.revokeInvitation(invite.group_id, invite.id);
      onRevoked();
    } catch (err) {
      alert(err instanceof ApiError ? err.code : String(err));
    }
  }
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">{invite.email}</div>
        <div className="text-xs text-ink-faint">
          {invite.role} · expires {new Date(invite.expires_at).toLocaleDateString()}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={copy}
          className="text-xs font-medium text-accent transition hover:underline"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={revoke}
          className="text-xs font-medium text-pace-red transition hover:underline"
        >
          Revoke
        </button>
      </div>
    </li>
  );
}

function InviteModal({
  groupId,
  onClose,
  onCreated,
}: {
  groupId:   string;
  onClose:   () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const inv = await api.createInvitation(groupId, email, role);
      setCreated(inv);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "network_error");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="w-full max-w-md rounded-lg border border-hairline bg-white p-6 shadow-lg">
        <h2 className="serif text-xl font-semibold tracking-tight text-ink">Invite member</h2>

        {created ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-ink-dim">
              Share this link with <span className="font-medium text-ink">{created.email}</span>.
              The link is single-use and expires in 7 days.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={created.invite_url}
                className="block w-full rounded-md border border-hairline bg-subtle px-3 py-2 text-sm text-ink"
              />
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(created.invite_url)}
                className="inline-flex h-9 shrink-0 items-center rounded-md bg-accent px-3 text-sm font-semibold text-white"
              >
                Copy
              </button>
            </div>
            <div className="pt-2 text-right">
              <button
                type="button"
                onClick={() => {
                  onCreated();
                  onClose();
                }}
                className="text-sm font-medium text-ink-dim hover:text-ink"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <label className="block">
              <span className="block text-sm font-medium text-ink">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-ink">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="mt-1 block w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <div className="rounded-md border border-pace-red/30 bg-pace-red/5 px-3 py-2 text-sm text-pace-red">
                {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="text-sm font-medium text-ink-dim hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
              >
                {submitting ? "Creating…" : "Create invite"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
