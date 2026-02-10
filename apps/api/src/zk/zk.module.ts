import { Module } from '@nestjs/common';
import { ProofService } from './proof.service';
import { MerkleTreeService } from './merkle-tree.service';

@Module({
  providers: [MerkleTreeService, ProofService],
  exports: [MerkleTreeService, ProofService],
})
export class ZkModule {}
