# AGENTS.md — RENT

Gestión de propiedades de Sulbase, **100 % edge**: Cloudflare Workers + Supabase (Postgres), con Hono y Drizzle.
Léelo antes de tocar código. El historial completo (fases cerradas, Condo, Jev, plan anterior) está en `docs/AGENTS.historial.md` y `docs/AGENTS.plan-anterior.txt`, excluidos del contexto por `.cursorignore`; sácalos de ahí solo si hace falta consultarlos.

## 1. Stack y decisiones vigentes

| Tema | Decisión |
|---|---|
| Backend | Hono en Cloudflare Workers (`OpenProperty/`, Worker `rent`) |
| Base de datos | Supabase Postgres (plan Free) + Drizzle; esquema en `src/db/schema.ts` |
| Conexión | Hyperdrive en producción (origen directo 5432); `DATABASE_URL` pooler 6543 como respaldo y en local. Nunca un pool persistente |
| Archivos | R2 (binding `FILES`), bucket privado, descarga siempre por el Worker. No Supabase Storage |
| Firma | firma.dev (webhook HMAC en `/api/webhooks/firma`); el PDF firmado se archiva en R2 |
| Frontend | SPA Vite + React en `/app/*` (privada, `noindex`); landing pre-renderizada con React Router v7 en `/`. No Remix |
| Auth y permisos | Supabase Auth + JWT en el Worker; `memberships` con rol (`owner`, `manager`, `staff`, `viewer`); RLS aplazado |
| Dominio | `https://rent.sulbase.com` (canónico); `workers.dev` redirige ahí (`CANONICAL_REDIRECT = "true"`) |
| Producto | Marca **RENT**; español y sistema métrico; moneda por organización (MXN por defecto) |
| Mensajería | Correo interno tipo hilos (miembros + inquilinos); alertas automáticas en `notifications`. Sin SMTP propio |
| Pagos desde el portal | Comprobantes aprobados por el equipo. PayPhone después, con cuenta por organización (§6) |

## 2. Reglas de trabajo

- **GitHub:** repo [sulbase/RENT](https://github.com/sulbase/RENT), cuenta `sulbase` (no `kpalvear`), autor `324332889+sulbase@users.noreply.github.com`.
- **Todo entra por PR** con revisión humana. La IA propone, el humano aprueba. No hacer commit ni merge sin que el usuario lo pida.
- **Deploy:** solo GitHub Actions (`.github/workflows/ci.yml`): PR → `verify` + `preview`; push a `main` → `verify` + `deploy`. No usar Workers Builds.
- **CI:** typecheck, `biome` en `src/server`, tests (vitest), build, gitleaks.
- **Secretos:** solo `wrangler secret put` o secrets de GitHub. Worker: `DATABASE_URL`, `SUPABASE_JWT_SECRET` (y luego `FIRMA_*`). Nunca en el repo ni en el cliente.
- **Migraciones:** `pnpm db:pg:generate` (Drizzle, `.env` con puerto 5432) y se aplican fuera del Worker con `pnpm db:pg:migrate`. **Hasta el lanzamiento, dev, lab y producción comparten la misma base:** un asistente no aplica migraciones ni SQL destructivo sin confirmación explícita. Aplicar la migración **antes** de desplegar código que la usa.
- **Local con auth real:** en `OpenProperty/`, `.env` + `.env.local`, `pnpm dev:auth` → `http://localhost:5173/app`.
- **Windows:** `core.autocrlf` deja CRLF en local; `biome` falla en archivos no tocados. Formatear solo lo que cambias (`pnpm exec biome format --write <archivos>`); CI ve LF.

## 3. Arquitectura que no hay que romper

- **Organización:** la resuelve el middleware (`src/server/auth/middleware.ts`) desde `memberships`; nunca se confía en la del cliente. Toda query filtra por `organization_id`. Escrituras bloqueadas para `viewer`.
- **Portal del inquilino:** cuenta Supabase ligada a su ficha (`tenants.user_id`), invitada desde la ficha (`tenant_invitations`) y enlazada en el primer `/api/me`. API en `/api/portal/*`: el middleware fija ficha y organización desde `tenants.user_id`; esas cuentas no entran a las rutas del panel.
- **Pagos:** todo pago se registra con `recordPayment` (`src/server/rent/record-payment.ts`), que bloquea el cargo, rechaza importes mayores al saldo y recalcula. `payments.metadata.source` indica el origen (`staff`, `tenant_receipt`).
- **Comprobantes:** `payment_submissions`; no tocan el saldo hasta que un miembro los aprueba en Rentas.
- **Archivos:** clave R2 generada por el servidor con prefijo `org/<organization_id>/…`; validar MIME, extensión, contenido y tamaño (`src/server/documents/policy.ts`); cuota por organización.
- **Webhooks:** fuera del middleware de organización, firma HMAC e idempotencia por id de entrega.
- **Validación:** Zod en cada endpoint; rate limiting en `/api/*`, auth, envío de correo y subida de comprobantes.
- **Fechas `date`:** leerlas como texto (`::text`) para no desplazarlas un día por zona horaria.
- **Tests:** cada ruta nueva con datos de organización o ficha lleva test de aislamiento (`src/server/integration/*`).

## 4. Supabase (configurado en el dashboard, no en el repo)

- Site URL `https://rent.sulbase.com/app`; Redirect URLs `https://rent.sulbase.com/**` y `http://localhost:5173/**`. CI fija `VITE_AUTH_REDIRECT_URL=https://rent.sulbase.com/app`.
- Plantillas de correo en español versionadas en `OpenProperty/docs/email-templates/` (pegar en Authentication → Emails → Templates).
- Plan Free: sin backups automáticos; pausa tras una semana sin actividad. Antes del lanzamiento, un segundo proyecto Free solo para producción.

## 5. Pendiente

- [ ] Secretos de firma.dev (`FIRMA_API_KEY`, `FIRMA_WEBHOOK_SECRET`) y registro del webhook en `https://rent.sulbase.com/api/webhooks/firma`
- [ ] Validar el JSON-LD de la landing con un validador público
- [ ] Restauración probada desde `db dump` (`OpenProperty/docs/db-backup-restore.md`)
- [ ] Prueba de carga básica (`OpenProperty/docs/load-test.md`); revisar rate limiting y validación
- [ ] Segundo proyecto Supabase para producción antes de datos reales
- [ ] Alertas de costo y errores en Cloudflare (hoy bastan GitHub + Slack)
- [ ] SMTP propio en Supabase con dominio verificado y remitente "RENT · Sulbase"
- [ ] Después: páginas públicas (precios, legal), OpenAPI solo si hay integradores, funciones inspiradas en Condo

## 6. PayPhone (plan, sin implementar)

Pasarela de tarjetas de Ecuador ([docs.payphone.app](https://docs.payphone.app)). Verificar endpoints y campos en la documentación vigente antes de implementar.

- **Cuenta por organización:** el `owner` guarda el token de su cuenta PayPhone en Ajustes; se cifra en Postgres (AES-GCM, clave maestra `PAYMENTS_ENCRYPTION_KEY` en `wrangler secret put`); nunca vuelve al cliente. Probar en el sandbox.
- **Solo USD:** el botón aparece solo si la organización usa `currency = USD`.
- **Tabla `online_payments`:** cargo, ficha, monto, `client_transaction_id` único (servidor), id de PayPhone, estado (`pending|approved|failed|cancelled|expired`), respuesta cruda, `payment_id`.
- **Flujo:** `POST /api/portal/charges/:id/payphone` (saldo calculado en el servidor, *Prepare*, vuelta a `/app/portal/pago`) → `POST /api/portal/payphone/confirm` (*Confirm* con el token de la organización; si aprueba, `recordPayment` con método nuevo `payphone`). Idempotente; confirmar siempre al volver porque PayPhone revierte lo no confirmado. Respaldo: su "Notificación externa" o un Cron sobre `pending`.
- **UI:** botón **Pagar con tarjeta** junto a **Subir comprobante** en "Por pagar".
- **Negocio:** comisión publicada 5 % + IVA por cobro; decidir quién la asume y revisar facturación SRI. "Split de pagos" solo si Sulbase cobra comisión propia.
- **Tests:** cargo ajeno, monto manipulado, confirmación repetida, token de otra organización, transacción rechazada.
