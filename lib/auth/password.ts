import bcrypt from "bcryptjs";

import { PASSWORD_MIN_LENGTH } from "@/lib/auth/constants";

let dummyBcryptHash: string | undefined;

function getDummyBcryptHash(): string {
  if (dummyBcryptHash === undefined) {
    dummyBcryptHash = bcrypt.hashSync("__waia_auth_dummy_password__", 10);
  }
  return dummyBcryptHash;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, passwordHashFromDb: string | null | undefined): boolean {
  const hashToUse = passwordHashFromDb ?? getDummyBcryptHash();
  return bcrypt.compareSync(plain, hashToUse);
}

export function validatePasswordPolicy(plain: string): boolean {
  return plain.length >= PASSWORD_MIN_LENGTH;
}
