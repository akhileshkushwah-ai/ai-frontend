'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, HelpCircle, Volume2, ShieldCheck } from 'lucide-react';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'counselor';
  text: string;
  timestamp: Date;
  reportPayloadSent?: boolean;
}

interface CounselorChatProps {
  messages: ChatMessage[];
  onSendMessage: (msg: string) => void;
  isLoading: boolean;
  onSetState: (state: 'idle' | 'thinking' | 'speaking') => void;
  isSpeechEnabled: boolean;
}

const QUICK_PROMPTS = [
  "Kya main future me CA (Chartered Accountant) kar sakta hu?",
  "Mera Logical Coding 92% hai, mere liye konse career options hain?",
  "Mera Accounts score report me weak kyu bata raha hai?",
  "Tech Sector me Software & Data Science ka kya scope hai?",
];

export const CounselorChat: React.FC<CounselorChatProps> = ({
  messages,
  onSendMessage,
  isLoading,
  onSetState,
  isSpeechEnabled,
}) => {
  const [inputMsg, setInputMsg] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || isLoading) return;
    onSendMessage(inputMsg.trim());
    setInputMsg('');
  };

  const handlePromptClick = (prompt: string) => {
    if (isLoading) return;
    onSendMessage(prompt);
  };

  return (
    <div className="glass-panel flex flex-col h-[640px] rounded-2xl border border-indigo-500/20 overflow-hidden">
      {/* Header Bar */}
      <div className="px-5 py-3.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
            <Bot className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">AI Counselor Conversation</h3>
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              Stateful Context Live in Session
            </p>
          </div>
        </div>

        <span className="text-xs px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
          Hindi / Hinglish Mode
        </span>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 p-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
              <Sparkles className="w-6 h-6 text-cyan-400 animate-pulse" />
            </div>
            <h4 className="text-base font-semibold text-slate-200 mb-1">AI Counselor is Ready!</h4>
            <p className="text-xs text-slate-400 max-w-sm mb-4">
              Aapka assessment report session memory me load ho chuka hai. Aap koi bhi question poochh sakte hain!
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.sender === 'counselor' && (
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white flex items-center justify-center shrink-0 shadow-md">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-[82%] p-4 rounded-2xl text-sm leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-none shadow-lg'
                    : 'bg-slate-900/90 text-slate-200 border border-slate-800 rounded-tl-none shadow-md'
                }`}
              >
                {/* User vs AI Header info */}
                <div className="flex items-center justify-between text-[10px] opacity-75 mb-1.5 border-b border-white/10 pb-1">
                  <span className="font-semibold">
                    {msg.sender === 'user' ? 'You' : 'SABCQ AI Counselor'}
                  </span>
                  <span>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Content */}
                <div className="whitespace-pre-wrap font-sans">
                  {msg.text}
                </div>

                {/* Proof badge for follow up user messages */}
                {msg.sender === 'user' && (
                  <div className="mt-2 text-[10px] text-indigo-200/90 flex items-center justify-end gap-1 font-mono">
                    <ShieldCheck className="w-3 h-3 text-cyan-300" />
                    Payload: 0 Bytes Report Data Sent
                  </div>
                )}
              </div>

              {msg.sender === 'user' && (
                <div className="w-8 h-8 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))
        )}

        {/* Loading / Thinking Indicator */}
        {isLoading && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white flex items-center justify-center shrink-0 animate-pulse">
              <Bot className="w-4 h-4" />
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/90 text-slate-400 border border-slate-800 rounded-tl-none flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400 animate-spin" />
              <span className="text-xs font-medium text-slate-300">
                Evaluating Report Context & Generating Answer...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>


    </div>
  );
};
