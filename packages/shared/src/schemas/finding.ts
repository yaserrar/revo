import { z } from 'zod';
import { CATEGORIES, SEVERITIES } from '../constants';

export const CategorySchema = z.enum(CATEGORIES);
export const SeveritySchema = z.enum(SEVERITIES);

/** Longest replacement code kept for a one-click fix (characters). */
export const REPLACEMENT_MAX_CHARS = 3000;
/** Most lines a one-click fix may replace. */
export const REPLACEMENT_MAX_LINES = 20;

/**
 * A problem reported by pass 1 (spec section 8). This is the shape the model
 * fills through its tool; lines refer to the NEW version of the file.
 */
export const FindingSchema = z
  .object({
    category: CategorySchema,
    severity: SeveritySchema,
    file: z.string().min(1),
    lineStart: z.number().int().min(1),
    lineEnd: z.number().int().min(1),
    /** e.g. "Discount applied after tax" */
    title: z.string().min(1).max(100),
    /** What is wrong and why it matters. */
    explanation: z.string().min(1).max(800),
    /** How to fix it, with code if short. */
    suggestion: z.string().max(800),
    confidence: z.number().min(0).max(1),
    /**
     * The exact new code for lines lineStart..lineEnd, when the fix is a local
     * edit of those lines: posted as a GitHub suggested change (one click to apply).
     */
    replacement: z.string().max(REPLACEMENT_MAX_CHARS).optional(),
  })
  .refine((f) => f.lineEnd >= f.lineStart, { message: 'lineEnd must be >= lineStart', path: ['lineEnd'] });
export type Finding = z.infer<typeof FindingSchema>;

export const VERIFICATION_OUTCOMES = ['confirmed', 'rejected'] as const;
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];

/**
 * Pass 2's answer for one finding (spec section 8). The spec's `verdict`
 * field is named `outcome` here.
 */
export const VerificationSchema = z.object({
  /** Index of the finding from pass 1. */
  index: z.number().int().min(0),
  outcome: z.enum(VERIFICATION_OUTCOMES),
  reason: z.string().max(400),
  /** Only when pass 2 lowers the severity. */
  severity: SeveritySchema.optional(),
  /** Pass 2's check of the finding's `replacement`: anything but true drops it. */
  replacementSafe: z.boolean().optional(),
});
export type Verification = z.infer<typeof VerificationSchema>;

export const FindingsToolInputSchema = z.object({ findings: z.array(FindingSchema).max(10) });
export const VerificationsToolInputSchema = z.object({ verifications: z.array(VerificationSchema) });
