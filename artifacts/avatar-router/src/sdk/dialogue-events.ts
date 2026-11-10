import type { DialogueMessage } from './client-core';

/** Daily app messages are provisional captions, never final transcript evidence. */
export function tavusUtterance(data: unknown): DialogueMessage | null {
  if (!data || typeof data !== 'object') return null;
  const event = data as Record<string, unknown>;
  if (event.event_type !== 'conversation.utterance' || event.message_type !== 'conversation' ||
      typeof event.inference_id !== 'string' || !event.inference_id || event.inference_id.length > 200 ||
      !event.properties || typeof event.properties !== 'object') return null;
  const p = event.properties as Record<string, unknown>;
  if (!['user', 'pal', 'replica'].includes(String(p.role)) ||
      typeof p.speech !== 'string' || !p.speech.trim() || p.speech.length > 10000) return null;
  const role = p.role === 'user' ? 'user' : 'assistant';
  // Tavus emits both pal and legacy replica for the SAME inference.
  return { id: `${event.inference_id}:${role}`, role, text: p.speech };
}
