export class CreateOrderDto {
    amount: number;
    currency: string;
    mode: 'public' | 'zk';
}
