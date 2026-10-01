import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  const actor: AuthenticatedUser = {
    id: '1f73d68f-6474-48bf-b95a-1f2e20d7b32a',
    email: 'admin@luma.test',
    name: null,
    active: true,
    globalAccess: false,
    organization: {
      id: '8fa94171-13b3-40b5-8c33-1f7d8ea94c75',
      code: 'LUMA',
      name: 'Luma',
      type: 'FRANQUICIA',
    },
    role: {
      id: '4bd1189b-2bb1-4258-889b-4500de5eeade',
      code: 'ADMINISTRADOR',
      name: 'Administrador',
      system: true,
      permissions: [],
    },
    branch: null,
  };
  const ownerOrganizationId = '7d5cc401-544e-4651-9bd6-52495887fecd';
  const version = {
    id: '4de88c4c-3382-4f9b-ae60-98147159c977',
    nombre: 'ABS',
    es_marcador: false,
    activo: true,
    alcance: 'RESTRINGIDO',
    organizacion_propietaria_id: ownerOrganizationId,
    creado_en: new Date(),
    actualizado_en: new Date(),
    modelos_vehiculos: {
      id: '84e778cc-7616-4792-b6db-d89f100bb6f1',
      nombre: 'Wave',
      tipo_vehiculo: 'MOTO',
      activo: true,
      creado_en: new Date(),
      actualizado_en: new Date(),
      marcas_vehiculos: {
        id: '904e2a34-8285-48fa-b64c-24a80d94f9cb',
        nombre: 'Honda',
        activo: true,
        creado_en: new Date(),
        actualizado_en: new Date(),
      },
    },
    catalogo_organizaciones: [
      { organizacion_id: actor.organization.id },
      { organizacion_id: ownerOrganizationId },
    ],
  };

  const findMany = jest.fn();
  function serviceWithVersion() {
    findMany.mockReset().mockResolvedValue([version]);
    const transaction = {
      versiones_vehiculos: {
        count: jest.fn().mockResolvedValue(1),
        findMany,
      },
    } as unknown as Prisma.TransactionClient;
    return new CatalogService(
      {
        withTenant: jest
          .fn()
          .mockImplementation(
            (
              _scope: unknown,
              work: (tx: Prisma.TransactionClient) => Promise<unknown>,
            ) => work(transaction),
          ),
      } as unknown as PrismaService,
      {} as AuditService,
    );
  }

  it('hides peer organization identifiers from tenant catalog responses', async () => {
    const result = await serviceWithVersion().versions(
      { page: 1, limit: 50 },
      actor,
    );

    expect(result.items[0]).toMatchObject({
      ownerOrganizationId: null,
      sellableOrganizationIds: [actor.organization.id],
    });
  });

  it('accepts the authenticated tenant organization as an explicit filter', async () => {
    const result = await serviceWithVersion().versions(
      {
        page: 1,
        limit: 50,
        organizationId: actor.organization.id,
        vehicleType: 'MOTO',
      },
      actor,
    );

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: version.id,
      sellableOrganizationIds: [actor.organization.id],
    });
  });

  it('rejects a peer organization filter for tenant actors', async () => {
    await expect(
      serviceWithVersion().versions(
        {
          page: 1,
          limit: 50,
          organizationId: ownerOrganizationId,
        },
        actor,
      ),
    ).rejects.toThrow(
      'Only users with global access can filter by organization',
    );
  });

  it('keeps complete catalog organization assignments for global actors', async () => {
    const result = await serviceWithVersion().versions(
      { page: 1, limit: 50 },
      { ...actor, globalAccess: true },
    );

    expect(result.items[0]).toMatchObject({
      ownerOrganizationId,
      sellableOrganizationIds: [actor.organization.id, ownerOrganizationId],
    });
  });

  it('searches versions by brand and model name, word by word', async () => {
    await serviceWithVersion().versions(
      { page: 1, limit: 50, search: ' Honda  WAVE ', vehicleType: 'MOTO' },
      actor,
    );
    const where = (
      findMany.mock.calls[0] as [
        { where: Prisma.versiones_vehiculosWhereInput },
      ]
    )[0].where;
    const matches = (word: string) => [
      { nombre_normalizado: { contains: word, mode: 'insensitive' } },
      {
        modelos_vehiculos: {
          nombre_normalizado: { contains: word, mode: 'insensitive' },
        },
      },
      {
        modelos_vehiculos: {
          marcas_vehiculos: {
            nombre_normalizado: { contains: word, mode: 'insensitive' },
          },
        },
      },
    ];
    expect(where.AND).toEqual([
      { OR: matches('honda') },
      { OR: matches('wave') },
    ]);
    expect(where).not.toHaveProperty('nombre_normalizado');
    expect(where.modelos_vehiculos).toEqual({
      tipo_vehiculo: 'MOTO',
      marca_id: undefined,
    });
  });
});
