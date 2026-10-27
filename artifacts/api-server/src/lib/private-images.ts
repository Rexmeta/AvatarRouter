import { Storage } from "@google-cloud/storage";
import { SessionProblem } from "./session-service";

const sidecar = "http://127.0.0.1:1106";
const storage = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: `${sidecar}/token`, type: "external_account",
    credential_source: { url: `${sidecar}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  }, projectId: "",
});
function privateFile(objectPath: string, prefix = "avatar-images") {
  const root = process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "");
  if (!root || !objectPath.startsWith(`${root}/${prefix}/`)) {
    throw new SessionProblem(503, "STORAGE_NOT_CONFIGURED", "Private image storage is unavailable.");
  }
  const [bucket, ...name] = objectPath.replace(/^\//, "").split("/");
  return storage.bucket(bucket!).file(name.join("/"));
}
export async function savePrivateImage(tenant: string, id: string, bytes: Buffer) {
  const path = `${process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "")}/avatar-images/${tenant}/${id}.jpg`;
  await privateFile(path).save(bytes, { resumable: false, contentType: "image/jpeg", metadata: { cacheControl: "private, no-store" } });
  return path;
}
export async function readPrivateImage(path: string) { const [bytes] = await privateFile(path).download(); return bytes; }
export async function removePrivateImage(path: string) { await privateFile(path).delete({ ignoreNotFound: true }); }
// Short-lived renderer messages; never store PCM/base64 in PostgreSQL.
export async function saveRendererAudio(id: string, bytes: Buffer) {
  const path = `${process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "")}/renderer-audio/${id}.pcm`;
  await privateFile(path, "renderer-audio").save(bytes, { resumable: false, contentType: "application/octet-stream", metadata: { cacheControl: "private, no-store" } });
  return path;
}
export async function readRendererAudio(path: string) { const [bytes] = await privateFile(path, "renderer-audio").download(); return bytes; }
export async function removeRendererAudio(path: string) { await privateFile(path, "renderer-audio").delete({ ignoreNotFound: true }); }
export async function providerImageUrl(path: string) {
  privateFile(path); // Root-constrained path from our DB, never from a client.
  const [bucket, ...name] = path.replace(/^\//, "").split("/");
  const response = await fetch(`${sidecar}/object-storage/signed-object-url`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_name: bucket, object_name: name.join("/"), method: "GET", expires_at: new Date(Date.now() + 25 * 3600_000).toISOString() }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new SessionProblem(503, "IMAGE_SIGNING_FAILED", "Could not authorize provider image access.");
  const data = await response.json() as { signed_url?: unknown };
  if (typeof data.signed_url !== "string") throw new Error("Invalid storage signer response");
  return data.signed_url as string;
}
