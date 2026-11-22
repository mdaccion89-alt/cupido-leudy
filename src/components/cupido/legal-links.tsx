type LegalLinksProps = { className?: string };

export function LegalLinks({ className = "" }: LegalLinksProps) {
  return (
    <nav aria-label="Información legal" className={`flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground ${className}`}>
      <a href="/legal?doc=terms" className="underline-offset-4 hover:text-foreground hover:underline">Términos de Uso</a>
      <a href="/legal?doc=privacy" className="underline-offset-4 hover:text-foreground hover:underline">Política de Privacidad</a>
      <a href="/legal?doc=age" className="underline-offset-4 hover:text-foreground hover:underline">Solo +18</a>
    </nav>
  );
}
