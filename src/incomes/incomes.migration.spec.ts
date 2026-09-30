import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Linked incomes database invariants', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260929000000_linked_incomes_cash_handover',
      'migration.sql',
    ),
    'utf8',
  );

  it('links the client with a composite tenant FK', () => {
    expect(migration).toContain('"ingreso_cliente_organizacion_fk"');
    expect(migration).toMatch(
      /FOREIGN KEY \("cliente_id", "organizacion_id"\)\s+REFERENCES "public"\."clientes"\("id", "organizacion_id"\)/,
    );
  });

  it('keeps the income client equal to the operation client', () => {
    expect(migration).toContain('"luma_validar_vinculos_ingreso"');
    expect(migration).toContain('ingresos_cliente_operacion_consistente');
    expect(migration).toContain('ingresos_componente_operacion_consistente');
    expect(migration).toContain('"luma_propagar_cliente_operacion_a_ingresos"');
  });

  it('enforces the cash handover contract in the database', () => {
    expect(migration).toContain('"ingresos_efectivo_requiere_cobrador"');
    expect(migration).toContain('"ingresos_efectivo_requiere_rendicion"');
    expect(migration).toContain(
      '"rendicion_confirmada_por_personal_id" = "rendido_a_personal_id"',
    );
  });

  it('records the financiera payment without an amount, only on financing', () => {
    expect(migration).toContain('"componentes_financiera_pago_completo"');
    expect(migration).toContain(
      '"financiera_pago_informado_en" IS NULL OR "tipo_componente" = \'FINANCIACION\'',
    );
    expect(migration).toContain(
      '"es_credito_propio" BOOLEAN NOT NULL DEFAULT false',
    );
  });

  it('links installment incomes to the installment of the same operation', () => {
    expect(migration).toContain('"ingreso_cuota_credito_organizacion_fk"');
    expect(migration).toContain('ingresos_cuota_operacion_consistente');
  });

  it('does not drop RLS, triggers or checks managed in SQL', () => {
    expect(migration).not.toMatch(/DROP POLICY/i);
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(migration).not.toMatch(/DROP CONSTRAINT/i);
    expect(migration).not.toMatch(/DROP INDEX/i);
  });
});
