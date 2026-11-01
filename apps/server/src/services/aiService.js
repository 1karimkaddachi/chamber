import { PRIVACY_VALUES, ROOM_LIMITS, clamp } from '@chamber/shared';
import config, { aiConfigured } from '../config.js';
import { logger } from '../logger.js';
import { getAnalytics } from './analyticsService.js';
import { listTemplates } from './templateService.js';

const HEURISTICS = [
  {
    test: /(competitive|ranked|rank|tournament|scrim|valorant|league|cs2|csgo|overwatch)/i,
    privacy: 'INVITE_ONLY',
    userLimit: 5,
    bitrate: 128000,
    slug: 'competitive-team',
    rationale: ['Competitive sessions usually want a locked five-stack.', 'A higher bitrate keeps voice comms crisp.'],
  },
  {
    test: /\bduo\b|1v1|two players|just the two/i,
    privacy: 'PRIVATE',
    userLimit: 2,
    bitrate: 96000,
    slug: 'duo-room',
    rationale: ['A two-person room stays private and focused.'],
  },
  {
    test: /\btrio\b|three players/i,
    privacy: 'PRIVATE',
    userLimit: 3,
    bitrate: 96000,
    slug: 'trio-room',
    rationale: ['A three-seat private room matches the group size.'],
  },
  {
    test: /(study|homework|focus|quiet|exam|revision)/i,
    privacy: 'PUBLIC',
    userLimit: 20,
    bitrate: 64000,
    slug: 'study-room',
    rationale: ['Study rooms work best when discoverable and calm.', '64 kbps is plenty for voice-only focus sessions.'],
  },
  {
    test: /(movie|film|watch|cinema|stream night)/i,
    privacy: 'INVITE_ONLY',
    userLimit: 15,
    bitrate: 96000,
    slug: 'movie-night',
    rationale: ['Watch parties benefit from a capped, invite-only audience.'],
  },
  {
    test: /(meeting|standup|planning|work|sync|interview)/i,
    privacy: 'INVITE_ONLY',
    userLimit: 25,
    bitrate: 64000,
    slug: 'meeting-room',
    rationale: ['Meetings should stay invite-only and distraction-free.'],
  },
  {
    test: /(music|listening|dj|playlist|concert)/i,
    privacy: 'PUBLIC',
    userLimit: 0,
    bitrate: 128000,
    slug: 'music-lounge',
    rationale: ['Listening rooms are more enjoyable with higher audio quality.', 'Keep the door open for spontaneous guests.'],
  },
  {
    test: /(lounge|chill|private|relax|vibe)/i,
    privacy: 'PRIVATE',
    userLimit: 0,
    bitrate: 96000,
    slug: 'private-lounge',
    rationale: ['A private lounge avoids unexpected visitors.', 'Invite people you want in the room.'],
  },
  {
    test: /(gaming|game|squad|party|fps|minecraft|roblox)/i,
    privacy: 'PUBLIC',
    userLimit: 0,
    bitrate: 96000,
    slug: 'gaming-squad',
    rationale: ['Gaming squads usually want an open, discoverable room.'],
  },
];

function inferFromPurpose(purpose) {
  const match = HEURISTICS.find((heuristic) => heuristic.test.test(purpose));
  return match ?? null;
}

function normalizeLimit(value, fallback) {
  if (value === 0) return 0;
  return clamp(value ?? fallback ?? 0, 0, ROOM_LIMITS.userLimitMax);
}

export function aiStatus() {
  return {
    configured: aiConfigured,
    enabled: Boolean(config.ai.enabled),
    provider: aiConfigured ? (config.ai.baseUrl.includes('ollama') ? 'Ollama (OpenAI-compatible)' : 'OpenAI-compatible endpoint') : null,
    model: aiConfigured ? config.ai.model : null,
  };
}

async function statsContext(guildId) {
  const analytics = await getAnalytics(guildId, '30d').catch(() => null);
  return {
    popularTypes: analytics?.popularTypes?.map((type) => ({ type: type.name, rooms: type.count })) ?? [],
    activeRooms: analytics?.totals?.activeRooms ?? 0,
    averageMembers: analytics?.totals?.membersInRooms ?? 0,
    completedRooms: analytics?.totals?.completedRooms ?? 0,
  };
}

function localSuggestion({ purpose, expectedMembers, tone, templates, stats, currentRoom }) {
  const match = inferFromPurpose(purpose);
  const rationales = match ? [...match.rationale] : [];
  let privacy = match?.privacy ?? 'PUBLIC';
  let userLimit = match?.userLimit ?? 0;
  let bitrate = match?.bitrate ?? 96000;
  let templateSlug = match?.slug ?? 'community-room';

  if (tone === 'competitive') {
    privacy = 'INVITE_ONLY';
    rationales.push('Competitive tone: locking the room prevents interruptions.');
  }
  if (tone === 'focused' && privacy === 'PUBLIC') {
    privacy = 'PRIVATE';
    rationales.push('Focused tone: a private room reduces distractions.');
  }
  if (expectedMembers) {
    userLimit = normalizeLimit(expectedMembers, userLimit);
    rationales.push(`Capacity set to ${expectedMembers} based on the expected group size.`);
  }
  if (!match && stats.popularTypes?.[0]) {
    rationales.push(`The most popular room type on this server recently is ${stats.popularTypes[0].type}.`);
  }
  if (currentRoom) {
    rationales.push(`Current room privacy is ${currentRoom.privacy.toLowerCase()}; the suggestion only changes settings after you confirm.`);
  }

  const template =
    templates.find((item) => item.slug === templateSlug) ??
    templates.find((item) => item.roomTypeKey && purpose.toLowerCase().includes(item.roomTypeKey)) ??
    templates[0] ??
    null;

  return {
    source: 'local',
    suggestions: {
      privacy,
      userLimit,
      bitrate,
      templateSlug: template?.slug ?? null,
      templateName: template?.name ?? null,
    },
    template: template ? { id: template.id, name: template.name, slug: template.slug, emoji: template.emoji } : null,
    rationale: rationales.length ? rationales.slice(0, 4) : ['A balanced public room keeps things simple.'],
  };
}

function sanitizeAiSuggestion(raw, templates, fallback) {
  const candidate = raw?.suggestions ?? raw;
  const privacy = PRIVACY_VALUES.includes(candidate?.privacy) ? candidate.privacy : fallback.suggestions.privacy;
  const userLimit = normalizeLimit(candidate?.userLimit, fallback.suggestions.userLimit);
  const bitrate = clamp(candidate?.bitrate ?? fallback.suggestions.bitrate, ROOM_LIMITS.bitrateMin, ROOM_LIMITS.bitrateMax);
  const templateSlug = templates.find((template) => template.slug === candidate?.templateSlug)?.slug
    ?? fallback.suggestions.templateSlug;
  const template = templates.find((item) => item.slug === templateSlug) ?? fallback.template;
  const rationale = Array.isArray(raw?.rationale)
    ? raw.rationale.filter((line) => typeof line === 'string').slice(0, 5).map((line) => line.slice(0, 200))
    : fallback.rationale;
  return {
    source: 'ai',
    suggestions: {
      privacy,
      userLimit,
      bitrate,
      templateSlug: template?.slug ?? templateSlug,
      templateName: template?.name ?? null,
    },
    template: template
      ? { id: template.id, name: template.name, slug: template.slug, emoji: template.emoji }
      : fallback.template,
    rationale: rationale.length ? rationale : fallback.rationale,
  };
}

async function callProvider({ purpose, expectedMembers, tone, stats, templates, currentRoom }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.ai.apiKey ? { Authorization: `Bearer ${config.ai.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.ai.model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are Chamber, a Discord temporary voice room assistant. Recommend room settings as strict JSON. Never claim to change anything. Allowed privacy values: PUBLIC, PRIVATE, INVITE_ONLY, REQUEST, PASSWORD, FRIENDS, ROLE_RESTRICTED. userLimit is 0 (unlimited) or 1-99. bitrate is 8000-384000. Choose templateSlug only from the provided templates. Respond with {"suggestions":{"privacy":"...","userLimit":0,"bitrate":64000,"templateSlug":"..."},"rationale":["..."]}.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              purpose,
              expectedMembers: expectedMembers ?? null,
              tone: tone ?? null,
              serverStats: stats,
              templates: templates.map((template) => ({
                slug: template.slug,
                name: template.name,
                roomType: template.roomTypeKey,
                privacy: template.defaultPrivacy,
                limit: template.defaultLimit,
              })),
              currentRoom: currentRoom
                ? { name: currentRoom.name, privacy: currentRoom.privacy, limit: currentRoom.userLimit }
                : null,
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI provider returned an empty response');
    return JSON.parse(content);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateSuggestions({ guildId, input, currentRoom = null }) {
  const [templates, stats] = await Promise.all([listTemplates(guildId), statsContext(guildId)]);
  const fallback = localSuggestion({ ...input, templates, stats, currentRoom });
  if (!config.ai.enabled) return fallback;
  if (!aiConfigured) {
    return { ...fallback, fallbackReason: 'AI is enabled but no provider is configured. Add AI_BASE_URL and AI_MODEL.' };
  }
  try {
    const raw = await callProvider({ ...input, stats, templates, currentRoom });
    return sanitizeAiSuggestion(raw, templates, fallback);
  } catch (error) {
    logger.warn({ err: error }, 'AI suggestion provider failed; using local heuristics');
    return { ...fallback, fallbackReason: 'The AI provider was unavailable, so the built-in heuristic engine answered.' };
  }
}

export default { generateSuggestions, aiStatus };
