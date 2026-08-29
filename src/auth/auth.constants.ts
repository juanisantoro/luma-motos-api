export const JWT_ISSUER = 'luma-motos-api';
export const JWT_AUDIENCE = 'luma-motos-web';

export const ROLE_CODES = {
  VENDEDOR: 'VENDEDOR',
  ADMINISTRATIVA: 'ADMINISTRATIVA',
  ADMINISTRADOR: 'ADMINISTRADOR',
  GERENTE: 'GERENTE',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

export const PERMISSION_CODES = {
  USERS_READ: 'usuarios.consultar',
  USERS_MANAGE: 'usuarios.gestionar',
  CLIENTS_READ: 'clientes.consultar',
  CLIENTS_MANAGE: 'clientes.gestionar',
  CATALOG_READ: 'catalogo.consultar',
  CATALOG_MANAGE: 'catalogo.gestionar',
  INVENTORY_READ: 'inventario.consultar',
  INVENTORY_MANAGE: 'inventario.gestionar',
  INVENTORY_TRANSFER: 'inventario.transferir',
  SUPPLIERS_READ: 'proveedores.consultar',
  SUPPLIERS_MANAGE: 'proveedores.gestionar',
  SUPPLY_READ: 'abastecimiento.consultar',
  SUPPLY_MANAGE: 'abastecimiento.gestionar',
  SUPPLY_RECEIVE: 'abastecimiento.recibir',
  SALES_READ: 'ventas.consultar',
  SALES_MANAGE: 'ventas.gestionar',
  SALES_APPROVE: 'ventas.aprobar',
  SALES_CANCEL: 'ventas.cancelar',
  SALES_CLOSE: 'ventas.cerrar',
  STOCK_RESERVATIONS_MANAGE: 'reservas_stock.gestionar',
} as const;

export const AUDIT_ACTIONS = {
  TEMPORARY_PASSWORD_CHANGE_FAILED: 'AUTH_TEMPORARY_PASSWORD_CHANGE_FAILED',
  TEMPORARY_PASSWORD_CHANGED: 'AUTH_TEMPORARY_PASSWORD_CHANGED',
  PASSWORD_CHANGE_FAILED: 'AUTH_PASSWORD_CHANGE_FAILED',
  PASSWORD_CHANGED: 'AUTH_PASSWORD_CHANGED',
  LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
  LOGIN_SUCCEEDED: 'AUTH_LOGIN_SUCCEEDED',
  LOGOUT: 'AUTH_LOGOUT',
  INITIAL_ADMIN_CREATED: 'INITIAL_ADMIN_CREATED',
} as const;
