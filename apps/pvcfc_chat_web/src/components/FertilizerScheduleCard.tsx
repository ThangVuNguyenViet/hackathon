import React from 'react';
import { CalendarCheck, Bell, FileDown } from 'lucide-react';

export interface Stage {
  name: string;
  timing: string;
  dosage: string;
}

export interface FertilizerScheduleProps {
  title: string;
  stages: Stage[];
  onAction: (actionId: string, cardTitle: string) => void;
}

export const FertilizerScheduleCard: React.FC<FertilizerScheduleProps> = ({
  title,
  stages = [],
  onAction,
}) => {
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-bold text-[#005A36]">
        <CalendarCheck className="h-4 w-4 text-[#DAA520]" />
        <span>{title}</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-[#F0F7F3] text-[#005A36]">
              <th className="p-2 font-semibold">Đợt Bón</th>
              <th className="p-2 font-semibold">Thời Gian</th>
              <th className="p-2 font-semibold">Liều Lượng & Phân Bón</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {stages.map((stage, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="p-2 font-medium text-[#111827]">{stage.name}</td>
                <td className="p-2 text-gray-600">{stage.timing}</td>
                <td className="p-2 text-gray-800">{stage.dosage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-dashed border-gray-200 pt-3">
        <button
          onClick={() => onAction('schedule_reminder', title)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#0A6B41] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#005A36]"
        >
          <Bell className="h-3.5 w-3.5" /> Lập lịch nhắc bón phân
        </button>
        <button
          onClick={() => onAction('export_pdf', title)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#0A6B41] bg-white px-3 py-1.5 text-xs font-semibold text-[#0A6B41] transition hover:bg-[#F0F7F3]"
        >
          <FileDown className="h-3.5 w-3.5" /> Tải lịch PDF
        </button>
      </div>
    </div>
  );
};
