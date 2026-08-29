import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import {
  InventoryBranchesController,
  InventoryController,
} from './inventory.controller';
import { InventoryService } from './inventory.service';
@Module({
  imports: [CatalogModule],
  controllers: [InventoryController, InventoryBranchesController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
