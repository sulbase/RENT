import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "manager",
  "staff",
  "viewer",
]);

export const propertyTypeEnum = pgEnum("property_type", [
  "single_family",
  "multi_family",
  "condo",
  "townhouse",
  "commercial",
]);

export const unitStatusEnum = pgEnum("unit_status", [
  "vacant",
  "occupied",
  "turnover",
  "unavailable",
]);

export const maritalStatusEnum = pgEnum("marital_status", [
  "soltero",
  "casado",
  "divorciado",
  "viudo",
  "union_libre",
  "separado",
]);

export const leaseStatusEnum = pgEnum("lease_status", [
  "upcoming",
  "active",
  "ended",
  "cancelled",
]);

export const rentChargeStatusEnum = pgEnum("rent_charge_status", [
  "open",
  "partial",
  "paid",
  "overdue",
  "waived",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "check",
  "ach",
  "credit",
  "other",
]);

export const vendorCategoryEnum = pgEnum("vendor_category", [
  "plumber",
  "electrician",
  "hvac",
  "handyman",
  "cleaning",
  "landscaping",
  "general",
]);

export const workOrderPriorityEnum = pgEnum("work_order_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const workOrderStatusEnum = pgEnum("work_order_status", [
  "open",
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
]);

export const applicationStatusEnum = pgEnum("application_status", [
  "new",
  "screening",
  "approved",
  "declined",
  "withdrawn",
]);

export const documentEntityTypeEnum = pgEnum("document_entity_type", [
  "property",
  "unit",
  "lease",
  "tenant",
  "work_order",
  "message",
]);

export const messageParticipantKindEnum = pgEnum("message_participant_kind", [
  "membership",
  "tenant",
]);

export const messageParticipantRoleEnum = pgEnum("message_participant_role", [
  "from",
  "to",
  "cc",
]);

export const messageThreadEntityTypeEnum = pgEnum("message_thread_entity_type", [
  "property",
  "lease",
  "tenant",
  "work_order",
]);

export const documentKindEnum = pgEnum("document_kind", [
  "image",
  "deed",
  "certificate",
  "invoice",
  "signed_lease",
  "inventory",
  "signed_inventory",
  "other",
]);

export const signaturePurposeEnum = pgEnum("signature_purpose", ["lease", "inventory"]);

export const signatureProviderEnum = pgEnum("signature_provider", ["firma_dev"]);

export const leaseSignatureStatusEnum = pgEnum("lease_signature_status", [
  "draft",
  "sent",
  "viewed",
  "partially_signed",
  "completed",
  "declined",
  "expired",
  "cancelled",
]);

export const signatureRecipientRoleEnum = pgEnum("signature_recipient_role", [
  "owner",
  "tenant",
]);

export const signatureRecipientStatusEnum = pgEnum("signature_recipient_status", [
  "pending",
  "viewed",
  "signed",
  "declined",
]);

export type JsonObject = Record<string, unknown>;

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: membershipRoleEnum("role").notNull().default("staff"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("idx_memberships_user").on(table.userId),
  ],
);

/**
 * Pending access keyed by email. Accepted when that address signs in
 * (`acceptPendingInvitations`); no SMTP in this phase.
 */
export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: membershipRoleEnum("role").notNull(),
    invitedBy: uuid("invited_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_org_invitations_pending_email")
      .on(table.organizationId, table.email)
      .where(sql`${table.acceptedAt} IS NULL`),
    index("idx_org_invitations_email").on(table.email),
    check(
      "organization_invitations_email_len",
      sql`char_length(${table.email}) BETWEEN 3 AND 254`,
    ),
  ],
);

export const settings = pgTable(
  "settings",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.key] }),
    index("idx_settings_org").on(table.organizationId),
  ],
);

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: propertyTypeEnum("type").notNull().default("single_family"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    yearBuilt: integer("year_built"),
    notes: text("notes"),
    color: text("color").notNull().default("sky"),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_properties_org").on(table.organizationId),
    uniqueIndex("uq_properties_id_org").on(table.id, table.organizationId),
  ],
);

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    propertyId: uuid("property_id").notNull(),
    name: text("name").notNull(),
    bedrooms: numeric("bedrooms", { precision: 4, scale: 1 })
      .notNull()
      .default("1"),
    bathrooms: numeric("bathrooms", { precision: 4, scale: 1 })
      .notNull()
      .default("1"),
    sqft: integer("sqft"),
    marketRent: numeric("market_rent", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    status: unitStatusEnum("status").notNull().default("vacant"),
    /** Piso del edificio. Negativo para sótanos. */
    floor: integer("floor"),
    /** Slug fijo (departamento, suite, local, parqueadero) o etiqueta extra de la organización. */
    unitType: text("unit_type").notNull().default("departamento"),
    furnished: boolean("furnished").notNull().default(false),
    aliquotPrice: numeric("aliquot_price", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.propertyId, table.organizationId],
      foreignColumns: [properties.id, properties.organizationId],
    }).onDelete("cascade"),
    index("idx_units_org").on(table.organizationId),
    index("idx_units_property").on(table.propertyId),
    index("idx_units_org_status").on(table.organizationId, table.status),
    uniqueIndex("uq_units_id_org").on(table.id, table.organizationId),
    check(
      "units_floor",
      sql`${table.floor} IS NULL OR ${table.floor} BETWEEN -5 AND 200`,
    ),
    check(
      "units_unit_type_len",
      sql`char_length(${table.unitType}) BETWEEN 1 AND 40`,
    ),
    check("units_aliquot_price", sql`${table.aliquotPrice} >= 0`),
  ],
);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    dateOfBirth: date("date_of_birth"),
    emergencyContact: text("emergency_contact"),
    employer: text("employer"),
    monthlyIncome: numeric("monthly_income", { precision: 12, scale: 2 }),
    /** Número de identificación (CURP u otro). Máximo 18 caracteres. */
    governmentId: text("government_id"),
    maritalStatus: maritalStatusEnum("marital_status"),
    occupation: text("occupation"),
    workAddress: text("work_address"),
    previousAddress: text("previous_address"),
    occupantCount: integer("occupant_count"),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_tenants_org").on(table.organizationId),
    index("idx_tenants_org_name").on(
      table.organizationId,
      table.lastName,
      table.firstName,
    ),
    uniqueIndex("uq_tenants_id_org").on(table.id, table.organizationId),
    check(
      "tenants_government_id_len",
      sql`${table.governmentId} IS NULL OR char_length(${table.governmentId}) BETWEEN 1 AND 18`,
    ),
    check(
      "tenants_occupation_len",
      sql`${table.occupation} IS NULL OR char_length(${table.occupation}) BETWEEN 1 AND 80`,
    ),
    check(
      "tenants_work_address_len",
      sql`${table.workAddress} IS NULL OR char_length(${table.workAddress}) BETWEEN 1 AND 200`,
    ),
    check(
      "tenants_previous_address_len",
      sql`${table.previousAddress} IS NULL OR char_length(${table.previousAddress}) BETWEEN 1 AND 200`,
    ),
    check(
      "tenants_occupant_count",
      sql`${table.occupantCount} IS NULL OR ${table.occupantCount} BETWEEN 0 AND 99`,
    ),
  ],
);

export const leases = pgTable(
  "leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    primaryTenantId: uuid("primary_tenant_id"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    monthlyRent: numeric("monthly_rent", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    deposit: numeric("deposit", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    rentDueDay: integer("rent_due_day").notNull().default(1),
    lateFee: numeric("late_fee", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    status: leaseStatusEnum("status").notNull().default("active"),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.unitId, table.organizationId],
      foreignColumns: [units.id, units.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.primaryTenantId, table.organizationId],
      foreignColumns: [tenants.id, tenants.organizationId],
    }).onDelete("set null"),
    index("idx_leases_org").on(table.organizationId),
    index("idx_leases_unit").on(table.unitId),
    index("idx_leases_tenant").on(table.primaryTenantId),
    index("idx_leases_org_status").on(table.organizationId, table.status),
    uniqueIndex("uq_leases_id_org").on(table.id, table.organizationId),
    uniqueIndex("uq_leases_open_unit")
      .on(table.organizationId, table.unitId)
      .where(sql`${table.status} in ('upcoming', 'active')`),
  ],
);

export const leaseTenants = pgTable(
  "lease_tenants",
  {
    organizationId: uuid("organization_id").notNull(),
    leaseId: uuid("lease_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.leaseId, table.tenantId] }),
    foreignKey({
      columns: [table.leaseId, table.organizationId],
      foreignColumns: [leases.id, leases.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [tenants.id, tenants.organizationId],
    }).onDelete("cascade"),
    index("idx_lease_tenants_org").on(table.organizationId),
  ],
);

export const rentCharges = pgTable(
  "rent_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    leaseId: uuid("lease_id").notNull(),
    period: text("period").notNull(),
    dueDate: date("due_date").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    status: rentChargeStatusEnum("status").notNull().default("open"),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.leaseId, table.organizationId],
      foreignColumns: [leases.id, leases.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("idx_charges_lease_period").on(table.leaseId, table.period),
    index("idx_charges_org_due").on(table.organizationId, table.dueDate),
    index("idx_charges_org_status").on(table.organizationId, table.status),
    uniqueIndex("uq_rent_charges_id_org").on(table.id, table.organizationId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    chargeId: uuid("charge_id").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    amount: numeric("amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    method: paymentMethodEnum("method").notNull().default("cash"),
    reference: text("reference"),
    notes: text("notes"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    voidedBy: uuid("voided_by"),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
  },
  (table) => [
    foreignKey({
      columns: [table.chargeId, table.organizationId],
      foreignColumns: [rentCharges.id, rentCharges.organizationId],
    }).onDelete("cascade"),
    index("idx_payments_org").on(table.organizationId),
    index("idx_payments_charge").on(table.chargeId),
    index("idx_payments_active_charge")
      .on(table.organizationId, table.chargeId)
      .where(sql`${table.voidedAt} IS NULL`),
    uniqueIndex("uq_payments_id_org").on(table.id, table.organizationId),
    check(
      "payments_void_pair",
      sql`(
        ${table.voidedAt} IS NULL AND ${table.voidReason} IS NULL
      ) OR (
        ${table.voidedAt} IS NOT NULL
        AND ${table.voidReason} IS NOT NULL
        AND char_length(${table.voidReason}) BETWEEN 1 AND 200
      )`,
    ),
  ],
);

export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: vendorCategoryEnum("category").notNull().default("general"),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    color: text("color").notNull().default("slate"),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_vendors_org").on(table.organizationId),
    uniqueIndex("uq_vendors_id_org").on(table.id, table.organizationId),
  ],
);

export const workOrders = pgTable(
  "work_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id"),
    unitId: uuid("unit_id"),
    tenantId: uuid("tenant_id"),
    vendorId: uuid("vendor_id"),
    title: text("title").notNull(),
    description: text("description"),
    priority: workOrderPriorityEnum("priority").notNull().default("normal"),
    status: workOrderStatusEnum("status").notNull().default("open"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cost: numeric("cost", { precision: 12, scale: 2 }),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.propertyId, table.organizationId],
      foreignColumns: [properties.id, properties.organizationId],
    }).onDelete("set null"),
    foreignKey({
      columns: [table.unitId, table.organizationId],
      foreignColumns: [units.id, units.organizationId],
    }).onDelete("set null"),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [tenants.id, tenants.organizationId],
    }).onDelete("set null"),
    foreignKey({
      columns: [table.vendorId, table.organizationId],
      foreignColumns: [vendors.id, vendors.organizationId],
    }).onDelete("set null"),
    index("idx_wo_org_status").on(table.organizationId, table.status),
    index("idx_wo_org_property").on(table.organizationId, table.propertyId),
    index("idx_wo_org_unit").on(table.organizationId, table.unitId),
    uniqueIndex("uq_work_orders_id_org").on(table.id, table.organizationId),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    monthlyIncome: numeric("monthly_income", { precision: 12, scale: 2 }),
    employer: text("employer"),
    desiredMoveIn: date("desired_move_in"),
    status: applicationStatusEnum("status").notNull().default("new"),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.unitId, table.organizationId],
      foreignColumns: [units.id, units.organizationId],
    }).onDelete("set null"),
    index("idx_applications_org_status").on(table.organizationId, table.status),
    uniqueIndex("uq_applications_id_org").on(table.id, table.organizationId),
  ],
);

/** Plain-text cap for an in-app mail body. Enforced again in the route. */
const MAX_MESSAGE_BODY = 10_000;

export const messageThreads = pgTable(
  "message_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    entityType: messageThreadEntityTypeEnum("entity_type"),
    entityId: uuid("entity_id"),
    propertyId: uuid("property_id"),
    leaseId: uuid("lease_id"),
    tenantId: uuid("tenant_id"),
    workOrderId: uuid("work_order_id"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.propertyId, table.organizationId],
      foreignColumns: [properties.id, properties.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.leaseId, table.organizationId],
      foreignColumns: [leases.id, leases.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [tenants.id, tenants.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workOrderId, table.organizationId],
      foreignColumns: [workOrders.id, workOrders.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("uq_message_threads_id_org").on(table.id, table.organizationId),
    index("idx_message_threads_org_recent").on(table.organizationId, table.lastMessageAt),
    index("idx_message_threads_property").on(table.propertyId),
    index("idx_message_threads_lease").on(table.leaseId),
    index("idx_message_threads_tenant").on(table.tenantId),
    index("idx_message_threads_work_order").on(table.workOrderId),
    check("message_threads_subject_len", sql`char_length(${table.subject}) BETWEEN 1 AND 200`),
    check(
      "message_threads_entity_pair",
      sql`(
        (${table.entityType} IS NULL AND ${table.entityId} IS NULL AND ${table.propertyId} IS NULL AND ${table.leaseId} IS NULL AND ${table.tenantId} IS NULL AND ${table.workOrderId} IS NULL)
        OR (${table.entityType} = 'property' AND ${table.propertyId} = ${table.entityId} AND ${table.leaseId} IS NULL AND ${table.tenantId} IS NULL AND ${table.workOrderId} IS NULL)
        OR (${table.entityType} = 'lease' AND ${table.leaseId} = ${table.entityId} AND ${table.propertyId} IS NULL AND ${table.tenantId} IS NULL AND ${table.workOrderId} IS NULL)
        OR (${table.entityType} = 'tenant' AND ${table.tenantId} = ${table.entityId} AND ${table.propertyId} IS NULL AND ${table.leaseId} IS NULL AND ${table.workOrderId} IS NULL)
        OR (${table.entityType} = 'work_order' AND ${table.workOrderId} = ${table.entityId} AND ${table.propertyId} IS NULL AND ${table.leaseId} IS NULL AND ${table.tenantId} IS NULL)
      )`,
    ),
  ],
);

export const messageThreadParticipants = pgTable(
  "message_thread_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    threadId: uuid("thread_id").notNull(),
    participantKind: messageParticipantKindEnum("participant_kind").notNull(),
    userId: uuid("user_id"),
    tenantId: uuid("tenant_id"),
    email: text("email").notNull(),
    role: messageParticipantRoleEnum("role").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.threadId, table.organizationId],
      foreignColumns: [messageThreads.id, messageThreads.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [tenants.id, tenants.organizationId],
    }).onDelete("cascade"),
    index("idx_message_participants_thread").on(table.threadId),
    index("idx_message_participants_user")
      .on(table.organizationId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    index("idx_message_participants_tenant").on(table.tenantId),
    uniqueIndex("uq_message_participants_user")
      .on(table.threadId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    uniqueIndex("uq_message_participants_tenant")
      .on(table.threadId, table.tenantId)
      .where(sql`${table.tenantId} IS NOT NULL`),
    check("message_participants_email_len", sql`char_length(${table.email}) BETWEEN 3 AND 320`),
    check(
      "message_participants_kind",
      sql`(
        (${table.participantKind} = 'membership' AND ${table.userId} IS NOT NULL AND ${table.tenantId} IS NULL)
        OR (${table.participantKind} = 'tenant' AND ${table.tenantId} IS NOT NULL AND ${table.userId} IS NULL)
      )`,
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    senderUserId: uuid("sender_user_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.threadId, table.organizationId],
      foreignColumns: [messageThreads.id, messageThreads.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("uq_messages_id_org").on(table.id, table.organizationId),
    index("idx_messages_thread_created").on(table.threadId, table.createdAt),
    index("idx_messages_sender").on(table.organizationId, table.senderUserId),
    check(
      "messages_body_len",
      sql`char_length(${table.body}) BETWEEN 1 AND ${sql.raw(String(MAX_MESSAGE_BODY))}`,
    ),
  ],
);

export const messageReads = pgTable(
  "message_reads",
  {
    messageId: uuid("message_id").notNull(),
    userId: uuid("user_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    foreignKey({
      columns: [table.messageId, table.organizationId],
      foreignColumns: [messages.id, messages.organizationId],
    }).onDelete("cascade"),
    index("idx_message_reads_user").on(table.organizationId, table.userId),
  ],
);

/** Database ceiling. Lease photos allow 15 MiB; other uploads stay at 10 MiB in the route. */
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityType: documentEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    propertyId: uuid("property_id"),
    unitId: uuid("unit_id"),
    leaseId: uuid("lease_id"),
    tenantId: uuid("tenant_id"),
    workOrderId: uuid("work_order_id"),
    messageId: uuid("message_id"),
    kind: documentKindEnum("kind").notNull(),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: uuid("uploaded_by"),
    isCover: boolean("is_cover").notNull().default(false),
    /** Extra category chosen from the organization's lease attachment list. */
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.propertyId, table.organizationId],
      foreignColumns: [properties.id, properties.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.unitId, table.organizationId],
      foreignColumns: [units.id, units.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.leaseId, table.organizationId],
      foreignColumns: [leases.id, leases.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [tenants.id, tenants.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workOrderId, table.organizationId],
      foreignColumns: [workOrders.id, workOrders.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.messageId, table.organizationId],
      foreignColumns: [messages.id, messages.organizationId],
    }).onDelete("cascade"),
    index("idx_documents_org").on(table.organizationId),
    index("idx_documents_entity")
      .on(table.organizationId, table.entityType, table.entityId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("idx_documents_property_id").on(table.propertyId),
    index("idx_documents_unit_id").on(table.unitId),
    index("idx_documents_lease_id").on(table.leaseId),
    index("idx_documents_tenant_id").on(table.tenantId),
    index("idx_documents_work_order_id").on(table.workOrderId),
    index("idx_documents_message_id").on(table.messageId),
    uniqueIndex("uq_documents_r2_key").on(table.r2Key),
    uniqueIndex("uq_documents_one_cover")
      .on(table.organizationId, table.entityType, table.entityId)
      .where(sql`${table.isCover} = true AND ${table.deletedAt} IS NULL`),
    check(
      "documents_entity_target",
      sql`(
        (${table.entityType} = 'property' AND ${table.propertyId} = ${table.entityId} AND ${table.unitId} IS NULL AND ${table.leaseId} IS NULL AND ${table.tenantId} IS NULL AND ${table.workOrderId} IS NULL AND ${table.messageId} IS NULL)
        OR (${table.entityType} = 'unit' AND ${table.unitId} = ${table.entityId} AND ${table.propertyId} IS NULL AND ${table.leaseId} IS NULL AND ${table.tenantId} IS NULL AND ${table.workOrderId} IS NULL AND ${table.messageId} IS NULL)
        OR (${table.entityType} = 'lease' AND ${table.leaseId} = ${table.entityId} AND ${table.propertyId} IS NULL AND ${table.unitId} IS NULL AND ${table.tenantId} IS NULL AND ${table.workOrderId} IS NULL AND ${table.messageId} IS NULL)
        OR (${table.entityType} = 'tenant' AND ${table.tenantId} = ${table.entityId} AND ${table.propertyId} IS NULL AND ${table.unitId} IS NULL AND ${table.leaseId} IS NULL AND ${table.workOrderId} IS NULL AND ${table.messageId} IS NULL)
        OR (${table.entityType} = 'work_order' AND ${table.workOrderId} = ${table.entityId} AND ${table.propertyId} IS NULL AND ${table.unitId} IS NULL AND ${table.leaseId} IS NULL AND ${table.tenantId} IS NULL AND ${table.messageId} IS NULL)
        OR (${table.entityType} = 'message' AND ${table.messageId} = ${table.entityId} AND ${table.propertyId} IS NULL AND ${table.unitId} IS NULL AND ${table.leaseId} IS NULL AND ${table.tenantId} IS NULL AND ${table.workOrderId} IS NULL)
      )`,
    ),
    check(
      "documents_cover_is_image",
      sql`(${table.isCover} = false OR ${table.kind} = 'image')`,
    ),
    check(
      "documents_size_bytes",
      sql`(${table.sizeBytes} > 0 AND ${table.sizeBytes} <= ${sql.raw(String(MAX_DOCUMENT_BYTES))})`,
    ),
    check(
      "documents_label_len",
      sql`(${table.label} IS NULL OR char_length(${table.label}) BETWEEN 1 AND 40)`,
    ),
    check(
      "documents_label_kind",
      sql`(${table.label} IS NULL OR ${table.kind} = 'other')`,
    ),
  ],
);

export const leaseSignatures = pgTable(
  "lease_signatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    leaseId: uuid("lease_id").notNull(),
    purpose: signaturePurposeEnum("purpose").notNull().default("lease"),
    provider: signatureProviderEnum("provider").notNull().default("firma_dev"),
    providerRequestId: text("provider_request_id"),
    status: leaseSignatureStatusEnum("status").notNull().default("draft"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    audit: jsonb("audit").$type<JsonObject[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.leaseId, table.organizationId],
      foreignColumns: [leases.id, leases.organizationId],
    }).onDelete("cascade"),
    index("idx_lease_signatures_org").on(table.organizationId),
    index("idx_lease_signatures_lease").on(table.leaseId),
    index("idx_lease_signatures_document").on(table.documentId),
    index("idx_lease_signatures_source_document").on(table.sourceDocumentId),
    uniqueIndex("uq_lease_signatures_id_org").on(table.id, table.organizationId),
    uniqueIndex("uq_lease_signatures_provider_request")
      .on(table.providerRequestId)
      .where(sql`${table.providerRequestId} IS NOT NULL`),
    uniqueIndex("uq_lease_signatures_open")
      .on(table.organizationId, table.leaseId, table.purpose)
      .where(
        sql`${table.status} IN ('draft', 'sent', 'viewed', 'partially_signed')`,
      ),
  ],
);

export const leaseSignatureRecipients = pgTable(
  "lease_signature_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    signatureId: uuid("signature_id").notNull(),
    providerRecipientId: text("provider_recipient_id"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: signatureRecipientRoleEnum("role").notNull(),
    sortOrder: integer("sort_order").notNull().default(1),
    status: signatureRecipientStatusEnum("status").notNull().default("pending"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.signatureId, table.organizationId],
      foreignColumns: [leaseSignatures.id, leaseSignatures.organizationId],
    }).onDelete("cascade"),
    index("idx_lease_signature_recipients_org").on(table.organizationId),
    index("idx_lease_signature_recipients_signature").on(table.signatureId),
  ],
);

export const notificationKindEnum = pgEnum("notification_kind", [
  "rent_due",
  "rent_overdue",
  "lease_expiring",
  "work_order",
  "signature",
  "system",
]);

export const notificationSeverityEnum = pgEnum("notification_severity", [
  "info",
  "warning",
  "critical",
]);

export const notificationEntityTypeEnum = pgEnum("notification_entity_type", [
  "rent_charge",
  "lease",
  "work_order",
  "lease_signature",
]);

/**
 * Org mailbox. `user_id` null means every member of the organization.
 * `period` is the logical bucket (charge period, lease end date, `unassigned`, signature event)
 * so a daily cron can insert with ON CONFLICT DO NOTHING.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    kind: notificationKindEnum("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    severity: notificationSeverityEnum("severity").notNull(),
    entityType: notificationEntityTypeEnum("entity_type"),
    entityId: uuid("entity_id"),
    period: text("period").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_notifications_dedupe")
      .on(table.organizationId, table.kind, table.entityId, table.period)
      .nullsNotDistinct(),
    index("idx_notifications_org_created").on(table.organizationId, table.createdAt),
    index("idx_notifications_org_kind").on(table.organizationId, table.kind),
    index("idx_notifications_user").on(table.userId),
    index("idx_notifications_unread")
      .on(table.organizationId)
      .where(sql`${table.readAt} IS NULL`),
    check("notifications_title_len", sql`char_length(${table.title}) BETWEEN 1 AND 160`),
    check("notifications_body_len", sql`char_length(${table.body}) BETWEEN 1 AND 2000`),
    check("notifications_period_len", sql`char_length(${table.period}) BETWEEN 1 AND 80`),
    check(
      "notifications_entity_pair",
      sql`(
        (${table.entityType} IS NULL AND ${table.entityId} IS NULL)
        OR (${table.entityType} IS NOT NULL AND ${table.entityId} IS NOT NULL)
      )`,
    ),
  ],
);

/** Idempotency key for firma.dev webhook deliveries (`X-Firma-Delivery`). */
export const firmaWebhookDeliveries = pgTable("firma_webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  eventId: text("event_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  properties: many(properties),
  tenants: many(tenants),
  vendors: many(vendors),
  workOrders: many(workOrders),
  applications: many(applications),
  settings: many(settings),
}));

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [properties.organizationId],
    references: [organizations.id],
  }),
  units: many(units),
}));

export const unitsRelations = relations(units, ({ one, many }) => ({
  property: one(properties, {
    fields: [units.propertyId, units.organizationId],
    references: [properties.id, properties.organizationId],
  }),
  leases: many(leases),
}));

export const leasesRelations = relations(leases, ({ one, many }) => ({
  unit: one(units, {
    fields: [leases.unitId, leases.organizationId],
    references: [units.id, units.organizationId],
  }),
  primaryTenant: one(tenants, {
    fields: [leases.primaryTenantId, leases.organizationId],
    references: [tenants.id, tenants.organizationId],
  }),
  rentCharges: many(rentCharges),
  leaseTenants: many(leaseTenants),
  signatures: many(leaseSignatures),
}));

export const rentChargesRelations = relations(rentCharges, ({ one, many }) => ({
  lease: one(leases, {
    fields: [rentCharges.leaseId, rentCharges.organizationId],
    references: [leases.id, leases.organizationId],
  }),
  payments: many(payments),
}));
