import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  BRANCH_OUT_OF_SCOPE,
  BRANCH_REQUIRED,
  BranchScope,
  buildBranchScope,
  resolveAllowedBranchIds,
} from './branch-scope';

const sanMiguel = { id: 'b1', codigo: 'SAN_MIGUEL', nombre: 'San Miguel' };
const delViso = { id: 'b2', codigo: 'DEL_VISO', nombre: 'Del Viso' };

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'u1',
    email: 'user@luma.test',
    name: 'User',
    active: true,
    globalAccess: false,
    organization: {
      id: 'o1',
      code: 'LUMA',
      name: 'Luma',
      type: 'CASA_CENTRAL',
    },
    role: {
      id: 'r1',
      code: 'ADMINISTRATIVA',
      name: 'Administrativa',
      system: true,
      permissions: [],
    },
    branch: { id: 'b1', code: 'SAN_MIGUEL', name: 'San Miguel' },
    branchScope: {
      allBranches: false,
      branches: [{ id: 'b1', code: 'SAN_MIGUEL', name: 'San Miguel' }],
    },
    ...overrides,
  };
}

function errorBody(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return {
      status: (error as HttpException).getStatus(),
      body: (error as HttpException).getResponse(),
    };
  }
  throw new Error('Expected an exception');
}

describe('buildBranchScope', () => {
  it('merges user branch, personnel main branch and accesses without duplicates', () => {
    expect(
      buildBranchScope(
        {
          acceso_global: false,
          sucursales: sanMiguel,
          personal: {
            sucursales: sanMiguel,
            acceso_personal_sucursal: [
              { sucursales: sanMiguel },
              { sucursales: delViso },
            ],
          },
        },
        [],
      ),
    ).toEqual({
      allBranches: false,
      branches: [
        { id: 'b1', code: 'SAN_MIGUEL', name: 'San Miguel' },
        { id: 'b2', code: 'DEL_VISO', name: 'Del Viso' },
      ],
    });
  });

  it('grants every branch through sucursales.todas regardless of the role', () => {
    expect(
      buildBranchScope(
        { acceso_global: false, sucursales: sanMiguel, personal: null },
        ['sucursales.todas'],
      ),
    ).toEqual({ allBranches: true, branches: [] });
  });

  it('grants every branch through acceso_global', () => {
    expect(
      buildBranchScope(
        { acceso_global: true, sucursales: null, personal: null },
        [],
      ).allBranches,
    ).toBe(true);
  });

  it('returns an empty scope for a user without branch nor accesses', () => {
    expect(
      buildBranchScope(
        {
          acceso_global: false,
          sucursales: null,
          personal: { sucursales: null, acceso_personal_sucursal: [] },
        },
        [],
      ),
    ).toEqual({ allBranches: false, branches: [] });
  });
});

describe('BranchScope', () => {
  it('scopes a GERENTE exactly like any other role: only by its branches', () => {
    const scope = BranchScope.forActor(
      actor({
        role: {
          id: 'r2',
          code: 'GERENTE',
          name: 'Gerente',
          system: true,
          permissions: ['ventas.aprobar'],
        },
      }),
    );
    expect(scope.allowedBranchIds).toEqual(['b1']);
  });

  it('widens a GERENTE through acceso_personal_sucursal without code changes', () => {
    expect(
      resolveAllowedBranchIds(
        actor({
          branchScope: {
            allBranches: false,
            branches: [
              { id: 'b1', code: 'SAN_MIGUEL', name: 'San Miguel' },
              { id: 'b2', code: 'DEL_VISO', name: 'Del Viso' },
            ],
          },
        }),
      ),
    ).toEqual(['b1', 'b2']);
  });

  it('returns null (every branch) for sucursales.todas or acceso_global', () => {
    expect(
      resolveAllowedBranchIds(
        actor({
          role: {
            id: 'r3',
            code: 'CUSTOM',
            name: 'Custom',
            system: false,
            permissions: ['sucursales.todas'],
          },
        }),
      ),
    ).toBeNull();
    expect(resolveAllowedBranchIds(actor({ globalAccess: true }))).toBeNull();
  });

  it('falls back to the user branch when branchScope is absent', () => {
    expect(resolveAllowedBranchIds(actor({ branchScope: undefined }))).toEqual([
      'b1',
    ]);
    expect(
      resolveAllowedBranchIds(actor({ branchScope: undefined, branch: null })),
    ).toEqual([]);
  });

  it('builds listing filters', () => {
    const scoped = BranchScope.forActor(actor());
    expect(scoped.where()).toEqual({ in: ['b1'] });
    expect(scoped.where('b1')).toBe('b1');
    expect(BranchScope.all().where()).toBeUndefined();
    expect(BranchScope.all().where('b2')).toBe('b2');
  });

  it('rejects a query or payload branch outside the scope with a typed 403', () => {
    const scoped = BranchScope.forActor(actor());
    expect(errorBody(() => scoped.where('b2'))).toEqual({
      status: 403,
      body: expect.objectContaining({
        statusCode: 403,
        code: BRANCH_OUT_OF_SCOPE,
        details: { branchId: 'b2' },
      }) as unknown,
    });
    expect(errorBody(() => scoped.assert(null)).status).toBe(403);
  });

  it('assumes the only branch on creation and demands one otherwise', () => {
    expect(BranchScope.forActor(actor()).resolveBranchId(undefined)).toBe('b1');
    expect(
      errorBody(() => BranchScope.all().resolveBranchId(undefined)),
    ).toEqual({
      status: 400,
      body: expect.objectContaining({ code: BRANCH_REQUIRED }) as unknown,
    });
    const twoBranches = BranchScope.forActor(
      actor({
        branchScope: {
          allBranches: false,
          branches: [
            { id: 'b1', code: 'SAN_MIGUEL', name: 'San Miguel' },
            { id: 'b2', code: 'DEL_VISO', name: 'Del Viso' },
          ],
        },
      }),
    );
    expect(errorBody(() => twoBranches.resolveBranchId(undefined)).status).toBe(
      400,
    );
    expect(twoBranches.resolveBranchId('b2')).toBe('b2');
  });

  it('keeps organization-level records for users with every branch', () => {
    expect(BranchScope.all().resolveOptionalBranchId(undefined)).toBeNull();
    expect(
      BranchScope.forActor(actor()).resolveOptionalBranchId(undefined),
    ).toBe('b1');
  });

  it('treats shared (branchless) records as usable', () => {
    const scoped = BranchScope.forActor(actor());
    expect(() => scoped.assertSharedOrInScope(null)).not.toThrow();
    expect(() => scoped.assertSharedOrInScope('b2')).toThrow(HttpException);
    expect(scoped.whereSharedOrInScope()).toEqual({
      OR: [{ sucursal_id: null }, { sucursal_id: { in: ['b1'] } }],
    });
    expect(BranchScope.all().whereSharedOrInScope()).toBeUndefined();
  });

  it('renders raw SQL predicates', () => {
    const column = Prisma.sql`o.sucursal_id`;
    expect(BranchScope.all().sql(column).sql).toBe('TRUE');
    expect(
      BranchScope.forActor(actor({ branchScope: undefined, branch: null })).sql(
        column,
      ).sql,
    ).toBe('FALSE');
    const predicate = BranchScope.forActor(actor()).sql(column);
    expect(predicate.sql).toBe('o.sucursal_id IN (CAST(? AS uuid))');
    expect(predicate.values).toEqual(['b1']);
  });
});
