/**
 * Trusted development operator only. Never expose as a public approval endpoint.
 * Review evidence and the provider's identity/policy requirements BEFORE use.
 */
import { db, pool, imageAssets, eq } from "@workspace/db";
const args = process.argv.slice(2);
const id = args[args.indexOf("--image-id") + 1];
if (!args.includes("--confirm-reviewed") || !args.includes("--image-id") || !id) {
  throw new Error("Usage: avatar:review-consent --image-id <id> --confirm-reviewed. Review actual consent evidence and provider requirements first.");
}
try {
  const [image] = await db.select().from(imageAssets).where(eq(imageAssets.id, id));
  if (!image || image.likeness !== "real_person" || !image.consentReference) throw new Error("No real-person consent evidence reference to review.");
  await db.update(imageAssets).set({ consentStatus: "verified" }).where(eq(imageAssets.id, id));
  console.log(JSON.stringify({ reviewed: true, scope: "Operator evidence review, not automated biometric identity verification." }));
} finally { await pool.end(); }
