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
| `GET /sales/operations`                          | `ventas.consultar`         | Filtros `status`, `branchId`, `clientId`, `sellerId`, `versionId`, `search`, `from`, `to`, `organizationId`; paginación `page`, `limit`.                              |
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

## Estados, reservas y precios

Flujo permitido:

`BORRADOR -> PENDIENTE_APROBACION -> APROBADA -> CERRADA`

`PENDIENTE_APROBACION -> RECHAZADA`, y una edición o nueva reserva reabre la operación como `BORRADOR`. Se puede cancelar cualquier estado no terminal excepto `CERRADA`.

Crear una reserva bloquea primero la operación y luego la unidad con `FOR UPDATE`, verifica que no exista otra reserva ACTIVO y acepta únicamente unidades `EN_STOCK` de la misma organización, versión, condición y sucursal. La unidad pasa a `RESERVADO`. Una reserva dura 48 horas por defecto y como máximo 30 días. Rechazo, cancelación o liberación explícita la pasan a `LIBERADA`, crean movimiento `LIBERACION` y devuelven la unidad a `EN_STOCK`. Una reserva vencida se marca `VENCIDA` al intentar reutilizar la unidad. El cierre consume la reserva, crea movimiento `VENTA` y cambia la unidad a `VENDIDO`.

El cliente nunca fija precio de lista, mínimo ni moneda. El backend selecciona la política vigente más específica (sucursal y luego organización) y guarda la referencia al crear; al enviar vuelve a tomar la política vigente. Toda operación pasa por aprobación explícita y la aprobación conserva la foto de lista, mínimo y acordado, satisfaciendo el override bajo mínimo exigido por las invariantes SQL.

## Cierre y futuro módulo de caja

Este corte no crea cobranzas ni movimientos de caja. Para cerrar, la suma de componentes de pago no cancelados debe coincidir exactamente con `precio_acordado`; es la única lectura del dominio financiero. El módulo posterior deberá gestionar componentes, cobranzas, contabilización/reversas y decidir si además exige pago completo antes del cierre comercial.

No se agrega migración: el schema actual contiene tablas, enums, RLS, FKs, checks y triggers requeridos. La exclusión concurrente se obtiene con el bloqueo pesimista de la unidad y la comprobación de reserva ACTIVO dentro de la misma transacción auditada.
