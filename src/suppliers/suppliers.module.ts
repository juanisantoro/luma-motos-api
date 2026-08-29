import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
@Module({
  imports: [CatalogModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
})
export class SuppliersModule {}
