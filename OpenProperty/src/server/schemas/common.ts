import { z } from "zod";

export const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM");

export const uuidSchema = z.string().uuid();

export const rentChargeStatusSchema = z.enum(["open", "partial", "paid", "overdue", "waived"]);

const settingValue = z.union([z.string(), z.number(), z.boolean()]);

/** Known organization settings only. Unknown keys are rejected. */
export const settingsPatchSchema = z
  .object({
    default_rent_due_day: settingValue.optional(),
    late_fee_amount: settingValue.optional(),
    late_fee_grace_days: settingValue.optional(),
    currency: settingValue.optional(),
    timezone: settingValue.optional(),
    language: settingValue.optional(),
    date_format: settingValue.optional(),
    area_unit: settingValue.optional(),
    landlord_first_name: settingValue.optional(),
    landlord_last_name: settingValue.optional(),
    landlord_email: settingValue.optional(),
    landlord_government_id: settingValue.optional(),
    bank_holder: settingValue.optional(),
    bank_name: settingValue.optional(),
    bank_account: settingValue.optional(),
    bank_clabe: settingValue.optional(),
  })
  .strict();

export const organizationPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    currency: z.string().trim().min(3).max(3).optional(),
    language: z.enum(["es", "en"]).optional(),
    date_format: z.enum(["dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd"]).optional(),
    area_unit: z.enum(["m2", "ft2"]).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "At least one field is required",
  });

export const inviteMemberSchema = z
  .object({
    email: z.string().trim().email().max(254),
    role: z.enum(["owner", "manager", "staff", "viewer"]),
  })
  .strict();

export const memberRoleSchema = z
  .object({
    role: z.enum(["owner", "manager", "staff", "viewer"]),
  })
  .strict();
