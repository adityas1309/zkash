import { Module } from '@nestjs/common';
import { SponsorshipService } from './sponsorship.service';

@Module({
  providers: [SponsorshipService],
  exports: [SponsorshipService],
})
export class SponsorshipModule {}
