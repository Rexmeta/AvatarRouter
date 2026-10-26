import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import https from "node:https";
import ipaddr from "ipaddr.js";
import sharp from "sharp";
import { SessionProblem } from "./session-service";

export const MAX_IMAGE_BYTES = 4_500_000;
export const hashImage = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function publicAddress(address: string) {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}
export async function validateImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new SessionProblem(400, "IMAGE_SIZE_INVALID", "Images must be between 1 byte and 4.5 MB.");
  }
  try {
    const image = sharp(bytes, { limitInputPixels: 16_777_216, failOn: "warning" });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) !== 1) {
      throw new Error("Unsupported format");
    }
    if (!meta.width || !meta.height || meta.width < 128 || meta.height < 128 || meta.width > 4096 || meta.height > 4096) {
      throw new Error("Invalid dimensions");
    }
    // Fully decode, remove EXIF/location metadata and normalize orientation.
    const { data, info } = await image.rotate().jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES) throw new Error("Normalized image too large");
    return { bytes: data, width: info.width, height: info.height, contentHash: hashImage(bytes) };
  } catch {
    throw new SessionProblem(400, "IMAGE_INVALID", "Use a non-animated JPEG, PNG or WebP, 128–4096 px, at most 16 megapixels.");
  }
}
export function decodeImageBase64(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new SessionProblem(400, "IMAGE_ENCODING_INVALID", "Use plain, valid base64 without a data URL prefix.");
  }
  return Buffer.from(value, "base64");
}
export async function fetchAuthorizedImage(source: string) {
  let url: URL;
  try { url = new URL(source); } catch { throw new SessionProblem(400, "URL_INVALID", "Invalid image URL."); }
  const allowed = (process.env.IMAGE_INGEST_ALLOWED_HOSTS ?? "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || !allowed.includes(url.hostname.toLowerCase())) {
    throw new SessionProblem(400, "URL_HOST_NOT_ALLOWED", "An operator must allowlist the exact HTTPS image hostname first. Upload a file instead.");
  }
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some(r => !publicAddress(r.address))) {
    throw new SessionProblem(400, "URL_ADDRESS_REJECTED", "Private, local and reserved network addresses are not permitted.");
  }
  const address = records[0]!;
  // Pin DNS resolution to the validated address, retain TLS hostname verification,
  // reject every redirect, never forward cookies or Authorization.
  return new Promise<Buffer>((resolve, reject) => {
    const req = https.get(url, {
      family: address.family,
      lookup: (_hostname, _options, cb) => cb(null, address.address, address.family),
      headers: { Accept: "image/jpeg,image/png,image/webp" },
    }, res => {
      if (res.statusCode !== 200 || Number(res.headers["content-length"] ?? 0) > MAX_IMAGE_BYTES) {
        res.destroy(); reject(new SessionProblem(400, "IMAGE_FETCH_REJECTED", "Image URL must return a direct, bounded HTTP 200 response.")); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) {
          res.destroy(new SessionProblem(400, "IMAGE_SIZE_INVALID", "Image exceeds 4.5 MB.")); return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new Error("Image fetch timeout")), 10_000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", () => reject(new SessionProblem(400, "IMAGE_FETCH_FAILED", "Unable to download the image securely.")));
  });
}
