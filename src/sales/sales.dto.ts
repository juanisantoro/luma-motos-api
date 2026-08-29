import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
} from 'class-validator';
import { condicion_vehiculo_luma, luma_estado_operacion } from '@prisma/client';

export class SalesOperationQueryDto {
  @IsOptional() @IsEnum(luma_estado_operacion) status?: luma_estado_operacion;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  mine?: boolean;
  @IsOptional() @IsUUID() versionId?: string;
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class SalesSellerQueryDto {
  @IsUUID() branchId!: string;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class SalesPricePolicyQueryDto {
  @IsUUID() branchId!: string;
  @IsUUID() versionId!: string;
  @IsOptional() @IsDateString() operationDate?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class CreateSalesOperationDto {
  @IsUUID() branchId!: string;
  @IsUUID() clientId!: string;
  @IsUUID() versionId!: string;
  @IsEnum(condicion_vehiculo_luma) condition!: condicion_vehiculo_luma;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsUUID() sellerId?: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  agreedPrice!: number;
  @IsOptional() @IsDateString() operationDate?: string;
  @IsOptional() @IsDateString() reservationExpiresAt?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class UpdateSalesOperationDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  agreedPrice?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class ReserveSalesUnitDto {
  @IsUUID() unitId!: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
}

export class VersionedSalesActionDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
}

export class ReasonedSalesActionDto extends VersionedSalesActionDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}

export class ReleaseSalesReservationDto extends ReasonedSalesActionDto {}

export class ApproveSalesOperationDto extends VersionedSalesActionDto {
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
