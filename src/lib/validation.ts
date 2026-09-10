import { z } from "zod";

export const initiatePaymentSchema = z.object({
  packageId: z.string().uuid("packageId must be a valid identifier."),
  phone: z.string().min(9).max(20),
  idempotencyKey: z.string().uuid("idempotencyKey must be a valid UUID."),
});

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createPackageSchema = z.object({
  name: z.string().min(1).max(100),
  priceKes: z.number().int().nonnegative(),
  durationSeconds: z.number().int().positive(),
  bandwidthDownMbps: z.number().int().positive(),
  bandwidthUpMbps: z.number().int().positive(),
  dataLimitBytes: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().optional().default(true),
});

export const updatePackageSchema = createPackageSchema.partial();
