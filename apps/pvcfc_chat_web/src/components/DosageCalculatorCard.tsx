import React, { useState } from 'react';
import { Calculator, Share2, Store } from 'lucide-react';

export interface DosageCalculatorProps {
  title: string;
  initialAreaHa?: number;
  onAction: (actionId: string, cardTitle: string) => void;
}

export const DosageCalculatorCard: React.FC<DosageCalculatorProps> = ({
  title,
  initialAreaHa = 5,
  onAction,
}) => {
  const [area, setArea] = useState<number>(initialAreaHa);

  const damBags = Math.ceil(area * 3.5);
  const npkBags = Math.ceil(area * 4.5);
  const omBags = Math.ceil(area * 10);

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-bold text-[#005A36]">
        <Calculator className="h-4 w-4 text-[#0A6B41]" />
        <span>{title}</span>
      </div>
      <div className="mt-2 text-xs text-gray-500">
        Diện tích đất canh tác: <strong className="text-gray-900">{area} Héc-ta</strong> ({area * 10} công)
      </div>
      <input
        type="range"
        min="1"
        max="200"
        value={area}
        onChange={(e) => setArea(Number(e.target.value))}
        className="my-3 w-full accent-[#0A6B41]"
      />
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#F0F7F3] p-3 text-center">
        <div>
          <div className="text-base font-bold text-[#0A6B41]">{damBags} bao</div>
          <div className="text-[11px] text-gray-500">Đạm Cà Mau (N46.Plus)</div>
        </div>
        <div>
          <div className="text-base font-bold text-[#0A6B41]">{npkBags} bao</div>
          <div className="text-[11px] text-gray-500">NPK 20-20-15</div>
        </div>
        <div>
          <div className="text-base font-bold text-[#0A6B41]">{omBags} bao</div>
          <div className="text-[11px] text-gray-500">Organic OM</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-dashed border-gray-200 pt-3">
        <button
          onClick={() => onAction('share_zalo', `${title} (${area} Ha)`)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#0A6B41] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#005A36]"
        >
          <Share2 className="h-3.5 w-3.5" /> Gửi bảng tính qua Zalo / SMS
        </button>
        <button
          onClick={() => onAction('order_dealer', `${title} (${area} Ha)`)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#0A6B41] bg-white px-3 py-1.5 text-xs font-semibold text-[#0A6B41] transition hover:bg-[#F0F7F3]"
        >
          <Store className="h-3.5 w-3.5" /> Đặt mua qua Đại Lý
        </button>
      </div>
    </div>
  );
};
