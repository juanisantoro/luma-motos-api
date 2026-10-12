import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { metodo_cobranza_luma } from '@prisma/client';

const MONEY_PATTERN = /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const SERVICE_ORDER_STATUSES = [
  'RECIBIDA',
  'EN_TALLER',
  'TERMINADA',
  'ENTREGADA',
  'CANCELADA',
] as const;
export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export const VEHICLE_CONDITIONS = ['OPTIMO', 'BUENO', 'REGULAR'] as const;

const trimmed = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

export class ServiceOrderQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsUUID() branchId?: string;
  /** Uno o varios estados separados por coma (`RECIBIDA,EN_TALLER`). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @IsIn(SERVICE_ORDER_STATUSES, { each: true })
  status?: ServiceOrderStatus[];
  /** Número de orden, cliente, dominio, chasis o modelo. */
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Matches(DATE_PATTERN) from?: string;
  @IsOptional() @Matches(DATE_PATTERN) to?: string;
}

export class VehicleLookupQueryDto {
  /** Dominio o número de chasis. */
  @trimmed() @IsString() @IsNotEmpty() @MaxLength(40) q!: string;
}

/** Datos de recepción que carga la administrativa. */
export class ServiceOrderReceptionDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @Matches(DATE_PATTERN) receptionDate?: string;
  @IsOptional() @IsUUID() clientId?: string;
  /** Obligatorio si no se elige un cliente registrado. */
  @IsOptional() @trimmed() @IsString() @MaxLength(160) clientName?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(40) clientPhone?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(160) clientEmail?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(20) clientDocument?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(240) clientAddress?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(120) clientLocality?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(20) plate?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(40) chassis?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(40) engine?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(120) model?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  year?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  nextServiceKm?: number | null;
  /** Tipo de service del catálogo; si no, `serviceTypeOther` (Otro). */
  @IsOptional() @IsUUID() serviceTypeId?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(70) serviceTypeOther?: string;
  @IsOptional() @IsString() @MaxLength(2000) receptionNotes?: string;
}

export class CreateServiceOrderDto extends ServiceOrderReceptionDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(2_000_000) currentKm!: number;
}

export class UpdateServiceOrderDto extends ServiceOrderReceptionDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  currentKm?: number;
}

export class ServiceTaskDto {
  @trimmed() @IsString() @IsNotEmpty() @MaxLength(160) description!: string;
  /** Sí / No; `null` mientras no se revisó. */
  @IsOptional() @IsBoolean() done?: boolean | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
}

export class ServiceOilDto {
  @IsOptional() @trimmed() @IsString() @MaxLength(80) type?: string | null;
  @IsOptional() @trimmed() @IsString() @MaxLength(40) viscosity?: string | null;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  liters?: number | null;
  @IsOptional() @IsBoolean() filter?: boolean | null;
}

export class ServicePartDto {
  @IsOptional() @trimmed() @IsString() @MaxLength(60) code?: string | null;
  @trimmed() @IsString() @IsNotEmpty() @MaxLength(200) description!: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000)
  quantity!: number;
  @IsOptional() @IsString() @Matches(MONEY_PATTERN) unitPrice?: string | null;
}

/** Lo que carga el mecánico. Reemplaza el checklist completo. */
export class SaveServiceWorkDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ServiceTaskDto)
  tasks!: ServiceTaskDto[];
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceOilDto)
  oil?: ServiceOilDto;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ServicePartDto)
  parts?: ServicePartDto[];
  @IsOptional() @IsString() @MaxLength(4000) diagnosis?: string | null;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  nextServiceKm?: number | null;
}

export class ServiceOrderReasonDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @trimmed() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

/** Cobro y entrega. Con importe 0 (garantía) no se crea ningún ingreso. */
export class DeliverServiceOrderDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsUUID() idempotencyKey!: string;
  @IsString() @Matches(MONEY_PATTERN) amount!: string;
  @ValidateIf(
    (input: DeliverServiceOrderDto) =>
      input.amount !== '0' && Number(input.amount) > 0,
  )
  @IsUUID()
  accountId?: string;
  @ValidateIf(
    (input: DeliverServiceOrderDto) =>
      input.amount !== '0' && Number(input.amount) > 0,
  )
  @IsIn(Object.values(metodo_cobranza_luma))
  paymentMethod?: metodo_cobranza_luma;
  @IsOptional() @IsUUID() collectedById?: string;
  @IsOptional() @IsUUID() handoverToId?: string;
  /** Día de la entrega y del cobro; por defecto, hoy. */
  @IsOptional() @Matches(DATE_PATTERN) deliveryDate?: string;
  @IsIn(VEHICLE_CONDITIONS)
  vehicleCondition!: (typeof VEHICLE_CONDITIONS)[number];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(160) reference?: string;
}

export class ServiceTypeDto {
  @trimmed() @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(999) order?: number;
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(160, { each: true })
  tasks!: string[];
  /** Lo que se cobra este service; vacío mientras no esté definido. */
  @IsOptional() @IsString() @Matches(MONEY_PATTERN) suggestedPrice?:
    string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ServiceTypeQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  includeInactive?: boolean;
}
