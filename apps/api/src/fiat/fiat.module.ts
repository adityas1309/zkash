import { Module } from '@nestjs/common';
import { FiatService } from './fiat.service';
import { FiatController } from './fiat.controller';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [UsersModule],
    controllers: [FiatController],
    providers: [FiatService],
})
export class FiatModule { }
