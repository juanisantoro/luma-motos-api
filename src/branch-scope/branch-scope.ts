import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type {
  AuthenticatedBranchScope,
  AuthenticatedUser,
} from '../auth/auth.types';
import { apiError } from '../common/api-error';

export const BRANCH_OUT_OF_SCOPE = 'BRANCH_OUT_OF_SCOPE';
export const BRANCH_REQUIRED = 'BRANCH_REQUIRED';

type BranchRow = { id: string; codigo: string; nombre: string };

/**
 * Minimal shape of `usuarios` needed to derive the branch scope. Both the JWT
 * strategy (every request) and the login response select it with
 * `branchScopeUserSelect`, so the scope is always recomputed from PostgreSQL
 * and a change of branch/accesses/permissions applies on the next request.
 */
export const branchScopeUserSelect = {
  sucursales: { select: { id: true, codigo: true, nombre: true } },
  personal: {
    select: {
      sucursales: { select: { id: true, codigo: true, nombre: true } },
      acceso_personal_sucursal: {
        select: {
          sucursales: { select: { id: true, codigo: true, nombre: true } },
        },
        orderBy: { sucursal_id: 'asc' as const },
      },
    },
  },
} satisfies Prisma.usuariosSelect;

export interface BranchScopeSource {
  acceso_global: boolean;
  sucursales: BranchRow | null;
  personal: {
    sucursales: BranchRow | null;
    acceso_personal_sucursal: Array<{ sucursales: BranchRow }>;
  } | null;
}

export function hasAllBranchesAccess(
  globalAccess: boolean,
  permissions: readonly string[],
): boolean {
  return globalAccess || permissions.includes(PERMISSION_CODES.BRANCHES_ALL);
}

/**
 * Builds the branch scope exposed as `user.branchScope`. Without
 * `sucursales.todas` (or `acceso_global`), the allowed branches are the
 * user's own branch, the personnel main branch and every branch enabled in
 * `acceso_personal_sucursal`, without duplicates. Nothing here depends on the
 * role name, so a GERENTE is scoped exactly like ADMINISTRATIVA/VENDEDOR and
 * gains more branches only through `acceso_personal_sucursal`.
 */
export function buildBranchScope(
  source: BranchScopeSource,
  permissions: readonly string[],
): AuthenticatedBranchScope {
  if (hasAllBranchesAccess(source.acceso_global, permissions))
    return { allBranches: true, branches: [] };
  const rows = [
    source.sucursales,
    source.personal?.sucursales ?? null,
    ...(source.personal?.acceso_personal_sucursal ?? []).map(
      (access) => access.sucursales,
    ),
  ].filter((row): row is BranchRow => row !== null);
  const unique = new Map<string, BranchRow>();
  for (const row of rows) if (!unique.has(row.id)) unique.set(row.id, row);
  return {
    allBranches: false,
    branches: [...unique.values()].map((row) => ({
      id: row.id,
      code: row.codigo,
      name: row.nombre,
    })),
  };
}

/**
 * Server-side branch scope of an authenticated actor. Every module that owns
 * branch-bound data (sales, inventory, supply, purchases, incomes, expenses,
 * cash, vehicle payments, credit plans, dashboard) resolves it through here:
 *
 * - `where()`/`whereNullable()` build the SQL filter for listings.
 * - `assert()` rejects a payload/query branch outside the scope with a typed
 *   `403 BRANCH_OUT_OF_SCOPE`.
 * - `resolveBranchId()` applies the single-branch default for creations.
 *
 * Existing records outside the scope are reported as `404` by each module (the
 * same answer used for cross-tenant ids), so their existence is not leaked.
 */
export class BranchScope {
  private readonly allowed: ReadonlySet<string>;

  private constructor(
    readonly allBranches: boolean,
    readonly branchIds: readonly string[],
  ) {
    this.allowed = new Set(branchIds);
  }

  static forActor(actor: AuthenticatedUser): BranchScope {
    if (hasAllBranchesAccess(actor.globalAccess, actor.role.permissions))
      return new BranchScope(true, []);
    // `branchScope` is always computed by the JWT strategy. The fallback keeps
    // internal callers that build an actor by hand on the restrictive side.
    const ids = actor.branchScope
      ? actor.branchScope.allBranches
        ? null
        : actor.branchScope.branches.map((branch) => branch.id)
      : actor.branch
        ? [actor.branch.id]
        : [];
    return ids === null
      ? new BranchScope(true, [])
      : new BranchScope(false, [...new Set(ids)]);
  }

  static all(): BranchScope {
    return new BranchScope(true, []);
  }

  /** `null` means "every branch of the organization". */
  get allowedBranchIds(): string[] | null {
    return this.allBranches ? null : [...this.branchIds];
  }

  get singleBranchId(): string | undefined {
    return !this.allBranches && this.branchIds.length === 1
      ? this.branchIds[0]
      : undefined;
  }

  includes(branchId: string | null | undefined): boolean {
    if (this.allBranches) return true;
    return !!branchId && this.allowed.has(branchId);
  }

  assert(branchId: string | null | undefined): void {
    if (this.includes(branchId)) return;
    throw apiError(
      HttpStatus.FORBIDDEN,
      BRANCH_OUT_OF_SCOPE,
      branchId
        ? 'The branch is outside the branches allowed for the user'
        : 'Records without a branch are only available to users with access to every branch',
      { branchId: branchId ?? null },
    );
  }

  /**
   * Prisma filter for a branch column, optionally narrowed by a query value.
   * On nullable columns `{ in: [...] }` also hides organization-level rows
   * (without branch), which stay reserved to users with every branch.
   */
  where(requested?: string): string | { in: string[] } | undefined {
    if (requested) {
      this.assert(requested);
      return requested;
    }
    return this.allBranches ? undefined : { in: [...this.branchIds] };
  }

  /**
   * Filter for records whose branch is optional and where a record without a
   * branch is shared by the whole organization (e.g. an organization bank
   * account): visible when shared or when its branch is in scope.
   */
  whereSharedOrInScope<W extends { sucursal_id?: unknown }>():
    { OR: W[] } | undefined {
    if (this.allBranches) return undefined;
    return {
      OR: [
        { sucursal_id: null } as W,
        { sucursal_id: { in: [...this.branchIds] } } as W,
      ],
    };
  }

  /** Same rule as `whereSharedOrInScope` for an already loaded record. */
  assertSharedOrInScope(branchId: string | null | undefined): void {
    if (branchId === null) return;
    this.assert(branchId);
  }

  /** Branch for a creation: explicit value or the user's only branch. */
  resolveBranchId(requested?: string | null): string {
    const branchId = requested ?? this.singleBranchId;
    if (!branchId)
      throw apiError(
        HttpStatus.BAD_REQUEST,
        BRANCH_REQUIRED,
        'branchId is required when the user can operate in more than one branch',
      );
    this.assert(branchId);
    return branchId;
  }

  /** Optional branch (e.g. expenses): defaults to the only branch if any. */
  resolveOptionalBranchId(requested?: string | null): string | null {
    if (requested) {
      this.assert(requested);
      return requested;
    }
    if (this.allBranches) return null;
    return this.resolveBranchId(undefined);
  }

  /** Raw SQL predicate over a branch column. */
  sql(column: Prisma.Sql): Prisma.Sql {
    if (this.allBranches) return Prisma.sql`TRUE`;
    if (!this.branchIds.length) return Prisma.sql`FALSE`;
    return Prisma.sql`${column} IN (${Prisma.join(
      this.branchIds.map((id) => Prisma.sql`CAST(${id} AS uuid)`),
    )})`;
  }
}

export function resolveAllowedBranchIds(
  actor: AuthenticatedUser,
): string[] | null {
  return BranchScope.forActor(actor).allowedBranchIds;
}
