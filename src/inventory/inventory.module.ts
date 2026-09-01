import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import {
  InventoryBranchesController,
  InventoryColorsController,
  InventoryController,
} from './inventory.controller';
import { InventoryService } from './inventory.service';
@Module({
  imports: [CatalogModule],
  controllers: [
    InventoryController,
    InventoryBranchesController,
    InventoryColorsController,
  ],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
