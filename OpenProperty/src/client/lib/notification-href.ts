export type NotificationLinkInput = {
  kind: string;
  entity_type?: string | null;
  entity_id?: string | null;
  period?: string | null;
  signature_lease_id?: string | null;
};

function rentPeriod(period: string | null | undefined): string | null {
  return period && /^\d{4}-\d{2}$/.test(period) ? period : null;
}

/** In-app path for a staff notification row, or null when there is no sensible destination. */
export function notificationHref(row: NotificationLinkInput): string | null {
  const entityType = row.entity_type ?? null;
  const entityId = row.entity_id ?? null;
  const period = rentPeriod(row.period);

  switch (entityType) {
    case "rent_charge":
      return period
        ? `/rent?period=${period}${row.kind === "rent_overdue" ? "&status=overdue" : ""}`
        : row.kind === "rent_overdue"
          ? "/rent?status=overdue"
          : "/rent";
    case "lease":
      return entityId ? `/leases/${entityId}/edit` : "/leases";
    case "lease_signature":
      return row.signature_lease_id
        ? `/leases/${row.signature_lease_id}/edit`
        : "/leases";
    case "work_order":
      return "/maintenance";
    case "payment_submission":
      return "/rent";
    case "tenant":
      return entityId ? `/tenants/${entityId}` : "/tenants";
    default:
      break;
  }

  switch (row.kind) {
    case "rent_due":
      return period ? `/rent?period=${period}` : "/rent";
    case "rent_overdue":
      return period ? `/rent?period=${period}&status=overdue` : "/rent?status=overdue";
    case "lease_expiring":
      return entityId ? `/leases/${entityId}/edit` : "/leases";
    case "work_order":
      return "/maintenance";
    case "signature":
      return row.signature_lease_id ? `/leases/${row.signature_lease_id}/edit` : "/leases";
    case "payment_receipt":
      return "/rent";
    default:
      return null;
  }
}