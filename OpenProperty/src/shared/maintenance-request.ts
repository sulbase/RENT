export const MAINTENANCE_LOCATIONS = [
  "Cocina",
  "Baño",
  "Recámara",
  "Sala",
  "Comedor",
  "Balcón o terraza",
  "Lavandería",
  "Pasillo",
  "Otro",
] as const;

export const MAINTENANCE_PROBLEMS = {
  Plomería: ["Fuga de agua", "Desagüe tapado", "Sin agua caliente", "Inodoro", "Grifo o llave", "Otro"],
  Electricidad: ["Sin luz", "Contacto dañado", "Interruptor", "Foco o lámpara", "Otro"],
  Pintura: ["Pared descascarada", "Mancha o humedad", "Techo", "Retoque", "Otro"],
  Cerrajería: ["Chapa", "Llave", "Puerta no cierra", "Otro"],
  Clima: ["Aire acondicionado", "Calefacción", "Ventilación", "Otro"],
  Electrodomésticos: ["Estufa", "Refrigerador", "Lavadora", "Otro"],
  General: ["Otro"],
} as const;

export const MAINTENANCE_CATEGORIES = Object.keys(MAINTENANCE_PROBLEMS) as [
  keyof typeof MAINTENANCE_PROBLEMS,
  ...(keyof typeof MAINTENANCE_PROBLEMS)[],
];

export type MaintenanceCategory = keyof typeof MAINTENANCE_PROBLEMS;

export function problemsFor(category: string): readonly string[] {
  if (category in MAINTENANCE_PROBLEMS) {
    return MAINTENANCE_PROBLEMS[category as MaintenanceCategory];
  }
  return [];
}

export function maintenanceTitle(category: string, problem: string): string {
  return `${category} · ${problem}`.slice(0, 160);
}
