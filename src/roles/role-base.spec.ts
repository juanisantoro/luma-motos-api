import { effectiveRoleCode, rolesActingAs } from './role-base';

describe('Rol base ("Funciona como")', () => {
  it('trata un rol propio con base como su base', () => {
    expect(
      effectiveRoleCode({
        codigo: 'VENDEDOR_AUTOS',
        es_sistema: false,
        rol_base: 'VENDEDOR',
      }),
    ).toBe('VENDEDOR');
  });

  it('deja igual un rol propio sin base y los del sistema', () => {
    expect(
      effectiveRoleCode({
        codigo: 'CAJERO',
        es_sistema: false,
        rol_base: null,
      }),
    ).toBe('CAJERO');
    expect(
      effectiveRoleCode({
        codigo: 'GERENTE',
        es_sistema: true,
        rol_base: 'VENDEDOR',
      }),
    ).toBe('GERENTE');
  });

  it('busca por código o por base', () => {
    expect(rolesActingAs(['VENDEDOR', 'CALLCENTER'])).toEqual({
      activo: true,
      OR: [
        { codigo: { in: ['VENDEDOR', 'CALLCENTER'] } },
        { rol_base: { in: ['VENDEDOR', 'CALLCENTER'] } },
      ],
    });
  });
});
