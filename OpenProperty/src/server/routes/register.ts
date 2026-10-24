import { mountAuthRoutes } from "./auth";
import { mountPropertiesRoutes } from "./properties";
import { mountUnitsRoutes } from "./units";
import { mountTenantsRoutes } from "./tenants";
import { mountTenantPortalAccessRoutes } from "./tenant-portal-access";
import { mountPortalRoutes } from "./portal";
import { mountLeasesRoutes } from "./leases";
import { mountRentRoutes } from "./rent";
import { mountVendorsRoutes } from "./vendors";
import { mountWorkOrdersRoutes } from "./work-orders";
import { mountApplicationsRoutes } from "./applications";
import { mountDashboardRoutes } from "./dashboard";
import { mountAccountRoutes } from "./account";
import { mountMemberRoutes } from "./members";
import { mountSettingsRoutes } from "./settings";
import { mountDocumentsRoutes } from "./documents";
import { mountMessageRoutes } from "./messages";
import { mountNotificationRoutes } from "./notifications";
import { mountFirmaWebhookRoute, mountSignatureRoutes } from "./signatures";

import type { Hono } from "hono";
import type { AppEnv } from "../env";

export function registerApiRoutes(app: Hono<AppEnv>) {
  mountAuthRoutes(app);
  mountPropertiesRoutes(app);
  mountUnitsRoutes(app);
  mountTenantsRoutes(app);
  mountTenantPortalAccessRoutes(app);
  mountPortalRoutes(app);
  mountLeasesRoutes(app);
  mountRentRoutes(app);
  mountVendorsRoutes(app);
  mountWorkOrdersRoutes(app);
  mountApplicationsRoutes(app);
  mountDashboardRoutes(app);
  mountAccountRoutes(app);
  mountSettingsRoutes(app);
  mountMemberRoutes(app);
  mountDocumentsRoutes(app);
  mountNotificationRoutes(app);
  mountMessageRoutes(app);
  mountSignatureRoutes(app);
  mountFirmaWebhookRoute(app);
}
