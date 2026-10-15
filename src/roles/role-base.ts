import { Prisma } from '@prisma/client';

// "Funciona como": un rol creado por la organización puede tomar como base un
// rol del sistema (p. ej. "Vendedor autos" con base Vendedor). Para todo lo
// que depende del tipo de rol (quién figura como vendedor, comisiones, el
// inicio, las pantallas propias del rol) cuenta como ese rol del sistema; sus
// permisos siguen siendo los que tiene cargados.
// Administrador no se puede usar como base: sus reglas de protección se
// aplican sólo al rol del sistema.

export const BASE_ROLE_CODES = [
  'GERENTE',
  'ADMINISTRATIVA',
  'VENDEDOR',
  'CALLCENTER',
  'MECANICO',
] as const;

export type BaseRoleCode = (typeof BASE_ROLE_CODES)[number];

/** Código con el que el sistema trata al rol. */
export function effectiveRoleCode(role: {
  codigo: string;
  es_sistema: boolean;
  rol_base?: string | null;
}) {
  return !role.es_sistema && role.rol_base ? role.rol_base : role.codigo;
}

/** Filtro de roles activos que son (o funcionan como) alguno de `codes`. */
export function rolesActingAs(codes: string[]): Prisma.RoleWhereInput {
  return {
    activo: true,
    OR: [{ codigo: { in: codes } }, { rol_base: { in: codes } }],
  };
}
