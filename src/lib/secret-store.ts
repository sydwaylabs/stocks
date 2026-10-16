import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { access, chmod, constants } from "node:fs/promises";

/**
 * Encryption at rest for secrets kept in action settings.
 *
 * **What this defends against, and what it does not.** Settings live in the Stream Deck profile,
 * which travels: profile exports, sync folders, Time Machine. Sealing a value puts ciphertext there
 * instead, and the key lives in the login keychain rather than the profile.
 *
 * It is **not** protection from a process running as the user. That was measured, not assumed:
 * the keychain item the host creates is readable by any unrelated binary with no prompt, and
 * every route to a real ACL (user-presence gating, a trusted-application list) needs a Developer
 * ID certificate. See references/portability.md.
 *
 * The seam is two calls: unsealValue when settings are read, sealValue before they are written.
 * Keep a stored `sealed` flag beside the value rather than sniffing the text.
 */

/** Bundled native host, relative to the sdPlugin root. Same binary as src/window-host.ts. */
const NATIVE_HOST = "bin/stocks-host";

/**
 * Envelope prefix and separator. `.` is safe as a separator because base64's alphabet
 * (`A-Za-z0-9+/=`) does not contain it, so the parts can never run together.
 *
 * The version is in the text so a later format can be introduced without having to guess which
 * one an existing profile holds.
 */
const ENVELOPE_V1 = "sk1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const KEY_BYTES = 32;

/** Thrown when a value cannot be decrypted: wrong key, truncated profile, or tampering. */
export class UnsealError extends Error {}

/**
 * Encrypts one value. AES-256-GCM with a fresh random IV every time, so sealing the same text
 * twice never produces the same ciphertext and the profile does not reveal which values match.
 *
 * `aad` binds the ciphertext to something outside it — the action's id and the setting's name.
 * Someone who can edit the profile can still delete a value, but they cannot move one key's
 * ciphertext onto another's and have it decrypt.
 */
export function sealValue(plaintext: string, key: Buffer, aad?: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", new Uint8Array(key), new Uint8Array(iv));
    if (aad !== undefined) cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [
        ENVELOPE_V1,
        iv.toString("base64"),
        ciphertext.toString("base64"),
        cipher.getAuthTag().toString("base64"),
    ].join(".");
}

/** Decrypts one value produced by {@link sealValue}. Throws {@link UnsealError} on any failure. */
export function unsealValue(envelope: string, key: Buffer, aad?: string): string {
    const parts = envelope.split(".");
    if (parts.length !== 4 || parts[0] !== ENVELOPE_V1) {
        throw new UnsealError("not a recognised sealed value");
    }
    const iv = Buffer.from(parts[1], "base64");
    const ciphertext = Buffer.from(parts[2], "base64");
    const tag = Buffer.from(parts[3], "base64");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new UnsealError("sealed value has a malformed header");
    }
    try {
        const decipher = createDecipheriv("aes-256-gcm", new Uint8Array(key), new Uint8Array(iv));
        if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
        // GCM's own authentication failing is the expected path for a wrong key or edited
        // profile, so it is reported as a refusal rather than allowed to escape as a raw error.
        throw new UnsealError(`could not decrypt: ${String(error)}`);
    }
}

/** True when two keys are the same, without leaking where they first differ. */
export function sameKey(a: Buffer, b: Buffer): boolean {
    return a.length === b.length && timingSafeEqual(a, b);
}

let cached: Buffer | null | undefined;

/**
 * Fetches the collection key from the login keychain, minting it on first use.
 *
 * Cached for the life of the plugin process. The alternative is spawning the host on every
 * settings write, and the key is already in this process's memory the moment
 * it is used, so re-reading it would buy nothing.
 *
 * Returns null when the native host is absent (a plain `npm run build`, or a package whose host
 * failed to install). Callers must treat that as "store in the clear", not as an error.
 *
 * The key crosses on **stdout**, never in arguments, since `ps` shows every process's argv to
 * every user on the machine.
 */
export async function getCollectionKey(
    onWarn?: (message: string) => void
): Promise<Buffer | null> {
    if (cached !== undefined) return cached;
    const host = await nativeHost();
    if (!host) {
        onWarn?.("native helper not available, so secrets are stored without encryption");
        cached = null;
        return cached;
    }
    try {
        const encoded = await runForStdout(host, ["--collection-key"]);
        const key = Buffer.from(encoded.trim(), "base64");
        if (key.length !== KEY_BYTES) throw new Error(`expected ${KEY_BYTES} bytes, got ${key.length}`);
        cached = key;
    } catch (error) {
        onWarn?.(`could not read the collection key, so secrets are stored without encryption: ${String(error)}`);
        // Deliberately not cached. A missing host is permanent for this process, but a failure
        // here is usually macOS waiting on a permission dialog, and caching the miss would leave
        // every sealed value unreadable until Stream Deck restarted even after the user allowed it.
        return null;
    }
    return cached;
}

/** Test seam: drops the cached key so a later call re-reads it. */
export function resetCollectionKeyCache(): void {
    cached = undefined;
}


/**
 * How long to wait for the key before giving up.
 *
 * **This is not belt and braces.** The keychain item carries an access control tied to the binary
 * that created it, so a host rebuilt or updated since then makes macOS put up a confirmation
 * dialog, and the read does not return until it is answered. Without a deadline that blocks
 * the action for as long as the dialog is ignored, and forever if the dialog cannot be
 * shown at all. Ten seconds is long enough to click Allow and short enough not to look frozen.
 */
const KEY_TIMEOUT_MS = 10_000;

function runForStdout(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
        const chunks: Uint8Array[] = [];
        let settled = false;
        const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
        const timer = setTimeout(() => {
            proc.kill("SIGKILL");
            finish(() => reject(new Error(
                `${command} did not answer within ${KEY_TIMEOUT_MS}ms, which usually means macOS `
                + "is asking permission to read the key"
            )));
        }, KEY_TIMEOUT_MS);
        proc.stdout.on("data", chunk => chunks.push(chunk));
        proc.on("error", error => finish(() => reject(error)));
        proc.on("close", code => finish(() => code === 0
            ? resolve(Buffer.concat(chunks).toString("utf8"))
            : reject(new Error(`${command} exited with code ${code}`))));
    });
}

/** The bundled host if it is present, repairing the exec bit `streamdeck pack` drops. */
async function nativeHost(): Promise<string | null> {
    try {
        await access(NATIVE_HOST, constants.F_OK);
    } catch {
        return null;
    }
    try {
        await access(NATIVE_HOST, constants.X_OK);
    } catch {
        try { await chmod(NATIVE_HOST, 0o755); } catch { return null; }
    }
    return NATIVE_HOST;
}
