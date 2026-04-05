import { Type } from 'class-transformer';
import {
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class RequestSwapDto {
  @IsMongoId()
  bobId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  @Max(1000000)
  amountIn: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  @Max(1000000)
  amountOut: number;

  @IsMongoId()
  offerId: string;
}

export class SubmitSwapProofDto {
  @IsString()
  @IsNotEmpty()
  proofBytes: string;

  @IsString()
  @IsNotEmpty()
  pubSignalsBytes: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-fA-F0-9]{64}$/)
  nullifier: string;
}

export class ExecutePrivateSwapDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  aliceProof?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  alicePubSignals?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-fA-F0-9]{64}$/)
  aliceNullifier?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  bobProof?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  bobPubSignals?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-fA-F0-9]{64}$/)
  bobNullifier?: string;
}

export class CompleteSwapDto {
  @IsString()
  @IsNotEmpty()
  txHash: string;
}

export class SwapActivityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number;
}
