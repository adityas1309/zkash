import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';

export class CreateOrderDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Min(1)
  @Max(500000)
  amount: number;

  @IsOptional()
  @IsString()
  @IsIn(['INR'])
  currency?: string;

  @IsString()
  @IsIn(['public', 'zk'])
  mode: 'public' | 'zk';
}

export class BankAccountDetailsDto {
  @IsString()
  @Matches(/^[0-9]{9,18}$/)
  accountNo: string;

  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/)
  ifsc: string;
}

export class SellFiatDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  @Min(0.1)
  @Max(1000000)
  amount: number;

  @ValidateNested()
  @Type(() => BankAccountDetailsDto)
  accountDetails: BankAccountDetailsDto;
}
