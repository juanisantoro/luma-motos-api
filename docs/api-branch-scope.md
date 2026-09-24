# Alcance por sucursal

Regla de negocio: un usuario que pertenece a una sucursal (por ejemplo San
Miguel) sólo ve y gestiona datos de esa sucursal y de las habilitadas en
`acceso_personal_sucursal`. No puede cargar stock, ventas, ingresos, gastos,
pagos de vehículo, compras ni pedidos de abastecimiento para otra sucursal.
Quien tiene el permiso `sucursales.todas` o `acceso_global` ve toda la
organización.

## Permiso

| Código | Roles base (seed) | Efecto |
| --- | --- | --- |
| `sucursales.todas` | ADMINISTRADOR | Alcance = todas las sucursales de la organización |

La decisión nunca se toma por nombre de rol. GERENTE, ADMINISTRATIVA,
VENDEDOR y CALLCENTER no reciben el permiso: su alcance es
`usuarios.sucursal_id` + `personal.sucursal_principal_id` +
`acceso_personal_sucursal`. Hoy la gestión de usuarios asigna una sola
sucursal, así que GERENTE opera en una; para ampliarlo alcanza con agregar
filas en `acceso_personal_sucursal`, sin cambios de código. Un rol
personalizado puede recibir `sucursales.todas` desde el módulo de roles.

Un usuario sin sucursal y sin el permiso tiene alcance vacío: los listados
vuelven vacíos y cualquier alta responde `403 BRANCH_OUT_OF_SCOPE` o
`400 BRANCH_REQUIRED`.

## Dónde se resuelve

`JwtStrategy` recalcula el alcance en cada request (misma consulta que ya
relee usuario, rol y permisos) y lo expone en `user.branchScope`, que también
devuelven `POST /api/auth/login` y `GET /api/auth/me`:

```json
{
  "branchScope": {
    "allBranches": false,
    "branches": [{ "id": "uuid", "code": "SAN_MIGUEL", "name": "San Miguel" }]
  }
}
```

Con `allBranches: true` la lista `branches` viaja vacía (el frontend usa
`GET /api/inventory/branches`).

Todos los módulos usan el helper `BranchScope` (`src/branch-scope/branch-scope.ts`):

- `BranchScope.forActor(actor)` / `resolveAllowedBranchIds(actor)` (devuelve
  `null` cuando son todas).
- `where(branchId?)`: filtro SQL para listados; si el query trae un
  `branchId` fuera del alcance responde 403.
- `assert(branchId)`: valida `branchId` de altas y ediciones.
- `resolveBranchId(branchId?)`: en altas, si el usuario tiene una sola
  sucursal y no envía `branchId`, el backend la asume. Con varias (o con
  todas) el campo es obligatorio: `400 BRANCH_REQUIRED`.
- `sql(column)`: el mismo predicado para las consultas raw y los `FOR UPDATE`.

## Errores

```json
{
  "statusCode": 403,
  "code": "BRANCH_OUT_OF_SCOPE",
  "message": "The branch is outside the branches allowed for the user",
  "details": { "branchId": "uuid" }
}
```

| Caso | Respuesta |
| --- | --- |
| `branchId` de query, body o edición fuera del alcance | `403 BRANCH_OUT_OF_SCOPE` (antes de abrir la transacción) |
| Alta sin `branchId` con más de una sucursal permitida | `400 BRANCH_REQUIRED` |
| Registro existente de otra sucursal (detalle, edición, acciones) | `404`, igual que un id de otro tenant, para no revelar su existencia |

## Cobertura por módulo

| Módulo | Listados | Altas / ediciones / acciones |
| --- | --- | --- |
| Operaciones de venta | `sucursal_id` en lista, bandeja de aprobaciones y detalle | Alta, edición (incluye cambio de sucursal), aprobación, rechazo, reserva, cierre, cancelación, plan de pagos y tomas pasan por el mismo lookup con alcance; `price-policy` valida la sucursal |
| Lookups de vendedores y contactos | Por defecto sólo personal cuya sucursal principal o acceso está en el alcance | `branchId` explícito fuera del alcance: 403 |
| Inventario / unidades | Lista, detalle y movimientos | Alta, alta masiva, alta con catálogo, edición y traslado. En el traslado la unidad (origen) debe estar en alcance; el destino puede ser cualquier sucursal activa de la organización (enviar stock no es "cargarlo" en otra sucursal) |
| Sucursales para selectores (`GET /inventory/branches`) | Sólo las del alcance, con `inScope` | `includeOutOfScope=true` devuelve todas las activas marcando `inScope` (destino de traslado) |
| Pedidos de abastecimiento | `sucursal_llegada_id` | Alta (`arrivalBranchId` opcional con default), transiciones y recepción |
| Compras a proveedor | `sucursal_id` | Alta, edición, pagos y reversos |
| Ingresos | `sucursal_id` | Alta, edición, cobranzas y reversos |
| Gastos | `sucursal_id` | Alta, edición, pagos, recuperos y reversos |
| Cuentas de caja | Cuentas de sucursales en alcance + cuentas compartidas (sin sucursal) | Alta y edición sólo de cuentas de sucursales en alcance; pagos, cobranzas y transferencias sólo desde/hacia cuentas en alcance o compartidas |
| Movimientos y transferencias de caja | Movimientos de cuentas usables; transferencias con al menos una cuenta usable | Reversar una transferencia exige ambas cuentas usables |
| Pagos de vehículo | Por la sucursal de la unidad | Alta (la unidad debe estar en alcance) y edición |
| Créditos / cobranzas | Cuotas por la sucursal de la operación | Confirmar crédito y cobrar cuota |
| Dashboard | Todas las métricas usan el alcance del actor | — |

Los catálogos de organización (proveedores, versiones, políticas de precios,
planes de crédito, financieras) no tienen sucursal y no cambian.

### Registros sin sucursal

- **Gastos sin sucursal** son de nivel organización: sólo los ve y crea quien
  tiene todas las sucursales. Un usuario acotado que no envía `branchId`
  recibe su única sucursal por defecto.
- **Compras sin sucursal** (datos legacy) sólo son visibles con todas las
  sucursales; el alta siempre exige sucursal.
- **Cuentas de caja sin sucursal** (por ejemplo el banco de la organización)
  son compartidas: cualquier usuario de la organización las ve y puede
  registrar movimientos contra ellas; sólo quien tiene todas las sucursales
  puede crearlas o editarlas.

## RLS: por qué no se reforzó en PostgreSQL

Se evaluó agregar `set_config('app.sucursales_permitidas', ...)` en
`PrismaService.withTenant` y políticas RLS por sucursal. Se decidió **no
hacerlo en esta fase**:

- Varias lecturas legítimas cruzan sucursales dentro del mismo tenant: el
  destino de un traslado de inventario, las cuentas de caja compartidas, las
  transferencias entre cajas de distintas sucursales, las comisiones y las
  políticas de precio por sucursal. Con RLS por sucursal cada una necesita
  una excepción en la política, y las políticas se vuelven más difíciles de
  auditar que el filtro en servicio.
- Las tablas sin `sucursal_id` propio (`pagos_vehiculo`, `cuotas_credito`,
  `movimientos_caja`, `transferencias_caja`) necesitarían políticas con joins
  (`EXISTS` sobre la unidad, la operación o la cuenta), con costo en cada
  consulta y riesgo de recursión de políticas.
- El aislamiento que protege datos entre empresas (organización) ya está en
  RLS obligatoria. El alcance por sucursal es una regla de negocio dentro del
  mismo tenant y queda centralizado en un único helper con tests.

Trade-off aceptado: un bug en un servicio nuevo que olvide el helper podría
exponer datos de otra sucursal del mismo tenant (nunca de otra
organización). Mitigación: todo lookup `*Or404` y todo listado de los
módulos listados usan `BranchScope`, y los tests e2e cubren los casos
principales. Si más adelante se quiere defensa en profundidad, el punto de
extensión es `withTenant`: agregar el `set_config` y políticas
`USING (sucursal_id = ANY(string_to_array(current_setting('app.sucursales_permitidas', true), ',')::uuid[]) OR current_setting('app.sucursales_permitidas', true) = '*')`
empezando por las tablas con `sucursal_id` propio.
