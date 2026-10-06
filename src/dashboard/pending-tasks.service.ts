import { Injectable } from '@nestjs/common';
import { estado_rendicion_luma } from '@prisma/client';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BranchScope } from '../branch-scope/branch-scope';
import { CreditPlansService } from '../credit-plans/credit-plans.service';
import { ExpensesService } from '../expenses/expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { argentinaToday } from '../sales/licensing';
import { SalesService } from '../sales/sales.service';
import { VehiclePaymentsService } from '../vehicle-payments/vehicle-payments.service';

/** Tareas de administración que se cuentan, en el orden en que se muestran. */
export const PENDING_TASK_KEYS = [
  'INSTALLMENTS_DUE_TODAY',
  'INSTALLMENTS_OVERDUE',
  'INCOMES_PENDING_COLLECTION',
  'CASH_PENDING_HANDOVER',
  'VEHICLE_PAYMENTS_UNCONFIRMED',
  'LICENSING_OVERDUE',
  'LICENSING_PENDING_COLLECTION',
  'EXPENSES_PENDING_PAYMENT',
] as const;

export type PendingTaskKey = (typeof PENDING_TASK_KEYS)[number];

export interface PendingTask {
  key: PendingTaskKey;
  count: number;
  /** Importe pendiente, sólo en las cuotas (siempre en pesos). */
  amount: number | null;
}

export interface BranchPendingTasks {
  branchId: string;
  branchName: string;
  total: number;
  tasks: PendingTask[];
}

/**
 * Trabajo pendiente de administración, sucursal por sucursal, para el inicio
 * de la administrativa (su sucursal), del gerente (las que tiene asignadas) y
 * del administrador (todas). No tiene criterios propios: cada número sale de
 * la misma consulta que usa la pantalla donde esa tarea se resuelve, acotada
 * a una sucursal. Cada tarea aparece sólo si el usuario tiene el permiso de
 * esa pantalla; nunca se decide por nombre de rol.
 */
@Injectable()
export class PendingTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditPlans: CreditPlansService,
    private readonly vehiclePayments: VehiclePaymentsService,
    private readonly sales: SalesService,
    private readonly expenses: ExpensesService,
  ) {}

  /** `null` cuando el usuario no puede ver ninguna de las tareas. */
  async byBranch(
    actor: AuthenticatedUser,
  ): Promise<{ branches: BranchPendingTasks[] } | null> {
    const permissions = new Set(actor.role.permissions);
    const can = {
      credits: permissions.has(PERMISSION_CODES.CREDIT_PLANS_READ),
      incomes: permissions.has(PERMISSION_CODES.INCOMES_READ),
      vehiclePayments: permissions.has(PERMISSION_CODES.VEHICLE_PAYMENTS_READ),
      licensing: permissions.has(PERMISSION_CODES.SALES_LICENSING_MANAGE),
      expenses: permissions.has(PERMISSION_CODES.EXPENSES_READ),
    };
    if (!Object.values(can).some(Boolean)) return null;

    const scope = BranchScope.forActor(actor);
    const branches = await this.branches(actor, scope);
    const rows = await Promise.all(
      branches.map(async (branch) => {
        const tasks = await this.tasks(actor, scope.only(branch.id), can);
        return {
          branchId: branch.id,
          branchName: branch.name,
          total: tasks.reduce((sum, task) => sum + task.count, 0),
          tasks,
        };
      }),
    );
    return { branches: rows };
  }

  private async branches(actor: AuthenticatedUser, scope: BranchScope) {
    if (!scope.allBranches) {
      const known =
        actor.branchScope?.branches ?? (actor.branch ? [actor.branch] : []);
      return scope.branchIds
        .map((id) => known.find((branch) => branch.id === id))
        .filter((branch): branch is NonNullable<typeof branch> =>
          Boolean(branch),
        )
        .map((branch) => ({ id: branch.id, name: branch.name }))
        .sort((left, right) => left.name.localeCompare(right.name, 'es'));
    }
    const rows = await this.prisma.withTenant(
      {
        organizationId: actor.organization.id,
        globalAccess: actor.globalAccess,
      },
      (tx) =>
        tx.sucursales.findMany({
          where: { organizacion_id: actor.organization.id, activa: true },
          select: { id: true, nombre: true },
          orderBy: { nombre: 'asc' },
        }),
    );
    return rows.map((row) => ({ id: row.id, name: row.nombre }));
  }

  private async tasks(
    actor: AuthenticatedUser,
    branch: BranchScope,
    can: Record<
      'credits' | 'incomes' | 'vehiclePayments' | 'licensing' | 'expenses',
      boolean
    >,
  ): Promise<PendingTask[]> {
    const today = argentinaToday();
    const [dueToday, overdue, incomes, vehiclePayments, licensing, expenses] =
      await Promise.all([
        can.credits
          ? this.creditPlans.dueInRange(actor, branch, today, today)
          : null,
        can.credits ? this.creditPlans.overdueAlert(actor, branch, 0) : null,
        can.incomes ? this.incomes(actor, branch) : null,
        can.vehiclePayments
          ? this.vehiclePayments.unconfirmedSummary(actor, branch)
          : null,
        can.licensing ? this.sales.licensingAlerts(actor, branch) : null,
        can.expenses ? this.expenses.pendingPaymentCount(actor, branch) : null,
      ]);
    const tasks: PendingTask[] = [];
    const add = (key: PendingTaskKey, count: number, amount?: number) =>
      tasks.push({ key, count, amount: amount ?? null });
    if (dueToday)
      add('INSTALLMENTS_DUE_TODAY', dueToday.count, dueToday.amount);
    if (overdue) add('INSTALLMENTS_OVERDUE', overdue.count, overdue.amount);
    if (incomes) {
      add('INCOMES_PENDING_COLLECTION', incomes.pendingCollection);
      add('CASH_PENDING_HANDOVER', incomes.pendingHandover);
    }
    if (vehiclePayments)
      add('VEHICLE_PAYMENTS_UNCONFIRMED', vehiclePayments.count);
    if (licensing) {
      add('LICENSING_OVERDUE', licensing.overdue);
      add('LICENSING_PENDING_COLLECTION', licensing.receivedPendingCollection);
    }
    if (expenses !== null) add('EXPENSES_PENDING_PAYMENT', expenses);
    return tasks;
  }

  /**
   * Ingresos cargados sin cobrar del todo y efectivo cobrado que todavía no
   * confirmó quien lo recibe. Sin importe: conviven pesos y dólares. Los
   * importados que esperan conciliación no son trabajo del día.
   */
  private incomes(actor: AuthenticatedUser, branch: BranchScope) {
    return this.prisma.withTenant(
      {
        organizationId: actor.organization.id,
        globalAccess: actor.globalAccess,
      },
      async (tx) => {
        const base = {
          organizacion_id: actor.organization.id,
          sucursal_id: branch.where(),
        };
        const [pendingCollection, pendingHandover] = await Promise.all([
          tx.ingresos.count({
            where: {
              ...base,
              estado_registro: { in: ['PENDIENTE', 'PAGO_PARCIAL'] },
              requiere_conciliacion: false,
            },
          }),
          tx.ingresos.count({
            where: {
              ...base,
              estado_rendicion: estado_rendicion_luma.PENDIENTE_RENDICION,
            },
          }),
        ]);
        return { pendingCollection, pendingHandover };
      },
    );
  }
}
