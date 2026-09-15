import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// New entities to add. Existing ones (Banco Columbia, Credicuotas, Banco del
// Sol) are intentionally left out here: this script is meant to be run once
// against the LUMA_CENTRAL organization to top up the catalog without
// touching branches, roles, or catalog products the way the full
// `prisma/seed.ts` does.
const newFinancialInstitutions = [
  'Prendo',
  'Creditech Unico',
  'Creditech Duomo',
  'Santander Consumer',
  'Provincia',
  'Directo',
  'Directo Duomo',
  'Uala',
] as const;

function normalize(legalName: string): string {
  return legalName.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');
}

async function main(): Promise<void> {
  const organization = await prisma.organizaciones.findUnique({
    where: { codigo: 'LUMA_CENTRAL' },
    select: { id: true, activa: true },
  });
  if (!organization?.activa) {
    throw new Error(
      'Active LUMA_CENTRAL organization not found. Run the database seed first.',
    );
  }

  const results = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.organizacion_id', ${organization.id}, true),
        set_config('app.acceso_global', 'true', true)
    `;

    const created: string[] = [];
    const updated: string[] = [];

    for (const legalName of newFinancialInstitutions) {
      const normalizedName = normalize(legalName);
      const existing = await transaction.financieras.findUnique({
        where: {
          organizacion_id_nombre_normalizado: {
            organizacion_id: organization.id,
            nombre_normalizado: normalizedName,
          },
        },
        select: { id: true },
      });

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

      (existing ? updated : created).push(legalName);
    }

    return { created, updated };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });

  if (results.created.length) {
    console.log(`Created: ${results.created.join(', ')}`);
  }
  if (results.updated.length) {
    console.log(
      `Already existed (left active, name refreshed): ${results.updated.join(', ')}`,
    );
  }
  console.log('Done.');
}

void main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Unknown error adding financieras';
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
