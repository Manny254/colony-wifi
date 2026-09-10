"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface DashboardData {
  revenueKes: { total: number; today: number };
  payments: { successful: number; failed: number; pending: number; needsReconciliation: number };
  activeUsers: number;
  expiringSoon: { count: number; windowMinutes: number };
  router: { status: string; detail: string };
}

interface PaymentRow {
  id: string;
  phoneE164: string;
  packageName: string;
  amountKes: number;
  status: string;
  mpesaReceiptNumber: string | null;
  verificationStatus: string;
  createdAt: string;
}

interface HealthData {
  database: { healthy: boolean; latencyMs: number };
  daraja: { configured: boolean; reachable: boolean; env: string };
  mikrotik: { status: string; detail: string };
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [dashRes, paymentsRes, healthRes] = await Promise.all([
      fetch("/api/admin/dashboard"),
      fetch("/api/admin/payments?limit=20"),
      fetch("/api/admin/system-health"),
    ]);

    if (dashRes.status === 401) {
      router.push("/admin/login");
      return;
    }
    if (!dashRes.ok) {
      setError("Couldn't load dashboard data.");
      return;
    }

    setDashboard(await dashRes.json());
    setPayments((await paymentsRes.json()).payments);
    setHealth(await healthRes.json());
  }, [router]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  async function reconcile(paymentId: string) {
    await fetch(`/api/admin/payments/${paymentId}/reconcile`, { method: "POST" });
    load();
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  if (error) {
    return <main style={{ padding: 32, color: "var(--error)" as any }}>{error}</main>;
  }

  return (
    <main style={{ padding: "24px 20px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Colony Admin</h1>
        <button onClick={logout} style={logoutButtonStyle}>
          Sign out
        </button>
      </div>

      {!dashboard ? (
        <p style={{ color: "var(--text-muted)" as any }}>Loading…</p>
      ) : (
        <>
          <section style={statGridStyle}>
            <StatCard label="Revenue today" value={`KSh ${dashboard.revenueKes.today}`} />
            <StatCard label="Revenue total" value={`KSh ${dashboard.revenueKes.total}`} />
            <StatCard label="Successful payments" value={String(dashboard.payments.successful)} />
            <StatCard label="Failed payments" value={String(dashboard.payments.failed)} />
            <StatCard label="Pending payments" value={String(dashboard.payments.pending)} />
            <StatCard
              label="Needs reconciliation"
              value={String(dashboard.payments.needsReconciliation)}
              warn={dashboard.payments.needsReconciliation > 0}
            />
            <StatCard label="Active users" value={String(dashboard.activeUsers)} />
            <StatCard
              label={`Expiring (${dashboard.expiringSoon.windowMinutes}min)`}
              value={String(dashboard.expiringSoon.count)}
            />
          </section>

          {health && (
            <section style={{ marginTop: 28 }}>
              <h2 style={sectionTitleStyle}>System health</h2>
              <div style={statGridStyle}>
                <HealthCard label="Database" ok={health.database.healthy} detail={`${health.database.latencyMs}ms`} />
                <HealthCard
                  label="Daraja"
                  ok={health.daraja.reachable}
                  detail={health.daraja.configured ? health.daraja.env : "not configured"}
                />
                <HealthCard
                  label="MikroTik"
                  ok={health.mikrotik.status === "HEALTHY"}
                  detail={health.mikrotik.status === "UNKNOWN" ? "not configured (Phase F)" : health.mikrotik.status}
                  neutral={health.mikrotik.status === "UNKNOWN"}
                />
              </div>
            </section>
          )}

          <section style={{ marginTop: 28 }}>
            <h2 style={sectionTitleStyle}>Recent payments</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-muted)" as any }}>
                    <th style={thStyle}>Phone</th>
                    <th style={thStyle}>Package</th>
                    <th style={thStyle}>Amount</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Receipt</th>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {payments?.map((p) => (
                    <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={tdStyle}>{p.phoneE164}</td>
                      <td style={tdStyle}>{p.packageName}</td>
                      <td style={tdStyle}>KSh {p.amountKes}</td>
                      <td style={tdStyle}>
                        <StatusPill status={p.status} />
                      </td>
                      <td style={tdStyle}>{p.mpesaReceiptNumber ?? "—"}</td>
                      <td style={tdStyle}>{new Date(p.createdAt).toLocaleString()}</td>
                      <td style={tdStyle}>
                        {(p.status === "PENDING" || p.status === "TIMEOUT") && (
                          <button onClick={() => reconcile(p.id)} style={reconcileButtonStyle}>
                            Reconcile
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {payments?.length === 0 && (
                <p style={{ color: "var(--text-muted)" as any, padding: "16px 0" }}>No payments yet.</p>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function StatCard({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, color: "var(--text-muted)" as any, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: warn ? "var(--warning)" as any : "var(--text)" as any }}>
        {value}
      </div>
    </div>
  );
}

function HealthCard({
  label,
  ok,
  detail,
  neutral,
}: {
  label: string;
  ok: boolean;
  detail: string;
  neutral?: boolean;
}) {
  const color = neutral ? "var(--text-muted)" : ok ? "var(--accent)" : "var(--error)";
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color as any }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" as any }}>{label}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{detail}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    SUCCESS: "var(--accent)",
    PENDING: "var(--warning)",
    TIMEOUT: "var(--warning)",
    FAILED: "var(--error)",
    CANCELLED: "var(--error)",
    RECONCILIATION_REQUIRED: "var(--error)",
  };
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: (colorMap[status] ?? "var(--text-muted)") as any,
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

const statGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
  gap: 12,
};

const cardStyle: React.CSSProperties = {
  background: "var(--surface)" as any,
  border: "1px solid var(--border)" as any,
  borderRadius: 12,
  padding: "14px 16px",
};

const sectionTitleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 700, marginBottom: 12 };
const thStyle: React.CSSProperties = { padding: "6px 10px", fontWeight: 500 };
const tdStyle: React.CSSProperties = { padding: "8px 10px" };

const logoutButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text)" as any,
  cursor: "pointer",
  fontSize: 13,
};

const reconcileButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--accent)" as any,
  cursor: "pointer",
  fontSize: 11,
};
