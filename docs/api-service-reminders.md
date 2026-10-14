# Avisos de service

A quién hay que contactar para el service de la moto que se le vendió.

- **1º service**: a los 30 días de entregada la moto (`operaciones.entregado_en`,
  ventas aprobadas o cerradas de motos), si todavía no hizo ningún service.
- **Anual**: al año del último service terminado o entregado de esa unidad
  (`ordenes_service` con `unidad_vehiculo_id`).

Sale lo que vence dentro de los próximos 7 días y lo vencido hace hasta 30. Una
moto con una orden de service abierta (recibida o en el taller) no sale. El
nombre del service es el del tipo con ese orden (`tipos_service.orden`: 1º,
2º…); si no hay, "1º service" o "service anual".

La lista se calcula; `avisos_service` sólo guarda lo resuelto (contactado o
descartado) para que no vuelva a salir. Migración
`20261014000000_service_reminders`.

Permiso: `service.consultar` (administrativa, gerente, administrador y
mecánico), con el alcance de sucursales del usuario sobre la sucursal de la
venta.

## Endpoints

`GET /service-reminders?status=PENDING|RESOLVED&branchId=`

```json
{
  "today": "2026-10-14",
  "items": [{
    "unitId": "<uuid>",
    "stage": "PRIMER_SERVICE",
    "dueDate": "2026-10-16",
    "daysToDue": 2,
    "serviceName": "1º service",
    "servicesDone": 0,
    "lastServiceDate": null,
    "deliveredAt": "2026-09-16",
    "operation": { "id": "<uuid>", "number": "1053" },
    "branch": { "id": "<uuid>", "name": "San Miguel" },
    "client": { "id": "<uuid>", "name": "Ana Pérez", "phone": "11 5555-0000" },
    "vehicle": { "brand": "Honda", "model": "Wave", "version": "110 S", "vin": "…", "plate": null },
    "resolution": null
  }]
}
```

`POST /service-reminders` — marca un aviso resuelto (si ya estaba, lo pisa):

```json
{ "unitId": "<uuid>", "stage": "PRIMER_SERVICE", "dueDate": "2026-10-16",
  "status": "CONTACTADO", "channel": "WHATSAPP", "note": "opcional" }
```

`status`: `CONTACTADO` o `DESCARTADO`. `channel`: `WHATSAPP`, `TELEFONO` u
`OTRO`. 404 `SERVICE_REMINDER_UNIT_NOT_FOUND` si la moto no es una venta de
Luma; 403 si la venta es de una sucursal fuera del alcance.

`DELETE /service-reminders?unitId=&stage=&dueDate=` — lo vuelve a pendiente.

Las dos quedan en auditoría (`SERVICE_REMINDER_RESOLVED`,
`SERVICE_REMINDER_REOPENED`).

En el inicio, la tarea `SERVICE_REMINDERS_DUE` cuenta los avisos pendientes
por sucursal para quien tiene `service.gestionar`.
