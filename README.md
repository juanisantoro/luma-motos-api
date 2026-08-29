# Luma Motos API

Backend productivo de Luma Motos construido con NestJS, TypeScript, Prisma y PostgreSQL en Neon. El servicio está preparado para desplegarse como Web Service en Render.

## Requisitos

- Node.js 20.19 o 22 LTS (el repositorio incluye `.node-version` con Node 22)
- npm
- Una base PostgreSQL en Neon

## Configuración local

1. Instalar dependencias:

   ```bash
   npm ci
   ```

2. Copiar `.env.example` a `.env` y completar todas las variables:

   ```bash
   cp .env.example .env
   ```

   En PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Generar el cliente de Prisma, aplicar migraciones y cargar datos base:

   ```bash
   npm run prisma:generate
   npm run prisma:migrate:deploy
   npm run prisma:seed
   ```

4. Iniciar el servidor:

   ```bash
   npm run start:dev
   ```

La API queda disponible en `http://localhost:3000/api` y el health check en `GET /api/health`.

## Autenticación y autorización

La API requiere autenticación por defecto. Las únicas rutas públicas iniciales son:

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/change-temporary-password`

Cada JWT identifica una sesión persistida. La sesión vence después de una hora sin actividad por defecto; cada request autenticado renueva `lastActivityAt`. El valor se configura con `JWT_SESSION_IDLE_TIMEOUT_SECONDS`, entre 60 segundos y 7 días. No es una expiración fija desde el login: mientras exista actividad dentro de la ventana, la sesión continúa vigente. `POST /api/auth/logout` la revoca inmediatamente.

La estrategia vuelve a consultar el usuario, su estado, rol y permisos en PostgreSQL en cada request, por lo que desactivar una cuenta o cambiar permisos tiene efecto inmediato. Las contraseñas se verifican con Argon2id y nunca se devuelven en respuestas ni se guardan en auditoría.

Crear el primer administrador de manera interactiva, después de ejecutar el seed:

```bash
npm run user:create-admin
```

El comando oculta la contraseña, exige al menos 12 caracteres, crea el administrador dentro de `LUMA_CENTRAL` con acceso global, crea su registro de `personal`, registra la operación en `registros_auditoria` y se niega a ejecutarse si ya existe cualquier usuario.

Iniciar sesión:

```http
POST /api/auth/login
Content-Type: application/json

{
  "organizationCode": "LUMA_CENTRAL",
  "email": "administrador@ejemplo.com",
  "password": "contraseña-ingresada-en-el-cli"
}
```

Consultar el perfil autenticado:

```http
GET /api/auth/me
Authorization: Bearer <accessToken>
```

Los decoradores `@Roles(...)` y `@Permissions(...)` permiten proteger nuevos controladores. Los guards son globales y verifican que el rol o todos los permisos declarados estén vigentes. El login admite cinco intentos por minuto y bloquea temporalmente el origen que supera el límite; el resto de la API admite cien requests por minuto por instancia.

Los intentos de login exitosos y fallidos se registran en `registros_auditoria` sin contraseñas, tokens ni detalles de conexión.

### Gestión segura de usuarios

Los permisos se administran mediante el seed:

- `usuarios.consultar`: asignado a **Administrador** y **Gerente**.
- `usuarios.gestionar`: asignado solo a **Administrador**.

Los usuarios sin acceso global quedan limitados por RLS a su organización. Un administrador global de Casa Central puede seleccionar otra organización; el backend valida que la sucursal pertenezca a ella. La organización asignada al crear el usuario no se modifica posteriormente para preservar la trazabilidad histórica.

| Endpoint | Permiso | Uso |
| --- | --- | --- |
| `GET /api/users` | `usuarios.consultar` | Listar usuarios con filtros y paginación |
| `GET /api/users/:id` | `usuarios.consultar` | Consultar un usuario |
| `GET /api/roles` | `usuarios.consultar` | Consultar roles y sus permisos |
| `GET /api/organizations` | `usuarios.consultar` | Consultar organizaciones accesibles |
| `GET /api/branches` | `usuarios.consultar` | Consultar sucursales accesibles |
| `POST /api/users` | `usuarios.gestionar` | Crear un usuario y enviar su contraseña temporal |
| `PATCH /api/users/:id/access` | `usuarios.gestionar` | Cambiar rol, sucursal o acceso global |
| `PATCH /api/users/:id/status` | `usuarios.gestionar` | Activar o desactivar |
| `POST /api/users/:id/temporary-password` | `usuarios.gestionar` | Revocar sesiones y emitir otra contraseña temporal |

El alta requiere email, nombre, organización y rol; sucursal, acceso global, código de empleado y teléfono son opcionales. La contraseña temporal se genera con aleatoriedad criptográfica, solo se conserva como hash Argon2id y vence según `USER_TEMPORARY_PASSWORD_TTL_SECONDS`. No se devuelve en la respuesta HTTP ni se incluye en auditoría.

Antes del primer login, el destinatario debe reemplazarla:

```http
POST /api/auth/change-temporary-password
Content-Type: application/json

{
  "organizationCode": "LUMA_CENTRAL",
  "email": "usuario@ejemplo.com",
  "temporaryPassword": "recibida-por-email",
  "newPassword": "una-contraseña-personal-segura"
}
```

Un usuario autenticado puede cambiar su contraseña con `POST /api/auth/change-password`, enviando `currentPassword` y `newPassword`. Los cambios de contraseña, rol, sucursal, acceso global o estado revocan todas las sesiones abiertas. Cada modificación y cada resultado de entrega de email queda auditado con actor, organización objetivo y timestamp.

### Gestión segura de clientes

El seed asigna `clientes.consultar` y `clientes.gestionar` a **Vendedor**, **Administrativa**, **Gerente** y **Administrador**. RLS limita cada consulta y mutación a la organización autenticada; solo un usuario con `acceso_global` puede enviar `organizationId` para listar o crear en otra organización.

| Endpoint | Permiso | Uso |
| --- | --- | --- |
| `GET /api/clients` | `clientes.consultar` | Listar con paginación y filtros |
| `GET /api/clients/:id` | `clientes.consultar` | Consultar por UUID |
| `POST /api/clients` | `clientes.gestionar` | Crear |
| `PATCH /api/clients/:id` | `clientes.gestionar` | Actualizar datos editables |
| `PATCH /api/clients/:id/status` | `clientes.gestionar` | Activar o desactivar sin borrar |

El listado acepta `page` (1-1.000.000), `limit` (1-100, por defecto 50), `search` (nombre, documento o email), `active` y `organizationId` (solo acceso global). Responde `{ items, total, page, limit }`, ordenado por creación descendente.

El alta recibe `fullName` y, opcionalmente, `documentType` (`DNI`, `CUIT`, `CI`, `PASAPORTE` u `OTRO`), `documentNumber`, `phone`, `email`, `address`, `notes` y `organizationId`. Tipo y número de documento se envían siempre juntos. La actualización admite los mismos datos editables salvo la organización; enviar ambos campos documentales como `null` elimina el documento. La respuesta usa nombres JSON en inglés:

```json
{
  "id": "uuid",
  "documentType": "DNI",
  "documentNumber": "12.345.678",
  "fullName": "Ana Cliente",
  "phone": null,
  "email": "ana@example.com",
  "address": null,
  "notes": null,
  "active": true,
  "createdAt": "2026-08-29T10:00:00.000Z",
  "updatedAt": "2026-08-29T10:00:00.000Z",
  "organization": {
    "id": "uuid",
    "code": "LUMA_CENTRAL",
    "name": "Luma Motos Casa Central",
    "type": "CASA_CENTRAL"
  }
}
```

Los nombres, emails y documentos se normalizan antes de buscar o persistir. Un índice parcial evita repetir la misma pareja tipo/número dentro de una organización, pero permite clientes sin documento. Los errores funcionales son `400` para payload, pareja documental, organización o estado inválidos; `403` para permisos/acceso global insuficientes; `404` para un UUID inexistente o fuera del tenant; y `409` para documento duplicado. Las mutaciones auditan actor, organización, estado y presencia de campos modificados sin copiar datos personales a la auditoría.

### Brevo SMTP

El envío usa STARTTLS con `smtp-relay.brevo.com:587`. Configurar en `.env` el login SMTP de Brevo, su clave SMTP y un remitente verificado:

```dotenv
SMTP_HOST="smtp-relay.brevo.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="login-smtp-de-brevo"
SMTP_PASSWORD="clave-smtp-de-brevo"
SMTP_FROM_EMAIL="remitente-verificado@dominio.com"
SMTP_FROM_NAME="Luma Motos"
```

No usar la contraseña de la cuenta Brevo ni guardar la clave SMTP en git. `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM_EMAIL` deben estar todos presentes o todos ausentes. Sin ellos el backend puede arrancar, pero el alta o reseteo informa que la entrega no está configurada.

PostgreSQL y SMTP no comparten una transacción distribuida: primero se confirma la cuenta o el reseteo y su auditoría, y luego se envía el email. Si Brevo falla, el fallo queda auditado y un administrador debe usar `POST /api/users/:id/temporary-password` para generar y enviar una credencial nueva; la anterior queda invalidada.

## Auditoría obligatoria

Toda mutación autenticada debe ejecutarse mediante `AuditService.execute(...)`. La operación de negocio y su registro en `registros_auditoria` se confirman en la misma transacción PostgreSQL y bajo el mismo contexto organizacional; si falla cualquiera, ambas se revierten. El evento exige el usuario actor y la organización, y la base asigna el timestamp, por lo que siempre queda registrado quién realizó la acción, para qué organización y cuándo.

Todo endpoint HTTP `POST`, `PUT`, `PATCH` o `DELETE` debe declarar `@AuditedMutation()`. Un guard global bloquea con error cualquier mutación nueva que omita esa declaración. Los intentos de login fallidos son la única excepción sin usuario: todavía no existe una identidad autenticada, por lo que se registran con actor nulo y sin incluir la credencial intentada. Migraciones y seeds son operaciones técnicas fuera del tráfico de usuarios.

Los usuarios se desactivan mediante `activo`; no se eliminan físicamente. La FK de auditoría restringe eliminaciones para preservar permanentemente la atribución histórica.

Los usuarios con permiso `auditoria.consultar` pueden consultar el historial paginado:

```http
GET /api/audit-logs?page=1&limit=50
Authorization: Bearer <accessToken>
```

La respuesta incluye acción, entidad, organización, usuario, sucursal actual y timestamp, sin hashes, tokens ni secretos.

## Variables de entorno

| Variable | Descripción |
| --- | --- |
| `DATABASE_URL` | URL pooled de un rol de aplicación sin `BYPASSRLS`. Debe incluir TLS (`sslmode=require`). |
| `DIRECT_URL` | URL directa del propietario, usada exclusivamente por Prisma para migraciones. |
| `JWT_SECRET` | Secreto aleatorio de al menos 32 caracteres. Nunca debe almacenarse en git. |
| `JWT_SESSION_IDLE_TIMEOUT_SECONDS` | Inactividad máxima de una sesión JWT; por defecto `3600` segundos. |
| `USER_TEMPORARY_PASSWORD_TTL_SECONDS` | Vigencia de contraseñas temporales; por defecto `86400` segundos. |
| `SMTP_HOST` | Host SMTP de Brevo, normalmente `smtp-relay.brevo.com`. |
| `SMTP_PORT` | Puerto SMTP de Brevo, normalmente `587`. |
| `SMTP_SECURE` | `false` para STARTTLS en el puerto 587; `true` solo para TLS implícito. |
| `SMTP_USER` | Login SMTP de Brevo. |
| `SMTP_PASSWORD` | Clave SMTP de Brevo, almacenada solo como secreto. |
| `SMTP_FROM_EMAIL` | Email remitente verificado en Brevo. |
| `SMTP_FROM_NAME` | Nombre visible del remitente. |
| `FRONTEND_URL` | Origen HTTP/HTTPS exacto autorizado por CORS. |
| `PORT` | Puerto HTTP. Render lo inyecta automáticamente; localmente usa `3000` por defecto. |
| `NODE_ENV` | `development`, `test` o `production`. |

El arranque valida estas variables y falla con un mensaje claro si falta alguna o tiene formato inválido. `.env` y sus variantes locales están ignorados por git; solo se versiona `.env.example`.

## Neon: URL pooled y directa

En Neon se deben usar roles separados:

- **Runtime**: crear un rol como `luma_app_runtime`, sin `SUPERUSER` ni `BYPASSRLS`, otorgarle conexión, uso de `public`, DML sobre tablas, uso de secuencias y ejecución de funciones. Su URL pooled va en `DATABASE_URL`.
- **Migraciones**: conservar el rol propietario de Neon únicamente en la URL directa `DIRECT_URL`.

También deben configurarse privilegios por defecto del propietario para que las tablas, secuencias y funciones creadas por migraciones futuras sean accesibles al rol de runtime. El arranque de producción se niega a iniciar si `DATABASE_URL` usa un rol con `SUPERUSER` o `BYPASSRLS`; en desarrollo solo emite una advertencia.

No reutilizar la URL compartida previamente por chat: esa credencial quedó expuesta. Rotar la contraseña o el rol de base de datos desde Neon y configurar únicamente las URLs nuevas en el `.env` local y en los secretos de Render.

## Modelo de datos y seeds

Prisma está alineado con el esquema integral existente de Luma Motos. La migración baseline representa el esquema original y las migraciones posteriores versionan autenticación y multiorganización. El backend de identidad usa directamente:

- `organizaciones`: Casa Central o franquicias.
- `sucursales`: locales pertenecientes a una organización; una sucursal de franquicia se identifica porque su organización es de tipo `FRANQUICIA`.
- `roles`, `permisos` y `permisos_rol`: autorización administrada como datos versionados.
- `usuarios` y `personal`: credenciales, estado, identidad, rol, organización y sucursal.
- `clientes`: identidad comercial, contacto, estado y organización, sin borrado físico.
- `registros_auditoria`: acción, entidad, organización, usuario actor, valores auditables y timestamp.
- `sesiones_autenticacion`: sesiones JWT revocables con vencimiento por inactividad.

El seed es idempotente y preserva el catálogo existente. Administra `LUMA_CENTRAL`, sus sucursales **San Miguel** y **Del Viso**, los roles **Vendedor**, **Administrativa**, **Administrador** y **Gerente**, y sincroniza los permisos de auditoría, usuarios y clientes descritos arriba. No crea usuarios, clientes ni contraseñas.

### Aislamiento multiorganización

Las tablas operativas llevan `organizacion_id`, constraints compuestas evitan referencias cruzadas y PostgreSQL aplica Row-Level Security obligatoria. Cada transacción de aplicación configura el tenant con `set_config(..., true)`, limitado a esa transacción para que una conexión pooled de Neon nunca conserve el contexto del request anterior.

Las FK compuestas siguen versionadas en SQL. Seis relaciones redundantes 1:1 se omiten deliberadamente del modelo Prisma porque Prisma 6 no puede representar a la vez la FK simple y su equivalente compuesto; volver a ejecutar `prisma db pull` requiere quitar nuevamente esas relaciones inferidas antes de generar el cliente.

- Una franquicia solo puede leer o modificar su propia organización.
- Un usuario de Casa Central sin `acceso_global` también queda limitado a su organización.
- `acceso_global` solo puede otorgarse a usuarios de tipo `CASA_CENTRAL`; habilita visibilidad transversal cuando además poseen el permiso funcional correspondiente.
- El login exige `organizationCode`, por lo que los intentos fallidos de una organización válida también quedan auditados en el tenant correcto.

`registros_auditoria` conserva la organización del evento. La sucursal devuelta para el actor corresponde a su asignación actual; si más adelante se requiere un snapshot histórico inmutable de la sucursal, deberá agregarse un `sucursal_id` propio al registro de auditoría.

Para actualizar el esquema durante desarrollo:

```bash
npm run prisma:migrate:dev -- --name descripcion_del_cambio
npm run prisma:seed
```

En producción solo se ejecutan migraciones ya versionadas:

```bash
npm run prisma:migrate:deploy
```

Si se conecta por primera vez una base Luma **ya inicializada** pero sin tabla `_prisma_migrations`, registrar una única vez el esquema existente antes del deploy:

```bash
npm run prisma:migrate:baseline
npm run prisma:migrate:deploy
```

El comando marca el esquema integral existente sin ejecutar ese DDL. No usarlo en una base vacía: allí `prisma:migrate:deploy` debe crear el esquema completo. Las migraciones también conservan funciones, `CHECK` constraints, triggers y las políticas RLS que Prisma no representa. La primera migración habilita `pg_trgm`, requerido por los índices de búsqueda.

## Despliegue en Render

`render.yaml` define un Web Service con:

- Build: `npm ci --include=dev && npm run render:build`
- Pre-deploy: `npm run prisma:migrate:deploy && npm run prisma:seed`
- Start: `npm run start:prod`
- Health check: `/api/health`

Crear el servicio mediante **New > Blueprint** apuntando a este repositorio. En Render completar `DATABASE_URL`, `DIRECT_URL`, `FRONTEND_URL`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM_EMAIL`; `JWT_SECRET` se genera como secreto. No cargar secretos en `render.yaml`.

El build necesita `@nestjs/cli`, TypeScript y Prisma CLI, que permanecen correctamente en `devDependencies`. `--include=dev` fuerza su instalación aunque Render exponga `NODE_ENV=production` o `NPM_CONFIG_PRODUCTION=true`; no mover estas herramientas a dependencias de runtime. Si el servicio fue creado manualmente o tiene un comando sobrescrito en el dashboard, reemplazar `npm install; npm run build` por el comando de build exacto anterior. `npm ci` valida y respeta `package-lock.json`, y `npm run start:prod` ejecuta únicamente el artefacto compilado `dist/main.js`.

El health check responde `200` solo cuando la aplicación puede consultar PostgreSQL. Ante una caída de base responde `503` con estados sanitizados, sin host, credenciales ni detalles internos.

## Scripts

| Comando                         | Uso                                           |
| ------------------------------- | --------------------------------------------- |
| `npm run start:dev`             | Desarrollo con recarga                        |
| `npm run build`                 | Compilación productiva                        |
| `npm run render:build`          | Generar Prisma y compilar para Render         |
| `npm run start:prod`            | Ejecutar `dist/main.js`                       |
| `npm run lint`                  | Lint y correcciones seguras                   |
| `npm test`                      | Pruebas unitarias                             |
| `npm run test:e2e`              | Pruebas HTTP                                  |
| `npm run prisma:generate`       | Generar Prisma Client                         |
| `npm run prisma:migrate:dev`    | Crear/aplicar migraciones de desarrollo       |
| `npm run prisma:migrate:deploy` | Aplicar migraciones versionadas               |
| `npm run prisma:seed`           | Sincronizar sucursales, roles y permisos base |
| `npm run user:create-admin` | Crear interactivamente el primer administrador |
