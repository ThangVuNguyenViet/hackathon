import React, { useState, useRef, useEffect } from 'react';
import { Sprout, MessageCircle, Send, Play, Loader2, Sparkles, FileText } from 'lucide-react';
import { FertilizerScheduleCard } from './components/FertilizerScheduleCard';
import { DosageCalculatorCard } from './components/DosageCalculatorCard';
import { DiagnosticProtocolCard } from './components/DiagnosticProtocolCard';
import { DealerLocatorCard } from './components/DealerLocatorCard';
import { ApprovalCard } from './components/ApprovalCard';

export interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  genUi?: any;
  approval?: {
    title: string;
    description: string;
    actionId: string;
    cardTitle: string;
    status: 'pending' | 'approved' | 'rejected';
  };
}

const DEMO_SCENARIOS = {
  1: {
    title: 'Kịch bản 1: Tư vấn quy trình lúa Hè Thu (5 Ha)',
    turns: [
      'Tư vấn quy trình lúa',
      'Lúa sạ 15 ngày, pH 4.5. Nhổ lúa lên rễ thâm đen. Bón Đạm Cà Mau vô liền được chưa?',
      'Cho xin lịch bón phân 3 đợt chuẩn phối hợp Organic OM Good, Đạm Cà Mau với NPK 20-20-15?',
      'Tui làm 5 héc-ta, tính tổng số ký và bao phân (50kg/bao) cho cả 3 đợt bón?',
    ],
  },
  2: {
    title: 'Kịch bản 2: Tính lượng phân bón Sầu Riêng',
    turns: [
      'Tính lượng phân bón',
      'Bộ đôi N46.Plus và NPK Gold này có ưu điểm gì?',
      'Liều lượng bón cho 2 Héc-ta sầu riêng nuôi trái thế nào?',
    ],
  },
  3: {
    title: 'Kịch bản 3: Chẩn đoán vàng lá thối rễ',
    turns: [
      'Chẩn đoán thối rễ',
      'Vĩnh Long mưa dầm bị thối rễ, giờ phải cứu vườn cam 1.5 Ha thế nào?',
    ],
  },
  4: {
    title: 'Kịch bản 4: Hẹn Kỹ sư đo pH & Tra cứu đại lý',
    turns: [
      'Hẹn Kỹ sư đo pH',
      'Tôi ở Cái Nước, Cà Mau, cho tra cứu đại lý chính hãng PVCFC gần nhất và hẹn kỹ sư?',
    ],
  },
};

export const App: React.FC = () => {
  const [route, setRoute] = useState<'chat' | 'demo'>(
    window.location.pathname === '/demo' ? 'demo' : 'chat'
  );
  const [responseMode, setResponseMode] = useState<'genui' | 'text'>('text');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg_welcome',
      role: 'bot',
      text: 'Xin chào, Phân Bón Cà Mau có thể giúp bạn tư vấn kỹ thuật bón phân và chăm sóc cây trồng ngay tại đây.',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeScenarioId, setActiveScenarioId] = useState<number>(1);
  const [demoMessages, setDemoMessages] = useState<ChatMessage[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const sessionIdRef = useRef<string>(`session_${Date.now()}`);
  const customerIdRef = useRef<string>(`cust_${Math.random().toString(36).slice(2, 9)}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, demoMessages, isLoading]);

  const callBackend = async (text: string, currentSessionId: string, currentCustId: string) => {
    const payload = {
      sessionId: `pvcfc:${currentSessionId}`,
      customerId: currentCustId,
      clientMessageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text,
      metadata: {
        responseProfile: responseMode === 'genui' ? 'genui' : 'social',
      },
    };

    const usesSameOriginApi =
      window.location.hostname === '165.154.229.65' ||
      window.location.hostname.endsWith('.pages.dev');
    const targetUrl = usesSameOriginApi
      ? '/chat/pvcfc/message'
      : 'http://165.154.229.65/chat/pvcfc/message';

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
      text: data.responseText || data.presentation?.text || '',
      genUi: data.presentation?.genUi || data.genUi || null,
    };
  };

  const handleSend = async (customText?: string) => {
    const text = (customText || inputText).trim();
    if (!text || isLoading) return;

    const userMsgId = `user_${Date.now()}`;
    const newMsg: ChatMessage = { id: userMsgId, role: 'user', text };

    setMessages((prev) => [...prev, newMsg]);
    if (!customText) setInputText('');
    setIsLoading(true);

    try {
      const resp = await callBackend(text, sessionIdRef.current, customerIdRef.current);
      const botMsg: ChatMessage = {
        id: `bot_${Date.now()}`,
        role: 'bot',
        text: resp.text,
        genUi: responseMode === 'genui' ? resp.genUi : null,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'bot',
          text: `⚠️ Lỗi kết nối AI: ${err.message || 'Không thể phản hồi'}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCardAction = (actionId: string, cardTitle: string) => {
    if (actionId === 'book_agronomist' || actionId === 'book_ph_test') {
      const approvalMsg: ChatMessage = {
        id: `approval_${Date.now()}`,
        role: 'bot',
        text: '',
        approval: {
          title: 'Cần bạn xác nhận',
          description: 'Cho phép PVCFC truyền dữ liệu và đặt lịch hẹn Kỹ sư Nông nghiệp xuống tận vườn kiểm tra pH đất.',
          actionId,
          cardTitle,
          status: 'pending',
        },
      };
      setMessages((prev) => [...prev, approvalMsg]);
      return;
    }

    const actionLabels: Record<string, string> = {
      schedule_reminder: 'Tôi muốn lập lịch nhắc bón phân tự động.',
      export_pdf: 'Cho tôi tải bản PDF lịch bón phân.',
      share_zalo: 'Cho tôi chia sẻ bảng tính bao phân qua Zalo.',
      order_dealer: 'Tôi muốn tìm đại lý gần nhất để đặt mua số lượng phân này.',
      download_protocol: 'Cho tôi xin tài liệu phác đồ cấp bách phục hồi bộ rễ.',
      call_hotline: 'Kết nối hotline 1800 888606 hỗ trợ.',
    };

    handleSend(actionLabels[actionId] || `Thực hiện thao tác: ${actionId}`);
  };

  const handleApprovalConfirm = (approved: boolean, msgId: string) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id === msgId && msg.approval) {
          return {
            ...msg,
            approval: {
              ...msg.approval,
              status: approved ? 'approved' : 'rejected',
            },
          };
        }
        return msg;
      })
    );

    if (approved) {
      handleSend('Đã xác nhận đặt lịch hẹn Kỹ sư PVCFC thăm vườn đo pH đất.');
    }
  };

  const runDemoReplay = async () => {
    if (isReplaying) return;
    setIsReplaying(true);
    setDemoMessages([]);

    const scenario = DEMO_SCENARIOS[activeScenarioId as keyof typeof DEMO_SCENARIOS];
    const demoSession = `pvcfc_demo_${activeScenarioId}_${Date.now()}`;
    const demoCust = `demo_cust_${activeScenarioId}`;

    for (const turnText of scenario.turns) {
      setDemoMessages((prev) => [
        ...prev,
        { id: `demo_user_${Date.now()}`, role: 'user', text: turnText },
      ]);

      try {
        const resp = await callBackend(turnText, demoSession, demoCust);
        setDemoMessages((prev) => [
          ...prev,
          {
            id: `demo_bot_${Date.now()}`,
            role: 'bot',
            text: resp.text,
            genUi: responseMode === 'genui' ? resp.genUi : null,
          },
        ]);
      } catch (err: any) {
        setDemoMessages((prev) => [
          ...prev,
          {
            id: `demo_err_${Date.now()}`,
            role: 'bot',
            text: `⚠️ Lỗi phát lại: ${err.message}`,
          },
        ]);
        break;
      }
      await new Promise((r) => setTimeout(r, 600));
    }

    setIsReplaying(false);
  };

  const renderGenUiComponent = (genUi: any) => {
    if (!genUi) return null;
    const data = genUi.data || genUi;
    const kind = data.type || genUi.widgetKind;

    switch (kind) {
      case 'FertilizerScheduleCard':
      case 'fertilizerSchedule':
        return (
          <FertilizerScheduleCard
            title={data.title || genUi.title || 'Lịch Bón Phân Cây Trồng'}
            stages={data.stages}
            onAction={handleCardAction}
          />
        );
      case 'DosageCalculatorCard':
      case 'dosageCalculator':
        return (
          <DosageCalculatorCard
            title={data.title || genUi.title || 'Bảng Tính Số Bao Phân Bón Cà Mau'}
            initialAreaHa={data.areaHa}
            onAction={handleCardAction}
          />
        );
      case 'DiagnosticProtocolCard':
      case 'diagnosticProtocol':
        return (
          <DiagnosticProtocolCard
            title={data.title || genUi.title || 'Phác Đồ Cấp Bách Phục Hồi Bộ Rễ'}
            warning={data.warning}
            steps={data.steps}
            onAction={handleCardAction}
          />
        );
      case 'DealerLocatorCard':
      case 'dealerLocator':
        return (
          <DealerLocatorCard
            title={data.title || genUi.title || 'Đại Lý Ủy Quyền & Đặt Lịch Kỹ Sư'}
            dealerName={data.dealerName}
            address={data.address}
            phone={data.phone}
            onAction={handleCardAction}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#F8FAF9]">
      {/* Top Header */}
      <header className="z-10 flex flex-col gap-2.5 border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex w-full items-center justify-between">
          <a href="#" className="flex items-center gap-3 no-underline" onClick={() => setRoute('chat')}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0A6B41] font-black text-white">
              PVCFC
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight text-[#0A6B41]">Phân Bón Cà Mau</h1>
              <p className="text-xs text-gray-500">Hạt Ngọc Mùa Vàng • Trợ Lý AI Nông Nghiệp</p>
            </div>
          </a>

          <div className="flex items-center gap-3.5">
            {/* Mode Toggle */}
            <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-1">
              <button
                onClick={() => setResponseMode('genui')}
                className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${
                  responseMode === 'genui'
                    ? 'bg-[#0A6B41] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Sparkles className="h-3 w-3" /> Generative UI
              </button>
              <button
                onClick={() => setResponseMode('text')}
                className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${
                  responseMode === 'text'
                    ? 'bg-[#0A6B41] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <FileText className="h-3 w-3" /> Text only
              </button>
            </div>

            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500">
              <MessageCircle className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Sub-nav Tabs */}
        <div className="flex items-center justify-between pt-0.5">
          <div className="flex gap-1.5">
            <button
              onClick={() => setRoute('chat')}
              className={`rounded-md border px-3.5 py-1 text-xs font-semibold transition ${
                route === 'chat'
                  ? 'border-[#0A6B41] bg-[#0A6B41] text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Trợ Lý
            </button>
            <button
              onClick={() => setRoute('demo')}
              className={`rounded-md border px-3.5 py-1 text-xs font-semibold transition ${
                route === 'demo'
                  ? 'border-[#0A6B41] bg-[#0A6B41] text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Replay
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      {route === 'chat' ? (
        <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col overflow-hidden border-x border-gray-200 bg-white">
          {/* Quick Suggestions Pills */}
          <div className="flex gap-2.5 overflow-x-auto border-b border-gray-200 bg-white px-6 py-3">
            {[
              'Tư vấn quy trình lúa',
              'Tính lượng phân bón',
              'Chẩn đoán thối rễ',
              'Hẹn Kỹ sư đo pH',
            ].map((pill) => (
              <button
                key={pill}
                onClick={() => handleSend(pill)}
                className="whitespace-nowrap rounded-md border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-800 transition hover:border-[#0A6B41] hover:bg-[#F0F7F3] hover:text-[#005A36]"
              >
                {pill}
              </button>
            ))}
          </div>

          {/* Transcript Messages */}
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex max-w-[700px] gap-3 ${
                  msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''
                }`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                    msg.role === 'user' ? 'bg-gray-500' : 'bg-[#0A6B41]'
                  }`}
                >
                  {msg.role === 'user' ? 'B' : <Sprout className="h-4 w-4" />}
                </div>
                <div className="flex flex-col">
                  {msg.text && (
                    <div
                      className={`rounded-xl px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-line ${
                        msg.role === 'user'
                          ? 'bg-[#0A6B41] text-white'
                          : 'border border-gray-200 bg-white text-gray-900 shadow-xs'
                      }`}
                    >
                      {msg.text}
                    </div>
                  )}

                  {msg.genUi && renderGenUiComponent(msg.genUi)}

                  {msg.approval && (
                    <ApprovalCard
                      title={msg.approval.title}
                      description={msg.approval.description}
                      actionId={msg.approval.actionId}
                      cardTitle={msg.approval.cardTitle}
                      status={msg.approval.status}
                      onConfirm={(approved) => handleApprovalConfirm(approved, msg.id)}
                    />
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0A6B41] text-white">
                  <Sprout className="h-4 w-4" />
                </div>
                <div className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 shadow-xs">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0A6B41]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0A6B41] [animation-delay:0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0A6B41] [animation-delay:0.4s]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Input Bar */}
          <div className="flex items-center gap-2.5 border-t border-gray-200 bg-white px-6 py-3.5">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Nhắn Phân Bón Cà Mau..."
              className="flex-1 rounded-lg border border-gray-200 bg-gray-100 px-4 py-3.5 text-sm text-gray-900 outline-none transition focus:border-[#0A6B41] focus:bg-white"
            />
            <button
              onClick={() => handleSend()}
              disabled={isLoading || !inputText.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#0A6B41] text-white transition hover:bg-[#005A36] disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </main>
      ) : (
        /* Demo Replay Showcase Layout */
        <main className="grid flex-1 grid-cols-[320px_1fr] overflow-hidden">
          <div className="flex flex-col gap-3 overflow-y-auto border-r border-gray-200 bg-white p-4.5">
            <div>
              <h2 className="text-base font-bold text-[#005A36]">Trình Chiếu Replay (/demo)</h2>
              <p className="text-xs text-gray-500">Chọn kịch bản mẫu và phát lại phiên AI trực tiếp:</p>
            </div>

            <div className="space-y-2.5">
              {Object.entries(DEMO_SCENARIOS).map(([idStr, sc]) => {
                const id = Number(idStr);
                const isActive = activeScenarioId === id;
                return (
                  <div
                    key={id}
                    onClick={() => setActiveScenarioId(id)}
                    className={`cursor-pointer rounded-lg border p-3 transition ${
                      isActive
                        ? 'border-[#0A6B41] bg-[#F0F7F3]'
                        : 'border-gray-200 bg-[#F8FAF9] hover:bg-gray-50'
                    }`}
                  >
                    <h3 className="text-xs font-bold text-[#005A36]">{sc.title}</h3>
                    <p className="mt-1 text-[11px] text-gray-500">{sc.turns[0]}</p>
                  </div>
                );
              })}
            </div>

            <button
              onClick={runDemoReplay}
              disabled={isReplaying}
              className="mt-auto flex w-full items-center justify-center gap-2 rounded-lg bg-[#0A6B41] py-2.5 text-xs font-semibold text-white transition hover:bg-[#005A36] disabled:opacity-50"
            >
              {isReplaying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Đang Phát Lại...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" /> Phát Lại Live AI Replay
                </>
              )}
            </button>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden bg-white">
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {demoMessages.length === 0 ? (
                <div className="py-12 text-center text-xs text-gray-500">
                  <Play className="mx-auto mb-2 h-7 w-7 text-[#0A6B41]" />
                  Nhấn nút <strong>"Phát Lại Live AI Replay"</strong> để gửi từng lượt câu hỏi kịch bản tới mô hình OpenAI.
                </div>
              ) : (
                demoMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex max-w-[700px] gap-3 ${
                      msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                        msg.role === 'user' ? 'bg-gray-500' : 'bg-[#0A6B41]'
                      }`}
                    >
                      {msg.role === 'user' ? 'B' : <Sprout className="h-4 w-4" />}
                    </div>
                    <div className="flex flex-col">
                      <div
                        className={`rounded-xl px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-line ${
                          msg.role === 'user'
                            ? 'bg-[#0A6B41] text-white'
                            : 'border border-gray-200 bg-white text-gray-900 shadow-xs'
                        }`}
                      >
                        {msg.text}
                      </div>
                      {msg.genUi && renderGenUiComponent(msg.genUi)}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-2.5 border-t border-gray-200 bg-white px-6 py-3.5">
              <input
                type="text"
                placeholder="Nhắn Phân Bón Cà Mau..."
                className="flex-1 rounded-lg border border-gray-200 bg-gray-100 px-4 py-3.5 text-sm text-gray-900 outline-none"
                disabled
              />
              <button disabled className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#0A6B41] text-white opacity-50">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </main>
      )}
    </div>
  );
};
