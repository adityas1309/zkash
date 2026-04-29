import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { networkStorage } from './network.context';

@Injectable()
export class NetworkMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    let network = req.headers['x-stellar-network'] as string;

    if (!network && req.headers.cookie) {
      const match = req.headers.cookie.match(/(?:^|;\s*)stellar_network=([^;]+)/);
      if (match) {
        network = match[1];
      }
    }

    const isMainnet = network === 'mainnet';
    networkStorage.run({ isMainnet }, () => {
      next();
    });
  }
}
