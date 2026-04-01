import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export enum WalletAsset {
  USDC = 'USDC',
  XLM = 'XLM',
}

export class FaucetRequestDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z0-9]{55}$/, { message: 'address must be a valid Stellar public key' })
  address: string;
}

export class SendPaymentDto {
  @IsString()
  @IsNotEmpty()
  recipient: string;

  @IsEnum(WalletAsset)
  asset: WalletAsset;

  @IsString()
  @IsNotEmpty()
  amount: string;
}

export class BalanceActionDto {
  @IsEnum(WalletAsset)
  asset: WalletAsset;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  amount: number;
}

export class SponsorshipPreviewDto {
  @IsEnum(WalletAsset)
  asset: WalletAsset;

  @IsString()
  @IsNotEmpty()
  operation: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(0)
  @Max(1000000)
  amount?: number;

  @IsOptional()
  @IsString()
  recipient?: string;
}
