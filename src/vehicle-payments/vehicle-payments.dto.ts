import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { tipo_vehiculo_luma } from '@prisma/client';

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const VEHICLE_PAYMENT_STATUSES = ['PENDIENTE', 'PAGADO'] as const;
export type VehiclePaymentStatus = (typeof VEHICLE_PAYMENT_STATUSES)[number];

export class VehiclePaymentQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsOptional() @IsUUID() conceptId?: string;
  @IsOptional() @IsUUID() providerId?: string;
  @IsOptional() @IsIn(VEHICLE_PAYMENT_STATUSES) status?: VehiclePaymentStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2200) year?: number;
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class CreateVehiclePaymentDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsUUID() conceptId!: string;
  @IsUUID() unitId!: string;
  @IsOptional() @IsUUID() operationId?: string;
  @IsUUID() providerId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount!: number;
  @IsDateString() @Matches(BUSINESS_DATE_PATTERN) paymentDate!: string;
  @IsOptional() @IsIn(VEHICLE_PAYMENT_STATUSES) status?: VehiclePaymentStatus;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateVehiclePaymentDto {
  @IsOptional() @IsUUID() conceptId?: string;
  @IsOptional() @IsUUID() operationId?: string | null;
  @IsOptional() @IsUUID() providerId?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount?: number;
  @IsOptional()
  @IsDateString()
  @Matches(BUSINESS_DATE_PATTERN)
  paymentDate?: string;
  @IsOptional() @IsIn(VEHICLE_PAYMENT_STATUSES) status?: VehiclePaymentStatus;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class CreateVehiclePaymentCatalogEntryDto {
  @IsString() @MaxLength(160) name!: string;
}
