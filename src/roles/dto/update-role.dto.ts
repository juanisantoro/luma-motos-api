import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { BASE_ROLE_CODES, type BaseRoleCode } from '../role-base';

export class UpdateRoleDto {
  // "Funciona como": rol del sistema que toma como base; null lo quita.
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsIn(BASE_ROLE_CODES)
  baseRole?: BaseRoleCode | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(240)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissionCodes?: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
