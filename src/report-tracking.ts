import { z } from "zod";

const revisionSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-f0-9]{7,40}$/,
    "Expected 7 to 40 lowercase hexadecimal characters.",
  );

const handoffSchema = z.object({
  nextOwner: z.string().trim().min(1).max(200),
  nextOwnerKind: z.enum(["human", "agent", "unknown"]),
  nextAction: z.string().trim().min(1).max(2000),
  dependency: z.string().trim().min(1).max(2000).optional(),
  waitingOnSubtaskIds: z.array(z.string().trim().min(1)).max(100).optional(),
});

const artifactSchema = z.object({
  label: z.string().trim().min(1).max(200),
  url: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return (
          (parsed.protocol === "http:" || parsed.protocol === "https:") &&
          parsed.username.length === 0 &&
          parsed.password.length === 0
        );
      } catch {
        return false;
      }
    }, "Expected an HTTP or HTTPS URL without credentials."),
  kind: z.enum(["artifact", "preview", "test", "review"]),
  testedRevision: revisionSchema.optional(),
});

export const reportTrackingSchema = z.object({
  handoff: handoffSchema.optional(),
  testedRevision: revisionSchema.optional(),
  artifacts: z.array(artifactSchema).max(20).optional(),
});

export type ReportHandoff = z.infer<typeof handoffSchema>;
export type ReportArtifact = z.infer<typeof artifactSchema>;
export type ReportTracking = z.infer<typeof reportTrackingSchema>;
