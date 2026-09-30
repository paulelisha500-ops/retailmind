// The accounts a fresh workspace ships with. Shared by the seed and the sign-in screen, so the
// quick sign-in list can never drift from what actually exists.
export const SEED_PASSWORD = "retailmind";

export const SEED_ACCOUNTS = [
  { email: "marcus@retailmind.app", label: "Marcus", role: "Admin" },
  { email: "priya@retailmind.app", label: "Priya", role: "Manager" },
  { email: "diego@retailmind.app", label: "Diego", role: "Staff" },
  { email: "layla@members.retailmind.app", label: "Layla", role: "Customer" },
];
