import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Assistant questions database invariants', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20261003010000_assistant_queries',
      'migration.sql',
    ),
    'utf8',
  );

  it('isolates the questions by organization with forced RLS', () => {
    expect(migration).toContain(
      'ALTER TABLE "consultas_asistente" FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'USING (luma_tiene_acceso_organizacion(organizacion_id))',
    );
    expect(migration).toContain(
      'WITH CHECK (luma_tiene_acceso_organizacion(organizacion_id))',
    );
  });

  it('links user, branch and reused answer with composite tenant FKs', () => {
    expect(migration).toMatch(
      /FOREIGN KEY \("usuario_id", "organizacion_id"\)\s+REFERENCES "usuarios"\("id", "organizacion_id"\)/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("sucursal_id", "organizacion_id"\)\s+REFERENCES "sucursales"\("id", "organizacion_id"\)/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("consulta_origen_id", "organizacion_id"\)\s+REFERENCES "consultas_asistente"\("id", "organizacion_id"\)/,
    );
  });

  it('only marks an answer as reused when it points at its origin', () => {
    expect(migration).toContain(
      'CHECK ("desde_cache" = ("consulta_origen_id" IS NOT NULL))',
    );
  });
});
