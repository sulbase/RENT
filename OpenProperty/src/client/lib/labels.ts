const PROPERTY_TYPE: Record<string, string> = {
  single_family: "Casa",
  multi_family: "Multifamiliar",
  condo: "Departamento",
  townhouse: "Adosada",
  commercial: "Comercial",
};

const CHARGE_STATUS: Record<string, string> = {
  open: "Abierto",
  partial: "Parcial",
  paid: "Pagado",
  overdue: "Vencido",
  waived: "Condonado",
};

const WORK_STATUS: Record<string, string> = {
  open: "Abierta",
  assigned: "Asignada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
};

const PRIORITY: Record<string, string> = {
  urgent: "Urgente",
  high: "Alta",
  normal: "Normal",
  low: "Baja",
};

const UNIT_STATUS: Record<string, string> = {
  vacant: "Vacante",
  occupied: "Ocupada",
  turnover: "En preparación",
  unavailable: "No disponible",
};

const LEASE_STATUS: Record<string, string> = {
  active: "Activo",
  upcoming: "Borrador",
  ended: "Terminado",
  cancelled: "Cancelado",
};

const ROLE: Record<string, string> = {
  owner: "Propietario",
  manager: "Gestor",
  staff: "Personal",
  viewer: "Consulta",
};

function label(map: Record<string, string>, value: string): string {
  return map[value] ?? value;
}

export const propertyTypeLabel = (value: string) => label(PROPERTY_TYPE, value);
export const chargeStatusLabel = (value: string) => label(CHARGE_STATUS, value);
export const workStatusLabel = (value: string) => label(WORK_STATUS, value);
export const priorityLabel = (value: string) => label(PRIORITY, value);
export const unitStatusLabel = (value: string) => label(UNIT_STATUS, value);
export const leaseStatusLabel = (value: string) => label(LEASE_STATUS, value);
export const roleLabel = (value: string) => label(ROLE, value);
