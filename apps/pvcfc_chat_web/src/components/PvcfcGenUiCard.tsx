import {
  ArrowUpRight,
  BookOpenCheck,
  ChevronRight,
  CircleCheck,
  Sparkles,
} from "lucide-react";
import type { PvcfcGenUiModel } from "../pvcfcGenUi";

interface PvcfcGenUiCardProps {
  readonly model: PvcfcGenUiModel;
  readonly onPrompt: (prompt: string) => void;
  readonly disabled?: boolean;
}

export function PvcfcGenUiCard({
  model,
  onPrompt,
  disabled = false,
}: PvcfcGenUiCardProps) {
  return (
    <section className="mt-2 w-full max-w-[620px] overflow-hidden rounded-2xl border border-[#B7D7C3] bg-[#FBFEFC] shadow-[0_12px_30px_rgba(10,107,65,0.08)]">
      <div className="flex items-start justify-between gap-4 border-b border-[#DCEDE2] bg-[linear-gradient(120deg,#F0F8F3_0%,#FBFEFC_68%)] px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0A6B41] text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#0A6B41]">
                Generative UI
              </span>
              <span className="rounded-full bg-[#DCEDE2] px-2 py-0.5 text-[10px] font-semibold text-[#17633F]">
                PVCFC
              </span>
            </div>
            <h3 className="text-sm font-bold text-[#114B32]">{model.title}</h3>
          </div>
        </div>
        <BookOpenCheck className="mt-1 h-4 w-4 shrink-0 text-[#DAA520]" />
      </div>

      <div className="space-y-4 px-4 py-4">
        <p className="text-[13px] leading-6 text-[#315442]">{model.summary}</p>

        <div className="space-y-2">
          {model.points.map((point, index) => (
            <div key={`${point}-${index}`} className="flex gap-2.5 text-[12px] leading-5 text-[#1F3D2C]">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0A6B41]" />
              <span>{point}</span>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-[#E5EEE8] bg-white px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#567263]">
              Nguồn kiểm chứng
            </span>
            <span className="text-[10px] font-semibold text-[#8A9B91]">
              {model.sources.length} URL
            </span>
          </div>
          {model.sources.length > 0 ? (
            <div className="space-y-1.5">
              {model.sources.map((source) => (
                <a
                  key={source}
                  href={source}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 break-all text-[11px] leading-4 text-[#0A6B41] underline decoration-[#B7D7C3] underline-offset-2 hover:text-[#005A36]"
                >
                  <ArrowUpRight className="h-3 w-3 shrink-0" />
                  {source}
                </a>
              ))}
            </div>
          ) : (
            <p className="text-[11px] leading-4 text-[#71847A]">
              Lượt này chưa trả về URL nguồn để hiển thị trong thẻ kiểm chứng.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[#E5EEE8] pt-3">
          {model.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={disabled}
              onClick={() => onPrompt(action.prompt)}
              className="group inline-flex items-center gap-1 rounded-full border border-[#B7D7C3] bg-white px-3 py-1.5 text-[11px] font-bold text-[#17633F] transition hover:border-[#0A6B41] hover:bg-[#F0F8F3] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {action.label}
              <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
