import type { Sql } from "../db";
import { insertNotification } from "./insert";

/** Canonical portal payments page. The cron has no request host. */
export const PORTAL_PAYMENTS_URL = "https://rent.sulbase.com/app/portal/pagos";

const TITLES = ["Primer aviso de mora", "Segundo aviso de mora", "Tercer aviso de mora"] as const;

const LETTER = `Según nuestros registros, no hemos recibido el pago de su cuenta de renta. Le recordamos que la renta vence el día indicado en su contrato de cada mes. Los pagos que no se reciben a tiempo están sujetos a un cargo por mora.

Le hacemos presente este asunto pensando que el pago pudo haberse pasado por alto. Agradeceremos su pronto pago.
Para su comodidad, puede pagar en el portal:
${PORTAL_PAYMENTS_URL}`;

export type LateNoticeCharge = {
  organizationId: string;
  tenantId: string;
  userId: string | null;
  tenantName: string;
  organizationName: string;
  dueDate: string;
  daysLate: number;
  balance: number;
  unitName: string;
  propertyName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  currency: string;
  dateFormat: string;
  noticeDate: string;
};

export type LateNoticeDraft = {
  organizationId: string;
  tenantId: string;
  userId: string | null;
  dueDate: string;
  stage: 1 | 2 | 3;
  title: string;
  body: string;
  period: string;
};

type UnitLine = {
  unitName: string;
  propertyName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  balance: number;
};

const CHARGE_SQL = `SELECT c.organization_id, t.id AS tenant_id, t.user_id,
  trim(concat_ws(' ', t.first_name, t.last_name)) AS tenant_name,
  o.name AS organization_name,
  c.due_date::text AS due_date,
  (CURRENT_DATE - c.due_date) AS days_late,
  (c.amount - c.amount_paid) AS balance,
  u.name AS unit_name,
  p.name AS property_name,
  p.address, p.city, p.state, p.zip,
  COALESCE(cur.value, 'MXN') AS currency,
  COALESCE(fmt.value, 'dd/MM/yyyy') AS date_format,
  CURRENT_DATE::text AS notice_date
FROM rent_charges c
JOIN leases l ON l.id = c.lease_id AND l.organization_id = c.organization_id
JOIN tenants t ON t.id = l.primary_tenant_id AND t.organization_id = l.organization_id
JOIN units u ON u.id = l.unit_id AND u.organization_id = l.organization_id
JOIN properties p ON p.id = u.property_id AND p.organization_id = u.organization_id
JOIN organizations o ON o.id = c.organization_id
LEFT JOIN settings cur ON cur.organization_id = c.organization_id AND cur.key = 'currency'
LEFT JOIN settings fmt ON fmt.organization_id = c.organization_id AND fmt.key = 'date_format'
WHERE l.status = 'active'
  AND l.primary_tenant_id IS NOT NULL
  AND c.due_date BETWEEN CURRENT_DATE - 2 AND CURRENT_DATE
  AND c.amount_paid < c.amount
  AND c.status <> 'waived'
ORDER BY c.organization_id, t.id, c.due_date, p.name, u.name`;

export function lateNoticeTitle(stage: 1 | 2 | 3): string {
  return TITLES[stage - 1];
}

export function lateNoticePeriod(stage: 1 | 2 | 3, dueDate: string): string {
  return `${stage}:${dueDate.slice(0, 10)}`;
}

export function formatNoticeDate(iso: string, format: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso.slice(0, 10);
  if (format === "MM/dd/yyyy") return `${month}/${day}/${year}`;
  if (format === "yyyy-MM-dd") return `${year}-${month}-${day}`;
  return `${day}/${month}/${year}`;
}

export function formatNoticeMoney(amount: number, currency: string): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "MXN";
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }
}

function placeLine(
  row: Pick<UnitLine, "address" | "city" | "state" | "zip" | "propertyName">,
): string {
  const street = row.address?.trim() || row.propertyName.trim() || "Unidad";
  const locality = [
    row.city?.trim(),
    [row.state?.trim(), row.zip?.trim()].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  return locality ? `${street}\n${locality}` : street;
}

function buildBody(input: {
  tenantName: string;
  organizationName: string;
  noticeDate: string;
  dateFormat: string;
  currency: string;
  units: UnitLine[];
}): string {
  const name = input.tenantName.trim() || "inquilino";
  const units = [...input.units].sort((a, b) =>
    `${a.propertyName} ${a.unitName}`.localeCompare(`${b.propertyName} ${b.unitName}`, "es"),
  );
  const total = units.reduce((sum, unit) => sum + unit.balance, 0);
  const lines = units.map(
    (unit) =>
      `${placeLine(unit)}. Unidad: ${unit.unitName} — ${formatNoticeMoney(unit.balance, input.currency)}`,
  );
  const signaturePlaces = [...new Set(units.map((unit) => placeLine(unit)))];
  return [
    `Fecha del aviso: ${formatNoticeDate(input.noticeDate, input.dateFormat)}`,
    `Entregar a: ${name}`,
    "",
    ...lines,
    `Saldo pendiente: ${formatNoticeMoney(total, input.currency)}`,
    "",
    `Estimado ${name}:`,
    "",
    LETTER,
    "",
    "Atentamente,",
    input.organizationName.trim() || "Administración",
    ...signaturePlaces,
  ].join("\n");
}

/** One letter per tenant and due date. Units that share that date stay in the same notice. */
export function groupLateNotices(rows: LateNoticeCharge[]): LateNoticeDraft[] {
  const groups = new Map<string, LateNoticeCharge[]>();
  for (const row of rows) {
    if (!(row.balance > 0) || row.daysLate < 0 || row.daysLate > 2) continue;
    const dueDate = row.dueDate.slice(0, 10);
    const key = `${row.organizationId}|${row.tenantId}|${dueDate}|${row.daysLate}`;
    const list = groups.get(key) ?? [];
    list.push({ ...row, dueDate });
    groups.set(key, list);
  }

  const drafts: LateNoticeDraft[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    if (!first) continue;
    const stage = (first.daysLate + 1) as 1 | 2 | 3;
    const byUnit = new Map<string, UnitLine>();
    for (const row of list) {
      const key = `${row.propertyName}|${row.unitName}|${row.address ?? ""}`;
      const current = byUnit.get(key);
      if (current) {
        current.balance = Math.round((current.balance + row.balance) * 100) / 100;
      } else {
        byUnit.set(key, {
          unitName: row.unitName,
          propertyName: row.propertyName,
          address: row.address,
          city: row.city,
          state: row.state,
          zip: row.zip,
          balance: row.balance,
        });
      }
    }
    drafts.push({
      organizationId: first.organizationId,
      tenantId: first.tenantId,
      userId: first.userId,
      dueDate: first.dueDate,
      stage,
      title: lateNoticeTitle(stage),
      period: lateNoticePeriod(stage, first.dueDate),
      body: buildBody({
        tenantName: first.tenantName,
        organizationName: first.organizationName,
        noticeDate: first.noticeDate,
        dateFormat: first.dateFormat,
        currency: first.currency,
        units: [...byUnit.values()],
      }).slice(0, 2000),
    });
  }
  return drafts;
}

function asCharge(row: Record<string, unknown>): LateNoticeCharge {
  return {
    organizationId: String(row.organization_id),
    tenantId: String(row.tenant_id),
    userId: row.user_id == null ? null : String(row.user_id),
    tenantName: String(row.tenant_name ?? ""),
    organizationName: String(row.organization_name ?? ""),
    dueDate: String(row.due_date),
    daysLate: Number(row.days_late),
    balance: Number(row.balance),
    unitName: String(row.unit_name ?? ""),
    propertyName: String(row.property_name ?? ""),
    address: row.address == null ? null : String(row.address),
    city: row.city == null ? null : String(row.city),
    state: row.state == null ? null : String(row.state),
    zip: row.zip == null ? null : String(row.zip),
    currency: String(row.currency ?? "MXN"),
    dateFormat: String(row.date_format ?? "dd/MM/yyyy"),
    noticeDate: String(row.notice_date),
  };
}

/** Insert one portal letter per tenant and due date. A repeated stage is ignored. */
export async function generateLateNotices(sql: Sql): Promise<number> {
  const rows = await sql.unsafe(CHARGE_SQL);
  const drafts = groupLateNotices((rows as unknown as Record<string, unknown>[]).map(asCharge));
  let inserted = 0;
  for (const draft of drafts) {
    const created = await insertNotification(sql, {
      organizationId: draft.organizationId,
      userId: draft.userId,
      kind: "rent_late_notice",
      title: draft.title,
      body: draft.body,
      severity: draft.stage === 3 ? "critical" : "warning",
      entityType: "tenant",
      entityId: draft.tenantId,
      period: draft.period,
    });
    if (created) inserted += 1;
  }
  return inserted;
}
