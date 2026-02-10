import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Swap, SwapSchema } from '../schemas/swap.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { SwapService } from './swap.service';
import { SwapController } from './swap.controller';
import { AuthModule } from '../auth/auth.module';
import { SorobanModule } from '../soroban/soroban.module';
import { ZkModule } from '../zk/zk.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Swap.name, schema: SwapSchema },
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => AuthModule),
    SorobanModule,
    ZkModule,
    forwardRef(() => UsersModule),
  ],
  controllers: [SwapController],
  providers: [SwapService],
  exports: [SwapService],
})
export class SwapModule { }
