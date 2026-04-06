import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { AssetType } from '../../schemas/offer.schema';

export class CreateOfferDto {
  @IsIn(['USDC', 'XLM'])
  assetIn: AssetType;

  @IsIn(['USDC', 'XLM'])
  assetOut: AssetType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  @Min(0.0000001)
  @Max(1000000)
  rate: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  @Min(0.0000001)
  @Max(1000000)
  min: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  @Min(0.0000001)
  @Max(1000000)
  max: number;
}

export class UpdateOfferDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;

  @ValidateIf((value) => value.rate !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  @Min(0.0000001)
  @Max(1000000)
  rate?: number;

  @ValidateIf((value) => value.min !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  @Min(0.0000001)
  @Max(1000000)
  min?: number;

  @ValidateIf((value) => value.max !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  @Min(0.0000001)
  @Max(1000000)
  max?: number;
}

export class OfferQueryDto {
  @IsOptional()
  @IsIn(['USDC', 'XLM'])
  assetIn?: AssetType;

  @IsOptional()
  @IsIn(['USDC', 'XLM'])
  assetOut?: AssetType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(0)
  amount?: number;
}
