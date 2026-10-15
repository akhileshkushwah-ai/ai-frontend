'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Wifi, Sparkles, UserCheck, PhoneOff, Mic, MicOff, Key, Volume2, ShieldCheck, Play, Layers, Radio } from 'lucide-react';
import { useGeminiLiveVoice } from '../hooks/useGeminiLiveVoice';

interface StreamingAvatarProps {
  counselorState: 'idle' | 'thinking' | 'speaking';
  responseText?: string;
  isLoading?: boolean;
  onEndSession: () => void;
  studentName: string;
}

export const HeyGenStreamingAvatar: React.FC<StreamingAvatarProps> = ({
  counselorState: propsState,
  responseText,
  isLoading,
  onEndSession,
  studentName,
}) => {
  const videoRefA = useRef<HTMLVideoElement>(null);
  const videoRefB = useRef<HTMLVideoElement>(null);
  const [activeVideo, setActiveVideo] = useState<'A' | 'B'>('A');
  const isSwitchingRef = useRef(false);

  const [heyGenKey, setHeyGenKey] = useState('');
  const [isKeySaved, setIsKeySaved] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [visemeScaleY, setVisemeScaleY] = useState(1);
  const [visemeScaleX, setVisemeScaleX] = useState(1);
  const [activeStreamMode, setActiveStreamMode] = useState<'interactive_avatar' | 'webrtc_live'>('interactive_avatar');
  const [liveError, setLiveError] = useState<string | null>(null);

  const hasSpokenIntroRef = useRef(false);
  const [introStarted, setIntroStarted] = useState(false);
  const [introCompleted, setIntroCompleted] = useState(false);
  const [counselingInitiated, setCounselingInitiated] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const introHasPlayedAudioRef = useRef(false);

  // Real-time Gemini Multimodal Live Voice-to-Voice Hook
  const {
    isLiveWsConnected,
    isMicActive,
    isUserSpeaking,
    isFallbackMode,
    counselorState: liveState,
    connectLiveWs,
    disconnectLiveWs,
    startMicStream,
    stopMicStream,
    stopAudioPlayback,
    interruptAi,
    sendLiveText,
    triggerFirstIntro,
    currentPhaseInfo,
  } = useGeminiLiveVoice({
    onConnected: () => setLiveError(null),
    onTextChunk: () => {},
    onError: (message) => setLiveError(message),
  });

  const handleEndSessionClick = () => {
    stopMicStream();
    stopAudioPlayback();
    disconnectLiveWs();
    onEndSession();
  };

  const counselorState = isLiveWsConnected && liveState !== 'idle' ? liveState : propsState;

  // Connect Gemini Live WS quietly in background
  useEffect(() => {
    connectLiveWs();
  }, [connectLiveWs]);

  // 1-Second Auto-Intro Trigger upon session connect
  useEffect(() => {
    if (isLiveWsConnected && !hasSpokenIntroRef.current) {
      const timer = setTimeout(() => {
        hasSpokenIntroRef.current = true;
        setIntroStarted(true);
        triggerFirstIntro();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isLiveWsConnected, triggerFirstIntro]);

  // Track intro audio playback start
  useEffect(() => {
    if (introStarted && counselorState === 'speaking') {
      introHasPlayedAudioRef.current = true;
    }
  }, [introStarted, counselorState]);

  // Mark intro completed once intro audio finishes playing and goes back to 'idle'
  useEffect(() => {
    if (introStarted && !introCompleted && introHasPlayedAudioRef.current && counselorState === 'idle') {
      setIntroCompleted(true);
    }
  }, [introStarted, introCompleted, counselorState]);

  // Maintain continuous hands-free mic listening once counseling is initiated
  useEffect(() => {
    if (counselingInitiated && isLiveWsConnected && !isMicActive && !isMuted) {
      startMicStream().catch(console.warn);
    }
  }, [counselingInitiated, isLiveWsConnected, isMicActive, isMuted, startMicStream]);

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

  const handleInitiateCounseling = async () => {
    setIsMuted(false);
    setCounselingInitiated(true);
    try {
      await startMicStream();
    } catch (err) {
      console.warn('Failed to start mic stream on initiate:', err);
    }
  };

  const toggleMicMute = async () => {
    if (isMicActive) {
      setIsMuted(true);
      stopMicStream();
    } else {
      setIsMuted(false);
      try {
        await startMicStream();
      } catch (err) {
        console.warn('Failed to resume mic stream:', err);
      }
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

      {/* TOP OVERLAY HEADER: Counselor Profile (Left) & SABCQ Phase Badge (Right) */}
      <div className="relative z-10 p-6 flex items-center justify-between gap-3 w-full">
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

        {/* Top Right SABCQ Phase Badge (Shifted from center to End Session position) */}
        <div className="flex items-center gap-2.5 bg-gradient-to-r from-cyan-950/90 via-blue-950/90 to-indigo-950/90 backdrop-blur-xl px-5 py-2.5 rounded-full border border-cyan-500/40 shadow-xl max-w-lg">
          <Layers className="w-4 h-4 text-cyan-400 shrink-0 animate-pulse" />
          <div className="flex flex-col text-left">
            <span className="text-[10px] font-semibold text-cyan-400 tracking-wider uppercase">
              {currentPhaseInfo?.phaseName || 'Introduction & Counseling Setup'}
            </span>
            <span className="text-xs font-bold text-white tracking-wide truncate">
              {currentPhaseInfo?.milestoneName || 'Welcome & Introduction'}
            </span>
          </div>
        </div>
      </div>

      {/* CENTER STATUS OVERLAY */}
      {isFallbackMode && (
        <div className="relative z-10 flex flex-col items-center justify-center p-4 text-center">
          <div className="mb-2 flex items-center gap-2 bg-indigo-500/20 backdrop-blur-md px-5 py-2 rounded-full border border-indigo-500/40 text-indigo-200 shadow-2xl max-w-xl">
            <Wifi className="w-4 h-4 text-cyan-300" />
            <span className="text-xs font-semibold tracking-wide">
              Live AI Counselor Stream Connected
            </span>
          </div>
        </div>
      )}

      {/* BOTTOM CONTROLS: Center Mic & Audio Visualizer Capsule + Right Circular End Button */}
      <div className="relative z-10 px-6 pb-6 pt-2 w-full flex flex-col items-center justify-center">
        
        {/* Main Controls Row with Centered Action and Right-Aligned Circular End Button */}
        <div className="relative w-full flex items-center justify-center min-h-[56px]">
          
          {!counselingInitiated ? (
            // PRE-COUNSELING STATE: Intro is playing OR waiting for user to click "Initiate Counseling"
            <div className="flex flex-col items-center gap-3">
              {!introCompleted ? (
                // Intro is currently playing
                <div className="flex items-center gap-4 bg-slate-950/85 backdrop-blur-xl px-7 py-3.5 rounded-full border border-cyan-500/30 shadow-[0_0_40px_rgba(6,182,212,0.25)]">
                  <div className="flex items-center gap-1.5 h-6">
                    <span className="w-1 bg-cyan-400 rounded-full h-3 animate-pulse" />
                    <span className="w-1 bg-cyan-400 rounded-full h-6 animate-bounce" />
                    <span className="w-1 bg-cyan-400 rounded-full h-4 animate-pulse" />
                    <span className="w-1 bg-cyan-400 rounded-full h-6 animate-bounce" />
                    <span className="w-1 bg-cyan-400 rounded-full h-2 animate-pulse" />
                  </div>
                  <span className="text-xs font-semibold text-cyan-200 tracking-wide flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-cyan-400 animate-pulse" />
                    Priya Sharma is giving introduction...
                  </span>
                  <div className="flex items-center gap-1.5 h-6">
                    <span className="w-1 bg-cyan-400 rounded-full h-2 animate-pulse" />
                    <span className="w-1 bg-cyan-400 rounded-full h-5 animate-bounce" />
                    <span className="w-1 bg-cyan-400 rounded-full h-3 animate-pulse" />
                    <span className="w-1 bg-cyan-400 rounded-full h-6 animate-bounce" />
                    <span className="w-1 bg-cyan-400 rounded-full h-3 animate-pulse" />
                  </div>
                </div>
              ) : (
                // Intro has completed: Show "Initiate Counseling" Button!
                <button
                  type="button"
                  onClick={handleInitiateCounseling}
                  className="flex items-center gap-3 px-8 py-3.5 rounded-full bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-sm shadow-[0_0_50px_rgba(6,182,212,0.6)] hover:scale-105 transition-all duration-300 ring-4 ring-cyan-400/40 animate-pulse cursor-pointer"
                >
                  <Sparkles className="w-5 h-5 text-cyan-200 animate-spin" />
                  <span className="tracking-wide text-sm font-extrabold uppercase">Initiate Counseling</span>
                </button>
              )}
            </div>
          ) : (
            // CONTINUOUS HANDS-FREE FULL-DUPLEX MODE ACTIVE!
            <div className={`flex items-center gap-6 bg-slate-950/85 backdrop-blur-xl px-8 py-3 rounded-full border transition-all duration-300 shadow-2xl ${
              isUserSpeaking
                ? 'border-emerald-500/50 shadow-[0_0_40px_rgba(16,185,129,0.3)] ring-2 ring-emerald-500/20'
                : counselorState === 'thinking'
                ? 'border-amber-500/40 shadow-[0_0_35px_rgba(245,158,11,0.25)]'
                : 'border-cyan-500/30 shadow-[0_0_40px_rgba(6,182,212,0.25)]'
            }`}>
              {/* Left Audio Waveform Bars */}
              <div className="flex items-center gap-1.5 h-8">
                <span className={`w-1 rounded-full transition-all duration-300 ${
                  isUserSpeaking
                    ? 'bg-emerald-400 h-6 animate-pulse'
                    : counselorState === 'speaking'
                    ? 'bg-cyan-400 h-6 animate-pulse'
                    : counselorState === 'thinking'
                    ? 'bg-amber-400 h-3 animate-pulse'
                    : isMicActive
                    ? 'bg-cyan-400/40 h-2'
                    : 'bg-slate-700 h-1.5'
                }`} />
                <span className={`w-1 rounded-full transition-all duration-300 ${
                  isUserSpeaking
                    ? 'bg-emerald-400 h-8 animate-bounce'
                    : counselorState === 'speaking'
                    ? 'bg-cyan-400 h-8 animate-bounce'
                    : counselorState === 'thinking'
                    ? 'bg-amber-400 h-4 animate-pulse'
                    : isMicActive
                    ? 'bg-cyan-400/50 h-3'
                    : 'bg-slate-700 h-1.5'
                }`} />
                <span className={`w-1 rounded-full transition-all duration-300 ${
                  isUserSpeaking
                    ? 'bg-emerald-400 h-5 animate-pulse'
                    : counselorState === 'speaking'
                    ? 'bg-cyan-400 h-5 animate-pulse'
                    : counselorState === 'thinking'
                    ? 'bg-amber-400 h-2.5 animate-pulse'
                    : isMicActive
                    ? 'bg-cyan-400/40 h-2'
                    : 'bg-slate-700 h-1.5'
                }`} />
                <span className={`w-1 rounded-full transition-all duration-300 ${
                  isUserSpeaking
                    ? 'bg-emerald-400 h-7 animate-bounce'
                    : counselorState === 'speaking'
                    ? 'bg-cyan-400 h-7 animate-bounce'
                    : counselorState === 'thinking'
                    ? 'bg-amber-400 h-4 animate-pulse'
                    : isMicActive
                    ? 'bg-cyan-400/60 h-3.5'
                    : 'bg-slate-700 h-1.5'
                }`} />
                <span className={`w-1 rounded-full transition-all duration-300 ${
                  isUserSpeaking
                    ? 'bg-emerald-400 h-4 animate-pulse'
                    : counselorState === 'speaking'
                    ? 'bg-cyan-400 h-4 animate-pulse'
                    : counselorState === 'thinking'
                    ? 'bg-amber-400 h-2 animate-pulse'
                    : isMicActive
                    ? 'bg-cyan-400/40 h-2'
                    : 'bg-slate-700 h-1.5'
                }`} />
              </div>

              {/* Central Glowing Mic Circle Button (Hands-free active / Click to Mute) */}
              <button
                type="button"
                onClick={toggleMicMute}
                className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-all duration-300 shadow-2xl cursor-pointer ${
                  counselorState === 'speaking'
                    ? 'bg-cyan-600 shadow-[0_0_35px_rgba(6,182,212,0.9)] animate-pulse scale-105'
                    : counselorState === 'thinking'
                    ? 'bg-amber-600 shadow-[0_0_35px_rgba(245,158,11,0.9)] animate-pulse scale-105 ring-4 ring-amber-400/40'
                    : isUserSpeaking
                    ? 'bg-emerald-500 shadow-[0_0_40px_rgba(16,185,129,0.95)] animate-pulse scale-110 ring-4 ring-emerald-300/60'
                    : isMicActive
                    ? 'bg-emerald-600 shadow-[0_0_35px_rgba(16,185,129,0.9)] ring-4 ring-emerald-400/40'
                    : 'bg-rose-600 shadow-[0_0_30px_rgba(225,29,72,0.8)] ring-4 ring-rose-400/30'
                }`}
                title={
                  counselorState === 'speaking'
                    ? 'Priya Mam Speaking'
                    : counselorState === 'thinking'
                    ? 'Preparing your answer...'
                    : isUserSpeaking
                    ? 'Listening'
                    : isMicActive
                    ? 'Speak'
                    : 'Mic is muted (Click to unmute)'
                }
              >
                {counselorState === 'speaking' ? (
                  <Radio className="w-6 h-6 animate-spin text-white" />
                ) : counselorState === 'thinking' ? (
                  <Sparkles className="w-6 h-6 animate-spin text-white" />
                ) : isUserSpeaking ? (
                  <Mic className="w-6 h-6 text-white animate-pulse" />
                ) : isMicActive ? (
                  <Mic className="w-6 h-6 text-white" />
                ) : (
                  <MicOff className="w-6 h-6 text-white" />
                )}
              </button>

              {/* Right Audio Waveform Bars */}
              <div className="flex items-center gap-1.5 h-8">
                <span className={`w-1 rounded-full transition-all duration-300 ${
                  isUserSpeaking
                    ? 'bg-emerald-400 h-4 animate-pulse'
                    : counselorState === 'speaking'
                    ? 'bg-cyan-400 h-4 animate-pulse'
                    : counselorState === 'thinking'
                    ? 'bg-amber-400 h-2.5 animate-pulse'
                    : isMicActive
                    ? 'bg-cyan-400/40 h-2'
                    : 'bg-slate-700 h-1.5'
                }`} />
                <span className={`w-1 rounded-full transition-all duration-300 ${
                  isUserSpeaking
                    ? 'bg-emerald-400 h-7 animate-bounce'
                    : counselorState === 'speaking'
                    ? 'bg-cyan-400 h-7 animate-bounce'
                    : counselorState === 'thinking'
                    ? 'bg-amber-400 h-4 animate-pulse'
                    : isMicActive
                    ? 'bg-cyan-400/60 h-3.5'
                    : 'bg-slate-700 h-1.5'
                }`} />
                <span className={`w-1 rounded-full transition-all duration-300 ${
                  isUserSpeaking
                    ? 'bg-emerald-400 h-5 animate-pulse'
                    : counselorState === 'speaking'
                    ? 'bg-cyan-400 h-5 animate-pulse'
                    : counselorState === 'thinking'
                    ? 'bg-amber-400 h-3 animate-pulse'
                    : isMicActive
                    ? 'bg-cyan-400/40 h-2'
                    : 'bg-slate-700 h-1.5'
                }`} />
                <span className={`w-1 rounded-full transition-all duration-300 ${
                  isUserSpeaking
                    ? 'bg-emerald-400 h-8 animate-bounce'
                    : counselorState === 'speaking'
                    ? 'bg-cyan-400 h-8 animate-bounce'
                    : counselorState === 'thinking'
                    ? 'bg-amber-400 h-4 animate-pulse'
                    : isMicActive
                    ? 'bg-cyan-400/50 h-3'
                    : 'bg-slate-700 h-1.5'
                }`} />
                <span className={`w-1 rounded-full transition-all duration-300 ${
                  isUserSpeaking
                    ? 'bg-emerald-400 h-6 animate-pulse'
                    : counselorState === 'speaking'
                    ? 'bg-cyan-400 h-6 animate-pulse'
                    : counselorState === 'thinking'
                    ? 'bg-amber-400 h-2 animate-pulse'
                    : isMicActive
                    ? 'bg-cyan-400/40 h-2'
                    : 'bg-slate-700 h-1.5'
                }`} />
              </div>
            </div>
          )}

          {/* Right Circular End Button: Shifted to bottom right parallel to the mic */}
          <div className="absolute right-0 flex items-center">
            <button
              type="button"
              onClick={handleEndSessionClick}
              className="w-14 h-14 rounded-full bg-[#E11D48] hover:bg-[#F43F5E] text-white flex flex-col items-center justify-center shadow-[0_0_25px_rgba(225,29,72,0.5)] hover:scale-105 active:scale-95 transition-all duration-200 border-2 border-rose-400/30 cursor-pointer"
              title="End"
            >
              <PhoneOff className="w-4 h-4 text-white mb-0.5" />
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-white">End</span>
            </button>
          </div>
        </div>

        {/* Live Status Text underneath */}
        <div className="mt-3 flex items-center justify-center">
          {!counselingInitiated ? (
            <p className="text-xs font-semibold tracking-wider text-cyan-300 uppercase bg-slate-950/80 px-4 py-1.5 rounded-full border border-cyan-500/20 backdrop-blur-md">
              {!introCompleted
                ? '● Please listen to the introduction...'
                : '● Introduction Complete — Click "Initiate Counseling" to speak'}
            </p>
          ) : (
            <p
              className={`text-xs font-semibold tracking-wide px-4 py-1.5 rounded-full backdrop-blur-md transition-all duration-300 flex items-center gap-2 ${
                counselorState === 'speaking'
                  ? 'text-cyan-300 bg-cyan-950/80 border border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.2)]'
                  : counselorState === 'thinking'
                  ? 'text-amber-300 bg-amber-950/80 border border-amber-500/40 shadow-[0_0_25px_rgba(245,158,11,0.3)] animate-pulse'
                  : isUserSpeaking
                  ? 'text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 shadow-[0_0_25px_rgba(16,185,129,0.3)] animate-pulse'
                  : isMicActive
                  ? 'text-cyan-200/90 bg-slate-950/80 border border-cyan-500/20'
                  : 'text-rose-300 bg-rose-950/80 border border-rose-500/30'
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                counselorState === 'speaking'
                  ? 'bg-cyan-400 animate-pulse'
                  : counselorState === 'thinking'
                  ? 'bg-amber-400 animate-spin'
                  : isUserSpeaking
                  ? 'bg-emerald-400 animate-ping'
                  : isMicActive
                  ? 'bg-cyan-400 animate-pulse'
                  : 'bg-rose-500'
              }`} />
              <span>
                {counselorState === 'speaking'
                  ? 'Priya Mam Speaking'
                  : counselorState === 'thinking'
                  ? 'Preparing Answer...'
                  : isUserSpeaking
                  ? 'Listening'
                  : isMicActive
                  ? 'Speak'
                  : 'Mic Muted'}
              </span>
            </p>
          )}
        </div>

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

