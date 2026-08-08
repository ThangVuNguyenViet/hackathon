import React from 'react';
import { AlertTriangle, UserCheck, Download } from 'lucide-react';

export interface DiagnosticProtocolProps {
  title: string;
  warning?: string;
  steps?: string[];
  onAction: (actionId: string, cardTitle: string) => void;
}

export const DiagnosticProtocolCard: React.FC<DiagnosticProtocolProps> = ({
  title,
  warning = 'Ngưng ngay đạm hóa học khi rễ bị thối đen!',
  steps = [],
  onAction,
}) => {
  return (
    <div className="mt-3 rounded-xl border border-red-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-bold text-red-700">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        <span>{title}</span>
      </div>
      <div className="mt-2.5 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
        ⚠️ <strong>Cảnh báo khẩn:</strong> {warning}
      </div>
      <div className="mt-2.5 space-y-1 text-xs leading-relaxed text-gray-800">
        {steps.map((step, idx) => (
          <div key={idx} className="flex items-start gap-1.5">
            <span className="font-bold text-[#0A6B41]">•</span>
            <span>{step}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-dashed border-gray-200 pt-3">
        <button
          onClick={() => onAction('book_agronomist', title)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#0A6B41] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#005A36]"
        >
          <UserCheck className="h-3.5 w-3.5" /> Hẹn Kỹ sư PVCFC thăm vườn
        </button>
        <button
          onClick={() => onAction('download_protocol', title)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#0A6B41] bg-white px-3 py-1.5 text-xs font-semibold text-[#0A6B41] transition hover:bg-[#F0F7F3]"
        >
          <Download className="h-3.5 w-3.5" /> Tải phác đồ điều trị
        </button>
      </div>
    </div>
  );
};
