# AGENTS.md — RENT

Plataforma de gestión de propiedades **100 % edge**: Cloudflare Workers + Supabase (Postgres), con Hono y Drizzle ORM.
Este archivo es la fuente de verdad del proyecto. Cualquier asistente de IA debe leerlo antes de tocar código.

> **Histórico:** copia del plan anterior (pre-acotación Fase 6 / frontend público) en [`AGENTS.plan-anterior.txt`](./AGENTS.plan-anterior.txt).

> **Prevalencia:** las decisiones de la sección 1 reemplazan a las de la arquitectura anterior (Railway + Node/Bun).
> Lo demás de esa arquitectura (validación, Hono RPC, migraciones versionadas, CI, GEO) se conserva, adaptado.

---

## 1. Decisiones vigentes

| Tema | Decisión |
|---|---|
| Backend | **Hono en Cloudflare Workers** (no Railway) |
| Base de datos | **Supabase (PostgreSQL)** |
| ORM | **Drizzle ORM** |
| Conexión a BD | Hyperdrive o el pooler de Supabase; nunca un pool persistente |
| Archivos | **Cloudflare R2** (binding `FILES`); bucket privado, descarga vía Worker. No usar Supabase Storage |
| Firma electrónica | **[firma.dev](https://docs.firma.dev)** (API REST + webhooks HMAC); el PDF firmado se archiva en R2 |
| Tareas en segundo plano | Cloudflare Queues + Cron Triggers, en lotes pequeños |
| Base de código | **OpenProperty** (clawnify), portado de D1/SQLite a Postgres |
| Referencia de lógica | **Condo** (open-condo-software), solo como referencia de lectura |
| Agente de desarrollo | Cursor, con las skills de `.agents/skills/` |
| Marca producto | **RENT** (Sulbase); dejar de usar “OpenProperty” en UI y metadatos al actualizar |
| Dominio producción | **`https://rent.sulbase.com`** (canónico); `*.workers.dev` solo transitorio en lab |
| Idioma y unidades | **Español** en producto; **sistema métrico** (m², km, °C, formatos locales) |
| Modelo de acceso | **App cerrada** tras login; API privada (JWT + org). Superficie pública mínima: landing informativa |

## 2. Punto de partida: OpenProperty

Copia de partida: [clawnify/OpenProperty](https://github.com/clawnify/OpenProperty) `a493028` (`master`). El historial upstream permanece en ese repositorio.

- Servidor: `src/server/index.ts` (~950 líneas, SQL a mano) + `schema.sql` (D1/SQLite) + `@clawnify/db`.
- Cliente: React 19 + Vite + Tailwind + Radix (se conserva en fase 1).
- Módulos: propiedades, unidades, inquilinos, contratos, cargos de renta, pagos, proveedores, órdenes de trabajo, solicitudes, panel y ajustes.
- **No tiene autenticación ni organizaciones**: es de un solo usuario. Hay que añadirlas.
- Dependencias a reemplazar: `@clawnify/db` (y revisar `@clawnify/app`).

### Traducción SQLite → Postgres
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `uuid` con `defaultRandom()`
- fechas en `TEXT` → `date` / `timestamptz`
- importes `REAL` → `numeric(12,2)`
- `datetime('now')` → `now()`
- estados en texto libre → `pgEnum` o `CHECK`
- conservar claves foráneas, índices y el único `rent_charges (lease_id, period)`

## 3. Skills instaladas (alcance: proyecto, en `.agents/skills/`)

| Skill | Fuente | Uso |
|---|---|---|
| `hono` | honojs/skills (oficial) | Rutas, middleware, validación, RPC |
| `cloudflare` | cloudflare/skills (oficial) | Plataforma Workers, R2, Queues |
| `wrangler` | cloudflare/skills (oficial) | Despliegue y configuración |
| `workers-best-practices` | cloudflare/skills (oficial) | Buenas prácticas de Workers |
| `supabase` | supabase/agent-skills (oficial) | Uso de Supabase |
| `supabase-postgres-best-practices` | supabase/agent-skills (oficial) | Diseño y rendimiento de Postgres |

Pendientes (no crear todavía): skill propia `condo-port` y, opcionalmente, una skill comunitaria de Drizzle (revisar su `SKILL.md` antes).
Repositorio en GitHub: **[sulbase/RENT](https://github.com/sulbase/RENT)**. La carpeta local puede tener otro nombre; abre en Cursor la raíz que contiene `.agents/skills/`.

## 4. Arquitectura por capas

### 4.1 Frontend
- **App (ahora):** conservar el cliente Vite + React de OpenProperty como **SPA privada** tras login (router actual hasta migrar). Sin SSR en el panel; `noindex` en el shell de la app cuando se implemente la separación de rutas.
- **Rutas objetivo en producción:** `/` = landing pública (HTML legible para humanos y agentes); **`/app/*`** = SPA de gestión + login. Evita que crawlers indexen el login como “home”.
- **Landing y marketing (después del producto interior):** sitio público con **React Router v7** en Cloudflare Workers (SSR o pre-render por ruta), español, canonical en `rent.sulbase.com`. Precios, disponibilidad y páginas comerciales extra entran **después** de cerrar funcionalidad core.
- **No usar Remix** en este proyecto; el stack público futuro es **React Router v7** (mismo Worker: `run_worker_first` en `/api/*` como hoy).
- Alojamiento: Cloudflare Workers con activos estáticos, Preview URL por rama/PR.

### 4.2 Backend (Core API)
- Hono en Workers. Estructura por dominio: `properties`, `units`, `tenants`, `leases`, `rent`, `payments`, `vendors`, `maintenance`, `applications`, `settings` y, desde la Fase 6B, `documents`, `signatures`, `notifications`, `messages`, `account`.
- **Webhooks entrantes** (`/api/webhooks/*`): fuera del middleware de organización, autenticados por firma HMAC del proveedor e idempotentes por identificador de entrega.
- **Cron Triggers** para generar alertas del buzón en lotes pequeños (cargos vencidos, contratos por expirar, órdenes sin asignar).
- **Hono RPC:** los tipos del backend se importan en el frontend; si la API cambia, el typecheck rompe el build.
- **Validación con Zod en cada endpoint.**
- **Rate limiting** en endpoints públicos y de autenticación (mecanismo de Cloudflare o middleware; verificar opciones vigentes).
- **Secretos** solo en el gestor de entorno (`wrangler secret put`), nunca en el repositorio.
- **Costos:** Supabase en Free; vigilar cuotas en el dashboard. Alertas formales en Cloudflare aplazadas; avisos operativos vía GitHub (email) y Slack (`/github subscribe`) por ahora.

### 4.3 Persistencia
- Supabase Postgres + Drizzle. Esquema en `src/db/schema.ts`.
- **Migraciones versionadas en el repositorio** (`drizzle-kit generate`); prohibido modificar el esquema a mano en producción.
- Migraciones aplicadas desde CI o local, nunca desde el Worker.
- Usar la URL con pooling (Hyperdrive o el pooler de Supabase, puerto 6543). **Desarrollo y lab:** pooler **6543** en `.dev.vars` / `wrangler secret put DATABASE_URL`. **Hyperdrive en el Worker de producción:** obligatorio en el checklist **antes del lanzamiento** (§8); no bloquea trabajo local.
- **Plan Free de Supabase, sin gasto.** Un solo proyecto activo hasta el lanzamiento (lab, preview, staging y desarrollo comparten la misma BD). Antes de producción real, crear un segundo proyecto Free solo para datos de usuarios (máximo dos activos en el plan). No hay backups automáticos ni PITR: copia con `db dump` fuera del repo y probar restauración. Un proyecto Free se pausa tras una semana sin actividad.

### 4.3.1 Archivos (R2)
- **Todo archivo va a R2**: imágenes de propiedades y unidades, escrituras, certificados, facturas y contratos firmados. Binding `FILES` en `wrangler.toml`; bucket por entorno.
- Los metadatos viven en Postgres (`documents`); R2 guarda solo el binario. La clave la genera el servidor con prefijo de organización.
- **Bucket privado**: la descarga pasa siempre por el Worker con JWT y comprobación de organización.

### 4.4 Multi-organización y permisos
- Añadir `organization_id` (not null) a las tablas principales y una tabla `memberships` con rol.
- Autenticación: Supabase Auth.
- **Permisos en la aplicación (cerrado):** JWT Supabase en el Worker, `memberships` + rol, `organization_id` en cada query; RLS aplazado como red de seguridad opcional (el pooler del Worker no sustituye esto por sí solo).
- Roles iniciales sugeridos: `owner`, `manager`, `staff`, `viewer`.

### 4.5 Visibilidad para agentes de IA (GEO)
- **Alcance acotado:** RENT es app cerrada; GEO = **una landing** con texto completo en HTML (qué es, para quién, funciones a alto nivel, contacto, enlace a login). No indexar panel ni `/api/*`.
- `robots.txt`: `Allow: /` en la landing; `Disallow: /app/`, `/api/`; ampliar cuando existan precios/legal. Rastreadores de IA: allow explícito solo si interesa; **verificar user-agents** en la documentación de cada proveedor antes de publicar.
- Opcional en la landing: `llms.txt` con resumen y URL canónica.
- JSON-LD solo en la landing (`Organization`, `SoftwareApplication`; `Offer` cuando haya precios reales).
- **OpenAPI público:** aplazado. La API sigue documentada vía Hono RPC para la app; un spec HTTP público (`@hono/zod-openapi`) solo si más adelante hay integraciones externas o endpoints comerciales self-serve.

## 5. Flujo de trabajo

- **GitHub:** repositorio **[sulbase/RENT](https://github.com/sulbase/RENT)** y operaciones (`gh`, push, PR) con la cuenta **[sulbase](https://github.com/sulbase)** — no `kpalvear`. Commits con autor `324332889+sulbase@users.noreply.github.com` (configuración **local** del repo: `git config user.email` / `user.name`).
- **Cloudflare:** Worker en `OpenProperty/` (`wrangler.toml`, nombre `rent`). **Producción (edge):** solo **GitHub Actions** — cada push a `main` → jobs `verify` luego `deploy` en `.github/workflows/ci.yml` (`npm run build` + `npm run deploy` desde la raíz del repo; secrets `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`). URL canónica: **`https://rent.sulbase.com`** (configurar custom domain en el Worker); hasta entonces lab en `https://rent.sistemas-d5d.workers.dev`. **Preview antes de merge:** job `preview` en pull requests (`wrangler preview`). **No usar Workers Builds** en este repo (desconectar Git en el dashboard del Worker `rent` → Settings → Build) para evitar doble deploy y un segundo token; otros proyectos de la cuenta pueden seguir con Builds. D1 solo en `wrangler dev -e local` hasta Fase 2. Secretos de app: `wrangler secret put`, nunca en git.
- **Postgres en producción:** el deploy de GitHub **no** configura la base de datos. Tras el primer deploy (o al cambiar de proyecto Supabase), ejecutar `wrangler secret put DATABASE_URL` con la URL del **transaction pooler** de Supabase (puerto **6543**, `?pgbouncer=true`). Sin ese secreto, el Worker arranca pero `/api/*` falla al conectar. En local, `pnpm run prepare:local-auth` (desde `.env` con `DATABASE_POOLED_URL`) o la misma URL 6543 en `.dev.vars`. Las migraciones Drizzle usan **5432** en `.env` y se aplican **fuera** del Worker (local o CI dedicado), no en el job `deploy`. **Hyperdrive:** activar en Cloudflare y `wrangler.toml` **antes del lanzamiento** (checklist §8); hasta entonces prod con pooler 6543 es válido.
- **Auth en producción:** `wrangler secret put SUPABASE_JWT_SECRET` (JWT Secret del proyecto). Sin secret ni bypass, `/api/*` responde 401. Local sin login: `AUTH_DEV_BYPASS=true` en `.dev.vars` **solo** si no hay `SUPABASE_JWT_SECRET`. Frontend: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en `.env` para Vite.
- **Local Modo B (auth como prod):** en `OpenProperty/`, `.env` con Supabase + `DATABASE_POOLED_URL`; `copy .env.local.example .env.local`; `pnpm run dev:auth` (genera `.dev.vars` y arranca Vite + `wrangler dev`). Landing en `http://localhost:5173/`; la SPA en `http://localhost:5173/app`. Supabase Redirect URLs: `http://localhost:5173/**`.
- **Archivos y firma (Fase 6B):** bucket R2 creado en Cloudflare y declarado en `wrangler.toml` (`binding = "FILES"`). Las claves de firma.dev (`FIRMA_API_KEY`, `FIRMA_WEBHOOK_SECRET`) y el registro del webhook se hacen en la **Fase 7**, nunca en el cliente ni en el repositorio.
- `main` protegida; todo entra por Pull Request con al menos una revisión humana.
- **CI obligatorio:** typecheck, lint/formato, tests unitarios y de integración de la API, build de frontend y backend, escaneo de secretos.
- **La IA propone, el humano aprueba.** Nunca fusionar código de IA sin revisión.
- **Prohibido** que un asistente ejecute migraciones o comandos destructivos contra producción (`drizzle-kit push/migrate`, SQL destructivo, seeds) sin confirmación explícita.

| Entorno | Frontend | Backend | Base de datos |
|---|---|---|---|
| Local | Vite dev | `wrangler dev` | Postgres local o proyecto de desarrollo |
| Lab / Preview | Preview URL | Worker `dev` | Proyecto Supabase Free de desarrollo |
| Staging | Preview/Staging | Worker staging | Mismo proyecto Free de desarrollo |
| Producción | Cloudflare | Worker prod | Segundo proyecto Supabase Free (solo antes del lanzamiento) |

## 6. Laboratorio de experimentos

Espacio para probar ideas sin riesgo. Reglas:
- Trabajar en ramas `lab/<tema>`, nunca directo en `main`.
- Usar **solo** la BD y el Worker de desarrollo; jamás credenciales de producción.
- Cada experimento termina con una nota breve: qué se probó, resultado y decisión (adoptar, descartar, seguir).

Experimentos candidatos:
- [ ] Máquina de estados de órdenes de trabajo inspirada en los tickets de Condo
- [ ] Permisos en la aplicación vs. RLS (comparar complejidad y rendimiento)
- [ ] Historial de cambios por triggers de Postgres (`*_history`) y soft delete (`deleted_at`)
- [ ] Hono RPC + OpenAPI en paralelo sobre las mismas rutas
- [ ] Cloudflare Queues para tareas largas (generación mensual de cargos, importaciones)
- [x] Subida de archivos a R2 vs. Supabase Storage — **resuelto: R2** (ver decisión #12 y Fase 6B.1)
- [ ] Skill propia `condo-port` (cuando se decida crearla)
- [ ] Jev (TypeSafe AI) como capa de decisión: clasificar órdenes de trabajo, puntuar solicitudes, estimar riesgo de mora (ver 6.1)
- [ ] _Por definir:_ ______________________

### 6.1 Experimento: Jev como capa de decisión

**Qué es (según la prensa y la ficha pública; verificar en la documentación oficial antes de integrar):** un modelo de TypeSafe AI que no genera texto. Recibe un estado (texto o JSON) y preguntas tipadas, y devuelve valores estructurados con probabilidades. Sirve para clasificar, puntuar y elegir entre opciones; **no** para escribir código ni conversar. No sustituye a Cursor ni a un LLM.

**Casos de uso candidatos en este proyecto:**
- Clasificar órdenes de trabajo: categoría (plomería, electricidad, HVAC…), prioridad y urgencia. (En Condo el ticket se autoclasifica al crearse; aquí sería el equivalente.)
- Sugerir a qué proveedor asignar una orden.
- Puntuar solicitudes de inquilinos (`applications`) como apoyo, nunca como decisión final.
- Estimar la probabilidad de mora en un cargo de renta.
- Decidir si un caso se escala a una persona.

**Reglas del experimento:**
- Solo en rama `lab/jev`, con datos de prueba; **sin datos personales reales** hasta revisar la política de privacidad y retención del proveedor.
- La llamada se hace **solo desde el Worker** (Hono); la clave va en `wrangler secret put`, nunca en el cliente ni en el repositorio.
- Toda decisión se guarda en una tabla `ai_decisions` (entidad, pregunta, valor, probabilidad, versión del modelo, fecha) para poder auditarla.
- Umbral de confianza: por debajo de `[definir]` pasa a revisión humana.
- Decisiones con efecto sobre personas (aceptar o rechazar una solicitud, cobrar una penalidad) **siempre las confirma un humano**.
- Comparar contra una regla determinista simple antes de adoptarlo: si no mejora, se descarta.
- Verificar precio, límites, disponibilidad (acceso anticipado vs. general) y compatibilidad con Workers en la documentación oficial.

**Resultado esperado:** nota breve con precisión observada, latencia, costo por decisión y recomendación (adoptar, descartar, seguir).

### Referencia de Condo: estados de ticket (para el experimento de órdenes de trabajo)
Estados: `OPEN`, `IN_PROGRESS`, `DEFERRED`, `COMPLETED`, `CLOSED`, `DECLINED`.

| Desde | Puede pasar a |
|---|---|
| OPEN | IN_PROGRESS, DEFERRED, DECLINED |
| IN_PROGRESS | DEFERRED, COMPLETED, OPEN, DECLINED |
| COMPLETED | OPEN, CLOSED |
| DEFERRED | OPEN, DECLINED |
| DECLINED | — (terminal) |

Reglas: al crear sin estado → `OPEN`; `DEFERRED` exige `deferredUntil`; cada cambio queda registrado en un historial.

## 7. Hoja de ruta (marca cada paso al completarlo)

### Fase 0 — Preparación
- [x] Skills instaladas y detectadas por Cursor
- [x] Repositorio público con `main` protegida y este `AGENTS.md` en la raíz
- [x] Proyecto Supabase Free de desarrollo creado; pooler (5432 y 6543) verificado. Sin PITR ni backups de pago
- [x] Worker `rent` en edge; deploy de `main` vía GitHub Actions (`deploy`); Workers Builds desconectado en RENT; ver §5
- [ ] Alertas de costo/errores en Cloudflare dashboard (aplazado; GitHub + Slack GitHub app bastan por ahora)
- [x] Secretos cargados con `wrangler secret put` / GitHub Actions; nada en el repositorio
  - Worker `rent` (Wrangler): `DATABASE_URL` (pooler 6543), `SUPABASE_JWT_SECRET`
  - GitHub Actions: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (build frontend en CI)
  - Comprobado en prod/lab: `/api/health` → Postgres, login Supabase, deploy Actions (sin valores en git; Gitleaks en CI)

### Fase 1 — Esquema
- [x] `src/db/schema.ts` en Drizzle a partir de `schema.sql` (con `organization_id`, sin RLS aún)
- [x] `drizzle.config.ts` y primera migración versionada
- [x] Migración aplicada al Supabase de desarrollo

### Fase 2 — Capa de datos
- [x] Reemplazar `@clawnify/db` por Drizzle (pooler Supabase; código listo para Hyperdrive en `resolveDatabaseUrl`)
- [x] `wrangler.toml` sin binding a D1; conexión vía pooler **6543** en dev/lab/prod interino
- [x] `wrangler dev` funcionando contra Supabase
- [ ] Hyperdrive en Worker **producción** (pre-lanzamiento; ver checklist §8) — local sigue sin Hyperdrive

### Fase 3 — API
- [x] Partir `index.ts` en módulos de rutas por dominio
- [x] Validación Zod en cada endpoint
- [x] Hono RPC: tipos compartidos backend ↔ frontend
- [x] Panel (`/api/dashboard/summary`) y generación de cargos de renta revisados

### Fase 4 — Autenticación y organizaciones
- [x] Decisión: permisos en la aplicación vs. RLS (RLS aplazado)
- [x] Supabase Auth integrado (cliente + JWT en Worker)
- [x] `organizations` + `memberships` con roles (onboarding + selector de org)
- [x] Todas las consultas filtradas por organización (vía middleware; no confiar en org del cliente)
- [x] Tests unitarios de roles y selección de tenant (`roles.test.ts`, `tenant.test.ts`)
- [x] Tests de integración API de aislamiento (`src/server/integration/org-isolation.test.ts`; ampliar a más rutas si hace falta)

### Fase 5 — CI y despliegue
- [x] CI: typecheck, lint (`biome` en `src/server`), tests, build, escaneo de secretos (`gitleaks`)
- [x] Staging = preview Worker en PR (`preview` job); producción = push a `main` (`deploy` job) — ver §5
- [x] Rate limiting en `/api/*` y rutas auth-adjacentes (`/api/me`, `/api/auth/*`) — ver `src/server/auth/rate-limit.ts`
- [ ] Restauración probada desde un `db dump` (procedimiento en `OpenProperty/docs/db-backup-restore.md`; ejecutar en lab)

### Fase 6 — Producto interior (prioridad antes de marketing)
- [x] Completar y pulir módulos core en la SPA (propiedades, renta, mantenimiento, etc.) — listas, panel y acciones principales en español
- [x] Marca **RENT** en UI (sustituir referencias OpenProperty en login, nav, `index.html`, manifest)
- [x] Español y **métrico** en formatos de la app (fechas `dd/MM/yyyy`, áreas en m², moneda de la organización; el valor por defecto de una org nueva es MXN)
- [x] Separación de rutas `/` (landing) y `/app/*` (SPA). Las rutas antiguas redirigen a `/app/…`

### Fase 6B — Documentos, firma, buzón y cuenta (plan intermedio)

Objetivo: cerrar los huecos funcionales del producto interior antes de landing y GEO.
Cada punto entra por Pull Request propio, con Zod, filtro por `organization_id` y tests de aislamiento.
Orden sugerido: **6B.4 → 6B.1 → 6B.3 → 6B.5 → 6B.2** (lo barato primero; la firma depende de documentos en R2; el correo interno puede ir en paralelo tras alertas).

#### 6B.1 Archivos e imágenes en R2
- [x] `[[r2_buckets]]` en `OpenProperty/wrangler.toml` con `binding = "FILES"`; bucket por entorno (`rent-files-dev`, `rent-files`) y tipado en `WorkerBindings`
- [x] Tabla `documents`: `id`, `organization_id`, `entity_type` (`property|unit|lease|tenant|work_order`), `entity_id`, `kind` (`image|deed|certificate|invoice|signed_lease|other`), `r2_key`, `filename`, `mime`, `size_bytes`, `uploaded_by`, `created_at`, `deleted_at`
- [x] Índice por `(organization_id, entity_type, entity_id)`; clave foránea compuesta contra la entidad cuando exista su `uq_<tabla>_id_org`
- [x] Clave R2 generada en el servidor: `org/<organization_id>/<entity_type>/<entity_id>/<uuid>-<nombre-normalizado>`. Nunca usar rutas enviadas por el cliente
- [x] Rutas `/api/documents`: subir, listar por entidad, descargar y borrar (soft delete). Validar tipo MIME permitido, tamaño máximo y extensión
- [x] Descarga **siempre a través del Worker** con JWT y organización comprobada; el bucket no es público
- [x] UI: pestaña "Documentos" en propiedad, unidad y contrato; arrastrar y soltar; galería con imagen de portada
- [x] Límite por organización (número de archivos y MB) para acotar almacenamiento y egress
- [x] Borrado de la entidad → borrar también los objetos en R2 (o marcarlos para limpieza por Cron)

#### 6B.2 Firma de contratos con firma.dev
API verificada en docs.firma.dev **v01.38.00**: base `https://api.firma.dev/functions/v1/signing-request-api`, cabecera `Authorization` con la API key (el prefijo `Bearer` es opcional). Webhook HMAC-SHA256 sobre `{timestamp}.{body}`.
- [x] Cliente en `src/server/integrations/firma.ts` (crear y enviar, reenviar, cancelar, descargar PDF; reintento corto ante 429)
- [x] Tabla `lease_signatures`: `id`, `organization_id`, `lease_id`, `provider` (`firma_dev`), `provider_request_id`, `status` (`draft|sent|viewed|partially_signed|completed|declined|expired|cancelled`), `document_id` (PDF firmado en R2), `created_by`, `sent_at`, `completed_at`, `last_error`, `audit` (jsonb)
- [x] Tabla `lease_signature_recipients`: firmante, correo, rol (`owner|tenant`), orden, estado y `signed_at`
- [x] Tabla `firma_webhook_deliveries`: idempotencia por `X-Firma-Delivery`
- [x] Rutas `/api/leases/:id/signature`: crear y enviar solicitud (PDF del contrato o plantilla), consultar estado, reenviar y cancelar
- [x] Webhook `POST /api/webhooks/firma`: verificar `X-Firma-Signature` (HMAC SHA-256 sobre `{timestamp}.{body}`, tolerar la rotación con `X-Firma-Signature-Old`), rechazar marcas de tiempo antiguas e ignorar entregas repetidas por `X-Firma-Delivery`
- [x] Eventos mínimos: `signing_request.recipient.signed` y `signing_request.completed`; al completarse, descargar el PDF final y archivarlo en R2 como `documents.kind = 'signed_lease'`
- [x] Responder al webhook en menos de 5 segundos: confirmar primero y archivar el PDF después (`waitUntil`)
- [x] Respetar los límites de tasa de firma.dev y registrar los fallos en el buzón (6B.3) — el cliente respeta 429; el fallo queda en `lease_signatures.last_error` y genera una alerta `signature`
- [x] UI: estado de firma en el contrato, con historial por firmante y enlace al PDF archivado

#### 6B.3 Buzón: alertas del sistema
- [x] Tabla `notifications`: `id`, `organization_id`, `user_id` (nulo = toda la organización), `kind` (`rent_due|rent_overdue|lease_expiring|work_order|signature|system`), `title`, `body`, `severity` (`info|warning|critical`), `entity_type`, `entity_id`, `read_at`, `created_at`
- [x] Rutas `/api/notifications`: listar con contador de no leídas, marcar una y marcar todas
- [x] Generación con **Cron Trigger** en lotes pequeños: cargos vencidos, contratos por expirar y órdenes de trabajo sin asignar (reutilizar la lógica de `src/server/routes/rent.ts`)
- [x] Evitar duplicados con clave lógica por `(organization_id, kind, entity_id, periodo)` y `ON CONFLICT DO NOTHING`
- [x] Eventos de firma (6B.2) generan entradas en el buzón
- [x] UI: campana en `page-shell` con contador, panel lateral y filtro por tipo y estado (solo alertas automáticas; distinto de la bandeja de correo 6B.5)

#### 6B.4 Ajustes de cuenta y organización
- [x] Separar superficies: `/api/settings` = organización; nueva `/api/account` = datos del usuario
- [x] Cuenta (Supabase Auth desde el cliente): cambiar contraseña, cambiar correo con reconfirmación y nombre para mostrar en `user_metadata`
- [x] **Recuperar contraseña** en el login (`resetPasswordForEmail` con el mismo destino que el resto de correos) — hoy no existe
- [x] Cerrar sesión en todos los dispositivos
- [x] Organización: nombre, zona horaria, moneda, idioma y formato de fecha y área (enlaza con "español y métrico" de la Fase 6)
- [x] Miembros: listar `memberships`, invitar por correo, cambiar rol y quitar acceso; solo `owner` y `manager` (usar `roles.ts`)
- [x] La organización activa se sigue resolviendo en el middleware; nunca se acepta la del cliente

#### 6B.5 Mensajería tipo correo (dentro de la app)
Modelo **correo electrónico**: hilos con asunto, remitente, destinatarios, cuerpo y fecha; bandeja de entrada y enviados; responder y reenviar en el mismo hilo. Todo filtrado por `organization_id`. Los adjuntos usan `documents` (6B.1) enlazados al mensaje o al hilo.

- [x] Tabla `message_threads`: `id`, `organization_id`, `subject`, `entity_type` / `entity_id` opcional (propiedad, contrato, inquilino, orden de trabajo), `created_by`, `created_at`, `last_message_at`
- [x] Tabla `message_thread_participants`: `thread_id`, `participant_kind` (`membership` | `tenant`), `user_id` o `tenant_id`, `email` (copia para mostrar), `role` (`from|to|cc` en el primer mensaje)
- [x] Tabla `messages`: `id`, `thread_id`, `organization_id`, `sender_user_id` (miembro de la org), `body` (texto), `created_at`; sin edición tras enviar (solo nuevos mensajes en el hilo)
- [x] Tabla `message_reads`: `message_id`, `user_id`, `read_at` — estado leído/no leído por destinatario interno
- [x] Rutas `/api/messages`: listar hilos (entrada / enviados), obtener hilo con mensajes, crear hilo (redactar), responder en hilo, marcar hilo o mensaje como leído
- [x] Destinatarios: miembros de la organización (`memberships`) e **inquilinos** del directorio (`tenants` con email); validar que el inquilino pertenece a la misma org
- [x] UI: sección **Correo** (o **Mensajes**) con lista de hilos, vista de conversación, redactar (asunto + Para/CC + cuerpo), adjuntar archivos vía API de documentos
- [x] **Correo SMTP saliente al email del inquilino:** aplazado; el MVP es mensajería **dentro de RENT** con UX de correo. Cuando exista portal de inquilino o integración SMTP, el mismo hilo puede notificar por email
- [x] Rate limiting en envío; tamaño máximo de cuerpo; prohibido HTML arbitrario sin sanitizar si más adelante se admite rich text

#### Criterios de cierre de la Fase 6B
- [x] Un administrador puede subir la escritura y las fotos de una propiedad, enviar el contrato a firma con firma.dev, ver la alerta de renta vencida, redactar un mensaje tipo correo a un inquilino y cambiar su contraseña, todo en español
- [x] Tests de integración de aislamiento ampliados a `documents`, `notifications`, `message_threads` / `messages` y `lease_signatures`
- [x] Ningún archivo accesible sin JWT y sin pertenecer a la organización propietaria
- [x] Webhook de firma con verificación de firma probada, incluida una petición manipulada que debe rechazarse

### Fase 7 — Landing y GEO (app cerrada; superficie pública mínima)
- [x] Decisión: SPA privada; landing futura con **React Router v7** (no Remix); precios/disponibilidad después
- [ ] Cuenta y API key de firma.dev: `wrangler secret put FIRMA_API_KEY` y `wrangler secret put FIRMA_WEBHOOK_SECRET` (nunca en el cliente ni en el repositorio). Registrar el webhook HTTPS en `https://rent.sulbase.com/api/webhooks/firma` (en lab, la URL de `workers.dev`); debe responder en menos de 5 segundos. En local, las mismas variables en `.dev.vars`. El Worker ya responde y archiva el PDF; faltan los secretos y el registro en firma.dev.
- [x] Dominio `rent.sulbase.com` ligado al Worker `rent` (zona `sulbase.com` en Cloudflare; custom domain activo). La ruta está en `OpenProperty/wrangler.toml`.
- [ ] Redirect desde workers.dev. `CANONICAL_REDIRECT` sigue en `"false"`: un 301 elimina el hash de los correos de Supabase. Activarlo cuando `https://rent.sulbase.com/app` esté en las Redirect URLs y `VITE_AUTH_REDIRECT_URL` apunte ahí.
- [x] Landing en `/` (RR7 pre-render): copy en español, HTML completo para crawlers/agentes. React Router 7 prerenderiza en el build (`src/landing/`); el Worker sirve el HTML estático, sin bundle de cliente.
- [x] SPA en `/app/*` con `noindex`; login bajo `/app`. Las rutas antiguas (`/properties`, …) redirigen a `/app/…`.
- [x] `robots.txt`, `sitemap.xml` (solo URLs públicas), JSON-LD en la landing (`Organization` + `SoftwareApplication`, sin `Offer`)
- [ ] Validar datos estructurados (Rich Results / Schema Markup Validator) — el JSON-LD se comprueba en test; el validador público exige la URL ya desplegada
- [x] `llms.txt`; allow selectivo de user-agents IA en `robots.txt` (nombres publicados por OpenAI, Anthropic, Perplexity, Google, Apple, Amazon, Common Crawl, ByteDance y Meta; `/app/` y `/api/` siguen bloqueados)

### Fase 8 — Comercial y API pública (cuando el producto esté listo)
- [ ] Páginas públicas extra (precios, disponibilidad, FAQ, legal) en el sitio RR7
- [ ] OpenAPI o endpoints comerciales self-serve solo si hay integradores o bots autorizados

### Fase 9 — Funciones inspiradas en Condo (opcional)
- [ ] Órdenes de trabajo con máquina de estados e historial
- [ ] Soft delete y versionado
- [ ] Roles y permisos más finos

## 8. Checklist previo al lanzamiento

- [ ] **Hyperdrive (producción):** en Cloudflare Dashboard crear Hyperdrive apuntando al **transaction pooler** de Supabase (host pooler, puerto **6543**, `pgbouncer=true`); descomentar `[[hyperdrive]]` en `OpenProperty/wrangler.toml` (`binding = "HYPERDRIVE"`); deploy y comprobar `/api/health`, login y bootstrap de org. Mantener `DATABASE_URL` 6543 como respaldo o según docs vigentes de Wrangler. **Caché de consultas:** desactivada o muy acotada (app de gestión). Desarrollo local **no** requiere Hyperdrive (`prepare:local-auth` + 6543).
- [ ] Restauración probada desde un volcado manual (`db dump`)
- [ ] Rate limiting y validación de entrada revisados
- [ ] Prueba de carga básica sobre la API (guía en `OpenProperty/docs/load-test.md`; ejecutar antes del lanzamiento; ideal comparar con/sin Hyperdrive si ya está activo)
- [x] Aislamiento entre organizaciones verificado (tests de integración + revisión manual en lab)
- [x] Plan de rollback documentado (`OpenProperty/docs/rollback.md`)

## 9. Control de riesgos

| Riesgo | Control |
|---|---|
| Gasto descontrolado | Supabase permanece en Free. Alertas y límites en Cloudflare. Vigilar cuotas del Free (500 MB, egress, pausa a los 7 días) |
| Pérdida de datos | Volcado manual fuera del repo y restauración probada. El plan Free no tiene backups automáticos ni PITR |
| Bug por cambio de API | Hono RPC + typecheck en CI |
| Abuso de tráfico | Rate limiting + protección de Cloudflare |
| Secretos expuestos | Gestor de entorno + escaneo en CI |
| Fuga entre organizaciones | Filtro por `organization_id` + tests (y RLS si se adopta) |
| Cambio destructivo en producción | Migraciones solo por CI; prohibido para asistentes de IA |
| Dependencia de un proveedor | Código estándar (Hono, Drizzle, Postgres) portable |
| Fuga de archivos entre organizaciones | Clave R2 con prefijo de organización, bucket privado y comprobación de pertenencia en cada descarga |
| Coste de almacenamiento y egress en R2 | Límite por organización y por archivo; vigilar métricas de R2 en el dashboard |
| Webhook de firma suplantado | Verificación HMAC obligatoria, ventana de tiempo acotada y control de entregas repetidas |
| Contrato firmado no recuperable | El PDF final se archiva en R2 y queda enlazado al contrato; no depender solo del panel de firma.dev |
| Mensajes visibles fuera de la organización | Hilos y participantes siempre acotados por `organization_id`; comprobar inquilino y miembro en la misma org en cada envío |

## 10. Decisiones abiertas

| # | Decisión | Estado |
|---|---|---|
| 1 | Permisos en la aplicación vs. RLS | Cerrado: aplicación primero; RLS opcional después |
| 2 | Multi-organización desde el esquema inicial | Recomendado: sí |
| 3 | SSR / sitio público | Cerrado: **React Router v7** solo para landing/marketing; **SPA Vite** para `/app`. Sin Remix |
| 4 | OpenAPI público desde Hono | Aplazado (Fase 8); API privada con Hono RPC |
| 5 | Skill comunitaria de Drizzle | Opcional, revisar antes |
| 6 | Crear la skill propia `condo-port` | Aplazada |
| 7 | Integrar Jev como capa de decisión | Solo experimento (sección 6.1) |
| 8 | Plan de Supabase | Cerrado: Free para siempre. Sin PITR ni backups de pago. Un proyecto hasta lanzamiento; segundo solo para prod |
| 9 | Segundo proyecto Supabase (prod) | Pendiente hasta pre-lanzamiento; no bloquea Fase 1 |
| 10 | Dominio y GEO | Cerrado: `rent.sulbase.com`; GEO = landing única; resto no indexable |
| 11 | Hyperdrive vs pooler 6543 | Cerrado: **6543** en dev/lab y prod hasta pre-lanzamiento; **Hyperdrive en prod** antes del go-live (checklist §8). No sustituye migraciones en 5432 |
| 12 | Almacenamiento de archivos | Cerrado: **R2** para todo (imágenes, escrituras, certificados, contratos firmados); binding `FILES`, bucket privado |
| 13 | Proveedor de firma electrónica | Cerrado: **firma.dev**; webhooks con HMAC y PDF final archivado en R2 (Fase 6B.2) |
| 14 | Mensajería con inquilinos | Cerrado: **tipo correo** en la app (hilos, asunto, bandeja entrada/enviados, miembros + inquilinos); alertas automáticas en `notifications` (6B.3). **Portal del inquilino v1:** cuenta Supabase invitada desde la ficha (`tenant_invitations`, enlace en `tenants.user_id` al primer `/api/me`), dentro de `/app/portal`, API en `/api/portal/*` acotada a esa ficha; sin SMTP. SMTP después |
