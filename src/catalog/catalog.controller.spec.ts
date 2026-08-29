/* eslint-disable @typescript-eslint/unbound-method */
import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { PERMISSION_CODES } from '../auth/auth.constants';
import { CatalogController } from './catalog.controller';

describe('CatalogController', () => {
  it('protects catalog mutations with the manage permission', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        CatalogController.prototype.createBrand,
      ),
    ).toEqual([PERMISSION_CODES.CATALOG_MANAGE]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CatalogController)).toEqual([
      PERMISSION_CODES.CATALOG_READ,
    ]);
  });
});
