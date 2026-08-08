import React from 'react';
import { Store, Phone, TestTube } from 'lucide-react';

export interface DealerLocatorProps {
  title: string;
  dealerName?: string;
  address?: string;
  phone?: string;
  onAction: (actionId: string, cardTitle: string) => void;
}

export const DealerLocatorCard: React.FC<DealerLocatorProps> = ({
  title,
  dealerName = 'Đại Lý Voi Vàng (Tư Hải)',
  address = 'QL1A, Thị trấn Cái Nước, H. Cái Nước, Cà Mau',
  phone = '1800 888606',
  onAction,
}) => {
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-bold text-[#005A36]">
        <Store className="h-4 w-4 text-[#0A6B41]" />
        <span>{title}</span>
      </div>
      <div className="mt-2.5 rounded-lg bg-[#F0F7F3] p-3 text-xs leading-relaxed">
        <div className="font-bold text-[#005A36]">📍 {dealerName}</div>
        <div className="text-gray-600">Địa chỉ: {address}</div>
        <div className="text-gray-800">📞 Hotline đại lý: <strong className="text-[#0A6B41]">{phone}</strong></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-dashed border-gray-200 pt-3">
        <button
          onClick={() => onAction('book_ph_test', `${dealerName}`)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#0A6B41] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#005A36]"
        >
          <TestTube className="h-3.5 w-3.5" /> Đặt lịch đo pH đất miễn phí
        </button>
        <button
          onClick={() => onAction('call_hotline', `${dealerName}`)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#0A6B41] bg-white px-3 py-1.5 text-xs font-semibold text-[#0A6B41] transition hover:bg-[#F0F7F3]"
        >
          <Phone className="h-3.5 w-3.5" /> Gọi Hotline 1800 888606
        </button>
      </div>
    </div>
  );
};
