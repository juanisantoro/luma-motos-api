import { IsOptional, IsUUID } from 'class-validator';

export class BranchListQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
