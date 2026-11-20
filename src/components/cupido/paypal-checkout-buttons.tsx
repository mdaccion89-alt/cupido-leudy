import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { capturePaypalOrder, createPaypalOrder } from "@/lib/payments.functions";

type PayPalButtonInstance = { render: (selector: string) => Promise<void> };
type PayPalSDK = {
  Buttons: (options: {
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onError?: (error: unknown) => void;
    style?: Record<string, unknown>;
  }) => PayPalButtonInstance;
};

declare global {
  interface Window {
    paypal?: PayPalSDK;
  }
}

type PayPalCheckoutButtonsProps = {
  clientId: string;
  packageId: string;
  disabled?: boolean;
  onSuccess: (credits: number) => void;
  onError: (message: string) => void;
};

export function PayPalCheckoutButtons({
  clientId,
  packageId,
  disabled = false,
  onSuccess,
  onError,
}: PayPalCheckoutButtonsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const createOrder = useServerFn(createPaypalOrder);
  const captureOrder = useServerFn(capturePaypalOrder);
  const callbacks = useRef({ onSuccess, onError });
  callbacks.current = { onSuccess, onError };

  useEffect(() => {
    if (!clientId || disabled) return;
    let disposed = false;

    const render = () => {
      const container = containerRef.current;
      if (!disposed && container && window.paypal) {
        container.innerHTML = "";
        void window.paypal
          .Buttons({
            createOrder: async () => {
              const result = await createOrder({
                data: { packageId, returnUrl: window.location.href },
              });
              if (!result.ok) {
                callbacks.current.onError(result.message);
                throw new Error(result.message);
              }
              return result.orderId;
            },
            onApprove: async ({ orderID }) => {
              const result = await captureOrder({ data: { orderId: orderID } });
              if (!result.ok) {
                callbacks.current.onError(result.message);
                throw new Error(result.message);
              }
              callbacks.current.onSuccess(result.credits);
            },
            onError: (error) => {
              callbacks.current.onError(
                error instanceof Error ? error.message : "No se pudo completar el pago con PayPal.",
              );
            },
            style: { layout: "vertical", shape: "pill", color: "gold", label: "paypal" },
          })
          .render(`#${container.id}`)
          .catch(() => {
            callbacks.current.onError("No se pudo cargar el botón de PayPal. Inténtalo de nuevo.");
          });
      }
    };

    if (window.paypal) {
      render();
      return () => {
        disposed = true;
      };
    }

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
    script.async = true;
    script.onload = render;
    script.onerror = () => callbacks.current.onError("No se pudo cargar PayPal. Revisa la conexión.");
    document.head.appendChild(script);

    return () => {
      disposed = true;
      script.onload = null;
      script.onerror = null;
    };
  }, [clientId, packageId, disabled, createOrder, captureOrder]);

  if (disabled) {
    return (
      <Button className="mt-2 w-full" disabled>
        <Loader2 className="animate-spin" /> Procesando…
      </Button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div ref={containerRef} id={`paypal-button-${packageId}`} className="min-h-10" />
      <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
        <CreditCard className="size-3" /> Paga con saldo PayPal o tarjeta
      </p>
    </div>
  );
}
