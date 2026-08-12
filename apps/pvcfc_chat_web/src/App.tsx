import React, { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Play, Send, Sprout } from "lucide-react";
import { PVCFC_DEMO_SCENARIOS, PVCFC_SUGGESTION_PILLS } from "./demoScenarios";

export interface ChatMessage {
  id: string;
  role: "user" | "bot";
  text: string;
}

export const App: React.FC = () => {
  const [route, setRoute] = useState<"chat" | "demo">(
    window.location.pathname === "/demo" ? "demo" : "chat",
  );
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "msg_welcome",
      role: "bot",
      text: "Xin chào. Trợ lý Phân Bón Cà Mau có thể tra cứu dữ liệu công khai về sản phẩm, tài liệu, đại lý và hoạt động PVCFC, kèm nguồn để bạn kiểm chứng.",
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeScenarioId, setActiveScenarioId] = useState<string>(
    PVCFC_DEMO_SCENARIOS[0]?.id ?? "exact-product",
  );
  const [demoMessages, setDemoMessages] = useState<ChatMessage[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const sessionIdRef = useRef<string>(`session_${Date.now()}`);
  const customerIdRef = useRef<string>(
    `cust_${Math.random().toString(36).slice(2, 9)}`,
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, demoMessages, isLoading]);

  const callBackend = async (
    text: string,
    currentSessionId: string,
    currentCustId: string,
  ) => {
    const payload = {
      sessionId: `pvcfc:${currentSessionId}`,
      customerId: currentCustId,
      clientMessageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text,
    };

    const usesSameOriginApi =
      window.location.hostname === "165.154.229.65" ||
      window.location.hostname.endsWith(".pages.dev");
    const targetUrl = usesSameOriginApi
      ? "/chat/pvcfc/message"
      : "http://165.154.229.65/chat/pvcfc/message";

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorBody = (await res.json().catch(() => ({}))) as {
        message?: string;
      };
      throw new Error(errorBody.message || `HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      responseText?: string;
      presentation?: { text?: string };
    };
    return data.responseText || data.presentation?.text || "";
  };

  const handleSend = async (customText?: string) => {
    const text = (customText || inputText).trim();
    if (!text || isLoading) return;

    const userMsgId = `user_${Date.now()}`;
    const newMsg: ChatMessage = { id: userMsgId, role: "user", text };

    setMessages((prev) => [...prev, newMsg]);
    if (!customText) setInputText("");
    setIsLoading(true);

    try {
      const responseText = await callBackend(
        text,
        sessionIdRef.current,
        customerIdRef.current,
      );
      const botMsg: ChatMessage = {
        id: `bot_${Date.now()}`,
        role: "bot",
        text: responseText,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (error: unknown) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: "bot",
          text: `⚠️ Lỗi kết nối AI: ${
            error instanceof Error ? error.message : "Không thể phản hồi"
          }`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const runDemoReplay = async () => {
    if (isReplaying) return;
    setIsReplaying(true);
    setDemoMessages([]);

    const scenario = PVCFC_DEMO_SCENARIOS.find(
      ({ id }) => id === activeScenarioId,
    );
    if (!scenario) {
      setIsReplaying(false);
      return;
    }
    const demoSession = `pvcfc_demo_${activeScenarioId}_${Date.now()}`;
    const demoCust = `demo_cust_${activeScenarioId}`;

    for (const turnText of scenario.turns) {
      setDemoMessages((prev) => [
        ...prev,
        { id: `demo_user_${Date.now()}`, role: "user", text: turnText },
      ]);

      try {
        const responseText = await callBackend(turnText, demoSession, demoCust);
        setDemoMessages((prev) => [
          ...prev,
          {
            id: `demo_bot_${Date.now()}`,
            role: "bot",
            text: responseText,
          },
        ]);
      } catch (error: unknown) {
        setDemoMessages((prev) => [
          ...prev,
          {
            id: `demo_err_${Date.now()}`,
            role: "bot",
            text: `⚠️ Lỗi phát lại: ${
              error instanceof Error ? error.message : "Không thể phản hồi"
            }`,
          },
        ]);
        break;
      }
      await new Promise((r) => setTimeout(r, 600));
    }

    setIsReplaying(false);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#F8FAF9]">
      {/* Top Header */}
      <header className="z-10 flex flex-col gap-2.5 border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex w-full items-center justify-between">
          <a
            href="#"
            className="flex items-center gap-3 no-underline"
            onClick={() => setRoute("chat")}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0A6B41] font-black text-white">
              PVCFC
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight text-[#0A6B41]">
                Phân Bón Cà Mau
              </h1>
              <p className="text-xs text-gray-500">
                Hạt Ngọc Mùa Vàng • Trợ Lý AI Nông Nghiệp
              </p>
            </div>
          </a>

          <div className="flex items-center gap-3.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500">
              <MessageCircle className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Sub-nav Tabs */}
        <div className="flex items-center justify-between pt-0.5">
          <div className="flex gap-1.5">
            <button
              onClick={() => setRoute("chat")}
              className={`rounded-md border px-3.5 py-1 text-xs font-semibold transition ${
                route === "chat"
                  ? "border-[#0A6B41] bg-[#0A6B41] text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Trợ Lý
            </button>
            <button
              onClick={() => setRoute("demo")}
              className={`rounded-md border px-3.5 py-1 text-xs font-semibold transition ${
                route === "demo"
                  ? "border-[#0A6B41] bg-[#0A6B41] text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Replay
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      {route === "chat" ? (
        <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col overflow-hidden border-x border-gray-200 bg-white">
          {/* Quick Suggestions Pills */}
          <div className="flex gap-2.5 overflow-x-auto border-b border-gray-200 bg-white px-6 py-3">
            {PVCFC_SUGGESTION_PILLS.map((pill) => (
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
                  msg.role === "user" ? "ml-auto flex-row-reverse" : ""
                }`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                    msg.role === "user" ? "bg-gray-500" : "bg-[#0A6B41]"
                  }`}
                >
                  {msg.role === "user" ? "B" : <Sprout className="h-4 w-4" />}
                </div>
                <div
                  className={`rounded-xl px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-line ${
                    msg.role === "user"
                      ? "bg-[#0A6B41] text-white"
                      : "border border-gray-200 bg-white text-gray-900 shadow-xs"
                  }`}
                >
                  {msg.text}
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
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
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
              <h2 className="text-base font-bold text-[#005A36]">
                Trình Chiếu Replay (/demo)
              </h2>
              <p className="text-xs text-gray-500">
                Chọn kịch bản mẫu và phát lại phiên AI trực tiếp:
              </p>
            </div>

            <div className="space-y-2.5">
              {PVCFC_DEMO_SCENARIOS.map((scenario) => {
                const isActive = activeScenarioId === scenario.id;
                return (
                  <div
                    key={scenario.id}
                    onClick={() => setActiveScenarioId(scenario.id)}
                    className={`cursor-pointer rounded-lg border p-3 transition ${
                      isActive
                        ? "border-[#0A6B41] bg-[#F0F7F3]"
                        : "border-gray-200 bg-[#F8FAF9] hover:bg-gray-50"
                    }`}
                  >
                    <h3 className="text-xs font-bold text-[#005A36]">
                      {scenario.title}
                    </h3>
                    <p className="mt-1 text-[11px] font-semibold text-[#0A6B41]">
                      {scenario.evidenceMode === "provider"
                        ? "Dữ liệu PVCFC đã kiểm kê"
                        : "Cần TinyFish để kiểm tra web trực tiếp"}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {scenario.turns[0]}
                    </p>
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
                  <Play className="h-4 w-4" /> Phát Lại Kịch Bản
                </>
              )}
            </button>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden bg-white">
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {demoMessages.length === 0 ? (
                <div className="py-12 text-center text-xs text-gray-500">
                  <Play className="mx-auto mb-2 h-7 w-7 text-[#0A6B41]" />
                  Nhấn nút <strong>"Phát Lại Kịch Bản"</strong> để gửi từng lượt
                  câu hỏi tới trợ lý LangChain.
                </div>
              ) : (
                demoMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex max-w-[700px] gap-3 ${
                      msg.role === "user" ? "ml-auto flex-row-reverse" : ""
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                        msg.role === "user" ? "bg-gray-500" : "bg-[#0A6B41]"
                      }`}
                    >
                      {msg.role === "user" ? (
                        "B"
                      ) : (
                        <Sprout className="h-4 w-4" />
                      )}
                    </div>
                    <div
                      className={`rounded-xl px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-line ${
                        msg.role === "user"
                          ? "bg-[#0A6B41] text-white"
                          : "border border-gray-200 bg-white text-gray-900 shadow-xs"
                      }`}
                    >
                      {msg.text}
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
              <button
                disabled
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#0A6B41] text-white opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </main>
      )}
    </div>
  );
};
