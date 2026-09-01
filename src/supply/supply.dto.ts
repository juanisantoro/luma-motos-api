import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  condicion_vehiculo_luma,
  estado_abastecimiento_luma,
} from '@prisma/client';
import { tipo_vehiculo_luma } from '@prisma/client';

export class SupplyRequestQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional()
  @IsEnum(estado_abastecimiento_luma)
  status?: estado_abastecimiento_luma;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() versionId?: string;
  @IsOptional() @IsEnum(tipo_vehiculo_luma) vehicleType?: tipo_vehiculo_luma;
  @IsOptional()
  @IsEnum(condicion_vehiculo_luma)
  condition?: condicion_vehiculo_luma;
  @IsOptional() @IsUUID() arrivalBranchId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}
export class CreateSupplyRequestDto {
  @IsUUID() supplierId!: string;
  @IsUUID() supplierAvailabilityId!: string;
  @IsOptional() @IsUUID() operationId?: string;
  @IsUUID() versionId!: string;
  @IsEnum(condicion_vehiculo_luma) condition!: condicion_vehiculo_luma;
  @IsUUID() arrivalBranchId!: string;
  @IsOptional() @IsString() @MaxLength(80) color?: string;
  @IsOptional() @IsString() @MaxLength(120) supplierReference?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  estimatedCost?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}
export class SupplyTransitionDto {
  @IsEnum(estado_abastecimiento_luma) toStatus!: estado_abastecimiento_luma;
  @IsOptional() @IsString() @MaxLength(120) supplierReference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class ReceiveSupplyRequestDto {
  @IsString() @MaxLength(80) vin!: string;
  @IsUUID() branchId!: string;
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
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchaseCost?: number;
  @IsOptional() @IsDateString() receivedAt?: string;
  @IsOptional() @IsString() @MaxLength(200) idempotencyKey?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
