import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AuditedMutation } from '../audit/decorators/audited-mutation.decorator';
import { PERMISSION_CODES } from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  CommissionAgreementDto,
  CommissionHistoryQueryDto,
  CommissionMeQueryDto,
  CommissionPolicyQueryDto,
  CommissionSettlementQueryDto,
  CommissionSuggestionQueryDto,
  CreateCommissionPolicyDto,
  PayCommissionDto,
  UpdateCommissionPolicyDto,
  VersionedCommissionPolicyDto,
} from './commissions.dto';
import { CommissionsService } from './commissions.service';

@Controller('commissions')
export class CommissionsController {
  constructor(private readonly service: CommissionsService) {}

  @Get('suggestions')
  @Permissions(PERMISSION_CODES.COMMISSIONS_READ)
  suggestions(
    @Query() query: CommissionSuggestionQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.suggestions(query, actor);
  }

  @Get('suggestions/:id')
  @Permissions(PERMISSION_CODES.COMMISSIONS_READ)
  suggestion(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.suggestion(id, actor);
  }

  @Put('suggestions/:id/agreement')
  @Permissions(PERMISSION_CODES.COMMISSIONS_AGREE)
  @AuditedMutation()
  agreement(
    @Param('id') id: string,
    @Body() input: CommissionAgreementDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.agree(id, input, actor);
  }

  @Get('settlements')
  @Permissions(PERMISSION_CODES.COMMISSIONS_READ)
  settlements(
    @Query() query: CommissionSettlementQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.settlements(query, actor);
  }

  @Post('settlements/:id/payments')
  @Permissions(PERMISSION_CODES.COMMISSIONS_PAY)
  @AuditedMutation()
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: PayCommissionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.pay(id, input, actor);
  }

  @Get('history')
  @Permissions(PERMISSION_CODES.COMMISSIONS_HISTORY)
  history(
    @Query() query: CommissionHistoryQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.history(query, actor);
  }

  @Get('policies')
  @Permissions(PERMISSION_CODES.COMMISSIONS_READ)
  policies(
    @Query() query: CommissionPolicyQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.policies(query, actor);
  }

  @Get('policies/:id')
  @Permissions(PERMISSION_CODES.COMMISSIONS_READ)
  policy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.policy(id, actor);
  }

  @Post('policies')
  @Permissions(PERMISSION_CODES.COMMISSIONS_CONFIGURE)
  @AuditedMutation()
  createPolicy(
    @Body() input: CreateCommissionPolicyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.createPolicy(input, actor);
  }

  @Put('policies/:id')
  @Permissions(PERMISSION_CODES.COMMISSIONS_CONFIGURE)
  @AuditedMutation()
  updatePolicy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateCommissionPolicyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.updatePolicy(id, input, actor);
  }

  @Post('policies/:id/activate')
  @Permissions(PERMISSION_CODES.COMMISSIONS_CONFIGURE)
  @AuditedMutation()
  activatePolicy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: VersionedCommissionPolicyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.activatePolicy(id, input, actor);
  }

  @Post('policies/:id/deactivate')
  @Permissions(PERMISSION_CODES.COMMISSIONS_CONFIGURE)
  @AuditedMutation()
  deactivatePolicy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: VersionedCommissionPolicyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.deactivatePolicy(id, input, actor);
  }

  @Delete('policies/:id')
  @Permissions(PERMISSION_CODES.COMMISSIONS_CONFIGURE)
  @AuditedMutation()
  deletePolicy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: VersionedCommissionPolicyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.deletePolicy(id, input, actor);
  }

  @Get('me')
  @Permissions(PERMISSION_CODES.COMMISSIONS_OWN)
  me(
    @Query() query: CommissionMeQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.me(query, actor);
  }
}
