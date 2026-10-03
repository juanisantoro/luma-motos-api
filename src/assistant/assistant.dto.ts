import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const ASSISTANT_HISTORY_ROLES = ['user', 'assistant'] as const;
export type AssistantHistoryRole = (typeof ASSISTANT_HISTORY_ROLES)[number];

export class AssistantHistoryItemDto {
  @IsIn(ASSISTANT_HISTORY_ROLES)
  role!: AssistantHistoryRole;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  content!: string;
}

export class AskAssistantDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(600)
  question!: string;

  // Últimos intercambios de la misma conversación, para repreguntas. No se
  // guardan en el servidor: los manda el front en cada pregunta.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => AssistantHistoryItemDto)
  history?: AssistantHistoryItemDto[];
}
