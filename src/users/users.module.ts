import { Module } from '@nestjs/common';
import {
  UserReferenceDataController,
  UsersController,
} from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, UserReferenceDataController],
  providers: [UsersService],
})
export class UsersModule {}
