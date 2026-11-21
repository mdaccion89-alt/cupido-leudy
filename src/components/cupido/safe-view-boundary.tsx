import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode; label: string };
type State = { error: Error | null };

export class SafeViewBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Error en ${this.props.label}`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-5">
        <div className="panel grain max-w-md p-8 text-center">
          <h1 className="text-xl font-semibold">No se pudo mostrar {this.props.label}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tus datos siguen guardados. Intenta cargar la vista de nuevo.
          </p>
          <Button className="mt-5" onClick={() => this.setState({ error: null })}>
            Reintentar
          </Button>
        </div>
      </main>
    );
  }
}
