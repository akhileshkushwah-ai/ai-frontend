'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { Mic, MicOff, Send, PhoneOff, Sparkles, UserCheck, Wifi, Volume2, Radio } from 'lucide-react';
import { useGeminiLiveVoice } from '../hooks/useGeminiLiveVoice';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'counselor';
  text: string;
  timestamp: Date;
}

interface HumanCounselorRoomProps {
  messages: ChatMessage[];
  onSendMessage: (msg: string) => void;
  isLoading: boolean;
  counselorState: 'idle' | 'thinking' | 'speaking';
  onEndSession: () => void;
  studentName: string;
}

export const HumanCounselorRoom: React.FC<HumanCounselorRoomProps> = ({
  messages,
  onSendMessage,
  isLoading,
  counselorState: propsState,
  onEndSession,
  studentName,
}) => {
  const [inputText, setInputText] = useState('');
  const [mouthOpen, setMouthOpen] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Real-time Gemini Multimodal Live Voice-to-Voice Hook
  const {
    isLiveWsConnected,
    isMicActive,
    counselorState: liveState,
    startMicStream,
    stopMicStream,
    interruptAi,
  } = useGeminiLiveVoice();

  const counselorState = isLiveWsConnected ? liveState : propsState;
  const lastMessage = messages[messages.length - 1];

  // Video playback logic for ai_live_counc.mp4
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (counselorState === 'speaking') {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((error: any) => {
          if (error.name !== 'AbortError') {
            console.error('Video play error:', error);
          }
        });
      }
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [counselorState]);

  // Real-time lip sync animation
  useEffect(() => {
    if (counselorState !== 'speaking') {
      setMouthOpen(0);
      return;
    }

    let frameId: number;
    let time = 0;

    const animateMouth = () => {
      time += 0.15;
      const openRatio = Math.max(0, Math.sin(time * 8) * 0.6 + Math.cos(time * 14) * 0.4);
      setMouthOpen(openRatio);
      frameId = requestAnimationFrame(animateMouth);
    };

    frameId = requestAnimationFrame(animateMouth);
    return () => cancelAnimationFrame(frameId);
  }, [counselorState]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    if (counselorState === 'speaking') {
      interruptAi();
    }
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const toggleSpeechRecognition = async () => {
    if (counselorState === 'speaking') {
      interruptAi();
    }

    if (isMicActive) {
      stopMicStream();
    } else {
      await startMicStream();
    }
  };

  return (
    <div className="relative w-full max-w-5xl mx-auto h-[82vh] rounded-3xl overflow-hidden glass-panel border border-cyan-500/30 shadow-[0_0_100px_rgba(6,182,212,0.25)] flex flex-col justify-between bg-slate-950">
      
      {/* BACKGROUND HUMAN COUNSELOR VIDEO CONTAINER */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        
        {/* Animated Human Portrait Layer */}
        <div
          className={`relative w-full h-full transition-transform duration-700 ${
            counselorState === 'speaking'
              ? 'scale-105 animate-float'
              : counselorState === 'thinking'
              ? 'scale-102 contrast-105'
              : 'scale-100'
          }`}
        >
          <Image
            src="/ai_councleor.png"
            alt="Priya Sharma - Live Human AI Career Counselor"
            fill
            className={`object-cover object-center filter brightness-100 contrast-105 transition-opacity duration-300 ${counselorState === 'speaking' ? 'opacity-0' : 'opacity-100'}`}
            priority
          />
          <video
            ref={videoRef}
            src="/ai_councleor_video.mp4"
            loop
            muted
            playsInline
            className={`absolute inset-0 w-full h-full object-cover object-center filter brightness-100 contrast-105 transition-opacity duration-300 ${counselorState === 'speaking' ? 'opacity-100' : 'opacity-0'}`}
          />



          {/* Ambient Lighting & Atmosphere Gradient */}
          <div
            className={`absolute inset-0 transition-opacity duration-500 pointer-events-none ${
              counselorState === 'speaking'
                ? 'bg-gradient-to-t from-slate-950 via-cyan-950/10 to-emerald-950/20 opacity-60'
                : 'bg-gradient-to-t from-slate-950 via-slate-950/20 to-slate-950/40 opacity-80'
            }`}
          />
        </div>
      </div>

      {/* TOP HEADER BAR */}
      <div className="relative z-10 p-5 flex items-center justify-between">
        <div className="flex items-center gap-3 bg-slate-950/85 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 shadow-xl">
          <div className="relative flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping absolute" />
            <span className="w-3 h-3 rounded-full bg-emerald-400 relative" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-white tracking-wide flex items-center gap-1.5">
              Priya Sharma
              <UserCheck className="w-4 h-4 text-cyan-400" />
            </h2>
            <p className="text-[11px] text-slate-300">Senior AI Career Counselor • SABCQ</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3.5 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold backdrop-blur-md flex items-center gap-1.5 shadow">
            <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            HD 1-on-1 Video Session
          </span>

          <button
            onClick={onEndSession}
            className="p-2.5 rounded-2xl bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 border border-rose-500/30 transition-all backdrop-blur-md"
            title="End Session"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* CENTER STATUS VISUALIZER */}
      <div className="relative z-10 flex flex-col items-center justify-center p-6 text-center">


        {counselorState === 'thinking' && (
          <div className="flex items-center gap-2 bg-amber-500/20 backdrop-blur-md px-5 py-2.5 rounded-full border border-amber-500/40 text-amber-300 shadow-2xl">
            <Sparkles className="w-4 h-4 animate-spin text-amber-400" />
            <span className="text-xs font-bold tracking-wider uppercase">Evaluating Report Context...</span>
          </div>
        )}
      </div>

      {/* BOTTOM FLOATING VOICE INPUT BAR */}
      <div className="relative z-10 p-6 space-y-4">

        {/* Floating Voice & Chat Input Controls */}
        <form
          onSubmit={handleSubmit}
          className="flex items-center justify-center gap-3 bg-slate-950/90 backdrop-blur-xl p-3 rounded-2xl border border-white/10 max-w-sm mx-auto shadow-2xl"
        >
          {/* Talk with Voice Button */}
          <button
            type="button"
            onClick={toggleSpeechRecognition}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all shadow-lg shrink-0 ${
              isMicActive
                ? 'bg-rose-500 text-white animate-pulse shadow-rose-500/50 border border-rose-400'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
            }`}
          >
            {isMicActive ? <Radio className="w-4 h-4 text-white animate-spin" /> : <Mic className="w-4 h-4" />}
            <span>{isMicActive ? 'Live Streaming Mic...' : 'Live Voice (Mic)'}</span>
          </button>
        </form>

      </div>

    </div>
  );
};
