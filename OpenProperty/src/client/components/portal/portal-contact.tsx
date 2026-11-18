import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PORTAL_MAIL_COMPOSE_HREF, usePortal } from "./portal-context";

type Tab = "phones" | "hours" | "address";

export function PortalContactPage() {
  const { home, navigate } = usePortal();
  const [tab, setTab] = useState<Tab>("hours");
  if (!home) return null;

  const places = home.leases.map((lease) => ({
    id: lease.id,
    title: [lease.property_name, lease.unit_name].filter(Boolean).join(" · ") || "Unidad",
    lines: [lease.address, lease.city].filter(Boolean),
  }));
  const tabs: { id: Tab; label: string }[] = [
    { id: "phones", label: "Números de teléfono" },
    { id: "hours", label: "Horario de atención" },
    { id: "address", label: "Dirección" },
  ];

  return (
    <PageShell title="Información de la oficina" width="max-w-5xl" notifications={false}>
      <div className="flex justify-end">
        <Button type="button" className="rounded-full px-4" onClick={() => navigate(PORTAL_MAIL_COMPOSE_HREF)}>
          Mensajes sobre la propiedad
        </Button>
      </div>
      <div className="flex flex-wrap gap-1" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`cursor-pointer rounded-md px-4 py-2 text-sm ${
              tab === item.id ? "bg-muted font-medium text-foreground" : "bg-card text-muted-foreground"
            }`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "phones" && (
        <p className="py-10 text-center text-sm italic text-muted-foreground">
          No hay números de teléfono publicados.
        </p>
      )}
      {tab === "hours" && (
        <Card className="p-4">
          <p className="text-sm font-medium">Sin horario publicado</p>
          <p className="text-sm text-muted-foreground">La administración aún no indicó su horario de atención.</p>
        </Card>
      )}
      {tab === "address" && (
        places.length === 0 ? (
          <p className="py-10 text-center text-sm italic text-muted-foreground">No hay una dirección publicada.</p>
        ) : (
          <ul className="space-y-3">
            {places.map((place) => (
              <li key={place.id}>
                <Card className="p-4">
                  <p className="text-sm font-medium">{place.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {place.lines.length > 0 ? place.lines.join(", ") : "Sin dirección"}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )
      )}
    </PageShell>
  );
}
