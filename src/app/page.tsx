"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface Package {
  id: string;
  name: string;
  priceKes: number;
  durationSeconds: number;
  bandwidthDownMbps: number;
  bandwidthUpMbps: number;
  dataLimitBytes: string | null;
}

type FlowState =
  | { step: "selecting" }
  | { step: "submitting" }
  | { step: "pending"; paymentId: string; sinceMs: number }
  | { step: "success"; paymentId: string; receipt: string | null; packageName: string }
  | { step: "failed"; message: string }
  | { step: "error"; message: string };

function formatDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr`;
  return `${Math.round(seconds / 86400)} day${seconds >= 172800 ? "s" : ""}`;
}

function formatData(bytes: string | null): string | null {
  if (!bytes) return null;
  const gb = Number(bytes) / (1024 * 1024 * 1024);
  return `${gb % 1 === 0 ? gb : gb.toFixed(1)} GB`;
}

export default function PortalPage() {
  const [packages, setPackages] = useState<Package[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [flow, setFlow] = useState<FlowState>({ step: "selecting" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/packages")
      .then((r) => r.json())
      .then((data) => setPackages(data.packages))
      .catch(() => setLoadError("Couldn't load packages. Check your connection and reload."));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollStatus = useCallback(
    (paymentId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/payments/${paymentId}/status`);
          if (!res.ok) return; // transient — keep polling
          const data = await res.json();

          if (data.status === "SUCCESS") {
            stopPolling();
            setFlow({
              step: "success",
              paymentId,
              receipt: data.mpesaReceiptNumber,
              packageName: data.packageName,
            });
          } else if (data.status === "FAILED" || data.status === "CANCELLED") {
            stopPolling();
            setFlow({
              step: "failed",
              message:
                data.status === "CANCELLED"
                  ? "Payment was cancelled on your phone."
                  : "The payment didn't go through.",
            });
          } else if (data.status === "TIMEOUT") {
            // Don't declare failure yet — spec section 15: a stuck/slow
            // response isn't the same as a failed payment. Keep polling;
            // reconciliation may still resolve it to SUCCESS.
            return;
          }
          // PENDING / RECONCILIATION_REQUIRED: keep polling silently.
        } catch {
          // Network hiccup — keep polling, don't flip to an error state
          // over one failed poll.
        }
      }, 2500);
    },
    [stopPolling]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    setFlow({ step: "submitting" });

    try {
      const res = await fetch("/api/payments/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: selectedId,
          phone,
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setFlow({ step: "error", message: data.error?.message ?? "Something went wrong." });
        return;
      }

      setFlow({ step: "pending", paymentId: data.id, sinceMs: Date.now() });
      pollStatus(data.id);
    } catch {
      setFlow({ step: "error", message: "Couldn't reach Colony. Check your connection and try again." });
    }
  }

  function retry() {
    idempotencyKeyRef.current = null;
    setFlow({ step: "selecting" });
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <SignalMark />
        <h1 style={styles.h1}>Colony Wi-Fi</h1>
        <p style={styles.tagline}>Fast internet, paid with M-Pesa. No account needed.</p>

        {flow.step === "selecting" || flow.step === "submitting" ? (
          <form onSubmit={handleSubmit}>
            {loadError && <p style={styles.errorText}>{loadError}</p>}

            {!packages && !loadError && <p style={styles.muted}>Loading packages…</p>}

            <div style={styles.packageList}>
              {packages?.map((pkg) => {
                const selected = pkg.id === selectedId;
                const dataLabel = formatData(pkg.dataLimitBytes);
                return (
                  <button
                    type="button"
                    key={pkg.id}
                    onClick={() => setSelectedId(pkg.id)}
                    style={{
                      ...styles.packageTile,
                      borderColor: selected ? "var(--accent)" as any : "var(--border)" as any,
                      background: selected ? "rgba(47,217,138,0.08)" : "var(--surface)" as any,
                    }}
                    aria-pressed={selected}
                  >
                    <div style={styles.packageTileLeft}>
                      <span style={styles.packageName}>{pkg.name}</span>
                      <span style={styles.packageSpecs}>
                        {pkg.bandwidthDownMbps} Mbps{dataLabel ? ` · ${dataLabel}` : ""}
                      </span>
                    </div>
                    <span style={styles.packagePrice}>KSh {pkg.priceKes}</span>
                  </button>
                );
              })}
            </div>

            <label style={styles.label} htmlFor="phone">
              M-Pesa phone number
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              placeholder="0712 345 678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={styles.input}
              required
            />

            <button
              type="submit"
              disabled={!selectedId || !phone || flow.step === "submitting"}
              style={{
                ...styles.primaryButton,
                opacity: !selectedId || !phone ? 0.5 : 1,
              }}
            >
              {flow.step === "submitting" ? "Sending request…" : "Buy access"}
            </button>
          </form>
        ) : null}

        {flow.step === "pending" && (
          <div style={styles.statusBlock}>
            <PulsingDot />
            <p style={styles.statusTitle}>Check your phone</p>
            <p style={styles.muted}>
              Enter your M-Pesa PIN on the prompt sent to your phone to complete payment.
            </p>
          </div>
        )}

        {flow.step === "success" && (
          <div style={styles.statusBlock}>
            <div style={styles.successIcon}>✓</div>
            <p style={styles.statusTitle}>Payment confirmed</p>
            <p style={styles.muted}>
              {flow.packageName} — your Wi-Fi access is activating now.
              {flow.receipt ? ` Receipt: ${flow.receipt}` : ""}
            </p>
          </div>
        )}

        {flow.step === "failed" && (
          <div style={styles.statusBlock}>
            <p style={styles.statusTitle}>{flow.message}</p>
            <button style={styles.primaryButton} onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {flow.step === "error" && (
          <div style={styles.statusBlock}>
            <p style={{ ...styles.statusTitle, color: "var(--error)" as any }}>{flow.message}</p>
            <button style={styles.primaryButton} onClick={retry}>
              Try again
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function SignalMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ marginBottom: 12 }}>
      <circle cx="20" cy="32" r="3" fill="var(--accent)" />
      <path
        d="M12 26a11 11 0 0 1 16 0"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
      <path
        d="M5 19a20 20 0 0 1 30 0"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.35"
      />
    </svg>
  );
}

function PulsingDot() {
  return (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "var(--warning)",
          animation: "pulse 1.4s ease-in-out infinite",
        }}
      />
      <style>{`@keyframes pulse { 0%,100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.15); } }`}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "var(--surface)" as any,
    border: "1px solid var(--border)" as any,
    borderRadius: 20,
    padding: "32px 24px",
  },
  h1: { fontSize: 24, fontWeight: 800, margin: "0 0 4px" },
  tagline: { color: "var(--text-muted)" as any, fontSize: 14, margin: "0 0 24px" },
  packageList: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 },
  packageTile: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "14px 16px",
    borderRadius: 12,
    border: "1.5px solid var(--border)",
    color: "var(--text)" as any,
    cursor: "pointer",
    textAlign: "left",
    transition: "border-color 120ms ease, background 120ms ease",
  },
  packageTileLeft: { display: "flex", flexDirection: "column", gap: 2 },
  packageName: { fontWeight: 600, fontSize: 15 },
  packageSpecs: { fontSize: 13, color: "var(--text-muted)" as any },
  packagePrice: { fontWeight: 700, fontSize: 16 },
  label: { display: "block", fontSize: 13, color: "var(--text-muted)" as any, marginBottom: 6 },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1.5px solid var(--border)",
    background: "var(--bg)" as any,
    color: "var(--text)" as any,
    fontSize: 16,
    marginBottom: 18,
  },
  primaryButton: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 12,
    border: "none",
    background: "var(--accent)" as any,
    color: "#0a1712",
    fontWeight: 700,
    fontSize: 16,
    cursor: "pointer",
  },
  statusBlock: { textAlign: "center", padding: "12px 0" },
  statusTitle: { fontSize: 17, fontWeight: 700, margin: "8px 0 6px" },
  muted: { color: "var(--text-muted)" as any, fontSize: 14 },
  errorText: { color: "var(--error)" as any, fontSize: 14, marginBottom: 12 },
  successIcon: {
    width: 44,
    height: 44,
    borderRadius: "50%",
    background: "var(--accent)" as any,
    color: "#0a1712",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 22,
    fontWeight: 800,
    margin: "0 auto 8px",
  },
};
