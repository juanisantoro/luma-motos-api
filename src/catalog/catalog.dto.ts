import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { alcance_catalogo_luma, tipo_vehiculo_luma } from '@prisma/client';

export class PageDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class CatalogQueryDto extends PageDto {
  @IsOptional()
  @IsString()
  @MaxLength(140)
  search?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @IsUUID()
  modelId?: string;

  @IsOptional()
  @IsEnum(alcance_catalogo_luma)
  scope?: alcance_catalogo_luma;

  @IsOptional()
  @IsUUID()
  versionId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  currentOn?: string;

  @IsOptional()
  @IsEnum(tipo_vehiculo_luma)
  vehicleType?: tipo_vehiculo_luma;

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class NameDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(140)
  name!: string;
}

export class UpdateNameDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateModelDto extends NameDto {
  @IsUUID()
  brandId!: string;

  @IsEnum(tipo_vehiculo_luma)
  vehicleType!: tipo_vehiculo_luma;
}

export class UpdateModelDto extends UpdateNameDto {
  @IsOptional()
  @IsEnum(tipo_vehiculo_luma)
  vehicleType?: tipo_vehiculo_luma;
}

export class CreateVersionDto extends NameDto {
  @IsUUID()
  modelId!: string;

  @IsOptional()
  @IsBoolean()
  marker?: boolean;

  @IsOptional()
  @IsEnum(alcance_catalogo_luma)
  scope?: alcance_catalogo_luma;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  organizationIds?: string[];
}

export class UpdateVersionDto extends UpdateNameDto {
  @IsOptional()
  @IsBoolean()
  marker?: boolean;

  @IsOptional()
  @IsEnum(alcance_catalogo_luma)
  scope?: alcance_catalogo_luma;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  organizationIds?: string[];
}

export class CreatePricePolicyDto {
  @IsUUID()
  versionId!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  listPrice!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumPrice!: number;

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @ValidateIf((item: CreatePricePolicyDto) => item.validUntil !== null)
  @IsDateString()
  validUntil?: string | null;

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class EffectivePricePolicyQueryDto {
  @IsUUID()
  versionId!: string;

  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsDateString()
  currentOn?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
