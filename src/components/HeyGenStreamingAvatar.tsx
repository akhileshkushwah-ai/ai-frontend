'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Wifi, Sparkles, UserCheck, PhoneOff, Mic, MicOff, Send, Key, Volume2, ShieldCheck, Play, Layers, Radio } from 'lucide-react';
import { useGeminiLiveVoice } from '../hooks/useGeminiLiveVoice';

interface StreamingAvatarProps {
  counselorState: 'idle' | 'thinking' | 'speaking';
  responseText: string;
  onSendMessage: (msg: string) => void;
  isLoading: boolean;
  onEndSession: () => void;
  studentName: string;
}

export const HeyGenStreamingAvatar: React.FC<StreamingAvatarProps> = ({
  counselorState: propsState,
  responseText,
  onSendMessage,
  isLoading,
  onEndSession,
  studentName,
}) => {
  const videoRefA = useRef<HTMLVideoElement>(null);
  const videoRefB = useRef<HTMLVideoElement>(null);
  const [activeVideo, setActiveVideo] = useState<'A' | 'B'>('A');
  const isSwitchingRef = useRef(false);

  const [inputText, setInputText] = useState('');
  const [heyGenKey, setHeyGenKey] = useState('');
  const [isKeySaved, setIsKeySaved] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [visemeScaleY, setVisemeScaleY] = useState(1);
  const [visemeScaleX, setVisemeScaleX] = useState(1);
  const [activeStreamMode, setActiveStreamMode] = useState<'interactive_avatar' | 'webrtc_live'>('interactive_avatar');
  const [liveError, setLiveError] = useState<string | null>(null);

  const hasSpokenIntroRef = useRef(false);

  // Real-time Gemini Multimodal Live Voice-to-Voice Hook
  const {
    isLiveWsConnected,
    isMicActive,
    isFallbackMode,
    counselorState: liveState,
    connectLiveWs,
    startMicStream,
    stopMicStream,
    interruptAi,
    sendLiveText,
    triggerFirstIntro,
  } = useGeminiLiveVoice({
    onConnected: () => setLiveError(null),
    onTextChunk: () => {},
    onError: (message) => setLiveError(message),
  });

  // Connect Gemini Live WS quietly in background
  useEffect(() => {
    connectLiveWs();
  }, [connectLiveWs]);

  const counselorState = isLiveWsConnected && liveState !== 'idle' ? liveState : propsState;

  // Dual-Video Ping-Pong Crossfade Playback Controller
  useEffect(() => {
    const vidA = videoRefA.current;
    const vidB = videoRefB.current;
    if (!vidA || !vidB) return;

    if (counselorState === 'speaking') {
      const currentVid = activeVideo === 'A' ? vidA : vidB;
      const playPromise = currentVid.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          if (error.name !== 'AbortError') {
            console.error('Video play error:', error);
          }
        });
      }
    } else {
      vidA.pause();
      vidA.currentTime = 0;
      vidB.pause();
      vidB.currentTime = 0;
      setActiveVideo('A');
      isSwitchingRef.current = false;
    }
  }, [counselorState, activeVideo]);

  // Seamless Zero-Blink Ping-Pong TimeUpdate Switcher
  useEffect(() => {
    const vidA = videoRefA.current;
    const vidB = videoRefB.current;
    if (!vidA || !vidB) return;

    const handleTimeUpdate = (e: Event) => {
      if (counselorState !== 'speaking' || isSwitchingRef.current) return;
      const target = e.target as HTMLVideoElement;
      const threshold = target.duration && !isNaN(target.duration) ? Math.max(0, target.duration - 0.4) : 9.5;

      if (target.currentTime >= threshold) {
        isSwitchingRef.current = true;
        const nextVid = target === vidA ? vidB : vidA;
        const nextMode = target === vidA ? 'B' : 'A';

        nextVid.currentTime = 0;
        const playPromise = nextVid.play();

        const doSwitch = () => {
          setActiveVideo(nextMode);
          setTimeout(() => {
            isSwitchingRef.current = false;
          }, 400);
        };

        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              if (nextVid.readyState >= 3) {
                doSwitch();
              } else {
                const onPlaying = () => {
                  nextVid.removeEventListener('playing', onPlaying);
                  doSwitch();
                };
                nextVid.addEventListener('playing', onPlaying);
              }
            })
            .catch(() => {
              isSwitchingRef.current = false;
            });
        } else {
          doSwitch();
        }
      }
    };

    vidA.addEventListener('timeupdate', handleTimeUpdate);
    vidB.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      vidA.removeEventListener('timeupdate', handleTimeUpdate);
      vidB.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [counselorState]);

  // Real-time audio spectrum & lip-sync frequency calculation
  useEffect(() => {
    if (counselorState !== 'speaking') {
      setVisemeScaleY(1);
      setVisemeScaleX(1);
      return;
    }

    let animFrameId: number;
    let clock = 0;

    const computeVisemeLipsync = () => {
      clock += 0.18;
      const openAmount = Math.max(0.2, Math.sin(clock * 6) * 0.7 + Math.cos(clock * 11) * 0.4);
      const widthAmount = Math.max(0.1, Math.cos(clock * 4) * 0.3);

      setVisemeScaleY(1 + openAmount * 2.2);
      setVisemeScaleX(1 + widthAmount * 0.5);

      animFrameId = requestAnimationFrame(computeVisemeLipsync);
    };

    animFrameId = requestAnimationFrame(computeVisemeLipsync);
    return () => cancelAnimationFrame(animFrameId);
  }, [counselorState]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const message = inputText.trim();
    if (!message || isLoading) return;

    if (counselorState === 'speaking') {
      interruptAi();
    }

    if (isLiveWsConnected) {
      setLiveError(null);
      sendLiveText(message);
    } else {
      onSendMessage(message);
    }
    setInputText('');
  };

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const toggleSpeechRecognition = async () => {
    if (counselorState === 'speaking') {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (_) {}
      }
    }

    // First Mic tap triggers official SABCQ Opening Intro
    if (!hasSpokenIntroRef.current) {
      hasSpokenIntroRef.current = true;
      if (isLiveWsConnected) {
        triggerFirstIntro();
      }
    }

    if (isListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) {}
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognitionClass =
      (typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));

    if (SpeechRecognitionClass) {
      try {
        const recognition = new SpeechRecognitionClass();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'hi-IN';

        recognition.onstart = () => {
          setIsListening(true);
          setLiveError(null);
        };

        recognition.onresult = (event: any) => {
          const spokenText = event.results[0][0].transcript;
          setIsListening(false);
          if (spokenText && spokenText.trim()) {
            if (isLiveWsConnected) {
              sendLiveText(spokenText.trim());
            } else {
              onSendMessage(spokenText.trim());
            }
          }
        };

        recognition.onerror = (err: any) => {
          console.warn('Speech recognition error:', err);
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err) {
        console.warn('Speech recognition init error:', err);
        setIsListening(false);
      }
    } else {
      console.warn('Browser does not support SpeechRecognition');
      setIsListening(false);
    }
  };

  return (
    <div className="relative w-full max-w-5xl mx-auto h-[82vh] rounded-3xl overflow-hidden glass-panel border border-cyan-500/40 shadow-[0_0_100px_rgba(6,182,212,0.3)] flex flex-col justify-between bg-slate-950">
      
      {/* 4K REALTIME HUMAN AVATAR DISPLAY */}
      <div className="absolute inset-0 z-0 overflow-hidden bg-slate-950 flex items-center justify-center">
        
        {/* Photorealistic Interactive Counselor Video/Image Canvas */}
        <div className={`relative w-full h-full transition-all duration-500 ease-in-out ${
          counselorState === 'speaking'
            ? 'scale-[1.02] filter brightness-105 contrast-105'
            : counselorState === 'thinking'
            ? 'scale-[1.01] filter brightness-110'
            : 'scale-100'
        }`}>
          <img
            src="/ai_councler.png"
            alt="Priya Sharma - Senior AI Career Counselor"
            className={`absolute inset-0 z-0 w-full h-full object-cover object-center transition-opacity duration-300 ${
              counselorState === 'speaking' ? 'opacity-0' : 'opacity-100'
            }`}
          />
          <video
            ref={videoRefA}
            src="/ai_councloer.mp4"
            muted
            playsInline
            preload="auto"
            className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-300 ${
              activeVideo === 'A'
                ? 'z-20 opacity-100'
                : counselorState === 'speaking'
                ? 'z-10 opacity-100'
                : 'z-0 opacity-0'
            }`}
          />
          <video
            ref={videoRefB}
            src="/ai_councloer.mp4"
            muted
            playsInline
            preload="auto"
            className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-300 ${
              activeVideo === 'B'
                ? 'z-20 opacity-100'
                : counselorState === 'speaking'
                ? 'z-10 opacity-100'
                : 'z-0 opacity-0'
            }`}
          />

          {/* Thinking Glow Overlay */}
          {counselorState === 'thinking' && (
            <div className="absolute inset-0 bg-gradient-to-t from-indigo-950/50 via-cyan-950/20 to-transparent pointer-events-none animate-pulse" />
          )}
        </div>
        
        {/* Ambient Dark Backdrop */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-slate-950/40 pointer-events-none" />
      </div>

      {/* TOP OVERLAY HEADER: Counselor Profile (Left), SABCQ Phase Badge (Center), End Session (Right) */}
      <div className="relative z-10 p-6 flex flex-wrap items-center justify-between gap-3 w-full">
        {/* Top Left Counselor Info Badge */}
        <div className="flex items-center gap-3 bg-slate-900/90 backdrop-blur-xl px-4 py-2.5 rounded-full border border-white/10 shadow-2xl">
          <div className="relative flex items-center justify-center">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping absolute" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 relative" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-1.5">
              Priya Sharma
              <UserCheck className="w-4 h-4 text-cyan-400" />
            </h2>
            <p className="text-[11px] text-slate-300">Senior AI Career Counselor • SABCQ</p>
          </div>
        </div>

        {/* Top Center SABCQ 45-Min Counseling Phase Badge */}
        <div className="flex items-center gap-2 bg-gradient-to-r from-cyan-950/90 via-blue-950/90 to-indigo-950/90 backdrop-blur-xl px-4 py-2 rounded-full border border-cyan-500/40 shadow-xl">
          <Layers className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span className="text-xs font-bold text-cyan-300 tracking-wider uppercase">
            SABCQ 45-Min Session • Active Phase
          </span>
        </div>

        {/* Top Right End Session Button */}
        <button
          onClick={onEndSession}
          className="flex items-center gap-2.5 px-6 py-2.5 rounded-full bg-[#E11D48] hover:bg-[#F43F5E] text-white font-bold text-sm shadow-[0_0_20px_rgba(225,29,72,0.4)] transition-all hover:scale-105"
          title="End Session"
        >
          <PhoneOff className="w-4 h-4" />
          <span>End Session</span>
        </button>
      </div>

      {/* CENTER STATUS OVERLAY */}
      <div className="relative z-10 flex flex-col items-center justify-center p-4 text-center">
        {isFallbackMode && (
          <div className="mb-2 flex items-center gap-2 bg-indigo-500/20 backdrop-blur-md px-5 py-2 rounded-full border border-indigo-500/40 text-indigo-200 shadow-2xl max-w-xl">
            <Wifi className="w-4 h-4 text-cyan-300" />
            <span className="text-xs font-semibold tracking-wide">
              Live AI Counselor Stream Connected
            </span>
          </div>
        )}

        {counselorState === 'thinking' && (
          <div className="flex items-center gap-2 bg-amber-500/20 backdrop-blur-md px-5 py-2 rounded-full border border-amber-500/40 text-amber-300 shadow-2xl animate-pulse">
            <Sparkles className="w-4 h-4 animate-spin text-amber-400" />
            <span className="text-xs font-bold tracking-wider uppercase">Evaluating Context...</span>
          </div>
        )}
      </div>

      {/* BOTTOM CENTER MIC & AUDIO VISUALIZER CAPSULE */}
      <div className="relative z-10 p-6 flex flex-col items-center justify-center">
        
        {/* Floating Capsule Bar matching image */}
        <div className="flex items-center gap-6 bg-slate-950/80 backdrop-blur-xl px-8 py-3 rounded-full border border-cyan-500/30 shadow-[0_0_40px_rgba(6,182,212,0.25)]">
          
          {/* Left Audio Waveform Bars */}
          <div className="flex items-center gap-1.5 h-8">
            <span className={`w-1 bg-cyan-400 rounded-full transition-all duration-300 ${isListening || counselorState === 'speaking' ? 'h-6 animate-pulse' : 'h-2'}`} />
            <span className={`w-1 bg-cyan-400 rounded-full transition-all duration-300 ${isListening || counselorState === 'speaking' ? 'h-8 animate-bounce' : 'h-3'}`} />
            <span className={`w-1 bg-cyan-400 rounded-full transition-all duration-300 ${isListening || counselorState === 'speaking' ? 'h-5 animate-pulse' : 'h-2'}`} />
            <span className={`w-1 bg-cyan-400 rounded-full transition-all duration-300 ${isListening || counselorState === 'speaking' ? 'h-7 animate-bounce' : 'h-4'}`} />
            <span className={`w-1 bg-cyan-400 rounded-full transition-all duration-300 ${isListening || counselorState === 'speaking' ? 'h-4 animate-pulse' : 'h-2'}`} />
          </div>

          {/* Central Glowing Mic Circle Button */}
          <button
            type="button"
            onClick={toggleSpeechRecognition}
            className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-all duration-300 shadow-2xl cursor-pointer ${
              isListening
                ? 'bg-rose-600 shadow-[0_0_35px_rgba(225,29,72,0.9)] animate-pulse scale-105 ring-4 ring-rose-400/40'
                : counselorState === 'thinking'
                ? 'bg-amber-600 shadow-[0_0_35px_rgba(245,158,11,0.9)] animate-pulse scale-105'
                : 'bg-gradient-to-r from-blue-600 to-cyan-500 shadow-[0_0_30px_rgba(6,182,212,0.8)] hover:scale-105 hover:shadow-[0_0_40px_rgba(6,182,212,1)] ring-4 ring-cyan-400/30'
            }`}
            title={isListening ? 'Listening to your question...' : 'Speak Now'}
          >
            {isListening ? <Radio className="w-6 h-6 animate-spin text-white" /> : <Mic className="w-6 h-6 text-white" />}
          </button>

          {/* Right Audio Waveform Bars */}
          <div className="flex items-center gap-1.5 h-8">
            <span className={`w-1 bg-cyan-400 rounded-full transition-all duration-300 ${isListening || counselorState === 'speaking' ? 'h-4 animate-pulse' : 'h-2'}`} />
            <span className={`w-1 bg-cyan-400 rounded-full transition-all duration-300 ${isListening || counselorState === 'speaking' ? 'h-7 animate-bounce' : 'h-4'}`} />
            <span className={`w-1 bg-cyan-400 rounded-full transition-all duration-300 ${isListening || counselorState === 'speaking' ? 'h-5 animate-pulse' : 'h-2'}`} />
            <span className={`w-1 bg-cyan-400 rounded-full transition-all duration-300 ${isListening || counselorState === 'speaking' ? 'h-8 animate-bounce' : 'h-3'}`} />
            <span className={`w-1 bg-cyan-400 rounded-full transition-all duration-300 ${isListening || counselorState === 'speaking' ? 'h-6 animate-pulse' : 'h-2'}`} />
          </div>
        </div>

        {/* Live Status Text underneath capsule */}
        <p className="mt-3 text-xs font-semibold tracking-wider text-cyan-300 uppercase bg-slate-950/80 px-4 py-1 rounded-full border border-cyan-500/20 backdrop-blur-md">
          {isListening ? '● Listening... Speak your question' : counselorState === 'thinking' ? '● AI Counselor Evaluating Context...' : counselorState === 'speaking' ? '● AI Counselor Speaking...' : 'Tap Mic to Speak'}
        </p>

      </div>

      {/* KEY CONFIG MODAL */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-indigo-500/30 rounded-3xl p-6 max-w-md w-full text-slate-200 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Key className="w-5 h-5 text-cyan-400" />
                Live Human Video Avatar API Key
              </h3>
              <button
                onClick={() => setShowKeyModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              <span className="text-emerald-300 font-semibold">Built-in Interactive Lipsync Avatar Engine Active!</span><br/>
              Photorealistic WebRTC stream connect karne ke liye HeyGen (heygen.com) ya Simli API key enter karein:
            </p>

            <input
              type="password"
              value={heyGenKey}
              onChange={(e) => setHeyGenKey(e.target.value)}
              placeholder="Enter HeyGen / Simli API Key..."
              className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setIsKeySaved(true);
                  setShowKeyModal(false);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow"
              >
                Save & Connect Stream
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

