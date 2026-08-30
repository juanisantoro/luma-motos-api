import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const centralOrganization = {
  codigo: 'LUMA_CENTRAL',
  nombre: 'Luma Motos Casa Central',
  tipo: 'CASA_CENTRAL' as const,
} as const;

const branches = [
  { codigo: 'SAN_MIGUEL', nombre: 'San Miguel' },
  { codigo: 'DEL_VISO', nombre: 'Del Viso' },
] as const;

const financialInstitutions = [
  'Banco Columbia',
  'Credicuotas',
  'Banco del Sol',
] as const;

const catalogProducts = [
  {
    vehicleType: 'AUTO' as const,
    brand: 'Toyota',
    model: 'Etios',
    version: 'XLS',
    listPrice: 11_800_000,
    minimumPrice: 10_800_000,
  },
] as const;

const roles = [
  {
    codigo: 'VENDEDOR',
    nombre: 'Vendedor',
    descripcion: 'Gestiona sus operaciones comerciales asignadas.',
  },
  {
    codigo: 'ADMINISTRATIVA',
    nombre: 'Administrativa',
    descripcion: 'Gestiona tareas administrativas y financieras.',
  },
  {
    codigo: 'ADMINISTRADOR',
    nombre: 'Administrador',
    descripcion: 'Administra configuración, usuarios y operaciones.',
  },
  {
    codigo: 'GERENTE',
    nombre: 'Gerente',
    descripcion: 'Supervisa la operación integral y sus reportes.',
  },
] as const;

const managedPermissions = [
  {
    codigo: 'auditoria.consultar',
    modulo: 'auditoria',
    descripcion: 'Consulta el historial de auditoría del sistema.',
    roles: ['ADMINISTRADOR', 'GERENTE'],
  },
  {
    codigo: 'usuarios.consultar',
    modulo: 'usuarios',
    descripcion: 'Consulta usuarios, roles, organizaciones y sucursales.',
    roles: ['ADMINISTRADOR', 'GERENTE'],
  },
  {
    codigo: 'usuarios.gestionar',
    modulo: 'usuarios',
    descripcion:
      'Crea usuarios y modifica su estado, rol, sucursal y acceso global.',
    roles: ['ADMINISTRADOR'],
  },
  {
    codigo: 'roles.consultar',
    modulo: 'roles',
    descripcion: 'Consulta roles, permisos y asignaciones vigentes.',
    roles: ['ADMINISTRADOR', 'GERENTE'],
  },
  {
    codigo: 'roles.gestionar',
    modulo: 'roles',
    descripcion: 'Crea, modifica, clona y desactiva roles personalizados.',
    roles: ['ADMINISTRADOR'],
  },
  {
    codigo: 'clientes.consultar',
    modulo: 'clientes',
    descripcion: 'Consulta clientes de las organizaciones habilitadas.',
    roles: ['VENDEDOR', 'ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'clientes.gestionar',
    modulo: 'clientes',
    descripcion: 'Crea, actualiza, activa y desactiva clientes.',
    roles: ['VENDEDOR', 'ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'consultas_crediticias.consultar',
    modulo: 'consultas_crediticias',
    descripcion:
      'Consulta el consolidado de rechazos y el historial crediticio.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'consultas_crediticias.verificar',
    modulo: 'consultas_crediticias',
    descripcion:
      'Verifica antecedentes crediticios por documento antes de una operación.',
    roles: ['VENDEDOR', 'ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'consultas_crediticias.registrar',
    modulo: 'consultas_crediticias',
    descripcion: 'Registra intentos de consulta crediticia.',
    roles: ['VENDEDOR', 'ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'financieras.gestionar',
    modulo: 'financieras',
    descripcion: 'Crea y administra entidades financieras.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'catalogo.consultar',
    modulo: 'catalogo',
    descripcion: 'Consulta marcas, modelos, versiones y políticas de precios.',
    roles: ['VENDEDOR', 'ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'catalogo.gestionar',
    modulo: 'catalogo',
    descripcion: 'Gestiona el catálogo y crea nuevas políticas de precios.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'inventario.consultar',
    modulo: 'inventario',
    descripcion: 'Consulta unidades y sus movimientos de inventario.',
    roles: ['VENDEDOR', 'ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'inventario.gestionar',
    modulo: 'inventario',
    descripcion: 'Registra y actualiza unidades físicas de inventario.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'inventario.transferir',
    modulo: 'inventario',
    descripcion: 'Transfiere unidades en stock entre sucursales.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'proveedores.consultar',
    modulo: 'proveedores',
    descripcion: 'Consulta proveedores y disponibilidades informadas.',
    roles: ['VENDEDOR', 'ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'proveedores.gestionar',
    modulo: 'proveedores',
    descripcion: 'Gestiona proveedores y sus disponibilidades.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'abastecimiento.consultar',
    modulo: 'abastecimiento',
    descripcion: 'Consulta solicitudes de abastecimiento.',
    roles: ['VENDEDOR', 'ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'abastecimiento.gestionar',
    modulo: 'abastecimiento',
    descripcion: 'Crea solicitudes y gestiona sus transiciones.',
    roles: ['ADMINISTRATIVA', 'ADMINISTRADOR'],
  },
  {
    codigo: 'abastecimiento.recibir',
    modulo: 'abastecimiento',
    descripcion: 'Recibe solicitudes en tránsito como unidades físicas.',
    roles: ['ADMINISTRATIVA', 'ADMINISTRADOR'],
  },
  {
    codigo: 'ventas.consultar',
    modulo: 'ventas',
    descripcion: 'Consulta operaciones comerciales y sus reservas.',
    roles: ['VENDEDOR', 'ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'ventas.gestionar',
    modulo: 'ventas',
    descripcion: 'Crea y edita borradores y envía operaciones a aprobación.',
    roles: ['VENDEDOR', 'ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'ventas.aprobar',
    modulo: 'ventas',
    descripcion: 'Aprueba o rechaza operaciones comerciales.',
    roles: ['GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'ventas.cancelar',
    modulo: 'ventas',
    descripcion: 'Cancela operaciones y libera sus reservas activas.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'ventas.cerrar',
    modulo: 'ventas',
    descripcion: 'Cierra operaciones aprobadas y consume su reserva.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'reservas_stock.gestionar',
    modulo: 'reservas_stock',
    descripcion: 'Reserva y libera unidades para operaciones comerciales.',
    roles: ['VENDEDOR', 'ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'compras.consultar',
    modulo: 'compras',
    descripcion: 'Consulta compras a proveedores sin revelar costos sensibles.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'compras.gestionar',
    modulo: 'compras',
    descripcion: 'Registra y modifica compras a proveedores.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'compras.pagar',
    modulo: 'compras',
    descripcion: 'Registra pagos parciales de compras a proveedores.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'compras.costos.consultar',
    modulo: 'compras',
    descripcion: 'Consulta importes y costos sensibles de compras.',
    roles: ['GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'ingresos.consultar',
    modulo: 'ingresos',
    descripcion: 'Consulta ingresos administrativos.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'ingresos.gestionar',
    modulo: 'ingresos',
    descripcion: 'Registra y modifica ingresos administrativos.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'ingresos.cobrar',
    modulo: 'ingresos',
    descripcion: 'Registra cobranzas parciales de ingresos.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'gastos.consultar',
    modulo: 'gastos',
    descripcion: 'Consulta gastos generales.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'gastos.gestionar',
    modulo: 'gastos',
    descripcion: 'Registra y modifica gastos generales.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'gastos.pagar',
    modulo: 'gastos',
    descripcion: 'Registra pagos parciales de gastos.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'gastos.recuperar',
    modulo: 'gastos',
    descripcion: 'Registra recuperaciones de gastos recuperables.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'caja.consultar',
    modulo: 'caja',
    descripcion: 'Consulta cuentas, saldos y movimientos de caja.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'caja.gestionar',
    modulo: 'caja',
    descripcion: 'Gestiona cuentas de caja, banco, socio y otras.',
    roles: ['GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'caja.transferir',
    modulo: 'caja',
    descripcion: 'Registra transferencias internas balanceadas.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'caja.reversar',
    modulo: 'caja',
    descripcion: 'Revierte movimientos financieros mediante contramovimientos.',
    roles: ['GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'comisiones.consultar',
    modulo: 'comisiones',
    descripcion: 'Consulta sugeridos, reuniones y liquidaciones de comisiones.',
    roles: ['GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'comisiones.configurar',
    modulo: 'comisiones',
    descripcion: 'Configura políticas y escalas de comisiones.',
    roles: ['ADMINISTRADOR'],
  },
  {
    codigo: 'comisiones.acordar',
    modulo: 'comisiones',
    descripcion: 'Registra acuerdos de comisión con vendedores.',
    roles: ['GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'comisiones.pagar',
    modulo: 'comisiones',
    descripcion: 'Paga liquidaciones acordadas desde una cuenta de caja.',
    roles: ['GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'comisiones.historial',
    modulo: 'comisiones',
    descripcion: 'Consulta el historial de comisiones pagadas.',
    roles: ['GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'comisiones.propias',
    modulo: 'comisiones',
    descripcion: 'Consulta el progreso y el historial propio de comisiones.',
    roles: ['VENDEDOR'],
  },
  {
    codigo: 'comisiones.gestionar',
    modulo: 'comisiones',
    descripcion: 'Gestiona liquidaciones, acuerdos y estados de comisiones.',
    roles: ['GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'reportes.consultar',
    modulo: 'reportes',
    descripcion: 'Consulta reportes operativos y financieros consolidados.',
    roles: ['GERENTE', 'ADMINISTRADOR'],
  },
] as const;

async function main(): Promise<void> {
  const organization = await prisma.organizaciones.upsert({
    where: { codigo: centralOrganization.codigo },
    create: centralOrganization,
    update: {
      nombre: centralOrganization.nombre,
      tipo: centralOrganization.tipo,
    },
  });

  await prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
        SELECT
          set_config('app.organizacion_id', ${organization.id}, true),
          set_config('app.acceso_global', 'true', true)
      `;

      for (const branch of branches) {
        await transaction.sucursales.upsert({
          where: {
            organizacion_id_codigo: {
              organizacion_id: organization.id,
              codigo: branch.codigo,
            },
          },
          create: {
            ...branch,
            organizacion_id: organization.id,
          },
          update: {
            nombre: branch.nombre,
          },
        });
      }

      for (const legalName of financialInstitutions) {
        const normalizedName = legalName
          .trim()
          .replace(/\s+/g, ' ')
          .toLocaleLowerCase('es-AR');
        await transaction.financieras.upsert({
          where: {
            organizacion_id_nombre_normalizado: {
              organizacion_id: organization.id,
              nombre_normalizado: normalizedName,
            },
          },
          create: {
            razon_social: legalName,
            nombre_normalizado: normalizedName,
            organizacion_id: organization.id,
          },
          update: {
            razon_social: legalName,
            activo: true,
          },
        });
      }

      for (const role of roles) {
        const existingRole = await transaction.role.findFirst({
          where: {
            codigo: role.codigo,
            es_sistema: true,
            organizacion_id: null,
          },
          select: { id: true },
        });
        if (existingRole) {
          await transaction.role.update({
            where: { id: existingRole.id },
            data: {
              nombre: role.nombre,
              descripcion: role.descripcion,
              activo: true,
            },
          });
        } else {
          await transaction.role.create({
            data: {
              ...role,
              es_sistema: true,
              organizacion_id: null,
            },
          });
        }
      }

      for (const permission of managedPermissions) {
        await transaction.permisos.upsert({
          where: { codigo: permission.codigo },
          create: {
            codigo: permission.codigo,
            modulo: permission.modulo,
            descripcion: permission.descripcion,
          },
          update: {
            modulo: permission.modulo,
            descripcion: permission.descripcion,
          },
        });

        const assignedRoles = await transaction.role.findMany({
          where: {
            codigo: { in: [...permission.roles] },
            es_sistema: true,
            organizacion_id: null,
          },
          select: { id: true },
        });
        await transaction.permisos_rol.createMany({
          data: assignedRoles.map((role) => ({
            rol_id: role.id,
            codigo_permiso: permission.codigo,
          })),
          skipDuplicates: true,
        });
      }

      for (const role of roles) {
        const systemRole = await transaction.role.findFirstOrThrow({
          where: {
            codigo: role.codigo,
            es_sistema: true,
            organizacion_id: null,
          },
          select: { id: true },
        });
        const permissionCodes = managedPermissions
          .filter((permission) =>
            (permission.roles as readonly string[]).includes(role.codigo),
          )
          .map((permission) => permission.codigo);
        await transaction.permisos_rol.deleteMany({
          where: {
            rol_id: systemRole.id,
            codigo_permiso: {
              notIn: permissionCodes,
            },
          },
        });
      }

      let commissionSeedActor = await transaction.personal.findFirst({
        where: {
          organizacion_id: organization.id,
          codigo_empleado: 'SISTEMA_COMISIONES',
        },
        select: { id: true },
      });
      if (!commissionSeedActor) {
        commissionSeedActor = await transaction.personal.create({
          data: {
            organizacion_id: organization.id,
            codigo_empleado: 'SISTEMA_COMISIONES',
            nombre_completo: 'Sistema de comisiones',
            nombre_normalizado: 'sistema de comisiones',
            puede_iniciar_sesion: false,
            estado: 'ACTIVO',
          },
          select: { id: true },
        });
      }

      for (const product of catalogProducts) {
        const brandNormalized = product.brand.toLocaleLowerCase('es-AR');
        const modelNormalized = product.model.toLocaleLowerCase('es-AR');
        const versionNormalized = product.version.toLocaleLowerCase('es-AR');
        const brand = await transaction.marcas_vehiculos.upsert({
          where: { nombre_normalizado: brandNormalized },
          create: {
            nombre: product.brand,
            nombre_normalizado: brandNormalized,
          },
          update: { activo: true },
          select: { id: true },
        });
        const model = await transaction.modelos_vehiculos.upsert({
          where: {
            marca_id_tipo_vehiculo_nombre_normalizado: {
              marca_id: brand.id,
              tipo_vehiculo: product.vehicleType,
              nombre_normalizado: modelNormalized,
            },
          },
          create: {
            marca_id: brand.id,
            tipo_vehiculo: product.vehicleType,
            nombre: product.model,
            nombre_normalizado: modelNormalized,
          },
          update: { activo: true },
          select: { id: true },
        });
        let version = await transaction.versiones_vehiculos.findFirst({
          where: {
            modelo_id: model.id,
            nombre_normalizado: versionNormalized,
          },
          select: { id: true },
        });
        if (version) {
          version = await transaction.versiones_vehiculos.update({
            where: { id: version.id },
            data: { activo: true },
            select: { id: true },
          });
        } else {
          version = await transaction.versiones_vehiculos.create({
            data: {
              modelo_id: model.id,
              nombre: product.version,
              nombre_normalizado: versionNormalized,
              alcance: 'RESTRINGIDO',
              organizacion_propietaria_id: organization.id,
            },
            select: { id: true },
          });
        }
        await transaction.catalogo_organizaciones.upsert({
          where: {
            organizacion_id_version_id: {
              organizacion_id: organization.id,
              version_id: version.id,
            },
          },
          create: {
            organizacion_id: organization.id,
            version_id: version.id,
          },
          update: { puede_vender: true },
        });
        const currentPricePolicy =
          await transaction.politicas_precios_vehiculos.findFirst({
            where: {
              organizacion_id: organization.id,
              version_id: version.id,
              sucursal_id: null,
              vigente_desde: { lte: new Date() },
              OR: [
                { vigente_hasta: null },
                { vigente_hasta: { gte: new Date() } },
              ],
            },
            select: { id: true },
          });
        if (!currentPricePolicy) {
          await transaction.politicas_precios_vehiculos.create({
            data: {
              version_id: version.id,
              moneda: 'ARS',
              precio_lista: product.listPrice,
              precio_minimo: product.minimumPrice,
              vigente_desde: new Date('2000-01-01T00:00:00.000Z'),
              creado_por_personal_id: commissionSeedActor.id,
              organizacion_id: organization.id,
            },
          });
        }
      }

      const existingMotoPolicy =
        await transaction.politicas_comisiones.findFirst({
          where: {
            organizacion_id: organization.id,
            tipo_vehiculo: 'MOTO',
          },
          select: { id: true },
        });
      if (!existingMotoPolicy) {
        const policy = await transaction.politicas_comisiones.create({
          data: {
            organizacion_id: organization.id,
            tipo_vehiculo: 'MOTO',
            moneda: 'ARS',
            vigente_desde: new Date('2000-01-01T00:00:00.000Z'),
            estado: 'ACTIVA',
            creado_por_personal_id: commissionSeedActor.id,
          },
          select: { id: true },
        });
        await transaction.escalas_comisiones.createMany({
          data: [
            { minimo_ventas: 1, maximo_ventas: 5, importe_fijo: 35000 },
            { minimo_ventas: 6, maximo_ventas: 10, importe_fijo: 40000 },
            { minimo_ventas: 11, maximo_ventas: 15, importe_fijo: 45000 },
            { minimo_ventas: 16, maximo_ventas: null, importe_fijo: 50000 },
          ].map((tier) => ({
            ...tier,
            politica_id: policy.id,
            organizacion_id: organization.id,
          })),
        });
      }
    },
    {
      maxWait: 30_000,
      timeout: 120_000,
    },
  );
}

void main()
  .catch((error: unknown) => {
    const errorCode =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : error instanceof Prisma.PrismaClientInitializationError
          ? error.errorCode
          : undefined;
    console.error(
      errorCode
        ? `Database seed failed (${errorCode})`
        : `Database seed failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
