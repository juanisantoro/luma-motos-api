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
    code: string;
    name: string;
    permissions: string[];
  };
  branch: {
    id: string;
    code: string;
    name: string;
  } | null;
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
