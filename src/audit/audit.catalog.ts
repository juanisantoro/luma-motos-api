// Catálogo de la auditoría: nombre en castellano y módulo de cada acción que
// el sistema registra. Una acción que no figure acá igual se lista (con su
// código y en el módulo "Otros"): agregala cuando sumes una mutación nueva.

export type AuditCategory =
  | 'VENTAS'
  | 'DINERO'
  | 'STOCK'
  | 'CLIENTES'
  | 'CREDITOS'
  | 'COMISIONES'
  | 'CATALOGO'
  | 'USUARIOS'
  | 'ACCESOS'
  | 'OTROS';

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  VENTAS: 'Ventas',
  DINERO: 'Dinero y caja',
  STOCK: 'Stock y abastecimiento',
  CLIENTES: 'Clientes',
  CREDITOS: 'Créditos personales',
  COMISIONES: 'Comisiones',
  CATALOGO: 'Catálogo y precios',
  USUARIOS: 'Usuarios y roles',
  ACCESOS: 'Ingresos al sistema',
  OTROS: 'Otros',
};

type CatalogEntry = { label: string; category: AuditCategory };

const entry = (category: AuditCategory, label: string): CatalogEntry => ({
  category,
  label,
});

export const AUDIT_ACTIONS: Record<string, CatalogEntry> = {
  // Ventas
  SALES_OPERATION_CREATED: entry('VENTAS', 'Venta cargada'),
  SALES_OPERATION_UPDATED: entry('VENTAS', 'Venta modificada'),
  SALES_OPERATION_CORRECTED: entry('VENTAS', 'Venta corregida'),
  SALES_OPERATION_SUBMITTED: entry('VENTAS', 'Venta enviada'),
  SALES_OPERATION_APPROVED: entry('VENTAS', 'Venta aprobada'),
  SALES_OPERATION_REJECTED: entry('VENTAS', 'Venta rechazada'),
  SALES_OPERATION_CANCELLED: entry('VENTAS', 'Venta cancelada'),
  SALES_OPERATION_CLOSED: entry('VENTAS', 'Venta cerrada'),
  SALES_OPERATION_UNIT_ASSIGNED: entry('VENTAS', 'Unidad asignada a la venta'),
  SALES_PAYMENT_PLAN_REPLACED: entry('VENTAS', 'Plan de pago reemplazado'),
  SALES_TRADE_IN_CREATED: entry('VENTAS', 'Toma en parte de pago cargada'),
  SALES_OPERATION_LICENSING_UPDATED: entry(
    'VENTAS',
    'Patentamiento modificado',
  ),
  SALES_OPERATION_LICENSE_PLATE_RECEIVED: entry('VENTAS', 'Patente cargada'),
  STOCK_RESERVATION_CREATED: entry('VENTAS', 'Unidad reservada'),
  STOCK_RESERVATION_RELEASED: entry('VENTAS', 'Reserva liberada'),
  VEHICLE_PAYMENT_CREATED: entry('VENTAS', 'Pago de patente/seguro cargado'),
  VEHICLE_PAYMENT_UPDATED: entry('VENTAS', 'Pago de patente/seguro modificado'),

  // Dinero y caja
  SALES_PAYMENT_COMPONENT_COLLECTED: entry('DINERO', 'Cobro de una venta'),
  SALES_OPERATION_LICENSING_COLLECTED: entry('DINERO', 'Cobro de patente'),
  LICENSING_COLLECTION_REGISTERED: entry('DINERO', 'Cobro de patente'),
  SALES_FINANCING_PAYMENT_MARKED: entry('DINERO', 'Financiera marcada paga'),
  SALES_FINANCING_PAYMENT_REVERTED: entry(
    'DINERO',
    'Marca de financiera deshecha',
  ),
  INCOME_CREATED: entry('DINERO', 'Ingreso cargado'),
  INCOME_UPDATED: entry('DINERO', 'Ingreso modificado'),
  INCOME_COLLECTION_REGISTERED: entry('DINERO', 'Cobro de un ingreso'),
  INCOME_COLLECTION_REVERSED: entry('DINERO', 'Cobro reversado'),
  INCOME_COLLECTION_REASSIGNED: entry('DINERO', 'Cobro reasignado de caja'),
  INCOME_CASH_HANDOVER_CONFIRMED: entry(
    'DINERO',
    'Rendición de efectivo confirmada',
  ),
  EXPENSE_CREATED: entry('DINERO', 'Gasto cargado'),
  EXPENSE_UPDATED: entry('DINERO', 'Gasto modificado'),
  EXPENSE_PAYMENT_REGISTERED: entry('DINERO', 'Pago de un gasto'),
  EXPENSE_RECOVERY_REGISTERED: entry('DINERO', 'Recuperación de un gasto'),
  EXPENSE_MOVEMENT_REVERSED: entry('DINERO', 'Movimiento de gasto reversado'),
  SUPPLIER_PURCHASE_CREATED: entry('DINERO', 'Compra cargada'),
  SUPPLIER_PURCHASE_UPDATED: entry('DINERO', 'Compra modificada'),
  SUPPLIER_PURCHASE_PAYMENT_REGISTERED: entry('DINERO', 'Pago de una compra'),
  SUPPLIER_PURCHASE_PAYMENT_REVERSED: entry(
    'DINERO',
    'Pago de compra reversado',
  ),
  CASH_ACCOUNT_CREATED: entry('DINERO', 'Cuenta de caja creada'),
  CASH_ACCOUNT_UPDATED: entry('DINERO', 'Cuenta de caja modificada'),
  CASH_TRANSFER_CREATED: entry('DINERO', 'Transferencia entre cuentas'),
  CASH_TRANSFER_REVERSED: entry('DINERO', 'Transferencia reversada'),
  PARTNER_WITHDRAWAL_REGISTERED: entry('DINERO', 'Retiro de socio'),
  PARTNER_WITHDRAWAL_REVERSED: entry('DINERO', 'Retiro de socio anulado'),

  // Stock y abastecimiento
  INVENTORY_UNIT_CREATED: entry('STOCK', 'Unidad ingresada al stock'),
  INVENTORY_UNITS_BULK_CREATED: entry('STOCK', 'Unidades ingresadas al stock'),
  INVENTORY_UNIT_UPDATED: entry('STOCK', 'Unidad modificada'),
  INVENTORY_UNIT_TRANSFERRED: entry('STOCK', 'Unidad trasladada'),
  SUPPLY_REQUEST_CREATED: entry('STOCK', 'Pedido a proveedor'),
  SUPPLY_REQUEST_RECEIVED: entry('STOCK', 'Llegada de un pedido'),
  SUPPLIER_CREATED: entry('STOCK', 'Proveedor creado'),
  SUPPLIER_UPDATED: entry('STOCK', 'Proveedor modificado'),
  SUPPLIER_AVAILABILITY_UPSERTED: entry(
    'STOCK',
    'Disponibilidad de proveedor informada',
  ),

  // Clientes
  CLIENT_CREATED: entry('CLIENTES', 'Cliente creado'),
  CLIENT_UPDATED: entry('CLIENTES', 'Cliente modificado'),
  CLIENT_STATUS_UPDATED: entry('CLIENTES', 'Cliente activado o desactivado'),
  CREDIT_INQUIRY_CREATED: entry('CLIENTES', 'Rechazo crediticio registrado'),
  FINANCIAL_INSTITUTION_CREATED: entry('CLIENTES', 'Financiera creada'),

  // Créditos personales
  CREDIT_PLAN_CREATED: entry('CREDITOS', 'Plan de crédito creado'),
  CREDIT_PLAN_UPDATED: entry('CREDITOS', 'Plan de crédito modificado'),
  OPERATION_CREDIT_CONFIRMED: entry('CREDITOS', 'Crédito propio confirmado'),
  CREDIT_INSTALLMENT_PAID: entry('CREDITOS', 'Cobro de cuota'),

  // Comisiones
  COMMISSION_POLICY_CREATED: entry('COMISIONES', 'Escala creada'),
  COMMISSION_POLICY_UPDATED: entry('COMISIONES', 'Escala modificada'),
  COMMISSION_POLICY_ACTIVATED: entry('COMISIONES', 'Escala activada'),
  COMMISSION_POLICY_DEACTIVATED: entry('COMISIONES', 'Escala desactivada'),
  COMMISSION_POLICY_DELETED: entry('COMISIONES', 'Escala eliminada'),
  COMMISSION_PAYMENT_REGISTERED: entry('COMISIONES', 'Pago de comisión'),
  MANAGER_COMMISSION_CONFIG_SAVED: entry(
    'COMISIONES',
    'Comisión de gerencia configurada',
  ),
  MANAGER_COMMISSION_PAYMENT_REGISTERED: entry(
    'COMISIONES',
    'Pago de comisión de gerencia',
  ),

  // Catálogo y precios
  CATALOG_BRAND_CREATED: entry('CATALOGO', 'Marca creada'),
  CATALOG_BRAND_UPDATED: entry('CATALOGO', 'Marca modificada'),
  CATALOG_MODEL_CREATED: entry('CATALOGO', 'Modelo creado'),
  CATALOG_MODEL_UPDATED: entry('CATALOGO', 'Modelo modificado'),
  CATALOG_VERSION_CREATED: entry('CATALOGO', 'Versión creada'),
  CATALOG_VERSION_UPDATED: entry('CATALOGO', 'Versión modificada'),
  CATALOG_VERSION_PHOTO_UPDATED: entry('CATALOGO', 'Foto de versión cambiada'),
  CATALOG_POLICY_INVENTORY_CREATED: entry('CATALOGO', 'Precio creado'),
  CATALOG_POLICY_AVAILABILITY_CREATED: entry('CATALOGO', 'Precio creado'),
  PRICE_POLICY_CREATED: entry('CATALOGO', 'Precio de lista actualizado'),

  // Usuarios y roles
  INITIAL_ADMIN_CREATED: entry('USUARIOS', 'Administrador inicial creado'),
  USER_CREATED: entry('USUARIOS', 'Usuario creado'),
  USER_UPDATED: entry('USUARIOS', 'Usuario modificado'),
  USER_ACCESS_UPDATED: entry('USUARIOS', 'Rol o sucursal de usuario cambiados'),
  USER_STATUS_UPDATED: entry('USUARIOS', 'Usuario activado o desactivado'),
  USER_TEMPORARY_PASSWORD_EMAIL_SENT: entry('USUARIOS', 'Invitación enviada'),
  USER_TEMPORARY_PASSWORD_EMAIL_FAILED: entry(
    'USUARIOS',
    'Invitación que no se pudo enviar',
  ),
  ROLE_CREATED: entry('USUARIOS', 'Rol creado'),
  ROLE_UPDATED: entry('USUARIOS', 'Rol modificado'),
  ROLE_STATUS_UPDATED: entry('USUARIOS', 'Rol activado o desactivado'),

  // Ingresos al sistema
  AUTH_LOGIN_SUCCEEDED: entry('ACCESOS', 'Ingreso al sistema'),
  AUTH_LOGIN_FAILED: entry('ACCESOS', 'Intento de ingreso fallido'),
  AUTH_LOGOUT: entry('ACCESOS', 'Cierre de sesión'),
  AUTH_PASSWORD_CHANGED: entry('ACCESOS', 'Contraseña cambiada'),
  AUTH_PASSWORD_CHANGE_FAILED: entry('ACCESOS', 'Cambio de contraseña fallido'),
  AUTH_TEMPORARY_PASSWORD_CHANGED: entry(
    'ACCESOS',
    'Contraseña temporal reemplazada',
  ),
  AUTH_TEMPORARY_PASSWORD_CHANGE_FAILED: entry(
    'ACCESOS',
    'Reemplazo de contraseña temporal fallido',
  ),
  AUTH_PASSWORD_RESET_EMAIL_SENT: entry(
    'ACCESOS',
    'Recuperación de contraseña enviada',
  ),
  AUTH_PASSWORD_RESET_EMAIL_FAILED: entry(
    'ACCESOS',
    'Recuperación de contraseña que no se pudo enviar',
  ),
};

export function auditActionInfo(action: string): CatalogEntry {
  return AUDIT_ACTIONS[action] ?? { category: 'OTROS', label: action };
}

export function auditActionsOfCategory(category: AuditCategory): string[] {
  return Object.entries(AUDIT_ACTIONS)
    .filter(([, info]) => info.category === category)
    .map(([action]) => action);
}

export const AUDIT_CATEGORIES = Object.keys(
  AUDIT_CATEGORY_LABELS,
) as AuditCategory[];
