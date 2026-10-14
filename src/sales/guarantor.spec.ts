import {
  guarantorSearchSql,
  guarantorSearchTokens,
  guarantorSearchWhere,
  guarantorView,
  resolveGuarantor,
} from './guarantor';
import { Prisma } from '@prisma/client';

const client = { nombre_completo: 'Gómez, Luis', numero_documento: '28999111' };

function code(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return (error as { getResponse(): { code: string } }).getResponse().code;
  }
  return null;
}

describe('guarantor', () => {
  it('sin crédito no hay garante', () => {
    expect(
      resolveGuarantor(
        'EFECTIVO',
        { hasGuarantor: true, guarantorFirstName: 'Juan' },
        client,
      ),
    ).toEqual({
      tiene_garante: null,
      garante_nombre: null,
      garante_apellido: null,
      garante_documento: null,
      garante_busqueda: null,
    });
  });

  it('con crédito hay que indicar si tiene garante', () => {
    expect(code(() => resolveGuarantor('CREDITO', {}, client))).toBe(
      'GUARANTOR_REQUIRED',
    );
  });

  it('sin garante propio, el garante es el cliente', () => {
    expect(
      resolveGuarantor('EFECTIVO_CREDITO', { hasGuarantor: false }, client),
    ).toEqual({
      tiene_garante: false,
      garante_nombre: 'Gómez, Luis',
      garante_apellido: null,
      garante_documento: '28999111',
      garante_busqueda: 'gomez, luis 28999111',
    });
  });

  it('con garante propio exige nombre, apellido y DNI', () => {
    expect(
      code(() =>
        resolveGuarantor(
          'CREDITO',
          {
            hasGuarantor: true,
            guarantorFirstName: 'Juan',
            guarantorLastName: ' ',
          },
          client,
        ),
      ),
    ).toBe('GUARANTOR_DATA_REQUIRED');
    expect(
      code(() =>
        resolveGuarantor(
          'CREDITO',
          {
            hasGuarantor: true,
            guarantorFirstName: 'Juan',
            guarantorLastName: 'Pérez',
            guarantorDocument: 'abc',
          },
          client,
        ),
      ),
    ).toBe('GUARANTOR_DOCUMENT_INVALID');
    expect(
      resolveGuarantor(
        'MOTO_CREDITO',
        {
          hasGuarantor: true,
          guarantorFirstName: ' Juan  Carlos ',
          guarantorLastName: 'Pérez',
          guarantorDocument: '30.111.222',
        },
        client,
      ),
    ).toEqual({
      tiene_garante: true,
      garante_nombre: 'Juan Carlos',
      garante_apellido: 'Pérez',
      garante_documento: '30111222',
      garante_busqueda: 'perez juan carlos 30111222',
    });
  });

  it('en una edición completa con lo que ya tenía la operación', () => {
    const current = {
      tiene_garante: true,
      garante_nombre: 'Juan',
      garante_apellido: 'Pérez',
      garante_documento: '30111222',
    };
    expect(
      resolveGuarantor(
        'CREDITO',
        { guarantorDocument: '30111223' },
        client,
        current,
      ),
    ).toMatchObject({ garante_nombre: 'Juan', garante_documento: '30111223' });
    // Si antes el garante era el cliente, no se reutilizan esos datos.
    expect(
      code(() =>
        resolveGuarantor('CREDITO', { hasGuarantor: true }, client, {
          ...current,
          tiene_garante: false,
        }),
      ),
    ).toBe('GUARANTOR_DATA_REQUIRED');
  });

  it('busca por DNI, apellido o apellido y nombre en cualquier orden', () => {
    expect(guarantorSearchTokens('  Juan PÉREZ ')).toEqual(['juan', 'perez']);
    expect(guarantorSearchTokens('30.111.222')).toEqual(['30111222']);
    expect(guarantorSearchWhere('perez juan')).toEqual({
      AND: [
        { garante_busqueda: { contains: 'perez' } },
        { garante_busqueda: { contains: 'juan' } },
      ],
    });
    expect(guarantorSearchWhere('   ')).toBeNull();
    const sql = guarantorSearchSql(
      Prisma.sql`o.garante_busqueda`,
      'Pérez 30.111.222',
    );
    expect(sql?.values).toEqual(['%perez%', '%30111222%']);
  });

  it('muestra el garante y marca cuando es el mismo cliente', () => {
    expect(guarantorView({ tiene_garante: null })).toBeNull();
    expect(
      guarantorView({
        tiene_garante: false,
        garante_nombre: 'Gómez, Luis',
        garante_documento: '28999111',
      }),
    ).toMatchObject({ sameAsClient: true, fullName: 'Gómez, Luis' });
    expect(
      guarantorView({
        tiene_garante: true,
        garante_nombre: 'Juan',
        garante_apellido: 'Pérez',
        garante_documento: '30111222',
      }),
    ).toMatchObject({ sameAsClient: false, fullName: 'Pérez, Juan' });
  });
});
