"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message ?? "Login failed.");
        setSubmitting(false);
        return;
      }
      router.push("/admin/dashboard");
    } catch {
      setError("Couldn't reach the server. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "var(--surface)" as any,
          border: "1px solid var(--border)" as any,
          borderRadius: 16,
          padding: 28,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px" }}>Colony Admin</h1>
        <p style={{ color: "var(--text-muted)" as any, fontSize: 13, margin: "0 0 20px" }}>
          Sign in to manage packages and payments.
        </p>

        {error && (
          <p style={{ color: "var(--error)" as any, fontSize: 13, marginBottom: 12 }}>{error}</p>
        )}

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
        />
        <button type="submit" disabled={submitting} style={buttonStyle}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: 9,
  border: "1.5px solid var(--border)",
  background: "var(--bg)" as any,
  color: "var(--text)" as any,
  fontSize: 15,
  marginBottom: 12,
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 10,
  border: "none",
  background: "var(--accent)" as any,
  color: "#0a1712",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
  marginTop: 4,
};
