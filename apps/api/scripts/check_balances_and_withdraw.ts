
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { UsersService } from '../src/users/users.service';
import { SwapService } from '../src/swap/swap.service';
import { User } from '../src/schemas/user.schema';
import { Model } from 'mongoose';

// Import necessary modules ONLY
import { AuthModule } from '../src/auth/auth.module';
import { UsersModule } from '../src/users/users.module';
import { SwapModule } from '../src/swap/swap.module';
import { SorobanModule } from '../src/soroban/soroban.module';
import { ZkModule } from '../src/zk/zk.module';
import { OffersModule } from '../src/offers/offers.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: path.join(process.cwd(), '.env') }),
        MongooseModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const uri = configService.get<string>('MONGODB_URI') || configService.get<string>('MONGO_URI');
                console.log('DEBUG: Connecting to Mongo URI:', uri);
                return {
                    uri: uri ?? 'mongodb://localhost:27017/lop',
                };
            },
        }),
        AuthModule,
        UsersModule,
        SwapModule,
        SorobanModule,
        ZkModule,
        OffersModule,
        // IndexerModule excluded
    ],
})
class ScriptModule { }

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(ScriptModule);
    const usersService = app.get(UsersService);
    const userModel = app.get<Model<User>>(getModelToken(User.name));

    console.log('--- Checking Private Balances & Auto-Withdrawal ---');

    const allUsers = await userModel.find({}).exec();
    console.log(`Found ${allUsers.length} users in database.`);

    for (const user of allUsers) {
        const username = user.username || 'unknown';
        console.log(`\nUser: ${username} (${user._id})`);

        // Check Private Balance
        try {
            const balance = await usersService.getPrivateBalance(user._id.toString());
            console.log(`Private Balance: ${JSON.stringify(balance)}`);

            if (Number(balance.usdc) > 0) {
                console.log(`[+] Found private USDC: ${balance.usdc}. Attempting withdrawal...`);
                try {
                    const res = await usersService.withdrawSelf(user._id.toString(), 'USDC', Number(balance.usdc));
                    console.log('Withdraw Result:', res);
                } catch (wdErr) {
                    console.error('Withdraw Failed:', wdErr);
                }
            }

            if (Number(balance.xlm) > 0) {
                console.log(`[+] Found private XLM: ${balance.xlm}. Attempting withdrawal...`);
                try {
                    const res = await usersService.withdrawSelf(user._id.toString(), 'XLM', Number(balance.xlm));
                    console.log('Withdraw Result:', res);
                } catch (wdErr) {
                    console.error('Withdraw Failed:', wdErr);
                }
            }
        } catch (e) {
            console.error(`Error checking user ${username}:`, e);
        }

        // Process pending withdrawals
        try {
            const res = await usersService.processPendingWithdrawals(user._id.toString());
            if (res.processed > 0) {
                console.log(`Processed ${res.processed} pending withdrawals for ${username}`);
            }
        } catch (e) {
            console.error(`Error processing pending withdrawals for ${username}:`, e);
        }
    }

    await app.close();
    process.exit(0);
}

bootstrap();
