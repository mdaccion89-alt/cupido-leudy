import { Sparkles } from "lucide-react";
import { REVIEW_MODE_MESSAGE } from "@/lib/review-mode";

export function ReviewModeCard({ className = "" }: { className?: string }) {
  return (
    <section
      className={`rounded-3xl border border-emerald-300/30 bg-gradient-to-r from-emerald-500/15 to-amber-400/10 p-5 text-center ${className}`}
    >
      <p className="flex items-start justify-center gap-2 text-left font-display text-sm leading-relaxed text-emerald-100 sm:text-base">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-emerald-200" /> {REVIEW_MODE_MESSAGE}
      </p>
    </section>
  );
}
