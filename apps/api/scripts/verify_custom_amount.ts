
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { UsersController } from '../src/users/users.controller';
import * as StellarSdk from '@stellar/stellar-sdk';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    // We need to bypass Auth guards, so we will call the Service directly
    // imitating the controller level if possible, or just testing the Service logic.

    const usersService = app.get(UsersService);
    const usersController = app.get(UsersController);

    console.log('Starting Custom Amount Verification...');

    // 1. Setup User
    // Assuming we have a user in DB. We'll pick one or create one.
    // For simplicity, let's use a hardcoded user ID or find one by username 'alice'.
    // If not found, we might need to rely on existing data.
    const alice = await usersService.findByUsername('alice');
    if (!alice) {
        console.error('User "alice" not found. Please create user "alice" first.');
        process.exit(1);
    }
    const userId = alice._id.toString();
    console.log(`Using user: ${alice.username} (${userId})`);

    // 2. Check Initial Balances
    const initial = await usersService.getPrivateBalance(userId);
    console.log('Initial Private Balance:', initial);

    // 3. Deposit Custom Amount (e.g. 5.5 XLM)
    const depositAmount = 5.5;
    console.log(`Depositing ${depositAmount} XLM...`);
    try {
        const depositRes = await usersService.deposit(userId, 'XLM', depositAmount);
        if (depositRes.error) throw new Error(depositRes.error);
        console.log('Deposit TX:', depositRes.txHash);
    } catch (e) {
        console.error('Deposit Failed:', e);
        process.exit(1);
    }

    // 4. Verify Balance Update
    // Wait a bit for indexing? db update is immediate in 'deposit' method (optimistic/post-tx).
    const postDeposit = await usersService.getPrivateBalance(userId);
    console.log('Post-Deposit Private Balance:', postDeposit);

    const expectedXlm = Number(initial.xlm) + depositAmount;
    // stored as string, might have small float diffs
    if (Math.abs(Number(postDeposit.xlm) - expectedXlm) > 0.0001) {
        console.warn(`Balance mismatch! Expected ~${expectedXlm}, got ${postDeposit.xlm}`);
    } else {
        console.log('Balance updated correctly.');
    }

    // 5. Withdraw EXACT Custom Amount (5.5 XLM)
    console.log(`Withdrawing ${depositAmount} XLM...`);
    try {
        const withdrawRes = await usersService.withdrawSelf(userId, 'XLM', depositAmount);
        if (!withdrawRes.success) throw new Error(withdrawRes.error);
        console.log('Withdraw TX:', withdrawRes.txHash);
    } catch (e) {
        console.error('Withdraw Failed:', e);
        process.exit(1);
    }

    // 6. Verify Final Balance
    const finalBal = await usersService.getPrivateBalance(userId);
    console.log('Final Private Balance:', finalBal);

    if (Math.abs(Number(finalBal.xlm) - Number(initial.xlm)) > 0.0001) {
        console.warn(`Balance mismatch! Expected return to ~${initial.xlm}, got ${finalBal.xlm}`);
    } else {
        console.log('Balance returned to initial state (minus fees if any). verification SUCCESS.');
    }

    await app.close();
    process.exit(0);
}

bootstrap();
