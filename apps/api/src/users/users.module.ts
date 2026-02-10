import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../schemas/user.schema';
import { PendingWithdrawal, PendingWithdrawalSchema } from '../schemas/pending-withdrawal.schema';
import { EncryptedNote, EncryptedNoteSchema } from '../schemas/encrypted-note.schema';
import { SpendableNote, SpendableNoteSchema } from '../schemas/spendable-note.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { SorobanModule } from '../soroban/soroban.module';
import { ZkModule } from '../zk/zk.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: PendingWithdrawal.name, schema: PendingWithdrawalSchema },
      { name: EncryptedNote.name, schema: EncryptedNoteSchema },
      { name: SpendableNote.name, schema: SpendableNoteSchema },
    ]),
    forwardRef(() => AuthModule),
    SorobanModule,
    ZkModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule { }
