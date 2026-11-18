import { useEffect, useRef, useState } from "react";
import { api, apiForm } from "@/api";
import { STATUS_VARIANT } from "@/components/maintenance/maintenance-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { priorityLabel, workStatusLabel } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_LOCATIONS,
  problemsFor,
} from "../../../shared/maintenance-request";
import type { PortalLease, PortalWorkOrder } from "./portal-types";

type MaintenanceTab = "open" | "past" | "phones";

const ENTRY_MAX = 200;
const DESCRIPTION_MAX = 4000;
const PHOTO_MAX = 3;
const PHOTO_BYTES = 8 * 1024 * 1024;

const EMPTY = {
  location: "",
  category: "",
  problem: "",
  description: "",
  hasPet: false,
  entryAllowed: false,
  entryComment: "",
};

export function PortalMaintenancePanel({
  lease,
  creating,
  onCreate,
  onDone,
}: {
  lease: PortalLease | null;
  creating: boolean;
  onCreate: () => void;
  onDone: () => void;
}) {
  const [orders, setOrders] = useState<PortalWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<MaintenanceTab>("open");

  async function load() {
    try {
      setLoading(true);
      const data = await api<{ work_orders: PortalWorkOrder[] }>("GET", "/api/portal/work-orders");
      const rows = lease
        ? data.work_orders.filter(
            (order) => order.unit_name === lease.unit_name && order.property_name === lease.property_name,
          )
        : data.work_orders;
      setOrders(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar tus solicitudes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [lease]);

  if (creating) {
    return <RequestForm lease={lease} onDone={onDone} />;
  }

  const openOrders = orders.filter((order) => order.status !== "completed" && order.status !== "cancelled");
  const pastOrders = orders.filter((order) => order.status === "completed" || order.status === "cancelled");
  const tabs: { id: MaintenanceTab; label: string }[] = [
    { id: "open", label: "Abrir solicitudes" },
    { id: "past", label: "Solicitudes previas" },
    { id: "phones", label: "Números de teléfono" },
  ];

  return (
    <Card className="p-5">
      <div className="flex justify-end">
        <Button type="button" className="rounded-full px-4" disabled={!lease} onClick={onCreate}>
          Solicitar mantenimiento
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`cursor-pointer rounded-full px-3 py-1.5 text-sm ${
              tab === item.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground"
            }`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : tab === "phones" ? (
        <p className="py-10 text-center text-sm italic text-muted-foreground">
          No hay números de teléfono publicados.
        </p>
      ) : (
        <OrderList
          orders={tab === "open" ? openOrders : pastOrders}
          empty={
            tab === "open"
              ? "No tiene solicitudes de mantenimiento abiertas"
              : "No tiene solicitudes de mantenimiento previas"
          }
        />
      )}
    </Card>
  );
}

function OrderList({ orders, empty }: { orders: PortalWorkOrder[]; empty: string }) {
  if (orders.length === 0) {
    return <p className="py-10 text-center text-sm italic text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="divide-y">
      {orders.map((order) => (
        <li key={order.id} className="flex items-start justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{order.title}</p>
            <p className="text-xs text-muted-foreground">
              {[order.property_name, order.unit_name].filter(Boolean).join(" · ") || "—"} ·{" "}
              {priorityLabel(order.priority)} · {formatDate(order.created_at)}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[order.status] ?? "secondary"}>{workStatusLabel(order.status)}</Badge>
        </li>
      ))}
    </ul>
  );
}

function RequestForm({ lease, onDone }: { lease: PortalLease | null; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [location, setLocation] = useState(EMPTY.location);
  const [category, setCategory] = useState(EMPTY.category);
  const [problem, setProblem] = useState(EMPTY.problem);
  const [description, setDescription] = useState(EMPTY.description);
  const [hasPet, setHasPet] = useState(EMPTY.hasPet);
  const [entryAllowed, setEntryAllowed] = useState(EMPTY.entryAllowed);
  const [entryComment, setEntryComment] = useState(EMPTY.entryComment);
  const [files, setFiles] = useState<File[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = problemsFor(category);
  const missing = [
    !location ? "Dónde se encuentra el problema" : null,
    !category ? "Categoría del problema" : null,
    !problem ? "Problema" : null,
    !description.trim() ? "Descripción del problema" : null,
    !entryAllowed ? "Permiso para ingresar" : null,
  ].filter((item): item is string => item !== null);

  function reset() {
    setLocation(EMPTY.location);
    setCategory(EMPTY.category);
    setProblem(EMPTY.problem);
    setDescription(EMPTY.description);
    setHasPet(EMPTY.hasPet);
    setEntryAllowed(EMPTY.entryAllowed);
    setEntryComment(EMPTY.entryComment);
    setFiles([]);
    setSavedId(null);
    setAttempted(false);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save(andAnother: boolean) {
    if (!lease) return;
    setAttempted(true);
    if (missing.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      let id = savedId;
      if (!id) {
        const created = await api<{ work_order: { id: string } }>("POST", "/api/portal/work-orders", {
          lease_id: lease.id,
          location,
          category,
          problem,
          description: description.trim(),
          has_pet: hasPet,
          entry_allowed: true,
          entry_comment: entryComment.trim(),
        });
        id = created.work_order.id;
        setSavedId(id);
      }
      for (const photo of files) {
        if (!id) break;
        const form = new FormData();
        form.set("file", photo);
        await apiForm(`/api/portal/work-orders/${id}/photo`, form);
      }
      if (andAnother) reset();
      else onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar la solicitud");
    } finally {
      setSaving(false);
    }
  }

  if (!lease) {
    return <p className="text-sm text-muted-foreground">Elige una unidad para solicitar mantenimiento.</p>;
  }

  const invalid = "shadow-[inset_0_0_0_1px_var(--destructive)]";

  function choosePhotos(list: FileList | null) {
    const next = Array.from(list ?? []).slice(0, PHOTO_MAX);
    const tooBig = next.find((photo) => photo.size > PHOTO_BYTES);
    const accepted = next.filter((photo) => photo.size <= PHOTO_BYTES);
    if ((list?.length ?? 0) > PHOTO_MAX) {
      setError(`Puedes adjuntar como máximo ${PHOTO_MAX} fotografías`);
    } else if (tooBig) {
      setError("Cada fotografía puede pesar como máximo 8 MB");
    } else {
      setError(null);
    }
    setFiles(accepted);
  }

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-muted-foreground">Proporcione los detalles de esta solicitud.</p>
      <p className="mt-1 text-sm text-muted-foreground">Los campos marcados con * son obligatorios.</p>

      <div className="mt-4 grid gap-4">
        <div>
          <p className="mb-1.5 text-sm">¿Tiene una mascota?</p>
          <button
            type="button"
            role="switch"
            aria-checked={hasPet}
            className="inline-flex cursor-pointer items-center gap-2 text-sm"
            onClick={() => setHasPet((value) => !value)}
          >
            <span
              className={`relative inline-block h-6 w-11 shrink-0 overflow-hidden rounded-full ${
                hasPet ? "bg-[var(--brand)]" : "bg-[#3a3937]"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 block size-5 rounded-full bg-white shadow transition-transform ${
                  hasPet ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </span>
            {hasPet ? "Sí" : "No"}
          </button>
        </div>

        <div>
          <Label htmlFor="wo-entry">Comentario de entrada (opcional)</Label>
          <Textarea
            id="wo-entry"
            value={entryComment}
            maxLength={ENTRY_MAX}
            rows={2}
            onChange={(e) => setEntryComment(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">Máximo {ENTRY_MAX} caracteres</p>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium">Permiso para ingresar *</p>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={entryAllowed}
              onChange={(e) => setEntryAllowed(e.target.checked)}
            />
            <span>
              Estoy de acuerdo en permitir que el personal de la propiedad ingrese a mi unidad para trabajar en este
              problema de mantenimiento.
            </span>
          </label>
        </div>
      </div>

      <h2 className="mb-3 mt-6 text-[1.0625rem] font-semibold">Detalles del problema</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>¿Dónde se encuentra el problema? *</Label>
          <Select value={location} onValueChange={setLocation}>
            <SelectTrigger aria-label="Dónde se encuentra el problema" className={attempted && !location ? invalid : ""}>
              <SelectValue placeholder="Seleccionar uno" />
            </SelectTrigger>
            <SelectContent>
              {MAINTENANCE_LOCATIONS.map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>¿Cuál es la categoría del problema? *</Label>
          <Select
            value={category}
            onValueChange={(value) => {
              setCategory(value);
              setProblem("");
            }}
          >
            <SelectTrigger aria-label="Categoría del problema" className={attempted && !category ? invalid : ""}>
              <SelectValue placeholder="Seleccionar uno" />
            </SelectTrigger>
            <SelectContent>
              {MAINTENANCE_CATEGORIES.map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label>¿Cuál es el problema? *</Label>
          <Select value={problem} onValueChange={setProblem} disabled={!category}>
            <SelectTrigger aria-label="Problema" className={attempted && !problem ? invalid : ""}>
              <SelectValue placeholder="Seleccionar uno" />
            </SelectTrigger>
            <SelectContent>
              {problems.map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
            </Select>
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="wo-desc">Descripción del problema *</Label>
          <Textarea
            id="wo-desc"
            value={description}
            maxLength={DESCRIPTION_MAX}
            rows={4}
            className={attempted && !description.trim() ? invalid : ""}
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">Máximo {DESCRIPTION_MAX} caracteres</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm">Agregar fotografías</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          multiple
          className="sr-only"
          onChange={(e) => choosePhotos(e.target.files)}
        />
        <Button type="button" variant="outline" className="rounded-full" onClick={() => fileRef.current?.click()}>
          Elegir archivo
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">
          {files.length > 0
            ? files.map((photo) => photo.name).join(", ")
            : `Hasta ${PHOTO_MAX} fotografías JPG o PNG. Máximo 8 MB cada una.`}
        </p>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-6 flex gap-2">
        <Button
          type="button"
          className="rounded-full px-5"
          disabled={saving}
          onClick={() => void save(false)}
        >
          Guardar
        </Button>
        <Button
          type="button"
          variant="outline"
          className="rounded-full px-5"
          disabled={saving}
          onClick={() => void save(true)}
        >
          Guardar y agregar más
        </Button>
      </div>
    </div>
  );
}
