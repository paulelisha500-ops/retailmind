// Prints the password record for the workspace's built-in accounts (SEED_PASSWORD_HASH in
// src/engine/accounts.js). It is derived here, once, rather than on every first launch: hashing costs
// ~80 ms each, and the password is published on the sign-in screen, so nothing is lost by sharing it.
//
//   node scripts/seed-hash.mjs          print the record
//   node scripts/seed-hash.mjs --write  rewrite it in src/engine/accounts.js
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { SEED_PASSWORD } from "../src/engine/accounts.js";
import { PBKDF2_ITERATIONS, hashPassword } from "../src/engine/crypto.js";

// A fixed salt keeps regeneration reproducible; it is derived from a label, not hand-typed.
const salt = Uint8Array.from(createHash("sha256").update("retailmind/built-in-accounts").digest().subarray(0, 16));
const record = await hashPassword(SEED_PASSWORD, PBKDF2_ITERATIONS, salt);
const literal = `{ alg: "${record.alg}", iterations: ${record.iterations}, salt: "${record.salt}", hash: "${record.hash}" }`;

if (process.argv.includes("--write")) {
  const file = new URL("../src/engine/accounts.js", import.meta.url);
  const source = readFileSync(file, "utf8");
  const next = source.replace(/(export const SEED_PASSWORD_HASH = Object\.freeze\()\{[^}]*\}(\);)/, `$1${literal}$2`);
  if (next === source && !source.includes(literal)) throw new Error("SEED_PASSWORD_HASH not found in accounts.js");
  writeFileSync(file, next);
  console.log("accounts.js updated");
} else {
  console.log(literal);
}
