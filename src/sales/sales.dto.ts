import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  condicion_vehiculo_luma,
  deuda_operacion_luma,
  luma_estado_entrega,
  luma_estado_operacion,
  plataforma_pago_luma,
  tipo_componente_pago_luma,
  tipo_documento_luma,
  tipo_vehiculo_luma,
} from '@prisma/client';

export enum SalesAssignmentRole {
  VENDEDOR = 'VENDEDOR',
  CONTACTO = 'CONTACTO',
}

export class SalesOperationQueryDto {
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
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

export class SalesFinancialInstitutionQueryDto {
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class SalesPricePolicyQueryDto {
  @IsUUID() branchId!: string;
  @IsUUID() versionId!: string;
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsOptional()
  @IsEnum(condicion_vehiculo_luma)
  condition?: condicion_vehiculo_luma;
  @IsOptional() @IsDateString() operationDate?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class InlineSalesClientDto {
  @IsEnum(tipo_documento_luma) documentType!: tipo_documento_luma;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  documentNumber!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fullName!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
}

export class CreateSalesOperationDto {
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsUUID() branchId!: string;
  @ValidateIf((input: CreateSalesOperationDto) => !input.client)
  @IsUUID()
  clientId?: string;
  @ValidateIf((input: CreateSalesOperationDto) => !input.clientId)
  @ValidateNested()
  @Type(() => InlineSalesClientDto)
  client?: InlineSalesClientDto;
  @IsUUID() versionId!: string;
  @IsEnum(condicion_vehiculo_luma) condition!: condicion_vehiculo_luma;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsUUID() supplierAvailabilityId?: string;
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  agreedPrice!: number;
  @IsEnum(plataforma_pago_luma) paymentPlatform!: plataforma_pago_luma;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  creditAmount?: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) guarantor?: string;
  @IsOptional() @IsDateString() operationDate?: string;
  @IsOptional() @IsDateString() reservationExpiresAt?: string;
  @IsOptional()
  @IsEnum(luma_estado_entrega)
  deliveryStatus?: luma_estado_entrega;
  @IsOptional() @IsBoolean() papersDelivered?: boolean;
  @IsOptional() @IsEnum(deuda_operacion_luma) debt?: deuda_operacion_luma;
  @IsOptional() @IsBoolean() submit?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class UpdateSalesOperationDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional() @IsUUID() contactId?: string | null;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  agreedPrice?: number;
  @IsOptional()
  @IsEnum(plataforma_pago_luma)
  paymentPlatform?: plataforma_pago_luma;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  creditAmount?: number | null;
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  guarantor?: string | null;
  @IsOptional() @IsDateString() operationDate?: string;
  @IsOptional()
  @IsEnum(luma_estado_entrega)
  deliveryStatus?: luma_estado_entrega;
  @IsOptional() @IsBoolean() papersDelivered?: boolean;
  @IsOptional() @IsEnum(deuda_operacion_luma) debt?: deuda_operacion_luma;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class SalesPaymentComponentDto {
  @IsEnum(tipo_componente_pago_luma) type!: tipo_componente_pago_luma;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsUUID() financialInstitutionId?: string;
  @IsOptional() @IsUUID() creditInquiryId?: string;
  @IsOptional() @IsUUID() tradeInVehicleId?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ReplaceSalesPaymentPlanDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => SalesPaymentComponentDto)
  components!: SalesPaymentComponentDto[];
}

export class CreateSalesTradeInDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) description!: string;
  @IsOptional() @IsUUID() versionId?: string;
  @IsOptional() @IsString() @MaxLength(40) vin?: string;
  @IsOptional() @IsString() @MaxLength(60) engineNumber?: string;
  @IsOptional() @IsString() @MaxLength(20) licensePlate?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  year?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) kilometers?: number;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  appraisedAmount!: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  acceptedAmount?: number;
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
