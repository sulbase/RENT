import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell } from "@/components/page-shell";
import { AccountTab } from "@/components/settings/account-tab";
import { MembersTab } from "@/components/settings/members-tab";
import { OrganizationTab } from "@/components/settings/organization-tab";

const SETTINGS_TAB_KEY = "rent.settingsTab";

export function SettingsPage() {
  const [tab, setTab] = useState("account");

  useEffect(() => {
    const stored = sessionStorage.getItem(SETTINGS_TAB_KEY);
    if (!stored) return;
    sessionStorage.removeItem(SETTINGS_TAB_KEY);
    setTab(stored);
  }, []);

  return (
    <PageShell
      title="Ajustes"
      meta="Cuenta, organización, miembros y política de renta"
      width="max-w-5xl"
    >

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="account">Cuenta</TabsTrigger>
            <TabsTrigger value="organization">Organización</TabsTrigger>
            <TabsTrigger value="members">Miembros</TabsTrigger>
            <TabsTrigger value="policy">Política de renta</TabsTrigger>
          </TabsList>

          <TabsContent value="account" className="mt-4">
            <AccountTab />
          </TabsContent>
          <TabsContent value="organization" className="mt-4">
            <OrganizationTab />
          </TabsContent>
          <TabsContent value="members" className="mt-4">
            <MembersTab />
          </TabsContent>
          <TabsContent value="policy" className="mt-4">
            <PolicyTab />
          </TabsContent>
        </Tabs>
    </PageShell>
  );
}

function PolicyTab() {
  const app = useApp();
  const [dueDay, setDueDay] = useState(String(app.settings.default_rent_due_day));
  const [lateFee, setLateFee] = useState(String(app.settings.late_fee_amount));
  const [grace, setGrace] = useState(String(app.settings.late_fee_grace_days));
  const [currency, setCurrency] = useState(app.settings.currency);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDueDay(String(app.settings.default_rent_due_day));
    setLateFee(String(app.settings.late_fee_amount));
    setGrace(String(app.settings.late_fee_grace_days));
    setCurrency(app.settings.currency);
  }, [app.settings]);

  async function save() {
    setSaving(true);
    try {
      await app.updateSettings({
        default_rent_due_day: Math.min(31, Math.max(1, parseInt(dueDay, 10) || 1)),
        late_fee_amount: parseFloat(lateFee) || 0,
        late_fee_grace_days: Math.max(0, parseInt(grace, 10) || 0),
        currency: currency.trim().toUpperCase() || "MXN",
      });
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-sm font-semibold">Rent policy defaults</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Used when creating new leases. Each lease can override these.
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <Label htmlFor="s-day">Rent due day</Label>
          <Input id="s-day" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="s-late">Late fee</Label>
          <Input id="s-late" type="number" value={lateFee} onChange={(e) => setLateFee(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="s-grace">Grace days</Label>
          <Input id="s-grace" type="number" min={0} value={grace} onChange={(e) => setGrace(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="s-cur">Currency</Label>
          <Input id="s-cur" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="MXN" />
        </div>
      </div>
      <div className="mt-4">
        <Button onClick={save} disabled={saving}>Guardar ajustes</Button>
      </div>
    </Card>
  );
}
