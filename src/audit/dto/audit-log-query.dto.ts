import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { direccion_caja_luma, tipo_movimiento_caja_luma } from '@prisma/client';
import { AUDIT_CATEGORIES, type AuditCategory } from '../audit.catalog';

class AuditPageDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  /** Instante desde (inclusive), ISO 8601 con zona horaria. */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /** Instante hasta (inclusive), ISO 8601 con zona horaria. */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  /** Número de operación de venta (el que ve el usuario). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  operationNumber?: number;
}

export class AuditLogQueryDto extends AuditPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsIn(AUDIT_CATEGORIES)
  category?: AuditCategory;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entity?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsUUID()
  operationId?: string;
}

export class AuditMoneyQueryDto extends AuditPageDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsIn(Object.values(direccion_caja_luma))
  direction?: direccion_caja_luma;

  @IsOptional()
  @IsIn(Object.values(tipo_movimiento_caja_luma))
  type?: tipo_movimiento_caja_luma;

  /** Usuario que registró el movimiento. */
  @IsOptional()
  @IsUUID()
  actorId?: string;

  /** Sólo movimientos reversados o que son una reversa. */
  @IsOptional()
  @IsIn(['true', 'false'])
  onlyReversals?: 'true' | 'false';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
