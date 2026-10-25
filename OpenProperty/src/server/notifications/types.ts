export const NOTIFICATION_KINDS = [
  "rent_due",
  "rent_overdue",
  "lease_expiring",
  "work_order",
  "signature",
  "payment_receipt",
  "system",
] as const;

export const NOTIFICATION_SEVERITIES = ["info", "warning", "critical"] as const;

export const NOTIFICATION_ENTITY_TYPES = [
  "rent_charge",
  "lease",
  "work_order",
  "lease_signature",
  "payment_submission",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export type NotificationDraft = {
  organizationId: string;
  userId?: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  severity: NotificationSeverity;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  period: string;
};
