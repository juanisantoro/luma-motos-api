# API de operaciones de venta y reservas

Todas las rutas usan el prefijo `/api`, requieren JWT y quedan acotadas por RLS al tenant autenticado. Un usuario con acceso global puede usar `organizationId` en listados y altas; las mutaciones sobre registros existentes obtienen la organización objetivo del registro bloqueado y la distinguen de la organización del actor en auditoría.

## Permisos

| Código                     | Roles base                                       |
| -------------------------- | ------------------------------------------------ |
| `ventas.consultar`         | VENDEDOR, ADMINISTRATIVA, GERENTE, ADMINISTRADOR |
| `ventas.gestionar`         | VENDEDOR, ADMINISTRATIVA, GERENTE, ADMINISTRADOR |
| `ventas.aprobar`           | GERENTE, ADMINISTRADOR                           |
| `ventas.cancelar`          | ADMINISTRATIVA, GERENTE, ADMINISTRADOR           |
| `ventas.cerrar`            | ADMINISTRATIVA, GERENTE, ADMINISTRADOR           |
| `reservas_stock.gestionar` | VENDEDOR, ADMINISTRATIVA, GERENTE, ADMINISTRADOR |

El seed es idempotente: crea o actualiza el catálogo y agrega asignaciones faltantes sin retirar permisos personalizados.

## Endpoints

| Método y ruta                                    | Permiso                    | Contrato                                                                                                                                                              |
| ------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /sales/operations`                          | `ventas.consultar`         | Filtros `status`, `branchId`, `clientId`, `sellerId`, `mine`, `versionId`, `search`, `from`, `to`, `organizationId`; paginación `page`, `limit`.                      |
| `GET /sales/operations/sellers`                  | `ventas.consultar`         | Requiere `branchId`; acepta `search`, `organizationId`, `page`, `limit`. Devuelve vendedores asignables a esa sucursal.                                               |
| `GET /sales/operations/price-policy`             | `ventas.consultar`         | Requiere `branchId`, `versionId`; acepta `operationDate`, `organizationId`. Devuelve la política efectiva priorizando sucursal sobre organización.                    |
| `GET /sales/operations/:id`                      | `ventas.consultar`         | Detalle sanitizado con cliente, sucursal, versión/unidad, vendedor, última reserva y última aprobación.                                                               |
| `POST /sales/operations`                         | `ventas.gestionar`         | `branchId`, `clientId`, `versionId`, `condition`, `agreedPrice`; opcionales `unitId`, `sellerId`, `operationDate`, `reservationExpiresAt`, `notes`, `organizationId`. |
| `PATCH /sales/operations/:id`                    | `ventas.gestionar`         | `expectedVersion` y al menos uno de `branchId`, `clientId`, `sellerId`, `agreedPrice`, `notes`. Solo BORRADOR/RECHAZADA.                                              |
| `POST /sales/operations/:id/reservation`         | `reservas_stock.gestionar` | `unitId`, `expectedVersion`, `expiresAt?`.                                                                                                                            |
| `POST /sales/operations/:id/reservation/release` | `reservas_stock.gestionar` | `expectedVersion`, `reason`.                                                                                                                                          |
| `POST /sales/operations/:id/submit`              | `ventas.gestionar`         | `expectedVersion`.                                                                                                                                                    |
| `POST /sales/operations/:id/approve`             | `ventas.aprobar`           | `expectedVersion`, `notes?`.                                                                                                                                          |
| `POST /sales/operations/:id/reject`              | `ventas.aprobar`           | `expectedVersion`, `reason`.                                                                                                                                          |
| `POST /sales/operations/:id/cancel`              | `ventas.cancelar`          | `expectedVersion`, `reason`.                                                                                                                                          |
| `POST /sales/operations/:id/close`               | `ventas.cerrar`            | `expectedVersion`.                                                                                                                                                    |

Los DTO rechazan campos desconocidos. `expectedVersion` debe coincidir con `rowVersion`; una edición concurrente devuelve `409`.
`mine=true` resuelve el `personal.id` del actor en el backend; no se puede
combinar con `sellerId` y esa combinación devuelve 400.

El lookup de vendedores devuelve
`{items:[{id,employeeCode,fullName}],total,page,limit}` y replica exactamente
la elegibilidad validada al crear/editar: personal activo de la organización
con sucursal principal o acceso explícito a `branchId`. No requiere
`usuarios.consultar`.

La política efectiva devuelve
`{id,versionId,branchId,organizationId,currency,listPrice,minimumPrice,
validFrom,validUntil,scope}`. `branchId` es nullable y `scope` vale
`BRANCH|ORGANIZATION`; los importes son strings decimales. Este endpoint es
solo una previsualización: create/submit vuelven a resolver la política en el
backend.

## Estados, reservas y precios

Flujo permitido:

`BORRADOR -> PENDIENTE_APROBACION -> APROBADA -> CERRADA`

`PENDIENTE_APROBACION -> RECHAZADA`, y una edición o nueva reserva reabre la operación como `BORRADOR`. Se puede cancelar cualquier estado no terminal excepto `CERRADA`.

Crear una reserva bloquea primero la operación y luego la unidad con `FOR UPDATE`, verifica que no exista otra reserva ACTIVO y acepta únicamente unidades `EN_STOCK` de la misma organización, versión, condición y sucursal. La unidad pasa a `RESERVADO`. Una reserva dura 48 horas por defecto y como máximo 30 días. Rechazo, cancelación o liberación explícita la pasan a `LIBERADA`, crean movimiento `LIBERACION` y devuelven la unidad a `EN_STOCK`. Una reserva vencida se marca `VENCIDA` al intentar reutilizar la unidad. El cierre consume la reserva, crea movimiento `VENTA` y cambia la unidad a `VENDIDO`.

El cliente nunca fija precio de lista, mínimo ni moneda. El backend selecciona la política vigente más específica (sucursal y luego organización) y guarda la referencia al crear; al enviar vuelve a tomar la política vigente. Toda operación pasa por aprobación explícita y la aprobación conserva la foto de lista, mínimo y acordado, satisfaciendo el override bajo mínimo exigido por las invariantes SQL.

La reserva comercial solo admite una unidad física mediante `unitId`; una
disponibilidad informada por proveedor no tiene VIN ni unidad y no se reserva.
El flujo para proveedor es: consultar `GET /supplier-availability`, crear
`POST /supply-requests` con `operationId` y opcional
`supplierAvailabilityId`, recibir la solicitud para materializar la unidad, y
recién entonces reservar su `unitId`. VENDEDOR puede consultar disponibilidad
pero `abastecimiento.gestionar` (ADMINISTRATIVA/GERENTE/ADMINISTRADOR) es
necesario para crear la solicitud. Mientras tanto la operación permanece en
BORRADOR y no puede enviarse a aprobación.

## Cierre y futuro módulo de caja

Este corte no crea cobranzas ni movimientos de caja. Para cerrar, la suma de componentes de pago no cancelados debe coincidir exactamente con `precio_acordado`; es la única lectura del dominio financiero. El módulo posterior deberá gestionar componentes, cobranzas, contabilización/reversas y decidir si además exige pago completo antes del cierre comercial.

No se agrega migración: el schema actual contiene tablas, enums, RLS, FKs, checks y triggers requeridos. La exclusión concurrente se obtiene con el bloqueo pesimista de la unidad y la comprobación de reserva ACTIVO dentro de la misma transacción auditada.
