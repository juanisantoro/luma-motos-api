export const ROLE_AUDIT_ACTIONS = {
  CREATED: 'ROLE_CREATED',
  UPDATED: 'ROLE_UPDATED',
  STATUS_UPDATED: 'ROLE_STATUS_UPDATED',
  CLONED: 'ROLE_CLONED',
} as const;

export const SYSTEM_ROLE_CODES = [
  'ADMINISTRADOR',
  'GERENTE',
  'ADMINISTRATIVA',
  'VENDEDOR',
  'CALLCENTER',
] as const;

export const ADMINISTRATOR_REQUIRED_PERMISSIONS = [
  'usuarios.consultar',
  'usuarios.gestionar',
  'roles.consultar',
  'roles.gestionar',
] as const;

export const PERMISSION_MODULE_LABELS: Record<string, string> = {
  abastecimiento: 'Abastecimiento',
  auditoria: 'Auditoría',
  caja: 'Caja y bancos',
  catalogo: 'Catálogo',
  clientes: 'Clientes',
  comisiones: 'Comisiones',
  compras: 'Compras',
  consultas_crediticias: 'Consultas crediticias',
  financieras: 'Financieras',
  gastos: 'Gastos',
  ingresos: 'Ingresos',
  inventario: 'Stock e inventario',
  proveedores: 'Proveedores',
  reportes: 'Reportes',
  reservas_stock: 'Reservas de stock',
  roles: 'Roles y permisos',
  usuarios: 'Usuarios',
  ventas: 'Ventas',
};
