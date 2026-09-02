import { Module } from '@nestjs/common';
import { BcraController } from './bcra.controller';
import { BcraService } from './bcra.service';
import { CuitParamPipe } from './cuit-param.pipe';

@Module({
  controllers: [BcraController],
  providers: [BcraService, CuitParamPipe],
})
export class BcraModule {}
