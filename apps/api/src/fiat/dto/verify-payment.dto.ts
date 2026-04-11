import { IsIn, IsString } from 'class-validator';

export class VerifyPaymentDto {
  @IsString()
  razorpayOrderId: string;

  @IsString()
  razorpayPaymentId: string;

  @IsString()
  razorpaySignature: string;

  @IsString()
  @IsIn(['public', 'zk'])
  mode: 'public' | 'zk';
}
