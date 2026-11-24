import paypalLogo from "@/assets/paypal-logo.svg";

export function PayPalLogo({ className = "h-6 w-[90px]" }: { className?: string }) {
  return <img src={paypalLogo} alt="PayPal" className={`inline-block shrink-0 object-contain ${className}`} />;
}
