import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell } from "@/components/page-shell";
import { AccountTab } from "@/components/settings/account-tab";
import { MembersTab } from "@/components/settings/members-tab";
import { OrganizationTab } from "@/components/settings/organization-tab";

const SETTINGS_TAB_KEY = "rent.settingsTab";

export function SettingsPage() {
  const auth = useAuth();
  const [tab, setTab] = useState("account");

  useEffect(() => {
    const stored = sessionStorage.getItem(SETTINGS_TAB_KEY);
    if (stored !== "account" && stored !== "organization" && stored !== "members") return;
    sessionStorage.removeItem(SETTINGS_TAB_KEY);
    setTab(stored);
  }, []);

  return (
    <PageShell
      title="Ajustes"
      meta="Cuenta, organización y miembros"
      width="max-w-5xl"
    >

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="account">Cuenta</TabsTrigger>
            <TabsTrigger value="organization">Organización</TabsTrigger>
            <TabsTrigger value="members">Miembros</TabsTrigger>
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
        </Tabs>

        <div className="md:hidden">
          <Button type="button" variant="outline" className="w-full" onClick={() => void auth.signOut()}>
            <LogOut className="size-4" aria-hidden />
            Cerrar sesión
          </Button>
        </div>
    </PageShell>
  );
}
