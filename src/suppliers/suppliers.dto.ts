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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { condicion_vehiculo_luma, tipo_vehiculo_luma } from '@prisma/client';

export class SupplierQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsString() @MaxLength(180) search?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;
  @IsOptional() @IsUUID() organizationId?: string;
}
export class SupplierInputDto {
  @IsString() @IsNotEmpty() @MaxLength(180) legalName!: string;
  @IsOptional() @IsString() @MaxLength(30) taxId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) address?: string | null;
  @IsOptional() @IsString() @MaxLength(160) contactName?: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsUUID() organizationId?: string;
}
export class UpdateSupplierDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(180) legalName?: string;
  @IsOptional() @IsString() @MaxLength(30) taxId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) address?: string | null;
  @IsOptional() @IsString() @MaxLength(160) contactName?: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class AvailabilityQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() versionId?: string;
  @IsOptional() @IsEnum(tipo_vehiculo_luma) vehicleType?: tipo_vehiculo_luma;
  @IsOptional()
  @IsEnum(condicion_vehiculo_luma)
  condition?: condicion_vehiculo_luma;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  includeExpired?: boolean;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsString() @MaxLength(80) search?: string;
}
export class UpsertAvailabilityDto {
  @IsUUID() supplierId!: string;
  @IsUUID() versionId!: string;
  @IsEnum(condicion_vehiculo_luma) condition!: condicion_vehiculo_luma;
  @Type(() => Number) @IsInt() @Min(0) reportedQuantity!: number;
  @IsOptional() @IsDateString() reportedAt?: string;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class SupplierInitialPricePolicyDto {
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

export class CreateCatalogAvailabilityDto {
  @IsUUID() supplierId!: string;
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsString() @IsNotEmpty() @MaxLength(120) brandName!: string;
  @IsString() @IsNotEmpty() @MaxLength(140) modelName!: string;
  @IsString() @IsNotEmpty() @MaxLength(140) versionName!: string;
  @ValidateNested()
  @Type(() => SupplierInitialPricePolicyDto)
  pricePolicy!: SupplierInitialPricePolicyDto;
  @IsEnum(condicion_vehiculo_luma) condition!: condicion_vehiculo_luma;
  @Type(() => Number) @IsInt() @Min(0) reportedQuantity!: number;
  @IsOptional() @IsDateString() reportedAt?: string;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsUUID() organizationId?: string;
}
