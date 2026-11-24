import { useEffect, useId, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { capturePaypalOrder, createPaypalOrder } from "@/lib/payments.functions";
import { readableErrorMessage } from "@/lib/cupido";

type PayPalButtonInstance = {
  render: (selector: string) => Promise<void>;
  close?: () => Promise<void>;
};
type PayPalSDK = {
  Buttons: (options: {
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel?: () => void;
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
  onCancel?: (message: string) => void;
};

function checkoutErrorMessage(error: unknown): string {
  const message = readableErrorMessage(error, "");
  const code = message.toUpperCase();
  if (/cancel/i.test(message)) {
    return "Pago cancelado. No se realizó ningún cargo; puedes intentarlo de nuevo cuando quieras.";
  }
  if (code.includes("PAYPAL_FINALIZE_FAILED")) {
    return "PayPal confirmó el pago, pero falta terminar la acreditación. No vuelvas a pagar; reintenta la confirmación.";
  }
  if (code.includes("PAYPAL_NETWORK_ERROR") || /network|failed to fetch|timeout|connection/i.test(message)) {
    return "No se pudo conectar con PayPal. Comprueba tu conexión y reintenta; si el pago fue confirmado, se verificará el mismo pedido.";
  }
  if (
    message &&
    message !== "[object Object]" &&
    !message.trim().startsWith("{") &&
    !code.startsWith("PAYPAL_") &&
    /(no se|pago|paypal|monedas|paquete|compra|conexión|conectar|reintenta|reintentar|confirm|configur|saldo|cancel|inténtalo|contacta)/i.test(message)
  ) return message;
  return "No se pudo completar el pago con PayPal. No cierres la app y reintenta en un momento.";
}

export function PayPalCheckoutButtons({
  clientId,
  packageId,
  disabled = false,
  onSuccess,
  onError,
  onCancel,
}: PayPalCheckoutButtonsProps) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const createOrder = useServerFn(createPaypalOrder);
  const captureOrder = useServerFn(capturePaypalOrder);
  const callbacks = useRef({ onSuccess, onError, onCancel });
  callbacks.current = { onSuccess, onError, onCancel };
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [failureMessage, setFailureMessage] = useState("");
  const [completedCredits, setCompletedCredits] = useState<number | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const captureOrderId = useRef<string | null>(null);
  const packageKey = packageId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const containerId = `paypal-button-${reactId}-${packageKey}-${retryKey}`;

  const reportFailure = (error: unknown) => {
    const message = checkoutErrorMessage(error);
    setLoading(false);
    setFailed(true);
    setFailureMessage(message);
    callbacks.current.onError(message);
  };

  const retryCheckout = async () => {
    const pendingOrderId = captureOrderId.current;
    setFailureMessage("");
    setFailed(false);
    setLoading(true);
    if (!pendingOrderId) {
      sdkPromise = null;
      setRetryKey((value) => value + 1);
      return;
    }
    try {
      const result = await captureOrder({ data: { orderId: pendingOrderId } });
      if (!result.ok) throw new Error(result.message);
      captureOrderId.current = null;
      setCompletedCredits(result.credits);
      setLoading(false);
      callbacks.current.onSuccess(result.credits);
    } catch (error) {
      reportFailure(error);
    }
  };

  useEffect(() => {
    if (!clientId || disabled) return;
    let disposed = false;
    let buttonInstance: PayPalButtonInstance | undefined;
    let renderTask: Promise<void> | undefined;
    let container: HTMLDivElement | null = null;
    setLoading(true);
    setFailed(false);
    setFailureMessage("");
    setCompletedCredits(null);

    const initialize = async () => {
      try {
        await loadPaypalSdk(clientId);
        container = containerRef.current;
        if (disposed || !container || !window.paypal) return;
        buttonInstance = window.paypal.Buttons({
            createOrder: async () => {
              const result = await createOrder({
                data: {
                  packageId,
                  ...(Capacitor.isNativePlatform() ? {} : { returnUrl: window.location.href }),
                },
              });
              if (!result.ok) throw new Error(result.message);
              return result.orderId;
            },
            onApprove: async ({ orderID }) => {
              captureOrderId.current = orderID;
              try {
                const result = await captureOrder({ data: { orderId: orderID } });
                if (!result.ok) throw new Error(result.message);
                captureOrderId.current = null;
                setCompletedCredits(result.credits);
                setLoading(false);
                callbacks.current.onSuccess(result.credits);
              } catch (error) {
                reportFailure(error);
              }
            },
            onCancel: () => {
              captureOrderId.current = null;
              const message = "Pago cancelado. No se realizó ningún cargo; puedes intentarlo de nuevo cuando quieras.";
              setLoading(false);
              setFailed(true);
              setFailureMessage(message);
              if (callbacks.current.onCancel) callbacks.current.onCancel(message);
              else callbacks.current.onError(message);
            },
            onError: reportFailure,
            style: { layout: "vertical", shape: "pill", color: "gold", label: "paypal" },
          });
        renderTask = buttonInstance.render(`#${containerId}`);
        await renderTask;
        if (!disposed) setLoading(false);
      } catch (error) {
        if (disposed) return;
        console.error("[PayPal] Falló la inicialización después de los reintentos.", error);
        setLoading(false);
        setFailed(true);
        setFailureMessage(checkoutErrorMessage(error));
      }
    };

    void initialize();
    return () => {
      disposed = true;
      void (async () => {
        try {
          await renderTask;
        } catch {
          // A disposed PayPal render may reject after navigation or a retry.
        }
        try {
          await buttonInstance?.close?.();
        } catch {
          // The SDK may already have removed its iframe while closing.
        }
        if (container && containerRef.current === container) container.replaceChildren();
      })();
    };
  }, [clientId, packageId, disabled, createOrder, captureOrder, retryKey, containerId]);

  if (disabled) {
    return (
      <Button className="mt-2 w-full" disabled>
        <Loader2 className="animate-spin" /> Procesando…
      </Button>
    );
  }

  return (
    <div translate="no" className="mt-2 space-y-2">
      {completedCredits !== null && (
        <p role="status" className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-center text-sm text-emerald-100">
          Pago confirmado: {completedCredits.toLocaleString("es")} monedas acreditadas.
        </p>
      )}
      {failureMessage && <p role="alert" className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-center text-sm text-amber-100">{failureMessage}</p>}
      {loading && (
        <div className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Conectando con PayPal…
        </div>
      )}
      {completedCredits === null && <div key={containerId} ref={containerRef} id={containerId} translate="no" className="min-h-10" />}
      {failed && completedCredits === null && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void retryCheckout()}
        >
          {captureOrderId.current ? "Reintentar confirmar pago" : "Reintentar PayPal"}
        </Button>
      )}
      <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
        <CreditCard className="size-3" /> Paga con saldo PayPal o tarjeta
      </p>
    </div>
  );
}
