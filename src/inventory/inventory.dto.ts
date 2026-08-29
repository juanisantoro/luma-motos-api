import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  condicion_vehiculo_luma,
  luma_estado_inventario,
  origen_adquisicion_luma,
  tipo_vehiculo_luma,
} from '@prisma/client';

export class InventoryQueryDto {
  @IsEnum(tipo_vehiculo_luma)
  vehicleType!: tipo_vehiculo_luma;
  @IsOptional()
  @IsEnum(condicion_vehiculo_luma)
  condition?: condicion_vehiculo_luma;
  @IsOptional()
  @IsEnum(luma_estado_inventario)
  inventoryStatus?: luma_estado_inventario;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() versionId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class InventoryMovementQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

export class InventoryBranchQueryDto {
  @IsOptional() @IsUUID() organizationId?: string;
}

export class CreateInventoryUnitDto {
  @IsUUID() versionId!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) vin!: string;
  @IsEnum(condicion_vehiculo_luma) condition!: condicion_vehiculo_luma;
  @IsOptional() @IsString() @MaxLength(60) engineNumber?: string;
  @IsOptional() @IsString() @MaxLength(20) licensePlate?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1886)
  @Max(3000)
  manufactureYear?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  mileageKm?: number;
  @IsOptional() @IsString() @MaxLength(80) color?: string;
  @IsUUID() branchId!: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsEnum(origen_adquisicion_luma) acquisitionOrigin!: origen_adquisicion_luma;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchaseCost?: number;
  @IsOptional() @IsDateString() receivedAt?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class BulkInventoryUnitsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateInventoryUnitDto)
  units!: CreateInventoryUnitDto[];
}

export class UpdateInventoryUnitDto {
  @IsOptional() @IsString() @MaxLength(60) engineNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(20) licensePlate?: string | null;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1886)
  @Max(3000)
  manufactureYear?: number | null;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  mileageKm?: number;
  @IsOptional() @IsString() @MaxLength(80) color?: string | null;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchaseCost?: number | null;
  @IsOptional()
  @IsEnum(luma_estado_inventario)
  inventoryStatus?: luma_estado_inventario;
}

export class TransferInventoryUnitDto {
  @IsUUID() destinationBranchId!: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
