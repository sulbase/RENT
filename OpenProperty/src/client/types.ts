// ── Core entities ──────────────────────────────────────────────────

export type PropertyType = "single_family" | "multi_family" | "condo" | "townhouse" | "commercial";

export interface Property {
  id: string;
  name: string;
  type: PropertyType;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  year_built: number | null;
  notes: string | null;
  color: string;
  created_at: string;
  // Joined
  unit_count?: number;
  occupied_count?: number;
}

export type UnitStatus = "vacant" | "occupied" | "turnover" | "unavailable";

export interface Unit {
  id: string;
  property_id: string;
  name: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number | null;
  market_rent: number;
  status: UnitStatus;
  floor: number | null;
  unit_type: string;
  furnished: boolean;
  aliquot_price: number;
  notes: string | null;
  created_at: string;
  // Joined
  property_name?: string | null;
  property_color?: string | null;
  property_address?: string | null;
  property_city?: string | null;
  active_lease_id?: string | null;
  active_tenant_name?: string | null;
}

export interface Tenant {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  emergency_contact: string | null;
  employer: string | null;
  monthly_income: number | null;
  government_id: string | null;
  marital_status: "soltero" | "casado" | "divorciado" | "viudo" | "union_libre" | "separado" | null;
  occupation: string | null;
  work_address: string | null;
  previous_address: string | null;
  occupant_count: number | null;
  notes: string | null;
  created_at: string;
  // Joined (active lease)
  active_unit_id?: string | null;
  active_unit_name?: string | null;
  active_property_name?: string | null;
}

export type LeaseStatus = "upcoming" | "active" | "ended" | "cancelled";

export interface Lease {
  id: string;
  unit_id: string;
  primary_tenant_id: string | null;
  start_date: string;
  end_date: string;
  monthly_rent: number;
  deposit: number;
  rent_due_day: number;
  late_fee: number;
  status: LeaseStatus;
  notes: string | null;
  created_at: string;
  // Joined
  unit_name?: string | null;
  property_id?: string | null;
  property_name?: string | null;
  property_color?: string | null;
  tenant_first_name?: string | null;
  tenant_last_name?: string | null;
  tenant_email?: string | null;
  tenant_phone?: string | null;
  tenant_government_id?: string | null;
}

export type ChargeStatus = "open" | "partial" | "paid" | "overdue" | "waived";

export interface RentCharge {
  id: string;
  lease_id: string;
  period: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  status: ChargeStatus;
  notes: string | null;
  created_at: string;
  // Joined
  unit_id?: string | null;
  lease_rent?: number | null;
  rent_due_day?: number | null;
  unit_name?: string | null;
  property_id?: string | null;
  property_name?: string | null;
  property_color?: string | null;
  tenant_id?: string | null;
  tenant_first_name?: string | null;
  tenant_last_name?: string | null;
}

export type PaymentMethod = "cash" | "check" | "ach" | "credit" | "other";

export interface Payment {
  id: string;
  charge_id: string;
  paid_at: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  voided_by?: string | null;
}

/** Pago leído desde el inquilino titular del contrato. El registro sigue en el cargo. */
export interface TenantPayment extends Payment {
  period: string;
  due_date: string;
  charge_amount: number;
  charge_status: ChargeStatus;
  lease_id: string;
  lease_status: LeaseStatus;
  unit_name: string | null;
  property_name: string | null;
}

export type VendorCategory = "plumber" | "electrician" | "hvac" | "handyman" | "cleaning" | "landscaping" | "general";

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  phone: string | null;
  email: string | null;
  notes: string | null;
  color: string;
  created_at: string;
}

export type WorkOrderPriority = "low" | "normal" | "high" | "urgent";
export type WorkOrderStatus = "open" | "assigned" | "in_progress" | "completed" | "cancelled";

export interface WorkOrder {
  id: string;
  property_id: string | null;
  unit_id: string | null;
  tenant_id: string | null;
  vendor_id: string | null;
  title: string;
  description: string | null;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  scheduled_at: string | null;
  completed_at: string | null;
  cost: number | null;
  notes: string | null;
  created_at: string;
  // Joined
  property_name?: string | null;
  property_color?: string | null;
  unit_name?: string | null;
  tenant_first_name?: string | null;
  tenant_last_name?: string | null;
  vendor_name?: string | null;
  vendor_color?: string | null;
}

export type ApplicationStatus = "new" | "screening" | "approved" | "declined" | "withdrawn";

export interface Application {
  id: string;
  unit_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  monthly_income: number | null;
  employer: string | null;
  desired_move_in: string | null;
  status: ApplicationStatus;
  notes: string | null;
  created_at: string;
  unit_name?: string | null;
  property_name?: string | null;
}

export interface DashboardSummary {
  period: string;
  properties: number;
  units: number;
  occupied: number;
  vacant: number;
  occupancy_rate: number;
  active_leases: number;
  upcoming_move_outs: number;
  month_outstanding: number;
  month_collected: number;
  overdue_total: number;
  overdue_count: number;
  open_work_orders: number;
  urgent_work_orders: number;
  recent_work_orders: {
    id: string; title: string; priority: string; status: string;
    property_name: string | null; unit_name: string | null; created_at: string;
  }[];
  upcoming_expirations: {
    id: string; end_date: string;
    tenant_first_name: string | null; tenant_last_name: string | null;
    unit_name: string | null; property_name: string | null;
  }[];
}

// ── Input types for mutations ──────────────────────────────────────

export type NewProperty = Partial<Omit<Property, "id" | "created_at" | "unit_count" | "occupied_count">> & { name: string };
export type NewUnit = Partial<Omit<Unit, "id" | "created_at" | "property_name" | "property_color" | "property_address" | "property_city" | "active_lease_id" | "active_tenant_name">> & { property_id: string; name: string };
export type NewTenant = Partial<Omit<Tenant, "id" | "created_at" | "active_unit_id" | "active_unit_name" | "active_property_name">> & { first_name: string; last_name: string };
export type NewLease = Partial<Omit<Lease, "id" | "created_at" | "unit_name" | "property_id" | "property_name" | "property_color" | "tenant_first_name" | "tenant_last_name" | "tenant_email" | "tenant_phone" | "tenant_government_id">> & { unit_id: string; start_date: string; end_date: string };
export type NewWorkOrder = Partial<Omit<WorkOrder, "id" | "created_at" | "property_name" | "property_color" | "unit_name" | "tenant_first_name" | "tenant_last_name" | "vendor_name" | "vendor_color">> & { title: string };
export type NewVendor = Partial<Omit<Vendor, "id" | "created_at">> & { name: string };
export type NewApplication = Partial<Omit<Application, "id" | "created_at" | "unit_name" | "property_name">> & { first_name: string; last_name: string };

export type DocumentEntityType = "property" | "unit" | "lease" | "tenant" | "work_order";
export type DocumentKind =
  | "image"
  | "deed"
  | "certificate"
  | "invoice"
  | "signed_lease"
  | "inventory"
  | "signed_inventory"
  | "other";

export type SignaturePurpose = "lease" | "inventory";

export interface PropertyDocument {
  id: string;
  entity_type: DocumentEntityType;
  entity_id: string;
  kind: DocumentKind;
  label?: string | null;
  filename: string;
  mime: string;
  size_bytes: number;
  uploaded_by: string | null;
  is_cover: boolean;
  created_at: string;
}

export type LeaseSignatureStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "partially_signed"
  | "completed"
  | "declined"
  | "expired"
  | "cancelled";

export interface LeaseSignatureRecipient {
  id: string;
  signature_id: string;
  name: string;
  email: string;
  role: "owner" | "tenant";
  sort_order: number;
  status: "pending" | "viewed" | "signed" | "declined";
  signed_at: string | null;
}

export interface LeaseSignature {
  id: string;
  provider: string;
  provider_request_id: string | null;
  status: LeaseSignatureStatus;
  purpose: SignaturePurpose;
  document_id: string | null;
  source_document_id: string | null;
  last_error: string | null;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string;
  recipients: LeaseSignatureRecipient[];
}
