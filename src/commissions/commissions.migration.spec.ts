import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Commission database invariants', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260829200000_productive_commissions',
      'migration.sql',
    ),
    'utf8',
  );
  const legacyIndexMigration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260829205000_drop_legacy_commission_index',
      'migration.sql',
    ),
    'utf8',
  );

  it('forces tenant RLS for policy and tier tables', () => {
    expect(migration).toContain(
      'ALTER TABLE "politicas_comisiones" FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'ALTER TABLE "escalas_comisiones" FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain('luma_tiene_acceso_organizacion');
  });

  it('protects snapshots and validates complete scale ranges', () => {
    expect(migration).toContain(
      '"luma_proteger_snapshot_liquidacion_comision"',
    );
    expect(migration).toContain('"luma_validar_escalas_comision"');
    expect(migration).toContain('anterior_maximo + 1');
  });

  it('enforces one settlement per seller, period and vehicle type', () => {
    expect(migration).toContain(
      '"liquidaciones_comisiones_periodo_tipo_unico"',
    );
    expect(migration).toContain(
      '("organizacion_id", "personal_id", "periodo_desde", "periodo_hasta", "tipo_vehiculo")',
    );
  });

  it('drops either legacy uniqueness representation and preserves paid rows safely', () => {
    expect(migration).toMatch(
      /DROP CONSTRAINT IF EXISTS\s+"liquidaciones_comisiones_personal_id_sucursal_id_periodo_de_key"/,
    );
    expect(legacyIndexMigration).toMatch(
      /DROP INDEX IF EXISTS\s+"liquidaciones_comisiones_personal_id_sucursal_id_periodo_de_key"/,
    );
    expect(migration).toContain('"pago_legacy" = ("estado_pago" = \'PAGADO\')');
  });
});
