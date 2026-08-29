/* eslint-disable @typescript-eslint/unbound-method */
import 'reflect-metadata';
import { PERMISSION_CODES } from '../auth/auth.constants';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { CashController } from '../cash/cash.controller';
import { ExpensesController } from '../expenses/expenses.controller';
import { IncomesController } from '../incomes/incomes.controller';
import { SupplierPurchasesController } from '../supplier-purchases/supplier-purchases.controller';

describe('Financial controllers', () => {
  it('separates read, management, settlement, recovery and reversal permissions', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, SupplierPurchasesController),
    ).toEqual([PERMISSION_CODES.PURCHASES_READ]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        SupplierPurchasesController.prototype.pay,
      ),
    ).toEqual([PERMISSION_CODES.PURCHASES_PAY]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        SupplierPurchasesController.prototype.reverse,
      ),
    ).toEqual([PERMISSION_CODES.CASH_REVERSE]);

    expect(Reflect.getMetadata(PERMISSIONS_KEY, IncomesController)).toEqual([
      PERMISSION_CODES.INCOMES_READ,
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, IncomesController.prototype.collect),
    ).toEqual([PERMISSION_CODES.INCOMES_COLLECT]);

    expect(Reflect.getMetadata(PERMISSIONS_KEY, ExpensesController)).toEqual([
      PERMISSION_CODES.EXPENSES_READ,
    ]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        ExpensesController.prototype.recover,
      ),
    ).toEqual([PERMISSION_CODES.EXPENSES_RECOVER]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        ExpensesController.prototype.reverse,
      ),
    ).toEqual([PERMISSION_CODES.CASH_REVERSE]);

    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        CashController.prototype.createTransfer,
      ),
    ).toEqual([PERMISSION_CODES.CASH_TRANSFER]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        CashController.prototype.reverseTransfer,
      ),
    ).toEqual([PERMISSION_CODES.CASH_REVERSE]);
  });
});
