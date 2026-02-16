import Script from 'next/script';
import { useEffect } from 'react';

interface RazorpayLoaderProps {
    onLoad: (razorpay: any) => void;
}

export default function RazorpayLoader({ onLoad }: RazorpayLoaderProps) {
    return (
        <Script
            id="razorpay-checkout-js"
            src="https://checkout.razorpay.com/v1/checkout.js"
            onLoad={() => {
                const win = window as any;
                if (win.Razorpay) {
                    onLoad(win.Razorpay);
                } else {
                    console.error("Razorpay SDK failed to load");
                }
            }}
        />
    );
}
