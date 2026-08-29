/* eslint-disable @typescript-eslint/unbound-method */
import 'reflect-metadata';
import { PERMISSION_CODES } from '../auth/auth.constants';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { SalesController } from './sales.controller';

describe('SalesController', () => {
  it('uses distinct permissions for management, approval and closing', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SalesController)).toEqual([
      PERMISSION_CODES.SALES_READ,
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, SalesController.prototype.create),
    ).toEqual([PERMISSION_CODES.SALES_MANAGE]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, SalesController.prototype.reserve),
    ).toEqual([PERMISSION_CODES.STOCK_RESERVATIONS_MANAGE]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, SalesController.prototype.approve),
    ).toEqual([PERMISSION_CODES.SALES_APPROVE]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, SalesController.prototype.cancel),
    ).toEqual([PERMISSION_CODES.SALES_CANCEL]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, SalesController.prototype.close),
    ).toEqual([PERMISSION_CODES.SALES_CLOSE]);
  });
});
