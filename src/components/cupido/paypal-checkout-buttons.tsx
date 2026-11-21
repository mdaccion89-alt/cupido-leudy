import { useEffect, useRef, useState } from "react";
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

let sdkClientId: string | null = null;
let sdkPromise: Promise<void> | null = null;

function loadPaypalSdk(clientId: string): Promise<void> {
  if (window.paypal && (!sdkClientId || sdkClientId === clientId)) {
    sdkClientId = clientId;
    return Promise.resolve();
  }
  if (sdkPromise && sdkClientId === clientId) return sdkPromise;

  sdkClientId = clientId;
  const pending = (async () => {
    const previous = document.querySelector<HTMLScriptElement>("script[data-cupido-paypal-sdk]");
    if (previous) previous.remove();
    delete window.paypal;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const script = document.createElement("script");
      script.dataset["cupidoPaypalSdk"] = clientId;
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons,card-fields&enable-funding=card`;
      script.async = true;
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("Timeout cargando PayPal")), 15_000);
          script.onload = () => {
            window.clearTimeout(timeout);
            window.paypal ? resolve() : reject(new Error("El SDK de PayPal no quedó disponible"));
          };
          script.onerror = () => {
            window.clearTimeout(timeout);
            reject(new Error("No se pudo conectar con PayPal"));
          };
          document.head.appendChild(script);
        });
        return;
      } catch (error) {
        script.remove();
        lastError = error instanceof Error ? error : new Error("No se pudo cargar PayPal");
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
    throw lastError ?? new Error("No se pudo cargar PayPal");
  })();
  sdkPromise = pending;
  void pending.then(() => {
    if (sdkPromise === pending) sdkPromise = null;
  }, () => {
    if (sdkPromise === pending) sdkPromise = null;
  });
  return pending;
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
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!clientId || disabled) return;
    let disposed = false;
    setLoading(true);
    setFailed(false);

    const initialize = async () => {
      try {
        await loadPaypalSdk(clientId);
        const container = containerRef.current;
        if (disposed || !container || !window.paypal) return;
        container.innerHTML = "";
        await window.paypal
          .Buttons({
            createOrder: async () => {
              const result = await createOrder({ data: { packageId, returnUrl: window.location.href } });
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
            onError: (error) => callbacks.current.onError(
              error instanceof Error ? error.message : "No se pudo completar el pago con PayPal.",
            ),
            style: { layout: "vertical", shape: "pill", color: "gold", label: "paypal" },
          })
          .render(`#${container.id}`);
        if (!disposed) setLoading(false);
      } catch (error) {
        if (disposed) return;
        console.error("[PayPal] Falló la inicialización después de los reintentos.", error);
        setLoading(false);
        setFailed(true);
      }
    };

    void initialize();
    return () => {
      disposed = true;
    };
  }, [clientId, packageId, disabled, createOrder, captureOrder, retryKey]);

  if (disabled) {
    return (
      <Button className="mt-2 w-full" disabled>
        <Loader2 className="animate-spin" /> Procesando…
      </Button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {loading && (
        <div className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Conectando con PayPal…
        </div>
      )}
      <div ref={containerRef} id={`paypal-button-${packageId}`} className="min-h-10" />
      {failed && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            sdkPromise = null;
            setLoading(true);
            setRetryKey((value) => value + 1);
          }}
        >
          Reintentar PayPal
        </Button>
      )}
      <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
        <CreditCard className="size-3" /> Paga con saldo PayPal o tarjeta
      </p>
    </div>
  );
}
