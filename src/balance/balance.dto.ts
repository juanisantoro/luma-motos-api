import { IsIn, IsOptional, Matches } from 'class-validator';

export class BalanceQueryDto {
  // Mes de trabajo (corte a corte), AAAA-MM. Sin mes, el que está en curso.
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'El mes va como AAAA-MM.' })
  period?: string;

  // Pesos y dólares no se suman: el balance es de una moneda por vez.
  @IsOptional()
  @IsIn(['ARS', 'USD'])
  currency: 'ARS' | 'USD' = 'ARS';
}
