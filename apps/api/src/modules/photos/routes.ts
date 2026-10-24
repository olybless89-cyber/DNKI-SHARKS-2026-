import { createHash } from "node:crypto";
import { PhotoUploadInput } from "@dnki/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { one } from "../../db/pool";
import { audit } from "../../lib/audit";
import { Errors } from "../../lib/errors";
import { hasPermission, noStore, requireAuth, requireVerifiedAccount } from "../../plugins/auth";

const MAX_BYTES = 2 * 1024 * 1024;

/** Checks the file signature so the declared type cannot smuggle other content. */
export function sniffImage(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

async function sendPhoto(reply: FastifyReply, row: { content_type: string; data: Buffer } | undefined) {
  if (!row) throw Errors.notFound("Photo");
  noStore(reply);
  reply.header("content-type", row.content_type);
  reply.header("x-content-type-options", "nosniff");
  reply.header("content-disposition", "inline");
  return reply.send(row.data);
}

/** Staff may view a photo only for identity confirmation (scanning) or credential administration. */
function requirePhotoAccess(req: FastifyRequest) {
  const auth = requireAuth(req);
  if (auth.privileged && !auth.mfaVerified) throw Errors.mfaRequired();
  if (
    !hasPermission(auth, "scan.admit") &&
    !hasPermission(auth, "credential.read") &&
    !hasPermission(auth, "registration.read")
  ) {
    throw Errors.forbidden();
  }
  return auth;
}

export async function photoRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { db } = app.ctx;

  app.put(
    "/me/photo",
    {
      schema: { body: PhotoUploadInput, tags: ["participant"] },
      bodyLimit: 3_200_000,
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req) => {
      const auth = requireVerifiedAccount(req);
      const data = Buffer.from(req.body.dataBase64, "base64");
      if (data.length === 0 || data.length > MAX_BYTES) {
        throw Errors.badRequest("PHOTO_TOO_LARGE", "Use a photo of 2 MB or less.");
      }
      const sniffed = sniffImage(data);
      if (!sniffed || sniffed !== req.body.contentType) {
        throw Errors.badRequest("PHOTO_INVALID", "Upload a JPEG, PNG or WebP image.");
      }
      const sha256 = createHash("sha256").update(data).digest("hex");
      await db.query(
        `insert into participant_photos (user_id, content_type, data, byte_size, sha256) values ($1, $2, $3, $4, $5)
         on conflict (user_id) do update set content_type = excluded.content_type, data = excluded.data,
           byte_size = excluded.byte_size, sha256 = excluded.sha256, uploaded_at = now()`,
        [auth.user.id, sniffed, data, data.length, sha256],
      );
      return { ok: true, bytes: data.length };
    },
  );

  app.get("/me/photo", { schema: { tags: ["participant"] } }, async (req, reply) => {
    const auth = requireVerifiedAccount(req);
    return sendPhoto(
      reply,
      await one<{ content_type: string; data: Buffer }>(
        db,
        "select content_type, data from participant_photos where user_id = $1",
        [auth.user.id],
      ),
    );
  });

  app.get(
    "/staff/photos/credential/:credentialId",
    { schema: { params: z.object({ credentialId: z.uuid() }), tags: ["scanner"] } },
    async (req, reply) => {
      requirePhotoAccess(req);
      const row = await one<{ content_type: string; data: Buffer }>(
        db,
        `select p.content_type, p.data from accreditation_credentials c
           join participant_photos p on p.user_id = c.user_id where c.id = $1`,
        [req.params.credentialId],
      );
      return sendPhoto(reply, row);
    },
  );

  app.get(
    "/staff/photos/registration/:registrationId",
    { schema: { params: z.object({ registrationId: z.uuid() }), tags: ["registration-admin"] } },
    async (req, reply) => {
      requirePhotoAccess(req);
      const row = await one<{ content_type: string; data: Buffer }>(
        db,
        `select p.content_type, p.data from registrations r
           join participant_photos p on p.user_id = r.user_id where r.id = $1`,
        [req.params.registrationId],
      );
      if (row) {
        await audit(db, req, { action: "photo.viewed", entityType: "registration", entityId: req.params.registrationId });
      }
      return sendPhoto(reply, row);
    },
  );
}
