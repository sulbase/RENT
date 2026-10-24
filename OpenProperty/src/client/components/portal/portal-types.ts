import type { LedgerCharge, LedgerPayment } from "../../../shared/tenant-ledger";

export type PortalLease = {
  id: string;
  start_date: string;
  end_date: string;
  monthly_rent: number;
  deposit: number;
  rent_due_day: number;
  status: string;
  unit_name: string | null;
  property_name: string | null;
  address: string | null;
  city: string | null;
};

export type PortalDocument = {
  id: string;
  lease_id: string;
  filename: string;
  size_bytes: number;
  created_at: string;
  unit_name: string | null;
  property_name: string | null;
};

export type PortalHome = {
  tenant: {
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    organization_name: string;
  };
  settings: Record<string, string>;
  leases: PortalLease[];
  charges: LedgerCharge[];
  payments: LedgerPayment[];
  documents: PortalDocument[];
};

export type PortalWorkOrder = {
  id: string;
  title: string;
  description: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "assigned" | "in_progress" | "completed" | "cancelled";
  created_at: string;
  scheduled_at: string | null;
  completed_at: string | null;
  property_name: string | null;
  unit_name: string | null;
};

export type PortalParticipant = {
  participant_kind: "membership" | "tenant";
  email: string;
  role: "from" | "to" | "cc";
};

export type PortalThread = {
  id: string;
  subject: string;
  last_message_at: string;
  unread_count: number;
  participants: PortalParticipant[];
};

export type PortalMessage = {
  id: string;
  body: string;
  created_at: string;
  mine: boolean;
  sender_email: string | null;
};
