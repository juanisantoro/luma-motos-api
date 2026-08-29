import { Module } from '@nestjs/common';
import {
  InventoryBranchesController,
  InventoryController,
} from './inventory.controller';
import { InventoryService } from './inventory.service';
@Module({
  controllers: [InventoryController, InventoryBranchesController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
