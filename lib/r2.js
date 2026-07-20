// Cloudflare R2 (S3-compatible) presigned URLs, implemented with node crypto
// so we don't ship the AWS SDK. The phone uploads straight to R2 with these;
// image bytes never transit our API.
//
// Required env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//               R2_BUCKET, R2_PUBLIC_BASE (the bucket's public URL, no slash)

import { createHmac, createHash } from "crypto";

const env = () => ({
  account: process.env.R2_ACCOUNT_ID,
  key: process.env.R2_ACCESS_KEY_ID,
  secret: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  pub: (process.env.R2_PUBLIC_BASE || "").replace(/\/$/, ""),
});

export function r2Configured() {
  const e = env();
  return !!(e.account && e.key && e.secret && e.bucket && e.pub);
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const hmac = (k, s) => createHmac("sha256", k).update(s).digest();
const encSeg = (seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => p.split("/").map(encSeg).join("/");

// SigV4 query-string presign (region "auto", service "s3", UNSIGNED-PAYLOAD).
function presign(method, objectKey, expires = 600) {
  const e = env();
  const host = `${e.account}.r2.cloudflarestorage.com`;
  const path = `/${e.bucket}/${encPath(objectKey)}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;

  const q = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${e.key}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = q
    .map(([k, v]) => `${encSeg(k)}=${encSeg(v)}`)
    .sort()
    .join("&");

  const canonicalRequest = [method, path, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${e.secret}`, date), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export const signPutUrl = (key) => presign("PUT", key);
export const publicUrl = (key) => `${env().pub}/${encPath(key)}`;

export function keyFromUrl(url) {
  const base = env().pub;
  if (!base || !url?.startsWith(base + "/")) return null;
  return decodeURIComponent(url.slice(base.length + 1));
}

// Best-effort object delete (orphaned bytes are acceptable; rows are truth).
export async function deleteObject(key) {
  try {
    await fetch(presign("DELETE", key), { method: "DELETE" });
  } catch { /* ignore */ }
}
