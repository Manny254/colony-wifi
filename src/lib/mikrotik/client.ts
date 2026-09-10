/**
 * MIKROTIK INTEGRATION — PHASE F — BLOCKED
 *
 * Spec sections 19, 43: "Do not implement MikroTik commands until actual
 * router information has been inspected." No router has been supplied
 * to this build session. This file intentionally contains NO real
 * RouterOS API calls, no assumed model/version/topology, and no
 * credentials.
 *
 * What's here instead: the shape of the contract Phase E (entitlement
 * engine) and Phase G (admin dashboard) will call once Phase F is
 * unblocked, so those layers can be written against a stable interface
 * now. Every method throws NotImplementedError. Nothing in this file
 * should ever be mistaken for a working integration.
 *
 * To unblock Phase F, the operator needs to supply (never passwords in
 * chat — see spec section 43):
 *   - MikroTik model
 *   - RouterOS version
 *   - /system resource print
 *   - /interface print
 *   - /ip address print
 *   - /ip pool print
 *   - /ip dhcp-server print
 *   - /ip hotspot print
 *   - /ip hotspot profile print
 *   - /ip firewall nat print
 *   - /ip firewall filter print
 *
 * And a secure management path decision: the router's API must not be
 * exposed directly to the public internet. Vercel's serverless functions
 * have no fixed egress IP by default and cannot reach a LAN-only router
 * without some tunnel/VPN/reverse-proxy path — that path itself needs
 * designing once the router's real network topology is known.
 */

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(
      `MikroTik.${method} is not implemented. Phase F is blocked pending real ` +
        `router configuration — see src/lib/mikrotik/client.ts header comment.`
    );
    this.name = "NotImplementedError";
  }
}

export interface AuthorizeSessionRequest {
  entitlementId: string;
  customerId: string;
  packageId: string;
  bandwidthDownMbps: number;
  bandwidthUpMbps: number;
  expiresAt: Date;
  /** MAC/IP/hotspot identity — exact shape TBD once HotSpot config is known. */
  deviceIdentity: {
    macAddress?: string;
    ipAddress?: string;
    hotspotUsername?: string;
  };
}

export interface RevokeSessionRequest {
  sessionId: string;
  reason: "expired" | "admin_revoked" | "payment_reconciliation_failed";
}

export interface RouterHealthCheckResult {
  status: "HEALTHY" | "UNHEALTHY" | "UNKNOWN";
  detail: string;
}

/**
 * Placeholder client. Do not call these in real request paths yet —
 * they exist so Phase E/G code can be written against a typed interface
 * without inventing behaviour underneath it.
 */
export const mikrotikClient = {
  async authorizeSession(_req: AuthorizeSessionRequest): Promise<never> {
    throw new NotImplementedError("authorizeSession");
  },
  async revokeSession(_req: RevokeSessionRequest): Promise<never> {
    throw new NotImplementedError("revokeSession");
  },
  async checkHealth(): Promise<RouterHealthCheckResult> {
    // This one path is safe to actually return a real (honest) answer:
    // there is no configured router, so the truthful status is UNKNOWN,
    // not a thrown error — the admin health dashboard needs to render
    // this state, not crash on it.
    return {
      status: "UNKNOWN",
      detail: "No MikroTik router has been configured. Phase F is blocked — see client.ts.",
    };
  },
};
