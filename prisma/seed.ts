import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

// Packages exactly as given in spec section 2:
//   1 Hour  — KSh 10  — 5 Mbps
//   6 Hours — KSh 30  — 8 Mbps
//   24 Hours — KSh 50 — 10 Mbps / 5 GB
//   7 Days  — KSh 200 — 10 Mbps / 20 GB
//
// ASSUMED (not specified by the handout, flagged rather than silently
// guessed): the spec gives only one Mbps figure per package. We treat
// it as the download speed and set upload speed equal to it (symmetric).
// If Colony's actual MikroTik queue setup uses asymmetric up/down, edit
// these values before running the seed against a real environment —
// this is exactly the kind of fact Phase F's router audit should confirm.
const PACKAGES = [
  {
    name: "1 Hour",
    priceKes: 10,
    durationSeconds: 60 * 60,
    bandwidthDownMbps: 5,
    bandwidthUpMbps: 5, // ASSUMED symmetric — see comment above
    dataLimitBytes: null,
  },
  {
    name: "6 Hours",
    priceKes: 30,
    durationSeconds: 6 * 60 * 60,
    bandwidthDownMbps: 8,
    bandwidthUpMbps: 8, // ASSUMED symmetric
    dataLimitBytes: null,
  },
  {
    name: "24 Hours",
    priceKes: 50,
    durationSeconds: 24 * 60 * 60,
    bandwidthDownMbps: 10,
    bandwidthUpMbps: 10, // ASSUMED symmetric
    dataLimitBytes: 5n * 1024n * 1024n * 1024n, // 5 GB
  },
  {
    name: "7 Days",
    priceKes: 200,
    durationSeconds: 7 * 24 * 60 * 60,
    bandwidthDownMbps: 10,
    bandwidthUpMbps: 10, // ASSUMED symmetric
    dataLimitBytes: 20n * 1024n * 1024n * 1024n, // 20 GB
  },
];

async function main() {
  console.log("Seeding packages...");
  for (const pkg of PACKAGES) {
    await db.package.upsert({
      where: { name: pkg.name }, // relies on name being effectively unique in practice; see note below
      update: pkg,
      create: pkg,
    });
    console.log(`  ✓ ${pkg.name}`);
  }

  const seedEmail = process.env.ADMIN_SEED_EMAIL;
  const seedPassword = process.env.ADMIN_SEED_PASSWORD;

  if (!seedEmail || !seedPassword) {
    console.log(
      "Skipping admin seed: ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD not set. " +
        "Set them in your environment before running `npm run prisma:seed` " +
        "the first time, then remove ADMIN_SEED_PASSWORD from the environment."
    );
    return;
  }

  const existing = await db.admin.findUnique({ where: { email: seedEmail } });
  if (existing) {
    console.log(`Admin ${seedEmail} already exists, skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(seedPassword, 12);
  await db.admin.create({
    data: { email: seedEmail, passwordHash },
  });
  console.log(`  ✓ Admin account created: ${seedEmail}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
