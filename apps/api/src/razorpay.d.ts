declare module 'razorpay' {
  export default class Razorpay {
    constructor(options: any);
    orders: {
      create(options: any): Promise<any>;
      fetch(orderId: string): Promise<any>;
    };
    payments: {
      fetch(paymentId: string): Promise<any>;
    };
  }
}
