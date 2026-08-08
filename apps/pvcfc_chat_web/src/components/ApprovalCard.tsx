import React from 'react';
import { ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';

export interface ApprovalCardProps {
  title: string;
  description: string;
  actionId: string;
  cardTitle: string;
  onConfirm: (approved: boolean, actionId: string) => void;
  status?: 'pending' | 'approved' | 'rejected';
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({
  title,
  description,
  actionId,
  onConfirm,
  status = 'pending',
}) => {
  if (status === 'approved') {
    return (
      <div className="mt-3 rounded-xl border border-green-200 bg-green-50/50 p-3.5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold text-[#0A6B41]">
          <CheckCircle2 className="h-4 w-4 text-[#0A6B41]" />
          <span>Đã xác nhận gửi thông tin</span>
        </div>
        <p className="mt-1 text-xs text-gray-600">
          Cảm ơn bà con! Kỹ sư Nông nghiệp PVCFC sẽ liên hệ trực tiếp trong vòng 24h để xác nhận địa điểm đo pH đất.
        </p>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3.5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold text-gray-600">
          <XCircle className="h-4 w-4 text-gray-500" />
          <span>Đã hủy thao tác</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Thao tác đăng ký đã được hủy theo yêu cầu.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border-1.5 border-[#DAA520] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold text-[#005A36]">
        <ShieldAlert className="h-4 w-4 text-[#DAA520]" />
        <span>{title}</span>
      </div>
      <p className="mt-1.5 text-xs text-gray-600">{description}</p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onConfirm(true, actionId)}
          className="rounded-md bg-[#0A6B41] px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#005A36]"
        >
          Đồng ý gửi
        </button>
        <button
          onClick={() => onConfirm(false, actionId)}
          className="rounded-md border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
        >
          Không đồng ý
        </button>
      </div>
    </div>
  );
};
