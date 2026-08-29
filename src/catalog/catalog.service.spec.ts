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
    role: { code: 'ADMINISTRADOR', name: 'Administrador', permissions: [] },
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

  function serviceWithVersion() {
    const transaction = {
      versiones_vehiculos: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([version]),
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
});
