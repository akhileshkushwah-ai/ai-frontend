export const BACKEND_PORT = process.env.NEXT_PUBLIC_BACKEND_PORT || '3002';

export const BACKEND_HTTP_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || `http://localhost:${BACKEND_PORT}`;

export const BACKEND_WS_URL =
  process.env.NEXT_PUBLIC_BACKEND_WS_URL || `ws://localhost:${BACKEND_PORT}`;

export const AI_COUNSELOR_API_BASE = `${BACKEND_HTTP_URL}/api/v1/ai-counselor`;

export const AI_COUNSELOR_WS_URL = `${BACKEND_WS_URL}/ws/live-counselor`;
