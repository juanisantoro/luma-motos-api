import type { tipo_organizacion_luma } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  globalAccess: boolean;
  organization: {
    id: string;
    code: string;
    name: string;
    type: tipo_organizacion_luma;
  };
  role: {
    id: string;
    code: string;
    name: string;
    system: boolean;
    permissions: string[];
  };
  branch: {
    id: string;
    code: string;
    name: string;
  } | null;
  /**
   * Branches the user can see and operate. `allBranches` comes from the
   * `sucursales.todas` permission or `acceso_global`; otherwise `branches`
   * lists the main branch plus `acceso_personal_sucursal`. Computed from
   * PostgreSQL on every authenticated request.
   */
  branchScope?: AuthenticatedBranchScope;
}

export interface AuthenticatedBranchScope {
  allBranches: boolean;
  branches: Array<{
    id: string;
    code: string;
    name: string;
  }>;
}

export interface JwtPayload {
  sub: string;
  sid: string;
  oid: string;
  type: 'access';
}

export interface AuthenticatedPrincipal {
  sessionId: string;
  user: AuthenticatedUser;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  idleTimeoutSeconds: number;
  user: AuthenticatedUser;
}
