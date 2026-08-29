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
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
  },
  {
    codigo: 'abastecimiento.recibir',
    modulo: 'abastecimiento',
    descripcion: 'Recibe solicitudes en tránsito como unidades físicas.',
    roles: ['ADMINISTRATIVA', 'GERENTE', 'ADMINISTRADOR'],
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
          set_config('app.acceso_global', 'false', true)
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

      for (const role of roles) {
        await transaction.role.upsert({
          where: { codigo: role.codigo },
          create: role,
          update: {
            nombre: role.nombre,
            descripcion: role.descripcion,
          },
        });
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
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
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
        : 'Database seed failed',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
