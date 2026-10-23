import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, ArrowRight, AlertCircle } from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  suggestedAction?: string;
  isError?: boolean;
  timestamp: string;
}

interface AiAssistantTabProps {
  siteId: string;
  siteName: string;
}

const SUGGESTED_QUESTIONS = [
  'Why is my internet slow?',
  'Is anything wrong right now?',
  'Which devices are offline?',
];

const AI_UNAVAILABLE_MESSAGE =
  "The AI assistant isn't available right now. Your network data is still up to date.";

const AI_BUSY_MESSAGE =
  'The AI assistant is busy right now. Please try again in a minute.';

export const AiAssistantTab: React.FC<AiAssistantTabProps> = ({ siteId, siteName }) => {
  const [messagesBySite, setMessagesBySite] = useState<Record<string, ChatMessage[]>>({});
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [unavailableBanner, setUnavailableBanner] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const currentMessages = messagesBySite[siteId] || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages.length, isSending, siteId]);

  const sendQuestion = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (!trimmed || isSending || !siteId) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const existingList = messagesBySite[siteId] || [];
    const nextHistory = [...existingList, userMsg];

    setMessagesBySite((prev) => ({
      ...prev,
      [siteId]: nextHistory,
    }));
    setInputValue('');
    setIsSending(true);
    setUnavailableBanner(null);

    try {
      const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          history: existingList.map((m) => ({
            role: m.role,
            text: m.text,
          })),
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await res.json().catch(() => null)
        : null;

      if (!res.ok || !data || data.aiAvailable === false) {
        const fallbackMsg =
          data?.error?.message ||
          (res.status === 503 || res.status === 504 ? AI_BUSY_MESSAGE : AI_UNAVAILABLE_MESSAGE);
        setUnavailableBanner(fallbackMsg);
        const errorReply: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: fallbackMsg,
          isError: true,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessagesBySite((prev) => ({
          ...prev,
          [siteId]: [...(prev[siteId] || []), errorReply],
        }));
        return;
      }

      const assistantReply: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: data.answer,
        suggestedAction: data.suggestedAction,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessagesBySite((prev) => ({
        ...prev,
        [siteId]: [...(prev[siteId] || []), assistantReply],
      }));
    } catch (_err) {
      setUnavailableBanner(AI_BUSY_MESSAGE);
      const errorReply: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: AI_BUSY_MESSAGE,
        isError: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessagesBySite((prev) => ({
        ...prev,
        [siteId]: [...(prev[siteId] || []), errorReply],
      }));
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendQuestion(inputValue);
  };

  return (
    <div className="glass-panel p-6 sm:p-8 flex-1 flex flex-col overflow-hidden">
      {/* Top context header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-black/[0.05] shrink-0">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: 'var(--accent-mint)' }}
            />
            <span className="font-semibold text-slate-700">Active location: {siteName}</span>
            <span aria-hidden="true">·</span>
            <span>Plain-English site assistant</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-2">
            AI assistant
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Ask a question about {siteName} in plain words. Answers use only your current network summary.
          </p>
        </div>
      </div>

      {/* Fallback notice when Gemini fails or times out */}
      {unavailableBanner && (
        <div className="mt-4 rounded-2xl bg-amber-50/90 border border-amber-200 px-4 py-3 flex items-center gap-3 text-xs sm:text-sm text-amber-900 shrink-0">
          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
          <span>{unavailableBanner}</span>
        </div>
      )}

      {/* Suggested questions bar */}
      <div className="pt-4 pb-3 shrink-0">
        <div className="text-xs font-semibold text-slate-500 mb-2">
          Suggested questions
        </div>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={isSending}
              onClick={() => void sendQuestion(q)}
              className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium text-slate-700 bg-white/75 hover:bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <span>{q}</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </button>
          ))}
        </div>
      </div>

      {/* Chat message area */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-[260px]">
        {currentMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 bg-white/50 rounded-2xl border border-black/[0.05]">
            <div className="w-11 h-11 rounded-2xl bg-white border border-slate-200/80 flex items-center justify-center text-teal-600 shadow-2xs mb-3">
              <MessageSquare className="w-5 h-5" />
            </div>
            <h2 className="text-base font-bold text-slate-800">
              Ask about {siteName}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mt-1 leading-relaxed">
              Pick one of the suggested questions above or type your own question below to get a plain-English answer and one suggested action.
            </p>
          </div>
        ) : (
          currentMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-2xl rounded-2xl p-4 sm:p-5 shadow-2xs ${
                  msg.role === 'user'
                    ? 'bg-[#0B4FA8] text-white'
                    : msg.isError
                      ? 'bg-amber-50/90 border border-amber-200 text-slate-800'
                      : 'bg-white/85 border border-black/[0.06] text-slate-800'
                }`}
              >
                <p className="text-xs sm:text-sm leading-relaxed">
                  {msg.text}
                </p>

                {msg.role === 'assistant' && msg.suggestedAction && !msg.isError && (
                  <div className="mt-3 pt-3 border-t border-black/[0.07] space-y-1">
                    <div className="text-xs font-bold text-slate-900">
                      Suggested action
                    </div>
                    <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                      {msg.suggestedAction}
                    </p>
                    <p className="text-[11px] text-slate-500 pt-1">
                      Suggested by AI. Check before acting.
                    </p>
                  </div>
                )}
              </div>

              <span className="text-[11px] text-slate-400 mt-1 px-1">
                {msg.role === 'user' ? 'You' : 'SignalBloom assistant'} · {msg.timestamp}
              </span>
            </div>
          ))
        )}

        {isSending && (
          <div className="flex items-start">
            <div className="bg-white/80 border border-black/[0.06] rounded-2xl px-4 py-3 shadow-2xs flex items-center gap-2.5 text-xs sm:text-sm text-slate-600">
              <div className="w-4 h-4 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
              <span>Checking your site summary...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Chat input form */}
      <form
        onSubmit={handleSubmit}
        className="pt-3 border-t border-black/[0.06] flex items-center gap-2.5 shrink-0"
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={`Ask a question about ${siteName}...`}
          disabled={isSending}
          className="flex-1 bg-white/85 focus:bg-white border border-slate-200 focus:border-teal-600 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 outline-none transition-all shadow-2xs"
        />
        <button
          type="submit"
          disabled={isSending || !inputValue.trim()}
          className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-white flex items-center gap-2 shadow-xs transition-all disabled:opacity-50 cursor-pointer"
          style={{ background: 'var(--accent-blue)' }}
        >
          <span>Ask</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
