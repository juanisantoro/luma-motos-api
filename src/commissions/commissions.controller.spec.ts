/* eslint-disable @typescript-eslint/unbound-method */
import 'reflect-metadata';
import { PERMISSION_CODES } from '../auth/auth.constants';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { CommissionsController } from './commissions.controller';

describe('CommissionsController', () => {
  it('uses granular management, configuration, payment and own permissions', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        CommissionsController.prototype.suggestions,
      ),
    ).toEqual([PERMISSION_CODES.COMMISSIONS_READ]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        CommissionsController.prototype.createPolicy,
      ),
    ).toEqual([PERMISSION_CODES.COMMISSIONS_CONFIGURE]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        CommissionsController.prototype.agreement,
      ),
    ).toEqual([PERMISSION_CODES.COMMISSIONS_AGREE]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, CommissionsController.prototype.pay),
    ).toEqual([PERMISSION_CODES.COMMISSIONS_PAY]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        CommissionsController.prototype.history,
      ),
    ).toEqual([PERMISSION_CODES.COMMISSIONS_HISTORY]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, CommissionsController.prototype.me),
    ).toEqual([PERMISSION_CODES.COMMISSIONS_OWN]);
  });
});
