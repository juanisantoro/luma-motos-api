import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  condicion_vehiculo_luma,
  luma_estado_inventario,
  origen_adquisicion_luma,
  tipo_vehiculo_luma,
} from '@prisma/client';

// Standardized finishes for physical inventory units. Colors used to be a
// hardcoded list here too, but now live in the colores_unidad table (see
// the 20260831000000_unit_colors_catalog migration) so they can be
// added/removed without a deploy - InventoryService.assertValidColor()
// validates against that table instead of an @IsIn list. Finishes stay a
// small fixed list since the business didn't ask for those to be editable.
export const UNIT_FINISHES = [
  'Brillante',
  'Mate',
  'Metalizado',
  'Perlado',
  'Flúor',
] as const;

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
  @IsOptional() @IsString() @IsIn(UNIT_FINISHES) acabado?: string;
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

export class InlineInventoryUnitDto {
  @IsString() @IsNotEmpty() @MaxLength(80) vin!: string;
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
  @IsOptional() @IsString() @IsIn(UNIT_FINISHES) acabado?: string;
}

export class InitialPricePolicyDto {
  @IsString() @MinLength(3) @MaxLength(3) currency = 'ARS';
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  listPrice!: number;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  minimumPrice!: number;
  @IsOptional() @IsDateString() validFrom?: string;
}

export class CreateCatalogInventoryDto {
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsString() @IsNotEmpty() @MaxLength(120) brandName!: string;
  @IsString() @IsNotEmpty() @MaxLength(140) modelName!: string;
  @IsString() @IsNotEmpty() @MaxLength(140) versionName!: string;
  @ValidateNested()
  @Type(() => InitialPricePolicyDto)
  pricePolicy!: InitialPricePolicyDto;
  @IsEnum(condicion_vehiculo_luma) condition!: condicion_vehiculo_luma;
  @IsUUID() branchId!: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsEnum(origen_adquisicion_luma)
  acquisitionOrigin!: origen_adquisicion_luma;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchaseCost?: number;
  @IsOptional() @IsDateString() receivedAt?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InlineInventoryUnitDto)
  units!: InlineInventoryUnitDto[];
  @IsOptional() @IsUUID() organizationId?: string;
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
  @IsOptional() @IsString() @IsIn(UNIT_FINISHES) acabado?: string | null;
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
