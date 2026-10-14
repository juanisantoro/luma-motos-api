import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const CLIENT_LOG_KINDS = ['VALIDATION'] as const;

// Lo que la pantalla frenó antes de llamar a la API (validaciones del
// formulario): qué pantalla, qué mensajes vio el usuario y un resumen de lo
// que había cargado.
export class CreateClientLogDto {
  @IsIn(CLIENT_LOG_KINDS) kind!: (typeof CLIENT_LOG_KINDS)[number];
  @IsString() @MaxLength(120) screen!: string;
  @IsObject() messages!: Record<string, unknown>;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
}
