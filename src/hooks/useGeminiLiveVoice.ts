'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { AI_COUNSELOR_WS_URL } from '@/lib/backend';

interface GatewayEvent {
  event: string;
  data?: string;
  text?: string;
  message?: string;
  mimeType?: string;
  phaseNumber?: number;
  phaseName?: string;
  milestoneId?: string;
  milestoneName?: string;
  milestonePart?: string;
  targetDuration?: string;
}

export interface PhaseInfo {
  phaseNumber: number;
  phaseName: string;
  milestoneId?: string;
  milestoneName?: string;
  milestonePart?: string;
  targetDuration?: string;
}

export type CounselorState = 'idle' | 'thinking' | 'speaking';

export interface UseGeminiLiveVoiceOptions {
  wsUrl?: string;
  onTextChunk?: (text: string) => void;
  onStateChange?: (state: CounselorState) => void;
  onError?: (errMessage: string) => void;
  onConnected?: () => void;
}

const DEFAULT_WS_URL = AI_COUNSELOR_WS_URL;

export function useGeminiLiveVoice(options: UseGeminiLiveVoiceOptions = {}) {
  // The caller passes a fresh object literal on every render. Keeping it in a ref
  // stops that from invalidating every useCallback below, which previously made
  // the unmount cleanup effect re-run on each render and tear down the live
  // WebSocket + microphone as soon as they were started.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const wsUrl = options.wsUrl || DEFAULT_WS_URL;

  const [isLiveWsConnected, setIsLiveWsConnected] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const isUserSpeakingRef = useRef(false);
  const userSpeechFramesRef = useRef(0);
  const bargeInFramesRef = useRef(0);
  const userSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const [counselorState, setCounselorState] = useState<CounselorState>('idle');
  const counselorStateRef = useRef<CounselorState>('idle');
  const [currentPhaseInfo, setCurrentPhaseInfo] = useState<PhaseInfo>({
    phaseNumber: 1,
    phaseName: 'Introduction & Counseling Setup',
    milestoneName: 'Welcome & Introduction',
  });

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  // Pending `start_live_session` frames that must wait for the socket to open.
  const queuedFramesRef = useRef<string[]>([]);

  const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef<number>(0);

  const idleDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const chunkCountRef = useRef<number>(0);

  const updateState = useCallback((state: CounselorState) => {
    counselorStateRef.current = state;
    if (state === 'speaking') {
      if (idleDebounceTimerRef.current) {
        clearTimeout(idleDebounceTimerRef.current);
        idleDebounceTimerRef.current = null;
      }
      setCounselorState('speaking');
      optionsRef.current.onStateChange?.('speaking');
    } else if (state === 'idle') {
      if (idleDebounceTimerRef.current) return;
      // 400ms Hysteresis Debounce: prevents state flapping to 'idle' during small network packet jitter
      idleDebounceTimerRef.current = setTimeout(() => {
        idleDebounceTimerRef.current = null;
        if (audioQueueRef.current.length === 0) {
          counselorStateRef.current = 'idle';
          setCounselorState('idle');
          optionsRef.current.onStateChange?.('idle');
        }
      }, 400);
    } else {
      setCounselorState(state);
      optionsRef.current.onStateChange?.(state);
    }
  }, []);

  const raiseError = useCallback((message: string) => {
    console.warn('[Gemini Live]', message);
    setIsFallbackMode(true);
    optionsRef.current.onError?.(message);
  }, []);

  const safeSend = useCallback((payload: unknown): boolean => {
    const socket = wsRef.current;
    const frame = JSON.stringify(payload);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(frame);
      return true;
    }
    // Buffer instead of dropping - the socket may still be handshaking.
    if (queuedFramesRef.current.length < 50) {
      queuedFramesRef.current.push(frame);
    }
    return false;
  }, []);

  // Stop current audio playback queue (Barge-in Interruption & Session End)
  const stopAudioPlayback = useCallback(() => {
    if (idleDebounceTimerRef.current) {
      clearTimeout(idleDebounceTimerRef.current);
      idleDebounceTimerRef.current = null;
    }
    bargeInFramesRef.current = 0;
    const currentQueue = audioQueueRef.current;
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
    chunkCountRef.current = 0;

    // Detach onended before stopping to prevent 880x spurious callback loops
    currentQueue.forEach((source) => {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch (_) {}
    });

    counselorStateRef.current = 'idle';
    setCounselorState('idle');
    optionsRef.current.onStateChange?.('idle');
  }, []);

  // Play PCM 24kHz Base64 chunk using Web Audio API with 120ms Jitter Buffer Smoothing
  const playPcm24kChunk = useCallback(
    (base64Data: string, mimeType?: string) => {
      try {
        const sampleRate = /rate=(\d+)/.exec(mimeType || '')?.[1];
        const pcmRate = sampleRate ? parseInt(sampleRate, 10) : 24000;

        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          const AudioContextClass =
            window.AudioContext || (window as any).webkitAudioContext;
          try {
            audioCtxRef.current = new AudioContextClass({ sampleRate: 24000 });
          } catch (_) {
            audioCtxRef.current = new AudioContextClass();
          }
        }

        const audioCtx = audioCtxRef.current;
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }

        // Cancel user silence timer & speech indicator once AI audio starts arriving
        if (userSilenceTimerRef.current) {
          clearTimeout(userSilenceTimerRef.current);
          userSilenceTimerRef.current = null;
        }
        if (isUserSpeakingRef.current) {
          isUserSpeakingRef.current = false;
          setIsUserSpeaking(false);
        }
        userSpeechFramesRef.current = 0;
        bargeInFramesRef.current = 0;

        // Convert Base64 binary string to 16-bit Little-Endian Float32 PCM samples
        const binaryString = atob(base64Data);
        const len = binaryString.length;
        const numSamples = Math.floor(len / 2);
        if (numSamples === 0) return;

        const float32Array = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          const low = binaryString.charCodeAt(i * 2);
          const high = binaryString.charCodeAt(i * 2 + 1);
          let sample = (high << 8) | low;
          if (sample & 0x8000) sample |= ~0xffff; // Sign-extend 16-bit negative PCM values
          float32Array[i] = sample / 32768.0;
        }

        const buffer = audioCtx.createBuffer(1, numSamples, pcmRate);
        buffer.getChannelData(0).set(float32Array);

        const source = audioCtx.createBufferSource();
        source.buffer = buffer;

        // Anti-Clipping Master Chain: GainNode (0.85) -> DynamicsCompressorNode -> Destination
        // Prevents speaker crackling/buzzing and harsh plosive distortion ("fatti hui awaj")
        if (!gainNodeRef.current || !compressorNodeRef.current) {
          const compressor = audioCtx.createDynamicsCompressor();
          compressor.threshold.setValueAtTime(-12, audioCtx.currentTime);
          compressor.knee.setValueAtTime(10, audioCtx.currentTime);
          compressor.ratio.setValueAtTime(4, audioCtx.currentTime);
          compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
          compressor.release.setValueAtTime(0.25, audioCtx.currentTime);
          compressor.connect(audioCtx.destination);
          compressorNodeRef.current = compressor;

          const gain = audioCtx.createGain();
          gain.gain.value = 0.85; // Clean headroom
          gain.connect(compressor);
          gainNodeRef.current = gain;
        }
        source.connect(gainNodeRef.current);

        const currentTime = audioCtx.currentTime;
        let startTime: number;

        // Intelligent Adaptive Jitter Buffer:
        // 1. Fresh turn or drained queue: give 120ms lead-in cushion to buffer incoming bursts
        if (nextStartTimeRef.current === 0 || audioQueueRef.current.length === 0) {
          startTime = currentTime + 0.12;
        } 
        // 2. Continuous playback: chain chunks seamlessly back-to-back with ZERO gap
        else if (nextStartTimeRef.current >= currentTime) {
          startTime = nextStartTimeRef.current;
        } 
        // 3. Packet jitter / small underrun: do NOT inject an artificial 50ms silence hole!
        else {
          const lag = currentTime - nextStartTimeRef.current;
          if (lag < 0.08) {
            // Under 80ms jitter: resume immediately at currentTime with seamless transition
            startTime = currentTime;
          } else {
            // Larger network freeze: minimal 30ms re-anchor cushion
            startTime = currentTime + 0.03;
          }
        }

        source.start(startTime);
        nextStartTimeRef.current = startTime + buffer.duration;
        audioQueueRef.current.push(source);
        chunkCountRef.current += 1;
        updateState('speaking');

        source.onended = () => {
          const index = audioQueueRef.current.indexOf(source);
          if (index > -1) {
            audioQueueRef.current.splice(index, 1);
          }
          if (audioQueueRef.current.length === 0) {
            nextStartTimeRef.current = 0;
            console.log(
              `[Gemini Live] Audio queue complete (${chunkCountRef.current} chunks played). Setting state to idle.`,
            );
            updateState('idle');
          }
        };
      } catch (err) {
        console.error('Audio playback error:', err);
      }
    },
    [updateState],
  );

  // Connect to Gemini Live WebSocket
  const connectLiveWs = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        console.log('Connected to Gemini Live Counselor WS Gateway');
        setIsFallbackMode(false);
        optionsRef.current.onConnected?.();

        socket.send(
          JSON.stringify({
            event: 'start_live_session',
            data: { languagePreference: 'hinglish' },
          }),
        );

        const queued = queuedFramesRef.current;
        queuedFramesRef.current = [];
        for (const frame of queued) {
          if (socket.readyState === WebSocket.OPEN) socket.send(frame);
        }
      };

      socket.onmessage = (event) => {
        let parsed: GatewayEvent;
        try {
          parsed = JSON.parse(event.data);
        } catch (err) {
          console.error('WS message parse error:', err);
          return;
        }

        switch (parsed.event) {
          case 'audio_chunk':
            if (parsed.data) playPcm24kChunk(parsed.data, parsed.mimeType);
            break;
          case 'text_chunk':
            if (parsed.text) optionsRef.current.onTextChunk?.(parsed.text);
            break;
          case 'live_session_started':
            console.log('Gemini Live Session Confirmed & Active!');
            setIsLiveWsConnected(true);
            setIsFallbackMode(false);
            break;
          case 'interrupted':
            // Student barged in / spoke over the counselor: cancel audio playback immediately
            console.log('[Gemini Live] Interruption received. Halting audio playback.');
            stopAudioPlayback();
            break;
          case 'turn_complete':
            // Gemini finished producing tokens on the backend.
            if (parsed.phaseNumber && parsed.phaseName) {
              setCurrentPhaseInfo({
                phaseNumber: parsed.phaseNumber,
                phaseName: parsed.phaseName,
                milestoneId: parsed.milestoneId,
                milestoneName: parsed.milestoneName,
                milestonePart: parsed.milestonePart,
                targetDuration: parsed.targetDuration,
              });
            }
            console.log(
              `[Gemini Live] turn_complete received. Phase ${parsed.phaseNumber || 1}: ${parsed.milestoneName || 'In progress'}`,
            );
            break;
          case 'live_ws_closed':
            setIsLiveWsConnected(false);
            raiseError(parsed.message || 'Live stream closed by server.');
            break;
          case 'live_ws_fallback':
            setIsFallbackMode(true);
            setIsLiveWsConnected(false);
            raiseError(parsed.message || 'Gemini Live stream is unavailable.');
            break;
          case 'error':
            raiseError(parsed.message || 'Unknown live counselor error');
            break;
          default:
            break;
        }
      };

      socket.onerror = (err) => {
        console.warn('Gemini Live WS Error:', err);
        setIsLiveWsConnected(false);
        raiseError('Could not reach the live counselor gateway on the backend.');
      };

      socket.onclose = () => {
        console.log('Gemini Live WS Closed');
        setIsLiveWsConnected(false);
        if (wsRef.current === socket) wsRef.current = null;
      };
    } catch (err) {
      console.error('WS Connection error:', err);
      raiseError(
        err instanceof Error ? err.message : 'WebSocket connection failed.',
      );
    }
  }, [wsUrl, playPcm24kChunk, stopAudioPlayback, raiseError]);

  // Disconnect WebSocket
  const disconnectLiveWs = useCallback(() => {
    queuedFramesRef.current = [];
    if (wsRef.current) {
      const socket = wsRef.current;
      wsRef.current = null;
      try {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      } catch (_) {}
    }
    setIsLiveWsConnected(false);
    stopAudioPlayback();
  }, [stopAudioPlayback]);

  // Start Real-Time Microphone Audio Streaming (Resampled down to 16kHz PCM)
  const startMicStream = useCallback(async () => {
    if (scriptNodeRef.current) return;

    // Ensure WS connection is open (audio frames are buffered until it is).
    connectLiveWs();

    try {
      // Capture flexible hardware mic stream without strict sampleRate constraint
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const micAudioCtx = new AudioContextClass();
      micAudioCtxRef.current = micAudioCtx;

      const source = micAudioCtx.createMediaStreamSource(stream);
      const scriptNode = micAudioCtx.createScriptProcessor(4096, 1, 1);
      scriptNodeRef.current = scriptNode;

      const nativeSampleRate = micAudioCtx.sampleRate;
      const targetSampleRate = 16000;
      const sampleRatio = nativeSampleRate / targetSampleRate;

      // Muting the ScriptProcessor output keeps it alive without echoing the mic.
      const silentGain = micAudioCtx.createGain();
      silentGain.gain.value = 0;

      scriptNode.onaudioprocess = (e) => {
        const inputBuffer = e.inputBuffer.getChannelData(0);

        // Compute RMS volume of incoming mic frame
        let sumSquares = 0;
        for (let i = 0; i < inputBuffer.length; i++) {
          sumSquares += inputBuffer[i] * inputBuffer[i];
        }
        const rms = Math.sqrt(sumSquares / inputBuffer.length);

        // Intelligent Echo Shield & Sustained Barge-In Detection:
        // When AI is actively speaking:
        if (counselorStateRef.current === 'speaking') {
          // Barge-in requires INTENTIONAL, SUSTAINED spoken volume into the headset microphone.
          // Single instantaneous spikes (coughs, breaths, chair squeaks, cable friction) are < 200ms and get rejected!
          const BARGE_IN_RMS_THRESHOLD = 0.075;
          const REQUIRED_BARGE_IN_FRAMES = 4; // ~340ms of continuous human voice required to interrupt

          if (rms >= BARGE_IN_RMS_THRESHOLD) {
            bargeInFramesRef.current += 1;
            if (bargeInFramesRef.current >= REQUIRED_BARGE_IN_FRAMES) {
              console.log(
                '[Gemini Live] Intentional Student Barge-In confirmed (Sustained RMS:',
                rms.toFixed(3),
                '). Stopping AI speech.',
              );
              bargeInFramesRef.current = 0;
              stopAudioPlayback();
              safeSend({ event: 'interrupt' });

              if (userSilenceTimerRef.current) {
                clearTimeout(userSilenceTimerRef.current);
                userSilenceTimerRef.current = null;
              }
              userSpeechFramesRef.current = 4;
              isUserSpeakingRef.current = true;
              setIsUserSpeaking(true);
            }
          } else {
            bargeInFramesRef.current = Math.max(0, bargeInFramesRef.current - 1);
          }

          // Crucial: Shield Gemini while AI is speaking! Never stream transient mic noise into Gemini's ear.
          return;
        } else {
          // AI is NOT speaking: detect student speech activity
          // Tuned parameters: 0.045 RMS threshold, 4 consecutive frames (~340ms), 900ms silence timeout
          const SPEECH_THRESHOLD = 0.045;
          const REQUIRED_SPEECH_FRAMES = 4;
          const SILENCE_TIMEOUT_MS = 900;

          if (rms >= SPEECH_THRESHOLD) {
            userSpeechFramesRef.current += 1;
            if (userSilenceTimerRef.current) {
              clearTimeout(userSilenceTimerRef.current);
              userSilenceTimerRef.current = null;
            }
            if (userSpeechFramesRef.current >= REQUIRED_SPEECH_FRAMES && !isUserSpeakingRef.current) {
              isUserSpeakingRef.current = true;
              setIsUserSpeaking(true);
              if (counselorStateRef.current === 'thinking') {
                updateState('idle');
              }
            }
          } else {
            userSpeechFramesRef.current = Math.max(0, userSpeechFramesRef.current - 1);
            if (isUserSpeakingRef.current && !userSilenceTimerRef.current) {
              userSilenceTimerRef.current = setTimeout(() => {
                userSilenceTimerRef.current = null;
                userSpeechFramesRef.current = 0;
                isUserSpeakingRef.current = false;
                setIsUserSpeaking(false);
                // When student finishes speaking, transition to 'thinking' (preparing answer)
                if (counselorStateRef.current !== 'speaking') {
                  updateState('thinking');
                }
              }, SILENCE_TIMEOUT_MS);
            }
          }
        }

        const outputLength = Math.floor(inputBuffer.length / sampleRatio);
        if (outputLength <= 0) return;

        const pcm16 = new Int16Array(outputLength);

        // Resample native audio down to 16000Hz PCM Int16
        for (let i = 0; i < outputLength; i++) {
          const inputIndex = Math.min(
            Math.floor(i * sampleRatio),
            inputBuffer.length - 1,
          );
          const s = Math.max(-1, Math.min(1, inputBuffer[inputIndex]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Convert Int16Array to Base64
        let binary = '';
        const bytes = new Uint8Array(pcm16.buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }

        safeSend({
          event: 'audio_input',
          data: { pcmBase64: btoa(binary) },
        });
      };

      source.connect(scriptNode);
      scriptNode.connect(silentGain);
      silentGain.connect(micAudioCtx.destination);
      setIsMicActive(true);
    } catch (err) {
      console.error('Microphone error:', err);
      raiseError(
        `Could not access microphone: ${err instanceof Error ? err.message : 'please check mic permissions.'}`,
      );
    }
  }, [connectLiveWs, safeSend, stopAudioPlayback, raiseError]);

  // Stop Microphone Stream
  const stopMicStream = useCallback(() => {
    if (scriptNodeRef.current) {
      try {
        scriptNodeRef.current.onaudioprocess = null;
        scriptNodeRef.current.disconnect();
      } catch (_) {}
      scriptNodeRef.current = null;
    }
    if (micAudioCtxRef.current) {
      try {
        micAudioCtxRef.current.close();
      } catch (_) {}
      micAudioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (userSilenceTimerRef.current) {
      clearTimeout(userSilenceTimerRef.current);
      userSilenceTimerRef.current = null;
    }
    userSpeechFramesRef.current = 0;
    isUserSpeakingRef.current = false;
    setIsUserSpeaking(false);
    setIsMicActive(false);
  }, []);

  // Interrupt AI Speech
  const interruptAi = useCallback(() => {
    stopAudioPlayback();
    safeSend({ event: 'interrupt' });
  }, [stopAudioPlayback, safeSend]);

  // Send a typed message into the live voice session
  const sendLiveText = useCallback(
    (text: string) => {
      if (!text.trim()) return false;
      updateState('thinking');
      return safeSend({ event: 'text_turn', data: { text: text.trim() } });
    },
    [safeSend, updateState],
  );

  // Trigger Official SABCQ Grand Opening Introduction on first mic tap
  const triggerFirstIntro = useCallback(() => {
    updateState('thinking');
    return safeSend({ event: 'trigger_first_intro' });
  }, [safeSend, updateState]);

  // Cleanup on unmount only. Deps are all stable callbacks, so this effect
  // runs once instead of tearing the session down on every render.
  useEffect(() => {
    return () => {
      stopMicStream();
      disconnectLiveWs();
    };
  }, [stopMicStream, disconnectLiveWs]);

  return {
    isLiveWsConnected,
    isMicActive,
    isUserSpeaking,
    isFallbackMode,
    counselorState,
    connectLiveWs,
    disconnectLiveWs,
    startMicStream,
    stopMicStream,
    stopAudioPlayback,
    interruptAi,
    sendLiveText,
    triggerFirstIntro,
    currentPhaseInfo,
  };
}
