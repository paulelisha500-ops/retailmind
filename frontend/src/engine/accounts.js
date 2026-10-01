// The accounts a fresh workspace ships with. Shared by the seed and the sign-in screen, so the
// quick sign-in list can never drift from what actually exists.
export const SEED_PASSWORD = "retailmind";

// PBKDF2-SHA256 record for SEED_PASSWORD, derived ahead of time so a first launch doesn't hash it once
// per account. The password is shown on the sign-in screen, so sharing a salt between these accounts
// weakens nothing; every account created afterwards gets its own random salt. Regenerate with
// `node scripts/seed-hash.mjs --write` (a unit test fails if this ever stops matching).
export const SEED_PASSWORD_HASH = Object.freeze({ alg: "pbkdf2-sha256", iterations: 150000, salt: "7yHWYdHVh+IKHmiqrpHsqA==", hash: "f2QZ+wgEvvcS9xzo5ZpVjA46gqEQ7SWNILh1Mqja0hM=" });

export const SEED_ACCOUNTS = [
  { email: "marcus@retailmind.app", label: "Marcus", role: "Admin" },
  { email: "priya@retailmind.app", label: "Priya", role: "Manager" },
  { email: "diego@retailmind.app", label: "Diego", role: "Staff" },
  { email: "layla@members.retailmind.app", label: "Layla", role: "Customer" },
];
