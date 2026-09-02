# Usuarios, roles y permisos

Todos los endpoints usan el prefijo `/api`, JSON estricto y JWT Bearer salvo los dos flujos públicos de autenticación. Las contraseñas temporales solo se envían por SMTP: nunca aparecen en responses, auditoría ni logs.

## Autenticación y primer acceso

### Login

`POST /api/auth/login`

```json
{
  "organizationCode": "LUMA_CENTRAL",
  "email": "usuario@example.com",
  "password": "credencial ingresada"
}
```

Un login normal responde:

```json
{
  "accessToken": "jwt",
  "tokenType": "Bearer",
  "idleTimeoutSeconds": 3600,
  "user": {
    "id": "uuid",
    "email": "usuario@example.com",
    "name": "Usuario Luma",
    "active": true,
    "globalAccess": false,
    "organization": {
      "id": "uuid",
      "code": "LUMA_CENTRAL",
      "name": "Luma Motos Casa Central",
      "type": "CASA_CENTRAL"
    },
    "role": {
      "id": "uuid",
      "code": "VENDEDOR",
      "name": "Vendedor",
      "system": true,
      "permissions": ["ventas.consultar"]
    },
    "branch": null
  }
}
```

Una contraseña temporal válida jamás crea sesión ni JWT. Responde `403`:

```json
{
  "statusCode": 403,
  "code": "PASSWORD_CHANGE_REQUIRED",
  "message": "Password change required",
  "details": {
    "organizationCode": "LUMA_CENTRAL",
    "email": "usuario@example.com",
    "expiresAt": "2026-08-30T18:00:00.000Z"
  }
}
```

Si la misma credencial válida expiró, responde `403 TEMPORARY_PASSWORD_EXPIRED`. Credenciales desconocidas, cuentas deshabilitadas o invitaciones no entregadas responden `401 INVALID_CREDENTIALS` sin distinguir la causa.

### Configuración inicial

`POST /api/auth/change-temporary-password`

```json
{
  "organizationCode": "LUMA_CENTRAL",
  "email": "usuario@example.com",
  "temporaryPassword": "recibida por email",
  "newPassword": "Clave-Nueva-Segura1!"
}
```

Responde `204`. La nueva contraseña debe tener entre 12 y 128 caracteres, mayúscula, minúscula, número y símbolo, y ser distinta de la temporal. La operación marca la invitación `ACCEPTED`, invalida la credencial temporal y revoca todas las sesiones. Repetirla no puede reutilizar la credencial.

`GET /api/auth/me` devuelve el mismo objeto `user` del login, con permisos efectivos leídos desde PostgreSQL. `POST /api/auth/change-password` conserva el cambio autenticado `{currentPassword,newPassword}` y responde `204`.

## Usuarios

Requieren `usuarios.consultar` para lectura y `usuarios.gestionar` para mutaciones.

| Método y path | Contrato |
| --- | --- |
| `GET /api/users` | Filtros `page`, `limit`, `search`, `organizationId`, `branchId`, `roleCode`, `active`, `invitationStatus`; responde `{items,total,page,limit}` |
| `GET /api/users/:id` | Detalle tenant-scoped |
| `POST /api/users` | `{email,fullName,organizationId,branchId?,roleCode,globalAccess?,employeeCode?,phone?}` |
| `PATCH /api/users/:id/access` | `{roleCode?,branchId?: uuid|null,globalAccess?}` |
| `PATCH /api/users/:id/status` | `{active}` |
| `POST /api/users/:id/invitation/resend` | Regenera la credencial, invalida la anterior, revoca sesiones y envía un nuevo correo |
| `POST /api/users/:id/temporary-password` | Alias compatible de reenvío/regeneración |
| `GET /api/organizations` | Organizaciones accesibles |
| `GET /api/branches?organizationId=uuid` | Sucursales activas accesibles |

Alta y reenvío responden `{user,delivery:{status:"DELIVERED",expiresAt}}`. Si Brevo falla, el intento queda `FAILED` y se responde `503 INVITATION_DELIVERY_FAILED` con `details: {userId,persisted:true,invitationStatus:"FAILED",retryEndpoint}`. La cuenta o el reseteo ya confirmados no se ocultan como si hubieran sido revertidos y nunca se devuelve éxito.

Un usuario contiene:

```json
{
  "id": "uuid",
  "email": "usuario@example.com",
  "active": true,
  "globalAccess": false,
  "passwordChangeRequired": true,
  "temporaryPasswordExpiresAt": "2026-08-30T18:00:00.000Z",
  "invitation": {
    "status": "DELIVERED",
    "lastAttemptAt": "2026-08-29T18:00:00.000Z",
    "sentAt": "2026-08-29T18:00:00.000Z",
    "expiresAt": "2026-08-30T18:00:00.000Z",
    "acceptedAt": null
  },
  "createdAt": "2026-08-29T18:00:00.000Z",
  "updatedAt": "2026-08-29T18:00:00.000Z",
  "lastLoginAt": null,
  "organization": {"id": "uuid", "code": "LUMA_CENTRAL", "name": "Luma", "type": "CASA_CENTRAL", "active": true},
  "role": {"id": "uuid", "code": "VENDEDOR", "name": "Vendedor", "active": true, "system": true, "version": 1, "permissions": []},
  "branch": {"id": "uuid", "code": "SAN_MIGUEL", "name": "San Miguel", "active": true},
  "personnel": {"id": "uuid", "employeeCode": null, "fullName": "Usuario Luma", "phone": null, "canSignIn": true, "status": "ACTIVO"}
}
```

`invitation.status` es `PENDING`, `DELIVERED`, `FAILED`, `ACCEPTED` o `EXPIRED`. Los cambios de rol, sucursal, alcance, estado o contraseña revocan todas las sesiones activas.

## Roles y permisos

`roles.consultar` habilita lectura y catálogo; `roles.gestionar` habilita mutaciones.

| Método y path | Contrato |
| --- | --- |
| `GET /api/roles` | Filtros `page`, `limit`, `search`, `active`, `organizationId`; responde `{items,total,page,limit}` |
| `GET /api/roles/:id` | Detalle |
| `POST /api/roles` | `{name,code?,description,permissionCodes[],organizationId?}`; genera `code` si se omite |
| `PATCH /api/roles/:id` | `{name?,description?,permissionCodes?,version}`; responde `{role,revokedSessions}` |
| `PATCH /api/roles/:id/status` | `{active,version}` |
| `POST /api/roles/:id/clone` | `{name,code?,organizationId?}` |
| `GET /api/permissions` | Catálogo `[{module,label,permissions:[{code,description}]}]` |

Un rol contiene `id`, `code`, `name`, `description`, `active`, `system`, `version`, `userCount`, timestamps, `organization` nullable, `permissions` y:

```json
{
  "actions": {
    "canEdit": true,
    "canChangeStatus": true,
    "canClone": true
  }
}
```

Los roles personalizados pertenecen a una organización. Los roles base `ADMINISTRADOR`, `GERENTE`, `ADMINISTRATIVA` y `VENDEDOR` son globales: no se cambia su código ni se desactivan. Solo un administrador global puede modificar nombre, descripción o permisos de un rol base. `ADMINISTRADOR` siempre conserva los cuatro permisos de usuarios/roles. Un rol asignado no se desactiva hasta reasignar todos sus usuarios. Cambiar permisos revoca inmediatamente las sesiones de todos los usuarios del rol.

## Errores funcionales

Los errores tipados responden `{statusCode,code,message,details?}`.

| Código | HTTP |
| --- | --- |
| `INVALID_CREDENTIALS`, `INVALID_TEMPORARY_CREDENTIALS` | 401 |
| `PASSWORD_CHANGE_REQUIRED`, `TEMPORARY_PASSWORD_EXPIRED` | 403 |
| `PASSWORD_POLICY_VIOLATION`, `INVALID_PERMISSION_CODES`, `ROLE_INACTIVE` | 400 |
| `CROSS_TENANT_ACCESS`, `SELF_ADMIN_ACCESS_CHANGE_FORBIDDEN` | 403 |
| `ROLE_CODE_ALREADY_EXISTS`, `ROLE_NAME_ALREADY_EXISTS`, `ROLE_HAS_ACTIVE_USERS`, `SYSTEM_ROLE_PROTECTED`, `LAST_ACTIVE_ADMIN`, `TEMPORARY_PASSWORD_ALREADY_USED`, `VERSION_CONFLICT` | 409 |
| `INVITATION_DELIVERY_FAILED` | 503 |

## Persistencia y despliegue

La migración `20260829160000_roles_permissions_invitations` agrega roles personalizados tenant-scoped, RLS, unicidades parciales, triggers contra asignación cross-tenant/inactiva, estado de invitación y versionado optimista. Debe aplicarse con la URL directa del propietario:

```bash
npm run prisma:migrate:deploy
npm run prisma:seed
```

En producción el bloque SMTP completo es obligatorio. `DATABASE_URL` debe usar un rol runtime sin `BYPASSRLS`; `DIRECT_URL`, el propietario de migraciones. `USER_TEMPORARY_PASSWORD_TTL_SECONDS` configura la vigencia y `FRONTEND_URL/primer-acceso` se incluye en el correo.
