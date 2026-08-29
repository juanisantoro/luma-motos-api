# Stock, catalog and supply API

All paths are under `/api`, require a bearer token, and use Nest errors:
`{ statusCode, message, error }`. UUIDs are strings; timestamps are ISO-8601
strings; money (`purchaseCost`, `estimatedCost`, `listPrice`, `minimumPrice`)
is always a decimal **string** in responses. Paged lists are
`{ items, total, page, limit }`, with `page=1`, `limit=50`, maximum 100.
Tenant `organizationId` selection/filtering requires global access.

| Area      | Read                       | Mutate                                                        |
| --------- | -------------------------- | ------------------------------------------------------------- |
| Catalog   | `catalogo.consultar`       | `catalogo.gestionar`                                          |
| Inventory | `inventario.consultar`     | `inventario.gestionar`; transfer: `inventario.transferir`     |
| Suppliers | `proveedores.consultar`    | `proveedores.gestionar`                                       |
| Supply    | `abastecimiento.consultar` | `abastecimiento.gestionar`; receive: `abastecimiento.recibir` |

Enums: `vehicleType=MOTO|AUTO`; `condition=NUEVO|USADO`; inventory status is
`EN_STOCK|RESERVADO|EN_TRASLADO|EN_ACONDICIONAMIENTO|VENDIDO|ENTREGADO|
BLOQUEADO|DADO_DE_BAJA` (manual PATCH only accepts `EN_STOCK`,
`EN_ACONDICIONAMIENTO`, or `BLOQUEADO`); acquisition origin is
`PROVEEDOR|TOMA_PARTE_PAGO|OTRO`; supply status is
`PENDIENTE_APROBACION|PENDIENTE_CONFIRMACION|CONFIRMADO|PEDIDO|EN_TRANSITO|RECIBIDO|ASIGNADO|CANCELADA`.

## Catalog

`GET /catalog/brands` accepts `search`, `active`, `vehicleType`, pagination.
`GET /catalog/models` accepts `search`, `active`, `brandId`, `vehicleType`,
pagination. `GET /catalog/versions` accepts `search`, `active`, `brandId`,
`modelId`, `scope=GLOBAL|RESTRINGIDO`, `vehicleType`, `organizationId`,
pagination. Restricted versions are visible to their owner and assigned
organizations. Brands/models are globally managed.

`GET /catalog/price-policies` accepts `versionId`, `branchId`, `currentOn`
(date), `organizationId`, `vehicleType`, pagination; it returns policies valid
on `currentOn` (today when omitted). `POST /catalog/price-policies` body:
`{versionId, branchId?, currency, listPrice, minimumPrice, validFrom,
validUntil?: string|null, organizationId?}`. It returns `400 Minimum price
cannot exceed list price` or `400 Valid until must be after valid from` when
applicable.

Brand: `{id,name,active,createdAt,updatedAt}`. Model:
`{id,name,vehicleType,active,brand: Brand,createdAt,updatedAt}`. Version:
`{id,name,model: Model,scope,ownerOrganizationId,sellableOrganizationIds,
marker,active,createdAt,updatedAt}`. Price policy:
`{id,versionId,branchId,organizationId,currency,listPrice,minimumPrice,
validFrom,validUntil,createdAt,updatedAt,version:{id,name,model},branch:
{id,code,name}|null}`.

Organization identifiers in version responses are tenant-scoped: global users
see the complete owner/assignment list, while tenant users only see their own
organization identifier and receive a null owner when another tenant owns the
shared version.

Creation/update bodies are: brands `{name}` / `{name?,active?}`; models
`{name,brandId,vehicleType}` / `{name?,active?,vehicleType?}`; versions
`{name,modelId,marker?,scope?,organizationId?,organizationIds?}` /
`{name?,active?,marker?,scope?,organizationIds?}`.

## Inventory

`GET /inventory/branches?organizationId?` returns active tenant-visible
branches as `[{id,code,name,organizationId}]`. It only needs
`inventario.consultar`.

`GET /inventory/units` requires `vehicleType=MOTO|AUTO`; optional filters are
`condition,inventoryStatus,branchId,versionId,supplierId,search,organizationId` plus
pagination. VIN searches normalize punctuation. Unit create body is
`{versionId,vin,condition,engineNumber?,licensePlate?,manufactureYear?,
mileageKm?,color?,branchId,supplierId?,acquisitionOrigin,purchaseCost?,
receivedAt?,organizationId?}`. VIN display text is stored/returned as trimmed
`vin`; `normalizedVin` is uppercase alphanumeric. Placeholder values
`USADA,USADO,SENA,SEÑA,SENIA,RESERVA,SINVIN,NOVIN,PENDIENTE`, repeated single
characters, and invalid lengths return `400 VIN is invalid`; duplicate VIN is 409.

`POST /inventory/units/bulk` takes `{units:[CreateUnit,...]}` (1--100) and is
atomic; response is exactly `{items,count}`. `PATCH /inventory/units/:id`
accepts editable unit fields. Repeated normalized VINs inside a bulk request
return `400 Bulk inventory units must have unique VINs`.
`POST /inventory/units/:id/transfer` takes
`{destinationBranchId,notes?}` and only transfers `EN_STOCK` to a different
active branch. `GET /inventory/units/:id/movements?page&limit` is paginated.
Unit response is `{id,versionId,vin,normalizedVin,condition,engineNumber,
licensePlate,manufactureYear,mileageKm,color,branchId,supplierId,
acquisitionOrigin,purchaseCost,inventoryStatus,receivedAt,createdAt,updatedAt,
organizationId,version:{id,name,model:{id,name,vehicleType,brand:{id,name}}},
branch:{id,code,name},supplier:{id,legalName}|null}`. Movements are
`{id,unitId,type,originBranchId,destinationBranchId,supplyRequestId,occurredAt,
notes,organizationId,createdAt}`.

## Suppliers

`GET /suppliers` accepts `search,active,organizationId` and pagination.
Create accepts `{legalName,taxId?,address?,contactName?,phone?,notes?,
active?,organizationId?}`; PATCH accepts those mutable fields.

`GET /supplier-availability` accepts `supplierId,versionId,vehicleType,
condition,includeExpired,organizationId` and pagination. PUT body is
`{supplierId,versionId,condition,reportedQuantity,reportedAt?,expiresAt?:
string|null,notes?:string|null,organizationId?}`. Availability response is
`{id,supplierId,versionId,organizationId,condition,reportedQuantity,
reportedAt,expiresAt,expired,notes,createdAt,updatedAt,supplier:{id,legalName},
version:{id,name,model:{id,name,vehicleType,brand:{id,name}}}}`.

## Supply requests

`GET /supply-requests` accepts `status,supplierId,versionId,vehicleType,
condition,arrivalBranchId,organizationId` and pagination. Create body:
`{supplierId,supplierAvailabilityId?,operationId?,versionId,condition,
arrivalBranchId,supplierReference?,estimatedCost?,notes?,organizationId?}`.
`operationId`, when present, must belong to the selected organization (400
`Operation does not belong to the selected organization`).

Supply response includes `supplierAvailabilityId`, `operationId`,
`organizationId`, all IDs/status/notes, `estimatedCost`, `requestedAt`,
`confirmedAt`, `orderedAt`, `dispatchedAt`, `receivedAt`, `assignedAt`,
`createdAt`, `updatedAt`, supplier `{id,legalName}`, version with nested
model/brand/vehicleType, and branch `{id,code,name}`.

`POST /supply-requests/:id/transitions` body is exactly
`{toStatus,supplierReference?,notes?}`. Only forward transitions
`PENDIENTE_APROBACION → PENDIENTE_CONFIRMACION → CONFIRMADO → PEDIDO →
EN_TRANSITO` are valid; `CANCELADA` is allowed only from nonterminal states.
`RECIBIDO` and `ASIGNADO` return `400 Invalid supply request transition`.

`POST /supply-requests/:id/receive` requires `{vin,branchId}` and optionally
`engineNumber,licensePlate,manufactureYear,mileageKm,color,purchaseCost,
receivedAt,idempotencyKey,notes`. The branch must equal the request arrival
branch, otherwise it returns `400 Reception branch must match the supply
request arrival branch`. Only `EN_TRANSITO` can be received (409 otherwise).
The locked atomic reception creates one unit and one movement and returns
`{supplyRequest,unit,inventoryMovement,replayed}`. Repeating it returns the
same serialized shapes with `replayed:true`; a different normalized VIN returns
409 `VIN conflicts with the completed supply reception`.
