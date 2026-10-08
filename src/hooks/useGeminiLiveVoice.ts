'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { AI_COUNSELOR_WS_URL } from '@/lib/backend';

interface GatewayEvent {
  event: string;
  data?: string;
  text?: string;
  message?: string;
  mimeType?: string;
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
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const [counselorState, setCounselorState] = useState<CounselorState>('idle');

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  // Pending `start_live_session` frames that must wait for the socket to open.
  const queuedFramesRef = useRef<string[]>([]);

  const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef<number>(0);

  const updateState = useCallback((state: CounselorState) => {
    setCounselorState(state);
    optionsRef.current.onStateChange?.(state);
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

  // Stop current audio playback queue (Barge-in Interruption)
  const stopAudioPlayback = useCallback(() => {
    audioQueueRef.current.forEach((source) => {
      try {
        source.stop();
        source.disconnect();
      } catch (_) {}
    });
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
    updateState('idle');
  }, [updateState]);

  // Play PCM 24kHz Base64 chunk using Web Audio API
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

        // Convert Base64 to ArrayBuffer
        const binaryString = atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Convert Int16 PCM to Float32
        const int16Array = new Int16Array(bytes.buffer);
        const numSamples = int16Array.length;
        if (numSamples === 0) return;

        const float32Array = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          float32Array[i] = int16Array[i] / 32768.0;
        }

        const buffer = audioCtx.createBuffer(1, numSamples, pcmRate);
        buffer.getChannelData(0).set(float32Array);

        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);

        const currentTime = audioCtx.currentTime;
        // Never schedule in the past: a too-small nextStartTime causes glitches.
        const startTime = Math.max(currentTime, nextStartTimeRef.current);
        source.start(startTime);

        nextStartTimeRef.current = startTime + buffer.duration;
        audioQueueRef.current.push(source);
        updateState('speaking');

        source.onended = () => {
          const index = audioQueueRef.current.indexOf(source);
          if (index > -1) {
            audioQueueRef.current.splice(index, 1);
          }
          if (
            audioQueueRef.current.length === 0 &&
            audioCtx.currentTime >= nextStartTimeRef.current
          ) {
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
          case 'turn_complete':
            stopAudioPlayback();
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
  }, [connectLiveWs, safeSend, raiseError]);

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
    isFallbackMode,
    counselorState,
    connectLiveWs,
    disconnectLiveWs,
    startMicStream,
    stopMicStream,
    interruptAi,
    sendLiveText,
    triggerFirstIntro,
  };
}
