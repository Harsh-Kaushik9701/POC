import { createHash } from "node:crypto";

/** Kiosk PINs are stored hashed. POC: salted SHA-256; production: argon2/bcrypt per employee. */
export const pinHash = (pin: string) => createHash("sha256").update(`akaal:${pin}`).digest("hex");
