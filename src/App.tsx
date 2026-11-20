// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Users, AlertCircle, Check, MapPin, Calendar, Clock, Save, Trash2, X, Plus,
  CheckSquare, ChevronLeft, ChevronRight, Lock, Mail, LogOut, ShieldCheck,
  KeyRound, Globe, UserPlus, Download, Search, Info, UserCheck, RefreshCw,
  Share2, Cloud, Pencil, Upload, Video, CalendarPlus, AlertTriangle
} from 'lucide-react';

// ============================================================================
// LIVE SUPABASE CONFIGURATION (West EU - Paris)
// ============================================================================
const SUPABASE_URL = 'https://zqasvlummmrpgewemeud.supabase.co';
const SUPABASE_ANON_KEY = "sb_publishable_yRrRjiNifOwkRmW7IqfN9Q_ndFQWsWm";

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GRID_HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00 to 23:00

const FALLBACK_IANA_ZONES = [
  'Africa/Cairo', 'Africa/Casablanca', 'Africa/Johannesburg', 'Africa/Lagos',
  'America/Buenos_Aires', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Mexico_City', 'America/New_York', 'America/Sao_Paulo', 'America/Toronto',
  'Asia/Bangkok', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Kolkata',
  'Asia/Manila', 'Asia/Riyadh', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore',
  'Asia/Tokyo', 'Australia/Melbourne', 'Australia/Sydney', 'Europe/Amsterdam',
  'Europe/Berlin', 'Europe/Brussels', 'Europe/Dublin', 'Europe/Istanbul',
  'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Milan',
  'Europe/Paris', 'Europe/Rome', 'Europe/Stockholm', 'Europe/Zurich',
  'Pacific/Auckland', 'UTC'
];

const ALL_IANA_ZONES = (() => {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      const supported = Intl.supportedValuesOf('timeZone');
      if (supported && supported.length > 0) return supported;
    }
  } catch {
    // fallback
  }
  return FALLBACK_IANA_ZONES;
})();

const DETECTED_TIMEZONE = (() => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && ALL_IANA_ZONES.includes(tz)) return tz;
  } catch {
    // fallback
  }
  return 'Europe/Paris';
})();

const FRI_SAT_WEEKEND_ZONES = new Set([
  'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Bahrain',
  'Asia/Muscat', 'Asia/Amman', 'Asia/Jerusalem', 'Africa/Cairo', 'Africa/Algiers'
]);

// --- SHA-256 Password Hashing (Web Crypto API) ---
const hashPassword = async (plainText) => {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoded = new TextEncoder().encode(plainText);
      const buffer = await crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fallback for non-HTTPS preview environments
  }
  let hash = 0;
  for (let i = 0; i < plainText.length; i++) {
    hash = ((hash << 5) - hash) + plainText.charCodeAt(i);
    hash |= 0;
  }
  return 'fb_' + Math.abs(hash).toString(16);
};

// --- Safe Clipboard Helper ---
const copyTextSafe = (text) => {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch {
    return false;
  }
};

// --- Supabase REST API Helper ---
const sbFetch = async (path, options = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Request failed');
    throw new Error(errText);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

// --- Standard IANA / Intl Timezone Helpers (DST-Aware) ---
const getUtcOffsetMinutes = (utcMs, timeZone) => {
  try {
    const date = new Date(utcMs);
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = dtf.formatToParts(date);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const hourVal = Number(map.hour) === 24 ? 0 : Number(map.hour);
    const asUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      hourVal,
      Number(map.minute),
      Number(map.second)
    );
    return Math.round((asUtc - utcMs) / 60000);
  } catch {
    return 0;
  }
};

const formatOffsetLabel = (offsetMin) => {
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hrs = Math.floor(abs / 60);
  const mins = abs % 60;
  return mins === 0 ? `UTC${sign}${hrs}` : `UTC${sign}${hrs}:${mins.toString().padStart(2, '0')}`;
};

const getZoneAbbreviation = (utcMs, timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(new Date(utcMs));
    return parts.find(p => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
};

const localToUtcMs = (year, monthIndex, day, hour, minute, timeZone) => {
  const guess = Date.UTC(year, monthIndex, day, hour, minute, 0);
  const offset1 = getUtcOffsetMinutes(guess, timeZone);
  const utc1 = guess - offset1 * 60000;
  const offset2 = getUtcOffsetMinutes(utc1, timeZone);
  const exactUtc = guess - offset2 * 60000;
  return Math.round(exactUtc / 1800000) * 1800000;
};

const getLocalParts = (utcMs, timeZone) => {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const hourNum = Number(map.hour) === 24 ? 0 : Number(map.hour);
    return {
      weekday: map.weekday || 'Mon',
      month: map.month || '',
      day: map.day || '',
      hourNum,
      hourStr: hourNum.toString().padStart(2, '0'),
      minuteStr: map.minute || '00',
      tzAbbr: map.timeZoneName || '',
    };
  } catch {
    const d = new Date(utcMs);
    return {
      weekday: DAYS[d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1],
      month: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
      day: String(d.getUTCDate()),
      hourNum: d.getUTCHours(),
      hourStr: d.getUTCHours().toString().padStart(2, '0'),
      minuteStr: d.getUTCMinutes().toString().padStart(2, '0'),
      tzAbbr: 'UTC',
    };
  }
};

const formatZoneOptionLabel = (tz, refUtcMs) => {
  const offsetMin = getUtcOffsetMinutes(refUtcMs, tz);
  const abbr = getZoneAbbreviation(refUtcMs, tz);
  const prettyName = tz.replace(/_/g, ' ');
  return `${prettyName} (${abbr ? abbr + ' • ' : ''}${formatOffsetLabel(offsetMin)})`;
};

const getMondayMidnightUtc = () => {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const day = now.getUTCDay() || 7;
  now.setUTCDate(now.getUTCDate() - day + 1);
  return now.getTime();
};

const CURRENT_MONDAY = getMondayMidnightUtc();

// --- ICS Calendar Helpers (Local Parsing + Export + Teams Link) ---
const formatIcsUtc = (utcMs) => {
  const d = new Date(utcMs);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
  );
};

const downloadMeetingIcs = (groupName, utcTimestamp, memberEmails = []) => {
  const startStr = formatIcsUtc(utcTimestamp);
  const endStr = formatIcsUtc(utcTimestamp + 3600 * 1000);
  const nowStr = formatIcsUtc(Date.now());
  const safeName = groupName.replace(/[,;\\]/g, ' ');
  const attendeesLines = memberEmails.map(em => `ATTENDEE;RSVP=TRUE:mailto:${em}`).join('\r\n');

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TimeSync GEMBA//SKEMA Cohort Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:timesync-${utcTimestamp}-${Math.random().toString(36).slice(2, 8)}@timesync-gemba`,
    `DTSTAMP:${nowStr}`,
    `DTSTART:${startStr}`,
    `DTEND:${endStr}`,
    `SUMMARY:GEMBA: ${safeName}`,
    `DESCRIPTION:Scheduled via TimeSync GEMBA.`,
    attendeesLines,
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `GEMBA-${groupName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`;
  a.click();
  URL.revokeObjectURL(url);
};

const buildTeamsMeetingUrl = (groupName, utcTimestamp, memberEmails = []) => {
  const startIso = new Date(utcTimestamp).toISOString();
  const endIso = new Date(utcTimestamp + 3600 * 1000).toISOString();
  const params = new URLSearchParams({
    subject: `GEMBA: ${groupName}`,
    startTime: startIso,
    endTime: endIso,
    content: `Study group session scheduled via TimeSync GEMBA.`,
  });
  if (memberEmails.length > 0) {
    params.set('attendees', memberEmails.join(','));
  }
  return `https://teams.microsoft.com/l/meeting/new?${params.toString()}`;
};

const parseIcsDateToUtcMs = (rawValue, paramStr = '', fallbackTz = DETECTED_TIMEZONE) => {
  if (!rawValue) return null;
  const val = rawValue.trim();

  const dateOnlyMatch = val.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnlyMatch) {
    return null;
  }

  const dtMatch = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!dtMatch) return null;

  const y = Number(dtMatch[1]);
  const m = Number(dtMatch[2]) - 1;
  const d = Number(dtMatch[3]);
  const hr = Number(dtMatch[4]);
  const min = Number(dtMatch[5]);
  const isUtc = Boolean(dtMatch[7]);

  if (isUtc) {
    return Date.UTC(y, m, d, hr, min, 0);
  }

  const tzMatch = paramStr.match(/TZID=([^;:]+)/i);
  let tz = fallbackTz;
  if (tzMatch && tzMatch[1]) {
    const candidate = tzMatch[1].replace(/^"|"$/g, '').trim();
    if (ALL_IANA_ZONES.includes(candidate)) {
      tz = candidate;
    }
  }
  return localToUtcMs(y, m, d, hr, min, tz);
};

const parseIcsFile = (icsText, fallbackTz) => {
  const unfolded = icsText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let inEvent = false;
  let current = {};

  const horizonStart = Date.now() - 14 * 24 * 3600 * 1000;
  const horizonEnd = Date.now() + 90 * 24 * 3600 * 1000;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      inEvent = false;
      if (current.start && current.end && current.end > current.start && current.transp !== 'TRANSPARENT') {
        const duration = current.end - current.start;
        const summary = current.summary || 'Busy';

        if (current.rrule && /FREQ=WEEKLY/i.test(current.rrule)) {
          const untilMatch = current.rrule.match(/UNTIL=([0-9TZ]+)/i);
          const countMatch = current.rrule.match(/COUNT=(\d+)/i);
          const intervalMatch = current.rrule.match(/INTERVAL=(\d+)/i);
          const intervalWeeks = intervalMatch ? Math.max(1, Number(intervalMatch[1])) : 1;
          const maxCount = countMatch ? Number(countMatch[1]) : 26;
          const untilMs = untilMatch ? (parseIcsDateToUtcMs(untilMatch[1], '', fallbackTz) || horizonEnd) : horizonEnd;

          let occStart = current.start;
          let count = 0;
          while (occStart <= Math.min(untilMs, horizonEnd) && count < maxCount) {
            if (occStart + duration >= horizonStart) {
              events.push({ start: occStart, end: occStart + duration, summary });
            }
            occStart += intervalWeeks * 7 * 24 * 3600 * 1000;
            count++;
          }
        } else if (current.end >= horizonStart && current.start <= horizonEnd) {
          events.push({ start: current.start, end: current.end, summary });
        }
      }
      continue;
    }

    if (!inEvent) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const left = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const semiIdx = left.indexOf(';');
    const propName = (semiIdx === -1 ? left : left.slice(0, semiIdx)).toUpperCase();
    const params = semiIdx === -1 ? '' : left.slice(semiIdx + 1);

    if (propName === 'DTSTART') {
      current.start = parseIcsDateToUtcMs(value, params, fallbackTz);
    } else if (propName === 'DTEND') {
      current.end = parseIcsDateToUtcMs(value, params, fallbackTz);
    } else if (propName === 'SUMMARY') {
      current.summary = value.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, ' ').trim();
    } else if (propName === 'RRULE') {
      current.rrule = value;
    } else if (propName === 'TRANSP') {
      current.transp = value.trim().toUpperCase();
    }
  }

  return events;
};

// --- Searchable IANA Timezone Picker ---
function TimezonePicker({ value, onChange, refUtcMs, placeholder = 'Search city or timezone (e.g. Paris, New York, Singapore)...', compact = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filteredZones = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const priority = [
        'Europe/Paris', 'Europe/London', 'Europe/Berlin', 'America/New_York',
        'America/Chicago', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Riyadh',
        'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'America/Sao_Paulo'
      ].filter(z => ALL_IANA_ZONES.includes(z));
      const rest = ALL_IANA_ZONES.filter(z => !priority.includes(z));
      return [...priority, ...rest].slice(0, 40);
    }
    return ALL_IANA_ZONES.filter(z => {
      const normalized = z.toLowerCase().replace(/_/g, ' ');
      const abbr = getZoneAbbreviation(refUtcMs, z).toLowerCase();
      return normalized.includes(q) || abbr.includes(q);
    }).slice(0, 40);
  }, [query, refUtcMs]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        className={`w-full text-left bg-white border border-slate-300 rounded-lg flex items-center justify-between gap-2 hover:border-indigo-400 focus:ring-2 focus:ring-indigo-500 outline-none transition-colors ${compact ? 'px-3 py-2 text-xs font-semibold text-blue-950 border-blue-200' : 'px-3 py-2.5 text-sm text-slate-800'}`}
      >
        <span className="truncate flex items-center gap-1.5">
          <Globe className="w-4 h-4 text-indigo-500 shrink-0" />
          <span className="truncate">{formatZoneOptionLabel(value, refUtcMs)}</span>
        </span>
        <span className="text-[10px] text-slate-400 shrink-0">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="p-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full text-xs bg-transparent outline-none text-slate-800 placeholder-slate-400"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
            {filteredZones.length === 0 ? (
              <div className="p-3 text-xs text-slate-400 text-center">No matching IANA timezone found.</div>
            ) : (
              filteredZones.map(tz => {
                const isSelected = tz === value;
                return (
                  <button
                    key={tz}
                    type="button"
                    onClick={() => {
                      onChange(tz);
                      setIsOpen(false);
                      setQuery('');
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-indigo-50 transition-colors ${isSelected ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700'}`}
                  >
                    <span className="truncate">{formatZoneOptionLabel(tz, refUtcMs)}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
          <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-500 flex items-center gap-1">
            <Info className="w-3 h-3 shrink-0" /> Standard IANA database • Daylight Saving Time (DST) is automatic.
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [cohort, setCohort] = useState([]);
  const [groups, setGroups] = useState([]);
  const [availabilities, setAvailabilities] = useState({});
  const [weekTimezones, setWeekTimezones] = useState({}); // { [userId]: { [weekMondayUtc]: 'Europe/Paris' } }
  const [confirmedMeetings, setConfirmedMeetings] = useState({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSavingAvail, setIsSavingAvail] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  // --- VPN-Resilient Batch Queue & In-Flight Slot Protection ---
  const pendingMutationsRef = useRef({});
  const inFlightMutationsRef = useRef({});
  const flushTimerRef = useRef(null);
  const isFlushingRef = useRef(false);
  const currentUserIdRef = useRef(null);

  // --- Touch / Thumb Scroll Guard (Prevents accidental slot toggles while panning on mobile) ---
  const touchGestureRef = useRef({
    startX: 0,
    startY: 0,
    moved: false,
    active: false,
    lastTouchTime: 0,
  });

  // Mobile Day Selector for Phone-Optimized Portrait View (0 = Mon ... 6 = Sun)
  const [mobileDayIdx, setMobileDayIdx] = useState(() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  });

  // Personal Local ICS Calendar Overlay (Never sent to Cloud)
  const [icsEvents, setIcsEvents] = useState([]);
  const [icsFileName, setIcsFileName] = useState('');
  const icsInputRef = useRef(null);

  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup' | 'reset'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authTimezone, setAuthTimezone] = useState(DETECTED_TIMEZONE);
  const [authGdprAccepted, setAuthGdprAccepted] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // App State
  const [currentUserId, setCurrentUserId] = useState(null);
  const [activeTab, setActiveTab] = useState('avail'); // 'avail' | 'groups' | 'privacy'
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [groupTab, setGroupTab] = useState('ranked'); // 'ranked' | 'heatmap' | 'members'
  const [slotDuration, setSlotDuration] = useState(60); // 60 | 30

  // Week State
  const [weekOffset, setWeekOffset] = useState(0);
  const currentBaseUtc = CURRENT_MONDAY + weekOffset * 7 * 24 * 3600 * 1000;

  // Heatmap Override & Interactive Slot Inspection
  const [heatmapUserId, setHeatmapUserId] = useState(null);
  const [hoveredHeatmapTs, setHoveredHeatmapTs] = useState(null);
  const [pinnedHeatmapTs, setPinnedHeatmapTs] = useState(null);

  // Group Creation State
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState([]);

  // Group Editing State (Organizer Only)
  const [isEditingGroup, setIsEditingGroup] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupMembers, setEditGroupMembers] = useState([]);
  const [confirmingDeleteGroup, setConfirmingDeleteGroup] = useState(false);

  // GDPR Account Deletion
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState('');

  // Quick Action Toggles
  const [toggles, setToggles] = useState({ typical: false, weekend: false, custom: false });
  const [customPreset, setCustomPreset] = useState([]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  const currentUser = cohort.find(u => u.id === currentUserId) || null;
  const activeGroup = groups.find(g => g.id === activeGroupId) || null;

  // Per-week timezone resolution
  const getUserTimezoneForWeek = useCallback((userObj, weekMondayUtc) => {
    if (!userObj) return DETECTED_TIMEZONE;
    return weekTimezones[userObj.id]?.[weekMondayUtc] || userObj.timezone || DETECTED_TIMEZONE;
  }, [weekTimezones]);

  const currentWeekOverrideTz = currentUser ? (weekTimezones[currentUser.id]?.[currentBaseUtc] || null) : null;
  const travelModeEnabled = Boolean(currentWeekOverrideTz);
  const activeTimezone = currentWeekOverrideTz || currentUser?.timezone || DETECTED_TIMEZONE;

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // --- Debounced Batch Flush to Supabase (Prevents Out-of-Order VPN Races) ---
  const flushPendingMutations = useCallback(async () => {
    const uid = currentUserIdRef.current;
    if (!uid || isFlushingRef.current) return;

    const entries = Object.entries(pendingMutationsRef.current);
    if (entries.length === 0) return;

    isFlushingRef.current = true;
    setIsSavingAvail(true);

    const batch = { ...pendingMutationsRef.current };
    pendingMutationsRef.current = {};
    inFlightMutationsRef.current = { ...inFlightMutationsRef.current, ...batch };

    const upserts = [];
    const deletes = [];
    for (const [tsStr, item] of Object.entries(batch)) {
      const utcTs = Number(tsStr);
      if (item.state) {
        upserts.push({
          user_id: uid,
          utc_ts: utcTs,
          state: item.state,
          week_timezone: item.tz,
        });
      } else {
        deletes.push(utcTs);
      }
    }

    try {
      if (upserts.length > 0) {
        await sbFetch('gemba_availabilities', {
          method: 'POST',
          body: JSON.stringify(upserts),
        });
      }
      if (deletes.length > 0) {
        for (let i = 0; i < deletes.length; i += 80) {
          const chunk = deletes.slice(i, i + 80).join(',');
          await sbFetch(`gemba_availabilities?user_id=eq.${encodeURIComponent(uid)}&utc_ts=in.(${chunk})`, {
            method: 'DELETE',
          });
        }
      }
      setSyncError('');
    } catch {
      for (const [tsStr, item] of Object.entries(batch)) {
        if (!(tsStr in pendingMutationsRef.current)) {
          pendingMutationsRef.current[tsStr] = item;
        }
      }
      setSyncError('Slow connection to EU Cloud — retrying save automatically...');
    } finally {
      for (const tsStr of Object.keys(batch)) {
        delete inFlightMutationsRef.current[tsStr];
      }
      isFlushingRef.current = false;

      if (Object.keys(pendingMutationsRef.current).length > 0) {
        flushTimerRef.current = setTimeout(() => {
          flushPendingMutations();
        }, 350);
      } else {
        setIsSavingAvail(false);
      }
    }
  }, []);

  const queueAvailabilityMutations = useCallback((upserts, deletes, tz) => {
    for (const { utcTs, state } of upserts) {
      pendingMutationsRef.current[String(utcTs)] = { state, tz };
    }
    for (const utcTs of deletes) {
      pendingMutationsRef.current[String(utcTs)] = { state: null, tz };
    }
    setIsSavingAvail(true);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flushPendingMutations();
    }, 350);
  }, [flushPendingMutations]);

  // Load saved local ICS overlay when user signs in
  useEffect(() => {
    if (!currentUser) {
      setIcsEvents([]);
      setIcsFileName('');
      return;
    }
    try {
      const raw = localStorage.getItem(`timesync_ics_${currentUser.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.events)) {
          setIcsEvents(parsed.events);
          setIcsFileName(parsed.fileName || 'calendar.ics');
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [currentUser?.id]);

  const handleIcsUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = String(ev.target?.result || '');
        const parsed = parseIcsFile(text, currentUser.timezone || DETECTED_TIMEZONE);
        setIcsEvents(parsed);
        setIcsFileName(file.name);
        localStorage.setItem(`timesync_ics_${currentUser.id}`, JSON.stringify({
          fileName: file.name,
          events: parsed,
        }));
        showToast(`Synced ${parsed.length} calendar events locally (private).`);
      } catch {
        showToast('Could not read .ics file. Please export a standard .ics calendar.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClearIcs = () => {
    if (!currentUser) return;
    setIcsEvents([]);
    setIcsFileName('');
    try {
      localStorage.removeItem(`timesync_ics_${currentUser.id}`);
    } catch {
      // ignore
    }
    showToast('Personal calendar overlay cleared.');
  };

  const getBusyIcsEvent = useCallback((slotUtcStart, durationMin) => {
    if (icsEvents.length === 0) return null;
    const slotEnd = slotUtcStart + durationMin * 60 * 1000;
    return icsEvents.find(ev => ev.start < slotEnd && ev.end > slotUtcStart) || null;
  }, [icsEvents]);

  // Returns the group's upcoming meeting only if it hasn't ended yet
  const getUpcomingMeeting = (groupId) => {
    const meeting = confirmedMeetings[groupId];
    if (!meeting) return null;
    if (meeting.utcTimestamp + 3600 * 1000 < Date.now()) return null;
    return meeting;
  };

  // --- Cloud Sync Loader (Supabase REST) ---
  const syncFromCloud = useCallback(async (forceFullRefresh = false) => {
    setIsSyncing(true);
    if (forceFullRefresh) setSyncError('');

    try {
      const [usersRows, groupsRows, availRows, meetingRows] = await Promise.all([
        sbFetch('gemba_users?select=*'),
        sbFetch('gemba_groups?select=*'),
        sbFetch('gemba_availabilities?select=*'),
        sbFetch('gemba_meetings?select=*'),
      ]);

      const mappedUsers = (usersRows || []).map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        passwordHash: r.password_hash,
        timezone: r.timezone,
        gdprConsentAt: r.gdpr_consent_at,
      }));
      const mappedGroups = (groupsRows || []).map(r => ({
        id: r.id,
        name: r.name,
        adminId: r.admin_id,
        members: Array.isArray(r.members) ? r.members : [],
      }));
      const cloudAvail = {};
      const mappedWeekTz = {};
      (availRows || []).forEach(r => {
        const ts = Number(r.utc_ts);
        if (r.state === 'tz_override' || ts < 0) {
          if (r.week_timezone) {
            if (!mappedWeekTz[r.user_id]) mappedWeekTz[r.user_id] = {};
            mappedWeekTz[r.user_id][Math.abs(ts)] = r.week_timezone;
          }
        } else {
          if (!cloudAvail[r.user_id]) cloudAvail[r.user_id] = {};
          cloudAvail[r.user_id][ts] = r.state;
        }
      });
      const mappedMeetings = {};
      (meetingRows || []).forEach(r => {
        mappedMeetings[r.group_id] = {
          utcTimestamp: Number(r.utc_ts),
          members: Array.isArray(r.members) ? r.members : [],
        };
      });

      const activeUid = currentUserIdRef.current;

      setAvailabilities(prev => {
        if (!activeUid) return cloudAvail;

        if (!forceFullRefresh && prev[activeUid]) {
          return {
            ...cloudAvail,
            [activeUid]: prev[activeUid],
          };
        }

        const mergedOwn = { ...(cloudAvail[activeUid] || {}) };
        const unconfirmed = {
          ...inFlightMutationsRef.current,
          ...pendingMutationsRef.current,
        };
        for (const [tsStr, item] of Object.entries(unconfirmed)) {
          if (item.state) mergedOwn[tsStr] = item.state;
          else delete mergedOwn[tsStr];
        }
        return {
          ...cloudAvail,
          [activeUid]: mergedOwn,
        };
      });

      setCohort(mappedUsers);
      setGroups(mappedGroups);
      setWeekTimezones(mappedWeekTz);
      setConfirmedMeetings(mappedMeetings);

      if (mappedUsers.length === 0 && !isAuthenticated) {
        setAuthMode('signup');
      }
      if (forceFullRefresh) {
        showToast('Synced latest updates from EU Cloud.');
      }
    } catch {
      if (forceFullRefresh) {
        setSyncError('Could not reach EU Cloud database. Tap Refresh to retry.');
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    syncFromCloud(false);
    const interval = setInterval(() => syncFromCloud(false), 20000);
    return () => clearInterval(interval);
  }, [syncFromCloud]);

  useEffect(() => {
    if (!currentUser) return;
    setHeatmapUserId(currentUser.id);
    setConfirmingDelete(false);
  }, [currentUser?.id]);

  // Reset quick-action toggle labels & heatmap selection when switching weeks or groups
  useEffect(() => {
    setToggles({ typical: false, weekend: false, custom: false });
    setHoveredHeatmapTs(null);
    setPinnedHeatmapTs(null);
  }, [weekOffset, activeGroupId]);

  // --- Save / Clear Per-Week Timezone Override ---
  const setWeekTimezoneOverride = async (newTz) => {
    if (!currentUser) return;
    const sentinelTs = -currentBaseUtc;

    setWeekTimezones(prev => {
      const userMap = { ...(prev[currentUser.id] || {}) };
      if (newTz) userMap[currentBaseUtc] = newTz;
      else delete userMap[currentBaseUtc];
      return { ...prev, [currentUser.id]: userMap };
    });

    try {
      if (newTz) {
        await sbFetch('gemba_availabilities', {
          method: 'POST',
          body: JSON.stringify([{
            user_id: currentUser.id,
            utc_ts: sentinelTs,
            state: 'tz_override',
            week_timezone: newTz,
          }]),
        });
      } else {
        await sbFetch(`gemba_availabilities?user_id=eq.${encodeURIComponent(currentUser.id)}&utc_ts=eq.${sentinelTs}`, {
          method: 'DELETE',
        });
      }
    } catch {
      setSyncError('Could not save weekly timezone to EU Cloud.');
    }
  };

  // --- ISO 8601 Week Formatting ---
  const getIsoWeekInfo = (weekMondayUtc) => {
    const thursday = new Date(weekMondayUtc + 3 * 24 * 3600 * 1000);
    const isoYear = thursday.getUTCFullYear();
    const yearStart = Date.UTC(isoYear, 0, 1);
    const isoWeek = Math.ceil((((thursday.getTime() - yearStart) / 86400000) + 1) / 7);

    const startD = new Date(weekMondayUtc);
    const endD = new Date(weekMondayUtc + 6 * 24 * 3600 * 1000);
    const startStr = startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const endStr = endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

    return {
      isoWeek: isoWeek.toString().padStart(2, '0'),
      range: `${startStr} – ${endStr}`,
    };
  };

  const weekInfo = (() => {
    const { isoWeek, range } = getIsoWeekInfo(currentBaseUtc);
    const relative = weekOffset === 0 ? 'This Week' : weekOffset === 1 ? 'Next Week' : weekOffset === -1 ? 'Last Week' : null;
    return {
      primary: `W${isoWeek} • ${range}`,
      relative,
      full: relative ? `${relative} (W${isoWeek}: ${range})` : `W${isoWeek} (${range})`
    };
  })();

  // --- Auth Handlers (@skema.edu enforced) ---
  const validateSkemaEmail = (email) => /^[^\s@]+@skema\.edu$/.test(email.trim().toLowerCase());

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');
    const normalizedEmail = authEmail.trim().toLowerCase();

    if (!validateSkemaEmail(normalizedEmail)) {
      setAuthError('Access is restricted to valid @skema.edu email addresses.');
      return;
    }

    setAuthLoading(true);
    try {
      const pwHash = await hashPassword(authPassword);

      if (authMode === 'login') {
        const existing = cohort.find(u => u.email.toLowerCase() === normalizedEmail);
        if (!existing) {
          setAuthError('No account found for this @skema.edu email. Please create an account first.');
          return;
        }
        if (existing.passwordHash !== pwHash) {
          setAuthError('Incorrect password. Try again or use "Forgot / Reset Password".');
          return;
        }
        pendingMutationsRef.current = {};
        inFlightMutationsRef.current = {};
        setCurrentUserId(existing.id);
        setIsAuthenticated(true);
        setAuthPassword('');
      } else if (authMode === 'signup') {
        if (!authName.trim()) {
          setAuthError('Please enter your full name.');
          return;
        }
        if (authPassword.length < 6) {
          setAuthError('Password must be at least 6 characters long.');
          return;
        }
        if (!authGdprAccepted) {
          setAuthError('Please confirm your GDPR consent before creating an account.');
          return;
        }
        if (cohort.some(u => u.email.toLowerCase() === normalizedEmail)) {
          setAuthError('An account with this @skema.edu email already exists. Please sign in.');
          return;
        }
        const newUser = {
          id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          name: authName.trim(),
          email: normalizedEmail,
          passwordHash: pwHash,
          timezone: authTimezone,
          gdprConsentAt: new Date().toISOString().split('T')[0],
        };

        await sbFetch('gemba_users', {
          method: 'POST',
          body: JSON.stringify({
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            password_hash: newUser.passwordHash,
            timezone: newUser.timezone,
            gdpr_consent_at: newUser.gdprConsentAt,
          }),
        });

        pendingMutationsRef.current = {};
        inFlightMutationsRef.current = {};
        setCohort(prev => [...prev, newUser]);
        setAvailabilities(prev => ({ ...prev, [newUser.id]: {} }));
        setCurrentUserId(newUser.id);
        setIsAuthenticated(true);
        setAuthPassword('');
        setAuthName('');
      } else if (authMode === 'reset') {
        const existing = cohort.find(u => u.email.toLowerCase() === normalizedEmail);
        if (!existing) {
          setAuthError('No account found for this @skema.edu email.');
          return;
        }
        if (authPassword.length < 6) {
          setAuthError('New password must be at least 6 characters long.');
          return;
        }

        await sbFetch(`gemba_users?id=eq.${encodeURIComponent(existing.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ password_hash: pwHash }),
        });

        setCohort(prev => prev.map(u => u.id === existing.id ? { ...u, passwordHash: pwHash } : u));
        setAuthSuccess('Password updated! You can now sign in with your new password.');
        setAuthPassword('');
        setAuthMode('login');
      }
    } catch {
      setAuthError('Could not save to EU Cloud database. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  // --- GDPR Export & Account Deletion ---
  const handleExportMyData = () => {
    if (!currentUser) return;
    const myData = {
      exportedAt: new Date().toISOString(),
      profile: {
        name: currentUser.name,
        email: currentUser.email,
        homeTimezone: currentUser.timezone,
        gdprConsentDate: currentUser.gdprConsentAt || 'N/A',
      },
      weeklyTimezoneOverrides: Object.entries(weekTimezones[currentUser.id] || {}).map(([wkTs, tz]) => ({
        weekStartingUtc: new Date(Number(wkTs)).toISOString().split('T')[0],
        timezone: tz,
      })),
      groups: groups.filter(g => g.members.includes(currentUser.id)).map(g => g.name),
      availabilitySlotsUtc: Object.entries(availabilities[currentUser.id] || {}).map(([ts, state]) => ({
        utcIso: new Date(Number(ts)).toISOString(),
        state,
      })),
    };
    const blob = new Blob([JSON.stringify(myData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesync-gemba-data-${currentUser.email.split('@')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setPrivacyNotice('Your personal data export (JSON) has been downloaded.');
  };

  const handleDeleteMyAccount = async () => {
    if (!currentUser) return;
    const idToDelete = currentUser.id;
    try {
      await sbFetch(`gemba_availabilities?user_id=eq.${encodeURIComponent(idToDelete)}`, { method: 'DELETE' });
      await sbFetch(`gemba_users?id=eq.${encodeURIComponent(idToDelete)}`, { method: 'DELETE' });
      const affectedGroups = groups.filter(g => g.members.includes(idToDelete));
      await Promise.all(
        affectedGroups.map(g =>
          sbFetch(`gemba_groups?id=eq.${encodeURIComponent(g.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ members: g.members.filter(mId => mId !== idToDelete) }),
          })
        )
      );
      localStorage.removeItem(`timesync_ics_${idToDelete}`);
    } catch {
      setPrivacyNotice('Could not complete cloud deletion. Please try again.');
      return;
    }

    pendingMutationsRef.current = {};
    inFlightMutationsRef.current = {};
    setAvailabilities(prev => {
      const next = { ...prev };
      delete next[idToDelete];
      return next;
    });
    setWeekTimezones(prev => {
      const next = { ...prev };
      delete next[idToDelete];
      return next;
    });
    setGroups(prev => prev.map(g => ({
      ...g,
      members: g.members.filter(mId => mId !== idToDelete)
    })));
    setConfirmedMeetings(prev => {
      const next = {};
      for (const [gId, m] of Object.entries(prev)) {
        next[gId] = { ...m, members: m.members.filter(mId => mId !== idToDelete) };
      }
      return next;
    });
    const remaining = cohort.filter(u => u.id !== idToDelete);
    setCohort(remaining);
    setCurrentUserId(null);
    setActiveGroupId(null);
    setIsEditingGroup(false);
    setConfirmingDelete(false);
    setIsAuthenticated(false);
    setAuthMode(remaining.length === 0 ? 'signup' : 'login');
    setAuthSuccess('Your account and all associated scheduling data have been permanently deleted.');
  };

  // --- Scheduling & Grid Helpers ---
  const getUserConfirmedMeeting = useCallback((userId, utcTimestamp) => {
    for (const [groupId, meeting] of Object.entries(confirmedMeetings)) {
      if (meeting.utcTimestamp === utcTimestamp && meeting.members.includes(userId)) {
        return groups.find(g => g.id === groupId);
      }
    }
    return null;
  }, [confirmedMeetings, groups]);

  const generateGrid = (timeZone, baseUtc, durationMin = 60) => {
    const grid = [];
    const minsList = durationMin === 30 ? [0, 30] : [0];
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const dayDate = new Date(baseUtc + dayIdx * 24 * 3600 * 1000);
      const y = dayDate.getUTCFullYear();
      const m = dayDate.getUTCMonth();
      const dt = dayDate.getUTCDate();
      const slots = [];
      GRID_HOURS.forEach(h => {
        minsList.forEach(min => {
          slots.push({
            localHour: h,
            localMinute: min,
            label: `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`,
            utcTimestamp: localToUtcMs(y, m, dt, h, min, timeZone),
          });
        });
      });
      grid.push({ dayName: DAYS[dayIdx], dateStr: dt, slots });
    }
    return grid;
  };

  // Grey <-> Amber toggle for ICS-busy slots; normal 3-state cycle for free slots
  const cycleState = (utcTimestamp) => {
    if (!currentUser) return;
    if (getUserConfirmedMeeting(currentUser.id, utcTimestamp)) return;
    const current = availabilities[currentUser.id]?.[utcTimestamp] || 'unavailable';
    const isBusyInIcs = Boolean(getBusyIcsEvent(utcTimestamp, slotDuration));

    let nextState = null;
    if (isBusyInIcs) {
      nextState = current === 'unavailable' ? 'available' : null;
    } else {
      if (current === 'unavailable') nextState = 'available';
      else if (current === 'available') nextState = 'preferred';
    }

    setAvailabilities(prev => {
      const userAvail = { ...(prev[currentUser.id] || {}) };
      if (nextState) userAvail[utcTimestamp] = nextState;
      else delete userAvail[utcTimestamp];
      return { ...prev, [currentUser.id]: userAvail };
    });

    if (nextState) {
      queueAvailabilityMutations([{ utcTs: utcTimestamp, state: nextState }], [], activeTimezone);
    } else {
      queueAvailabilityMutations([], [utcTimestamp], activeTimezone);
    }
  };

  // --- Touch-Safe Slot Tap Handlers (Ignores thumb drags > 8px) ---
  const handleSlotTouchStart = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    touchGestureRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      moved: false,
      active: true,
      lastTouchTime: Date.now(),
    };
  };

  const handleSlotTouchMove = (e) => {
    if (!touchGestureRef.current.active) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - touchGestureRef.current.startX);
    const dy = Math.abs(t.clientY - touchGestureRef.current.startY);
    if (dx > 8 || dy > 8) {
      touchGestureRef.current.moved = true;
    }
  };

  const handleSlotTouchEnd = (e, utcTimestamp) => {
    const g = touchGestureRef.current;
    g.lastTouchTime = Date.now();
    const wasTap = g.active && !g.moved;
    g.active = false;
    g.moved = false;
    if (wasTap) {
      if (e.cancelable) e.preventDefault(); // Prevent synthetic delayed mouse click
      cycleState(utcTimestamp);
    }
  };

  const handleSlotClick = (utcTimestamp) => {
    // Ignore synthetic click events fired right after a touch gesture
    if (Date.now() - touchGestureRef.current.lastTouchTime < 500) return;
    cycleState(utcTimestamp);
  };

  const applyLocalPattern = (conditionFn, isAdding) => {
    if (!currentUser) return;
    const grid = generateGrid(activeTimezone, currentBaseUtc, slotDuration);
    const upserts = [];
    const deletes = [];

    setAvailabilities(prev => {
      const userAvail = { ...(prev[currentUser.id] || {}) };
      grid.forEach((day, dayIdx) => {
        day.slots.forEach(slot => {
          if (conditionFn(dayIdx, slot.localHour)) {
            if (isAdding) {
              userAvail[slot.utcTimestamp] = 'available';
              upserts.push({ utcTs: slot.utcTimestamp, state: 'available' });
            } else {
              delete userAvail[slot.utcTimestamp];
              deletes.push(slot.utcTimestamp);
            }
          }
        });
      });
      return { ...prev, [currentUser.id]: userAvail };
    });

    queueAvailabilityMutations(upserts, deletes, activeTimezone);
  };

  const clearWeek = () => {
    if (!currentUser) return;
    const grid = generateGrid(activeTimezone, currentBaseUtc, 30);
    const deletes = [];
    setAvailabilities(prev => {
      const userAvail = { ...(prev[currentUser.id] || {}) };
      grid.forEach(day => {
        day.slots.forEach(slot => {
          if (userAvail[slot.utcTimestamp]) {
            delete userAvail[slot.utcTimestamp];
            deletes.push(slot.utcTimestamp);
          }
        });
      });
      return { ...prev, [currentUser.id]: userAvail };
    });
    setToggles({ typical: false, weekend: false, custom: false });
    queueAvailabilityMutations([], deletes, activeTimezone);
  };

  const isFriSatWeekend = FRI_SAT_WEEKEND_ZONES.has(activeTimezone);

  const toggleTypical = () => {
    const isAdding = !toggles.typical;
    applyLocalPattern((dayIdx, h) => {
      const isWeekend = isFriSatWeekend ? (dayIdx === 4 || dayIdx === 5) : (dayIdx === 5 || dayIdx === 6);
      return !isWeekend && h >= 18 && h < 22;
    }, isAdding);
    setToggles(prev => ({ ...prev, typical: isAdding }));
  };

  const toggleWeekend = () => {
    const isAdding = !toggles.weekend;
    applyLocalPattern((dayIdx, h) => {
      const isWeekend = isFriSatWeekend ? (dayIdx === 4 || dayIdx === 5) : (dayIdx === 5 || dayIdx === 6);
      return isWeekend && h >= 9 && h < 17;
    }, isAdding);
    setToggles(prev => ({ ...prev, weekend: isAdding }));
  };

  const toggleCustom = () => {
    if (!currentUser || customPreset.length === 0) return;
    const isAdding = !toggles.custom;
    const grid = generateGrid(activeTimezone, currentBaseUtc, slotDuration);
    const upserts = [];
    const deletes = [];

    setAvailabilities(prev => {
      const userAvail = { ...(prev[currentUser.id] || {}) };
      customPreset.forEach(({ dayIdx, hour, minute }) => {
        const slot = grid[dayIdx]?.slots.find(s => s.localHour === hour && s.localMinute === minute);
        if (slot) {
          if (isAdding) {
            userAvail[slot.utcTimestamp] = 'available';
            upserts.push({ utcTs: slot.utcTimestamp, state: 'available' });
          } else {
            delete userAvail[slot.utcTimestamp];
            deletes.push(slot.utcTimestamp);
          }
        }
      });
      return { ...prev, [currentUser.id]: userAvail };
    });
    setToggles(prev => ({ ...prev, custom: isAdding }));
    queueAvailabilityMutations(upserts, deletes, activeTimezone);
  };

  const saveCustomPreset = () => {
    if (!currentUser) return;
    const userAvail = availabilities[currentUser.id] || {};
    const grid = generateGrid(activeTimezone, currentBaseUtc, slotDuration);
    const saved = [];
    grid.forEach((day, dayIdx) => {
      day.slots.forEach(slot => {
        if (userAvail[slot.utcTimestamp] && userAvail[slot.utcTimestamp] !== 'unavailable') {
          saved.push({ dayIdx, hour: slot.localHour, minute: slot.localMinute });
        }
      });
    });
    setCustomPreset(saved);
    setToggles(prev => ({ ...prev, custom: true }));
    showToast('Custom preset saved!');
  };

  // --- Group CRUD Handlers ---
  const handleCreateGroup = async () => {
    if (!currentUser || !newGroupName.trim() || newGroupMembers.length === 0) return;
    const newGroup = {
      id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      name: newGroupName.trim(),
      adminId: currentUser.id,
      members: newGroupMembers,
    };

    try {
      await sbFetch('gemba_groups', {
        method: 'POST',
        body: JSON.stringify({
          id: newGroup.id,
          name: newGroup.name,
          admin_id: newGroup.adminId,
          members: newGroup.members,
        }),
      });
      setGroups(prev => [...prev, newGroup]);
      setIsCreatingGroup(false);
      setNewGroupName('');
      setNewGroupMembers([currentUser.id]);
      showToast(`Group "${newGroup.name}" created!`);
    } catch {
      setSyncError('Could not save group to EU Cloud.');
    }
  };

  const openEditGroup = (group) => {
    setEditGroupName(group.name);
    setEditGroupMembers([...group.members]);
    setConfirmingDeleteGroup(false);
    setIsEditingGroup(true);
  };

  const handleUpdateGroup = async () => {
    if (!currentUser || !activeGroup || !editGroupName.trim() || editGroupMembers.length === 0) return;
    const trimmedName = editGroupName.trim();
    const updatedMembers = Array.from(new Set([...editGroupMembers, currentUser.id]));

    try {
      await sbFetch(`gemba_groups?id=eq.${encodeURIComponent(activeGroup.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: trimmedName,
          members: updatedMembers,
        }),
      });

      if (confirmedMeetings[activeGroup.id]) {
        await sbFetch(`gemba_meetings?group_id=eq.${encodeURIComponent(activeGroup.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ members: updatedMembers }),
        });
        setConfirmedMeetings(prev => ({
          ...prev,
          [activeGroup.id]: { ...prev[activeGroup.id], members: updatedMembers },
        }));
      }

      setGroups(prev =>
        prev.map(g => g.id === activeGroup.id ? { ...g, name: trimmedName, members: updatedMembers } : g)
      );
      setIsEditingGroup(false);
      showToast(`Group "${trimmedName}" updated!`);
    } catch {
      setSyncError('Could not update group in EU Cloud.');
    }
  };

  const handleDeleteGroup = async () => {
    if (!activeGroup) return;
    const groupId = activeGroup.id;
    const groupName = activeGroup.name;

    try {
      await sbFetch(`gemba_meetings?group_id=eq.${encodeURIComponent(groupId)}`, { method: 'DELETE' });
      await sbFetch(`gemba_groups?id=eq.${encodeURIComponent(groupId)}`, { method: 'DELETE' });

      setGroups(prev => prev.filter(g => g.id !== groupId));
      setConfirmedMeetings(prev => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      setIsEditingGroup(false);
      setConfirmingDeleteGroup(false);
      setActiveGroupId(null);
      showToast(`Group "${groupName}" deleted.`);
    } catch {
      setSyncError('Could not delete group from EU Cloud.');
    }
  };

  const handleConfirmMeeting = async (group, utcTimestamp) => {
    const meetingData = { utcTimestamp, members: group.members };
    try {
      await sbFetch('gemba_meetings', {
        method: 'POST',
        body: JSON.stringify({
          group_id: group.id,
          utc_ts: utcTimestamp,
          members: group.members,
        }),
      });
      setConfirmedMeetings(prev => ({ ...prev, [group.id]: meetingData }));
      showToast('Next meeting locked across all groups!');
    } catch {
      setSyncError('Could not confirm meeting in EU Cloud.');
    }
  };

  const handleUnconfirmMeeting = async (groupId) => {
    try {
      await sbFetch(`gemba_meetings?group_id=eq.${encodeURIComponent(groupId)}`, {
        method: 'DELETE',
      });
      setConfirmedMeetings(prev => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      showToast('Meeting unlocked for re-scheduling.');
    } catch {
      setSyncError('Could not unconfirm meeting in EU Cloud.');
    }
  };

  const handleCopyInviteLink = () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const copied = copyTextSafe(url);
    showToast(copied ? 'App link copied! Share it with your GEMBA teammates.' : 'Share this page URL with your GEMBA teammates.');
  };

  const formatTimeForZoneFull = (utcTimestamp, timeZone) => {
    const p = getLocalParts(utcTimestamp, timeZone);
    return `${p.weekday}, ${p.month} ${p.day} • ${p.hourStr}:${p.minuteStr} ${p.tzAbbr}`;
  };

  const formatTimeForZoneShort = (utcTimestamp, timeZone) => {
    const p = getLocalParts(utcTimestamp, timeZone);
    return `${p.hourStr}:${p.minuteStr} ${p.tzAbbr}`;
  };

  // --- Member Breakdown Helper for any UTC Timestamp ---
  const getMemberBreakdownForSlot = useCallback((group, utcTimestamp) => {
    if (!group) return [];
    return group.members
      .map(memberId => cohort.find(u => u.id === memberId))
      .filter(Boolean)
      .map(userObj => {
        let state = availabilities[userObj.id]?.[utcTimestamp] || 'unavailable';
        const blockedByGroup = getUserConfirmedMeeting(userObj.id, utcTimestamp);
        if (blockedByGroup) {
          state = 'blocked';
        }
        const memberWeekTz = getUserTimezoneForWeek(userObj, currentBaseUtc);
        const local = getLocalParts(utcTimestamp, memberWeekTz);
        const isBadHour = local.hourNum >= 23 || local.hourNum < 6;
        return {
          user: userObj,
          memberWeekTz,
          state,
          blockedGroupName: blockedByGroup?.name || null,
          localHour: local.hourNum,
          isBadHour,
        };
      });
  }, [cohort, availabilities, getUserConfirmedMeeting, getUserTimezoneForWeek, currentBaseUtc]);

  // --- Overlap Engine (uses each member's timezone for the active week) ---
  const { rankedSlots, heatmapData } = useMemo(() => {
    if (!activeGroup) return { rankedSlots: [], heatmapData: {} };

    const availableSlots = [];
    const hMap = {};

    const startUtc = currentBaseUtc - 14 * 3600 * 1000;
    const endUtc = currentBaseUtc + (7 * 24 + 14) * 3600 * 1000;
    const minNeeded = activeGroup.members.length <= 1 ? 1 : 2;
    const stepMs = 1800 * 1000;

    for (let utcTimestamp = startUtc; utcTimestamp < endUtc; utcTimestamp += stepMs) {
      let totalFree = 0;
      let preferredCount = 0;
      let badHourPenalty = 0;

      const memberStatuses = getMemberBreakdownForSlot(activeGroup, utcTimestamp);
      memberStatuses.forEach(ms => {
        if (ms.state === 'available' || ms.state === 'preferred') {
          totalFree++;
          if (ms.state === 'preferred') preferredCount++;
          if (ms.isBadHour) badHourPenalty++;
        }
      });

      hMap[utcTimestamp] = totalFree;

      const inCurrentWeek = utcTimestamp >= currentBaseUtc && utcTimestamp < currentBaseUtc + 7 * 24 * 3600 * 1000;
      if (inCurrentWeek && totalFree >= minNeeded) {
        availableSlots.push({
          utcTimestamp,
          totalFree,
          preferredCount,
          totalMembers: memberStatuses.length,
          badHourPenalty,
          memberStatuses,
        });
      }
    }

    const sorted = availableSlots
      .sort((a, b) => {
        if (b.totalFree !== a.totalFree) return b.totalFree - a.totalFree;
        if (b.preferredCount !== a.preferredCount) return b.preferredCount - a.preferredCount;
        return a.badHourPenalty - b.badHourPenalty;
      })
      .slice(0, 10);

    return { rankedSlots: sorted, heatmapData: hMap };
  }, [activeGroup, currentBaseUtc, getMemberBreakdownForSlot]);

  // --- LOGIN / SIGNUP / RESET PORTAL ---
  if (!isAuthenticated || !currentUser) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-900 text-white p-6 text-center">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-3 shadow-md">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">TimeSync GEMBA</h1>
            <p className="text-slate-400 text-xs mt-1">SKEMA GEMBA Cross-Timezone Scheduler</p>
            <div className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full bg-slate-800 text-emerald-300 border border-slate-700">
              <Cloud className="w-3 h-3" />
              EU Cloud Synced (Paris)
            </div>
          </div>

          <div className="flex border-b border-slate-200 bg-slate-50 text-sm font-semibold">
            <button
              type="button"
              onClick={() => { setAuthMode('login'); setAuthError(''); setAuthSuccess(''); }}
              className={`flex-1 py-3 transition-colors ${authMode === 'login' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode('signup'); setAuthError(''); setAuthSuccess(''); }}
              className={`flex-1 py-3 transition-colors ${authMode === 'signup' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="p-6 flex flex-col gap-4">
            {authError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}
            {authSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs p-3 rounded-lg flex items-start gap-2">
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{authSuccess}</span>
              </div>
            )}

            {authMode === 'reset' && (
              <div className="text-xs text-slate-600 bg-indigo-50 border border-indigo-100 p-3 rounded-lg">
                Enter your <strong>@skema.edu</strong> email and choose a new password to reset your access.
              </div>
            )}

            {authMode === 'signup' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Firstname Lastname"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  className="w-full p-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">SKEMA Email (@skema.edu required)</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  placeholder="firstname.lastname@skema.edu"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {authMode === 'reset' ? 'New Password' : 'Password'}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  placeholder={authMode === 'login' ? 'Enter password' : 'Min. 6 characters'}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>

            {authMode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Home Timezone (Standard IANA • DST Automatic)
                  </label>
                  <TimezonePicker
                    value={authTimezone}
                    onChange={setAuthTimezone}
                    refUtcMs={currentBaseUtc}
                  />
                </div>

                <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <input
                    type="checkbox"
                    checked={authGdprAccepted}
                    onChange={(e) => setAuthGdprAccepted(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    <strong>GDPR Consent:</strong> Independent student tool hosted in EU (Paris). I consent to share my name, @skema.edu email, broad IANA timezone, and weekly availability with my GEMBA cohort. I can export or delete my account anytime.
                  </span>
                </label>
              </>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 text-sm mt-1"
            >
              {authMode === 'login' && <><Lock className="w-4 h-4" /> {authLoading ? 'Signing in...' : 'Sign In'}</>}
              {authMode === 'signup' && <><UserPlus className="w-4 h-4" /> {authLoading ? 'Creating account...' : 'Join GEMBA Cohort'}</>}
              {authMode === 'reset' && <><KeyRound className="w-4 h-4" /> {authLoading ? 'Updating...' : 'Reset Password'}</>}
            </button>

            <div className="flex items-center justify-between text-xs pt-1">
              {authMode === 'login' ? (
                <button
                  type="button"
                  onClick={() => { setAuthMode('reset'); setAuthError(''); setAuthSuccess(''); }}
                  className="text-indigo-600 hover:underline font-medium"
                >
                  Forgot / Reset Password?
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setAuthMode('login'); setAuthError(''); setAuthSuccess(''); }}
                  className="text-slate-500 hover:text-slate-800 font-medium"
                >
                  ← Back to Sign In
                </button>
              )}
              <span className="text-slate-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> GDPR Compliant
              </span>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const isGroupAdmin = activeGroup ? (!activeGroup.adminId || activeGroup.adminId === currentUser.id) : false;
  const activeUpcomingMeeting = activeGroup ? getUpcomingMeeting(activeGroup.id) : null;
  const showWeekNav = activeTab === 'avail' || (activeTab === 'groups' && Boolean(activeGroup) && !isCreatingGroup && !isEditingGroup);

  const activeGroupMemberEmails = activeGroup
    ? activeGroup.members
        .map(id => cohort.find(u => u.id === id)?.email)
        .filter(Boolean)
    : [];

  // Heatmap inspected slot (hover takes priority, otherwise pinned tap)
  const inspectedHeatmapTs = hoveredHeatmapTs ?? pinnedHeatmapTs;
  const heatmapViewUser = cohort.find(u => u.id === heatmapUserId) || currentUser;
  const heatmapViewTz = getUserTimezoneForWeek(heatmapViewUser, currentBaseUtc);
  const inspectedStatuses = (activeGroup && inspectedHeatmapTs)
    ? getMemberBreakdownForSlot(activeGroup, inspectedHeatmapTs)
    : [];
  const inspectedFreeList = inspectedStatuses.filter(ms => ms.state === 'available' || ms.state === 'preferred');
  const inspectedBusyList = inspectedStatuses.filter(ms => ms.state !== 'available' && ms.state !== 'preferred');

  // Pre-build week grid for My Avail (used by both Mobile Day View and Desktop Matrix View)
  const availWeekGrid = activeTab === 'avail'
    ? generateGrid(activeTimezone, currentBaseUtc, slotDuration)
    : [];
  const activeMobileDay = availWeekGrid[mobileDayIdx] || availWeekGrid[0];

  // --- MAIN APP SHELL ---
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col max-w-3xl mx-auto shadow-xl relative">
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <header className="bg-slate-900 text-white p-3.5 sm:p-4 flex justify-between items-center shrink-0 z-20 gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-base sm:text-lg tracking-tight truncate">TimeSync GEMBA</h1>
            {isSavingAvail ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                Saving...
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span className="hidden xs:inline">EU Cloud</span> Synced
              </span>
            )}
          </div>
          <p className="text-slate-400 text-xs truncate">
            Signed in as <span className="text-slate-200 font-medium">{currentUser.name}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={() => syncFromCloud(true)}
            disabled={isSyncing}
            title="Refresh latest cohort updates"
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition-colors flex items-center gap-1 text-xs"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-indigo-400' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={handleCopyInviteLink}
            title="Copy invite link for teammates"
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition-colors flex items-center gap-1 text-xs"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Invite</span>
          </button>
          <button
            onClick={() => { setIsAuthenticated(false); setActiveGroupId(null); setIsEditingGroup(false); }}
            title="Sign Out"
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {syncError && (
        <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4 shrink-0" /> {syncError}</span>
          <button onClick={() => setSyncError('')} className="text-red-500 hover:text-red-800"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Global ISO 8601 Week Navigator (Only shown on My Avail & Group Detail) */}
      {showWeekNav && (
        <div className="bg-slate-800 text-slate-200 px-3 sm:px-4 py-2 flex items-center justify-between text-xs sm:text-sm shadow-inner z-10 shrink-0 border-t border-slate-700">
          <button onClick={() => setWeekOffset(w => w - 1)} className="px-2 py-1 hover:bg-slate-700 hover:text-white rounded flex items-center gap-1 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <div className="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-2 text-center">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-400" />
              <span>{weekInfo.primary}</span>
            </div>
            {weekInfo.relative && (
              <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider bg-indigo-500/30 text-indigo-200 px-2 py-0.5 rounded-full border border-indigo-400/30">
                {weekInfo.relative}
              </span>
            )}
          </div>
          <button onClick={() => setWeekOffset(w => w + 1)} className="px-2 py-1 hover:bg-slate-700 hover:text-white rounded flex items-center gap-1 transition-colors">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TAB 1: MY AVAIL */}
      {activeTab === 'avail' && (
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          <div className="bg-blue-50 border-b border-blue-100 p-2.5 sm:p-3 px-3 sm:px-4 flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-blue-900 font-semibold text-xs sm:text-sm min-w-0">
                <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="truncate">
                  {travelModeEnabled
                    ? `Traveling (${weekInfo.primary.split(' • ')[0]}): ${activeTimezone.replace(/_/g, ' ')}`
                    : `Home: ${currentUser.timezone.replace(/_/g, ' ')}`}
                </span>
              </div>
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-blue-800 shrink-0">
                <span>Travel</span>
                <input
                  type="checkbox"
                  checked={travelModeEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) setWeekTimezoneOverride(currentUser.timezone);
                    else setWeekTimezoneOverride(null);
                  }}
                  className="rounded border-blue-300 text-indigo-600 focus:ring-indigo-500"
                />
              </label>
            </div>
            {travelModeEnabled && (
              <TimezonePicker
                value={activeTimezone}
                onChange={(tz) => setWeekTimezoneOverride(tz)}
                refUtcMs={currentBaseUtc}
                compact
              />
            )}
          </div>

          {/* Toolbar: Horizontally scrollable on mobile so it stays compact and never crowds the grid */}
          <div className="p-2.5 sm:p-4 border-b border-slate-100 shrink-0 bg-slate-50">
            <div className="flex sm:flex-wrap gap-1.5 sm:gap-2 items-center overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
              <button
                onClick={toggleTypical}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border shadow-sm shrink-0 ${toggles.typical ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}
              >
                Typical Week {toggles.typical ? '✓' : '+'}
              </button>
              <button
                onClick={toggleWeekend}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border shadow-sm shrink-0 ${toggles.weekend ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}
              >
                {isFriSatWeekend ? 'Fri–Sat' : 'Weekend'} {toggles.weekend ? '✓' : '+'}
              </button>

              <button
                onClick={toggleCustom}
                disabled={customPreset.length === 0}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border shadow-sm shrink-0 ${customPreset.length === 0 ? 'opacity-50 cursor-not-allowed bg-slate-100 text-slate-400' : toggles.custom ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}
              >
                Preset {customPreset.length > 0 ? (toggles.custom ? '✓' : '+') : '(Empty)'}
              </button>
              <button
                onClick={saveCustomPreset}
                title="Save current week as custom preset"
                className="px-2.5 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 shadow-sm transition-colors text-xs font-medium flex items-center gap-1 shrink-0"
              >
                <Save className="w-3.5 h-3.5" /> Save Preset
              </button>

              {/* Personal Local .ics Calendar Overlay */}
              <input
                ref={icsInputRef}
                type="file"
                accept=".ics,text/calendar"
                onChange={handleIcsUpload}
                className="hidden"
              />
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => icsInputRef.current?.click()}
                  title="Overlay your Outlook/Google/Apple .ics calendar locally (private, never uploaded)"
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 shadow-sm transition-colors flex items-center gap-1.5 shrink-0"
                >
                  <Upload className="w-3.5 h-3.5 text-indigo-600" />
                  <span>{icsFileName ? 'Replace .ics' : 'Import .ics'}</span>
                </button>
                {icsFileName && (
                  <button
                    onClick={handleClearIcs}
                    title={`Clear calendar overlay (${icsFileName})`}
                    className="p-1.5 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50 shadow-sm transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <button
                onClick={clearWeek}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-white text-red-600 border border-red-200 hover:bg-red-50 shadow-sm transition-colors sm:ml-auto flex items-center gap-1 shrink-0"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5 text-[11px] text-slate-500">
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block"></span> Available</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-700 inline-block"></span> Preferred</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block"></span> Confirmed</span>
                {icsEvents.length > 0 && (
                  <>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-300 inline-block"></span> Busy</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block"></span> Conflict</span>
                  </>
                )}
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-semibold">
                <button
                  onClick={() => setSlotDuration(60)}
                  className={`px-2.5 py-1 rounded-md transition-colors ${slotDuration === 60 ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  1h Slots
                </button>
                <button
                  onClick={() => setSlotDuration(30)}
                  className={`px-2.5 py-1 rounded-md transition-colors ${slotDuration === 30 ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  30m Slots
                </button>
              </div>
            </div>
          </div>

          {/* ================================================================= */}
          {/* MOBILE-OPTIMIZED PORTRAIT DAY VIEW (< 640px) — Zero Side-Scroll   */}
          {/* ================================================================= */}
          <div className="flex-1 flex flex-col overflow-hidden sm:hidden bg-white">
            {/* Day Selector Pills (Mon - Sun with slot count badge) */}
            <div className="grid grid-cols-7 gap-1 p-2 bg-slate-100 border-b border-slate-200 shrink-0">
              {availWeekGrid.map((day, idx) => {
                const isSelected = idx === mobileDayIdx;
                const freeCount = day.slots.filter(s => {
                  const st = availabilities[currentUser.id]?.[s.utcTimestamp];
                  return st === 'available' || st === 'preferred';
                }).length;
                return (
                  <button
                    key={day.dayName}
                    type="button"
                    onClick={() => setMobileDayIdx(idx)}
                    className={`py-1.5 px-1 rounded-lg flex flex-col items-center justify-center transition-all ${isSelected ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200'}`}
                  >
                    <span className="text-[10px] font-bold uppercase leading-tight">{day.dayName}</span>
                    <span className={`text-xs font-semibold leading-tight mt-0.5 ${isSelected ? 'text-indigo-100' : 'text-slate-800'}`}>{day.dateStr}</span>
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full ${freeCount > 0 ? (isSelected ? 'bg-emerald-300' : 'bg-blue-500') : 'bg-transparent'}`}></span>
                  </button>
                );
              })}
            </div>

            {/* Vertical Touch-Safe Slot List for Selected Day */}
            <div className="flex-1 overflow-y-auto p-3 pb-6 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-slate-500 px-1 pb-1">
                <span className="font-bold text-slate-800">
                  {activeMobileDay?.dayName}, {activeMobileDay?.dateStr}
                </span>
                <span>Tap a slot to cycle status</span>
              </div>

              {activeMobileDay?.slots.map(slot => {
                const state = availabilities[currentUser.id]?.[slot.utcTimestamp] || 'unavailable';
                const confirmedGroup = getUserConfirmedMeeting(currentUser.id, slot.utcTimestamp);
                const busyEvent = confirmedGroup ? null : getBusyIcsEvent(slot.utcTimestamp, slotDuration);
                const isConflict = Boolean(busyEvent && (state === 'available' || state === 'preferred'));

                let cardStyle = 'bg-white border-slate-200 text-slate-700';
                let badgeText = 'Unavailable';
                let badgeStyle = 'bg-slate-100 text-slate-400';

                if (confirmedGroup) {
                  cardStyle = 'bg-emerald-500 border-emerald-600 text-white shadow-sm';
                  badgeText = `Confirmed: ${confirmedGroup.name}`;
                  badgeStyle = 'bg-emerald-600/60 text-white';
                } else if (isConflict) {
                  cardStyle = 'bg-amber-100 border-amber-400 text-amber-950';
                  badgeText = `Free • Conflict: ${busyEvent.summary}`;
                  badgeStyle = 'bg-amber-400 text-amber-950 font-bold';
                } else if (busyEvent) {
                  cardStyle = 'bg-slate-100 border-slate-300 text-slate-500';
                  badgeText = `Busy (.ics): ${busyEvent.summary}`;
                  badgeStyle = 'bg-slate-200 text-slate-600';
                } else if (state === 'available') {
                  cardStyle = 'bg-blue-50 border-blue-400 text-blue-950';
                  badgeText = 'Available';
                  badgeStyle = 'bg-blue-500 text-white font-semibold';
                } else if (state === 'preferred') {
                  cardStyle = 'bg-indigo-700 border-indigo-800 text-white shadow-sm';
                  badgeText = '★ Preferred';
                  badgeStyle = 'bg-indigo-900/60 text-indigo-100 font-semibold';
                }

                return (
                  <button
                    key={slot.utcTimestamp}
                    type="button"
                    onTouchStart={handleSlotTouchStart}
                    onTouchMove={handleSlotTouchMove}
                    onTouchEnd={(e) => handleSlotTouchEnd(e, slot.utcTimestamp)}
                    onClick={() => handleSlotClick(slot.utcTimestamp)}
                    className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 text-left transition-transform active:scale-[0.99] select-none ${cardStyle}`}
                  >
                    <span className="font-mono text-sm font-bold shrink-0">{slot.label}</span>
                    <span className={`text-xs px-2.5 py-1 rounded-full truncate flex items-center gap-1.5 ${badgeStyle}`}>
                      {confirmedGroup && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={3} />}
                      {!confirmedGroup && isConflict && <AlertTriangle className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />}
                      <span className="truncate">{badgeText}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ================================================================= */}
          {/* DESKTOP / TABLET FULL WEEK MATRIX (>= 640px)                      */}
          {/* ================================================================= */}
          <main className="hidden sm:block flex-1 overflow-auto bg-white relative">
            <div className={`${slotDuration === 30 ? 'min-w-[1200px]' : 'min-w-[740px]'} h-full flex flex-col`}>
              <div className="flex sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <div className="w-16 flex-none border-r border-slate-200"></div>
                <div className="flex-1 flex text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  {GRID_HOURS.map(h => (
                    <div key={h} className="flex-1 text-center py-2 border-r border-slate-100">
                      {h.toString().padStart(2, '0')}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 flex flex-col pb-4">
                {availWeekGrid.map(day => (
                  <div key={day.dayName} className="flex flex-1 min-h-[48px] border-b border-slate-100">
                    <div className="w-16 flex-none flex flex-col items-center justify-center font-medium text-slate-500 border-r border-slate-200 bg-slate-50 sticky left-0 z-10">
                      <span className="text-sm leading-tight">{day.dayName}</span>
                      <span className="text-[10px] text-slate-400">{day.dateStr}</span>
                    </div>
                    <div className="flex-1 flex gap-0.5 pt-0.5 px-0.5">
                      {day.slots.map(slot => {
                        const state = availabilities[currentUser.id]?.[slot.utcTimestamp] || 'unavailable';
                        const confirmedGroup = getUserConfirmedMeeting(currentUser.id, slot.utcTimestamp);
                        const busyEvent = confirmedGroup ? null : getBusyIcsEvent(slot.utcTimestamp, slotDuration);
                        const isConflict = Boolean(busyEvent && (state === 'available' || state === 'preferred'));

                        let bgColor = 'bg-white border-slate-200';
                        let tooltip = `${day.dayName} ${slot.label}`;

                        if (confirmedGroup) {
                          bgColor = 'bg-emerald-500 border-emerald-600 flex items-center justify-center text-white';
                          tooltip = `Confirmed Meeting: ${confirmedGroup.name}`;
                        } else if (isConflict) {
                          bgColor = 'bg-amber-400 border-amber-500 flex items-center justify-center text-amber-950';
                          tooltip = `Conflict (Marked Free): ${busyEvent.summary} — click to mark Busy`;
                        } else if (busyEvent) {
                          bgColor = 'bg-slate-200 border-slate-300';
                          tooltip = `Busy (.ics): ${busyEvent.summary} — click to accommodate`;
                        } else if (state === 'available') {
                          bgColor = 'bg-blue-400 border-blue-400';
                        } else if (state === 'preferred') {
                          bgColor = 'bg-indigo-700 border-indigo-700';
                        }

                        return (
                          <div
                            key={slot.utcTimestamp}
                            title={tooltip}
                            onTouchStart={handleSlotTouchStart}
                            onTouchMove={handleSlotTouchMove}
                            onTouchEnd={(e) => handleSlotTouchEnd(e, slot.utcTimestamp)}
                            onClick={() => handleSlotClick(slot.utcTimestamp)}
                            className={`flex-1 h-10 border rounded-sm cursor-pointer transition-colors hover:brightness-95 select-none ${bgColor}`}
                          >
                            {confirmedGroup && <Check className="w-3.5 h-3.5 m-auto" strokeWidth={3} />}
                            {!confirmedGroup && isConflict && <AlertTriangle className="w-3.5 h-3.5 m-auto" strokeWidth={2.5} />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
      )}

      {/* TAB 2: GROUPS LIST */}
      {activeTab === 'groups' && !activeGroup && !isCreatingGroup && (
        <div className="flex-1 overflow-auto bg-slate-50 p-4">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-800">My GEMBA Study Groups</h2>
              <p className="text-xs text-slate-500 mt-0.5">{cohort.length} registered cohort {cohort.length === 1 ? 'member' : 'members'}</p>
            </div>
            <button
              onClick={() => {
                setNewGroupMembers([currentUser.id]);
                setIsCreatingGroup(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New Group
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {groups.map(group => {
              if (!group.members.includes(currentUser.id)) return null;
              const upcoming = getUpcomingMeeting(group.id);

              return (
                <div
                  key={group.id}
                  onClick={() => { setActiveGroupId(group.id); setGroupTab('ranked'); setIsEditingGroup(false); }}
                  className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md cursor-pointer transition-all active:scale-[0.98] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-800 text-lg mb-1 truncate">{group.name}</h3>
                    <div className="flex flex-wrap items-center gap-2.5 text-sm text-slate-500">
                      <span className="flex items-center gap-1 shrink-0"><Users className="w-4 h-4" /> {group.members.length} {group.members.length === 1 ? 'member' : 'members'}</span>
                      {upcoming ? (
                        <span className="flex items-center gap-1.5 text-emerald-700 font-medium bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full text-xs">
                          <Calendar className="w-3.5 h-3.5 shrink-0" />
                          <span>Next: {formatTimeForZoneFull(upcoming.utcTimestamp, activeTimezone)}</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-slate-500 font-medium bg-slate-100 px-2.5 py-0.5 rounded-full text-xs">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>Next meeting: TBD</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                    →
                  </div>
                </div>
              );
            })}

            {groups.filter(g => g.members.includes(currentUser.id)).length === 0 && (
              <div className="text-center py-10 px-4 bg-white rounded-xl border border-slate-200 border-dashed text-slate-500 mt-2 shadow-sm">
                <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="font-medium text-slate-700">No GEMBA study groups yet.</p>
                <p className="text-xs mt-1 max-w-sm mx-auto">
                  Share this link with your colleagues so they can sign up with their <strong>@skema.edu</strong> email, then tap <strong>New Group</strong>.
                </p>
                <button
                  onClick={handleCopyInviteLink}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-semibold transition-colors"
                >
                  <Share2 className="w-3.5 h-3.5" /> Copy App Link for Colleagues
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CREATE NEW GROUP */}
      {activeTab === 'groups' && isCreatingGroup && (
        <div className="flex-1 overflow-auto bg-slate-50 flex flex-col">
          <div className="bg-white p-4 border-b border-slate-200 shrink-0 flex items-center gap-3">
            <button
              onClick={() => setIsCreatingGroup(false)}
              className="text-slate-500 hover:text-slate-800 bg-slate-100 p-2 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-slate-900">Create GEMBA Study Group</h2>
          </div>

          <div className="p-4 sm:p-6 flex-1 flex flex-col gap-5 max-w-2xl mx-auto w-full">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Group / Course Topic Name</label>
              <input
                type="text"
                placeholder="e.g. Global Strategy Case Study"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="w-full p-3 bg-white border border-slate-300 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="block text-sm font-semibold text-slate-700">Select Registered GEMBA Cohort Members</label>
              <div className="bg-blue-50 border border-blue-100 text-blue-900 text-xs p-3 rounded-lg flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  For GDPR compliance, teammates self-register with their <strong>@skema.edu</strong> email and opt in before appearing here.
                </span>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                <div className="max-h-72 overflow-y-auto">
                  {cohort.map(u => (
                    <label key={u.id} className="flex items-center gap-3 p-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors">
                      <div className="relative flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={newGroupMembers.includes(u.id)}
                          disabled={u.id === currentUser.id}
                          onChange={(e) => {
                            if (e.target.checked) setNewGroupMembers([...newGroupMembers, u.id]);
                            else setNewGroupMembers(newGroupMembers.filter(id => id !== u.id));
                          }}
                          className="peer appearance-none w-5 h-5 border-2 border-slate-300 rounded bg-white checked:bg-indigo-600 checked:border-indigo-600 disabled:opacity-50 cursor-pointer"
                        />
                        <Check className="absolute w-3 h-3 text-white pointer-events-none opacity-0 peer-checked:opacity-100" strokeWidth={4} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                          <span className="truncate">{u.name}</span>
                          {u.id === currentUser.id && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">You (Organizer)</span>}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {formatZoneOptionLabel(getUserTimezoneForWeek(u, currentBaseUtc), currentBaseUtc)}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="bg-slate-50 p-3 text-xs font-semibold text-slate-500 border-t border-slate-200 text-center flex items-center justify-center gap-2">
                  <CheckSquare className="w-4 h-4" /> {newGroupMembers.length} {newGroupMembers.length === 1 ? 'Member' : 'Members'} Selected
                </div>
              </div>
            </div>

            <button
              onClick={handleCreateGroup}
              disabled={!newGroupName.trim() || newGroupMembers.length === 0}
              className="mt-2 w-full py-3 bg-indigo-600 text-white font-bold rounded-lg shadow hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Create Group
            </button>
          </div>
        </div>
      )}

      {/* EDIT GROUP (ORGANIZER ONLY) */}
      {activeTab === 'groups' && activeGroup && isEditingGroup && isGroupAdmin && (
        <div className="flex-1 overflow-auto bg-slate-50 flex flex-col">
          <div className="bg-white p-4 border-b border-slate-200 shrink-0 flex items-center gap-3">
            <button
              onClick={() => { setIsEditingGroup(false); setConfirmingDeleteGroup(false); }}
              className="text-slate-500 hover:text-slate-800 bg-slate-100 p-2 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-slate-900">Edit Group</h2>
          </div>

          <div className="p-4 sm:p-6 flex-1 flex flex-col gap-5 max-w-2xl mx-auto w-full">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Group / Course Topic Name</label>
              <input
                type="text"
                value={editGroupName}
                onChange={(e) => setEditGroupName(e.target.value)}
                className="w-full p-3 bg-white border border-slate-300 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="block text-sm font-semibold text-slate-700">Add or Remove Members</label>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                <div className="max-h-72 overflow-y-auto">
                  {cohort.map(u => {
                    const isOrganizerRow = u.id === currentUser.id;
                    const isChecked = editGroupMembers.includes(u.id);
                    return (
                      <label key={u.id} className="flex items-center gap-3 p-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors">
                        <div className="relative flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isOrganizerRow}
                            onChange={(e) => {
                              if (e.target.checked) setEditGroupMembers([...editGroupMembers, u.id]);
                              else setEditGroupMembers(editGroupMembers.filter(id => id !== u.id));
                            }}
                            className="peer appearance-none w-5 h-5 border-2 border-slate-300 rounded bg-white checked:bg-indigo-600 checked:border-indigo-600 disabled:opacity-50 cursor-pointer"
                          />
                          <Check className="absolute w-3 h-3 text-white pointer-events-none opacity-0 peer-checked:opacity-100" strokeWidth={4} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                            <span className="truncate">{u.name}</span>
                            {isOrganizerRow && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">You (Organizer)</span>}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {formatZoneOptionLabel(getUserTimezoneForWeek(u, currentBaseUtc), currentBaseUtc)}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="bg-slate-50 p-3 text-xs font-semibold text-slate-500 border-t border-slate-200 text-center flex items-center justify-center gap-2">
                  <CheckSquare className="w-4 h-4" /> {editGroupMembers.length} {editGroupMembers.length === 1 ? 'Member' : 'Members'} Selected
                </div>
              </div>
            </div>

            <button
              onClick={handleUpdateGroup}
              disabled={!editGroupName.trim() || editGroupMembers.length === 0}
              className="w-full py-3 bg-indigo-600 text-white font-bold rounded-lg shadow hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" /> Save Changes
            </button>

            <div className="border-t border-slate-200 pt-5 mt-2">
              {!confirmingDeleteGroup ? (
                <button
                  onClick={() => setConfirmingDeleteGroup(true)}
                  className="w-full py-2.5 px-4 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold rounded-lg text-xs flex items-center justify-center gap-2 transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Delete This Group
                </button>
              ) : (
                <div className="bg-red-50 border border-red-300 rounded-lg p-3.5 flex flex-col gap-3">
                  <p className="text-xs text-red-800 font-medium">
                    Delete <strong>{activeGroup.name}</strong>? This removes the group and unlocks any confirmed meeting for all members.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmingDeleteGroup(false)}
                      className="flex-1 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeleteGroup}
                      className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold"
                    >
                      Yes, Delete Group
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GROUP DETAIL VIEW */}
      {activeTab === 'groups' && activeGroup && !isCreatingGroup && !isEditingGroup && (
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
          <div className="bg-white p-4 border-b border-slate-200 shrink-0">
            <div className="flex items-center justify-between gap-2 mb-2">
              <button
                onClick={() => { setActiveGroupId(null); setIsEditingGroup(false); }}
                className="text-blue-600 text-sm font-semibold flex items-center gap-1 hover:underline"
              >
                ← Back to Groups
              </button>
              {isGroupAdmin && (
                <button
                  onClick={() => openEditGroup(activeGroup)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 rounded-lg text-xs font-semibold transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit Group
                </button>
              )}
            </div>
            <h2 className="text-2xl font-bold text-slate-900">{activeGroup.name}</h2>
            <p className="text-slate-500 text-sm">
              Viewing in <strong>{activeTimezone.replace(/_/g, ' ')}</strong> • DST-aware IANA times
            </p>
          </div>

          <div className="flex border-b border-slate-200 bg-white shrink-0">
            {['ranked', 'heatmap', 'members'].map(tab => (
              <button
                key={tab}
                onClick={() => setGroupTab(tab)}
                className={`flex-1 py-3 text-sm font-semibold capitalize transition-colors ${groupTab === tab ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/30' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {tab === 'ranked' ? 'Ranked Options' : tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {groupTab === 'ranked' && (
              <>
                {activeUpcomingMeeting ? (
                  <div className="bg-emerald-50 border-2 border-emerald-400 rounded-xl p-6 sm:p-8 text-center shadow-sm mt-2">
                    <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Check className="w-8 h-8 text-emerald-600" strokeWidth={3} />
                    </div>
                    <h2 className="text-2xl font-bold text-emerald-900 mb-2">Next Meeting Confirmed</h2>
                    <p className="text-emerald-700 font-medium mb-2 text-xl">
                      {formatTimeForZoneFull(activeUpcomingMeeting.utcTimestamp, activeTimezone)}
                    </p>
                    <p className="text-xs text-emerald-700/80 mb-6 max-w-md mx-auto">
                      This time is blocked across all other GEMBA groups.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-4">
                      {isGroupAdmin && (
                        <a
                          href={buildTeamsMeetingUrl(activeGroup.name, activeUpcomingMeeting.utcTimestamp, activeGroupMemberEmails)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full sm:w-auto px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 text-sm"
                        >
                          <Video className="w-4 h-4" /> Schedule in Teams
                        </a>
                      )}
                      <button
                        onClick={() => downloadMeetingIcs(activeGroup.name, activeUpcomingMeeting.utcTimestamp, activeGroupMemberEmails)}
                        className="w-full sm:w-auto px-5 py-3 bg-white hover:bg-emerald-100 text-emerald-800 border-2 border-emerald-300 font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 text-sm"
                      >
                        <CalendarPlus className="w-4 h-4" /> Add to Calendar (.ics)
                      </button>
                    </div>

                    {isGroupAdmin && (
                      <button
                        onClick={() => handleUnconfirmMeeting(activeGroup.id)}
                        className="mt-2 px-4 py-2 text-xs text-emerald-700 hover:text-emerald-900 hover:underline font-semibold inline-flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" /> Unconfirm / Pick Another Slot
                      </button>
                    )}
                  </div>
                ) : rankedSlots.length === 0 ? (
                  <div className="text-center py-10 bg-white rounded-xl border border-slate-200 text-slate-500 mt-2 shadow-sm">
                    <AlertCircle className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    <p>No overlapping slots found for {weekInfo.full}.</p>
                    <p className="text-sm mt-1">Make sure members have marked availability in "My Avail", or check another week.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 mt-2">
                    {rankedSlots.map((slot, idx) => (
                      <div key={slot.utcTimestamp} className={`flex flex-col sm:flex-row bg-white rounded-xl shadow-sm border overflow-hidden transition-all hover:shadow-md ${idx === 0 ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'}`}>
                        <div className="flex-1 p-5 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center gap-3 mb-2 flex-wrap">
                              <div className={`font-bold text-lg sm:text-xl ${idx === 0 ? 'text-indigo-700' : 'text-slate-800'}`}>
                                {formatTimeForZoneFull(slot.utcTimestamp, activeTimezone)}
                              </div>
                              {idx === 0 && <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">Top Pick</span>}
                            </div>
                            <div className="text-sm text-slate-500 flex items-center gap-2 mb-5 font-medium">
                              <Users className="w-4 h-4" /> {slot.totalFree} / {slot.totalMembers} Available
                            </div>
                          </div>
                          {isGroupAdmin ? (
                            <button
                              onClick={() => handleConfirmMeeting(activeGroup, slot.utcTimestamp)}
                              className={`w-full py-3 px-4 font-semibold rounded-lg transition-colors text-sm text-center shadow-sm flex items-center justify-center gap-2 ${idx === 0 ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                            >
                              <Check className="w-4 h-4" strokeWidth={3} /> Confirm Meeting
                            </button>
                          ) : (
                            <div className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg p-2.5 text-center">
                              Only the group organizer can confirm the final slot.
                            </div>
                          )}
                        </div>

                        <div className={`p-4 sm:w-64 border-t sm:border-t-0 sm:border-l ${idx === 0 ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-100 bg-slate-50/50'} text-sm overflow-y-auto max-h-52 sm:max-h-none`}>
                          <div className={`font-semibold mb-3 text-xs uppercase tracking-wider ${idx === 0 ? 'text-indigo-900' : 'text-slate-500'}`}>Member Local Times</div>
                          <div className="flex flex-col gap-2">
                            {slot.memberStatuses.map(ms => (
                              <div key={ms.user.id} className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  {ms.state === 'blocked' ? (
                                    <div className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center shrink-0" title="Blocked by another meeting"><X className="w-3 h-3 text-red-600" strokeWidth={3} /></div>
                                  ) : ms.state === 'unavailable' ? (
                                    <div className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center shrink-0"><div className="w-2 h-0.5 bg-slate-400 rounded-full"></div></div>
                                  ) : (
                                    <div className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center shrink-0"><Check className="w-3 h-3 text-emerald-600" strokeWidth={3} /></div>
                                  )}
                                  <span className={`truncate text-sm ${ms.state === 'blocked' ? 'text-red-600 line-through' : ms.state === 'unavailable' ? 'text-slate-400' : 'text-slate-700 font-medium'}`}>
                                    {ms.user.name.split(' ')[0]}
                                    {ms.state === 'blocked' && <span className="text-[10px] ml-1 no-underline font-semibold">(Blocked)</span>}
                                  </span>
                                </div>
                                <span className={`font-mono text-xs shrink-0 ${ms.isBadHour ? 'text-red-500 font-semibold' : (idx === 0 ? 'text-indigo-700' : 'text-slate-500')}`}>
                                  {formatTimeForZoneShort(slot.utcTimestamp, ms.memberWeekTz)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {groupTab === 'heatmap' && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 border-b border-slate-100 pb-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-700">Group Heatmap</div>
                    <div className="text-[11px] text-slate-400">Hover or tap any slot to see who is free</div>
                  </div>
                  <select
                    value={heatmapUserId || currentUser.id}
                    onChange={(e) => setHeatmapUserId(e.target.value)}
                    className="text-xs border border-slate-200 rounded p-1.5 bg-slate-50 text-slate-700"
                  >
                    {activeGroup.members
                      .map(mId => cohort.find(u => u.id === mId))
                      .filter(Boolean)
                      .map(u => {
                        const uWeekTz = getUserTimezoneForWeek(u, currentBaseUtc);
                        return (
                          <option key={u.id} value={u.id}>
                            View in: {u.name}'s Time ({uWeekTz.split('/').pop().replace(/_/g, ' ')})
                          </option>
                        );
                      })}
                  </select>
                </div>

                <div className="overflow-x-auto" onMouseLeave={() => setHoveredHeatmapTs(null)}>
                  <div className="min-w-[600px] flex flex-col gap-0.5">
                    <div className="flex mb-1">
                      <div className="w-12"></div>
                      {GRID_HOURS.map((h) => (
                        <div key={h} className="flex-1 text-[10px] text-slate-400 text-center font-mono">
                          {h.toString().padStart(2, '0')}
                        </div>
                      ))}
                    </div>
                    {generateGrid(heatmapViewTz, currentBaseUtc, 60).map(day => (
                      <div key={day.dayName} className="flex gap-0.5 items-center">
                        <div className="w-12 flex flex-col items-start justify-center">
                          <span className="text-xs font-medium text-slate-500 leading-none">{day.dayName}</span>
                          <span className="text-[9px] text-slate-400">{day.dateStr}</span>
                        </div>
                        {day.slots.map(slot => {
                          const count = heatmapData[slot.utcTimestamp] || 0;
                          const total = Math.max(activeGroup.members.length, 1);
                          const ratio = count / total;
                          const isSelected = inspectedHeatmapTs === slot.utcTimestamp;
                          const intensity = count === 0 ? 'bg-slate-50' :
                            ratio < 0.4 ? 'bg-emerald-100' :
                            ratio < 0.7 ? 'bg-emerald-300' :
                            ratio < 1 ? 'bg-emerald-500' : 'bg-emerald-700';

                          const slotStatuses = getMemberBreakdownForSlot(activeGroup, slot.utcTimestamp);
                          const freeNames = slotStatuses
                            .filter(ms => ms.state === 'available' || ms.state === 'preferred')
                            .map(ms => ms.user.name.split(' ')[0]);
                          const busyNames = slotStatuses
                            .filter(ms => ms.state !== 'available' && ms.state !== 'preferred')
                            .map(ms => ms.user.name.split(' ')[0]);
                          const richTooltip = `${day.dayName} ${slot.label} (${count}/${total} free)\n✓ Free: ${freeNames.length ? freeNames.join(', ') : 'None'}\n✕ Unavailable: ${busyNames.length ? busyNames.join(', ') : 'None'}`;

                          return (
                            <div
                              key={slot.utcTimestamp}
                              title={richTooltip}
                              onMouseEnter={() => setHoveredHeatmapTs(slot.utcTimestamp)}
                              onClick={() => setPinnedHeatmapTs(prev => prev === slot.utcTimestamp ? null : slot.utcTimestamp)}
                              className={`flex-1 h-7 sm:h-6 rounded-sm cursor-pointer ${intensity} transition-all ${isSelected ? 'ring-2 ring-indigo-600 scale-y-110 z-10' : 'hover:ring-1 hover:ring-black/30'}`}
                            ></div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Live Slot Member Breakdown Card (Hover or Tap) */}
                {inspectedHeatmapTs ? (
                  <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-indigo-200 transition-all">
                    <div className="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-slate-200/80">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900">
                          {formatTimeForZoneFull(inspectedHeatmapTs, heatmapViewTz)}
                        </span>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                          {inspectedFreeList.length} / {inspectedStatuses.length} Available
                        </span>
                      </div>
                      {pinnedHeatmapTs && (
                        <button
                          onClick={() => { setPinnedHeatmapTs(null); setHoveredHeatmapTs(null); }}
                          className="text-slate-400 hover:text-slate-700 p-0.5"
                          title="Close slot details"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1.5">
                          Available ({inspectedFreeList.length})
                        </div>
                        {inspectedFreeList.length === 0 ? (
                          <div className="text-slate-400 italic text-[11px]">Nobody free at this hour</div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {inspectedFreeList.map(ms => (
                              <span
                                key={ms.user.id}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium border ${ms.state === 'preferred' ? 'bg-indigo-50 text-indigo-800 border-indigo-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}
                              >
                                <Check className="w-3 h-3 shrink-0" strokeWidth={3} />
                                <span>{ms.user.name.split(' ')[0]}</span>
                                <span className={`font-mono text-[10px] ${ms.isBadHour ? 'text-red-600 font-bold' : 'opacity-75'}`}>
                                  ({formatTimeForZoneShort(inspectedHeatmapTs, ms.memberWeekTz)})
                                </span>
                                {ms.state === 'preferred' && <span className="text-[9px] font-bold text-indigo-600">★</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                          Unavailable ({inspectedBusyList.length})
                        </div>
                        {inspectedBusyList.length === 0 ? (
                          <div className="text-emerald-600 font-medium text-[11px]">Everyone is free!</div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {inspectedBusyList.map(ms => (
                              <span
                                key={ms.user.id}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border ${ms.state === 'blocked' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-slate-500 border-slate-200'}`}
                              >
                                <X className="w-3 h-3 shrink-0" />
                                <span>{ms.user.name.split(' ')[0]}</span>
                                <span className="font-mono text-[10px] opacity-75">
                                  ({formatTimeForZoneShort(inspectedHeatmapTs, ms.memberWeekTz)})
                                </span>
                                {ms.state === 'blocked' && <span className="text-[9px] font-bold">(In Meeting)</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 py-2.5 px-3 rounded-lg bg-slate-50 border border-dashed border-slate-200 text-center text-[11px] text-slate-400">
                    Hover over or tap any cell above to inspect who is available and their local time.
                  </div>
                )}

                <div className="flex justify-end gap-2 mt-4 text-[10px] text-slate-500 font-medium">
                  <div className="flex items-center gap-1"><div className="w-2 h-2 bg-slate-50 border border-slate-200"></div> 0</div>
                  <div className="flex items-center gap-1"><div className="w-2 h-2 bg-emerald-100"></div> Low</div>
                  <div className="flex items-center gap-1"><div className="w-2 h-2 bg-emerald-300"></div> Partial</div>
                  <div className="flex items-center gap-1"><div className="w-2 h-2 bg-emerald-500"></div> High</div>
                  <div className="flex items-center gap-1"><div className="w-2 h-2 bg-emerald-700"></div> All</div>
                </div>
              </div>
            )}

            {groupTab === 'members' && (
              <div className="flex flex-col gap-3">
                {isGroupAdmin && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => openEditGroup(activeGroup)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> Add / Remove Members
                    </button>
                  </div>
                )}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  {activeGroup.members
                    .map(mId => cohort.find(u => u.id === mId))
                    .filter(Boolean)
                    .map((u, i) => {
                      const uWeekTz = getUserTimezoneForWeek(u, currentBaseUtc);
                      const isTraveling = Boolean(weekTimezones[u.id]?.[currentBaseUtc] && weekTimezones[u.id][currentBaseUtc] !== u.timezone);
                      return (
                        <div key={u.id} className={`p-4 flex items-center justify-between gap-2 ${i !== 0 ? 'border-t border-slate-100' : ''}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0">
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-slate-800 truncate flex items-center gap-1.5">
                                <span>{u.name}</span>
                                {activeGroup.adminId === u.id && (
                                  <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-semibold">Organizer</span>
                                )}
                                {isTraveling && (
                                  <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-semibold">Traveling</span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 truncate">{u.email}</div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs sm:text-sm font-medium text-slate-700">{uWeekTz.replace(/_/g, ' ')}</div>
                            <div className="text-xs text-slate-400">
                              {getZoneAbbreviation(currentBaseUtc, uWeekTz)} ({formatOffsetLabel(getUtcOffsetMinutes(currentBaseUtc, uWeekTz))})
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PRIVACY (GDPR) */}
      {activeTab === 'privacy' && (
        <div className="flex-1 overflow-auto bg-slate-50 p-4 sm:p-6">
          <div className="max-w-xl mx-auto flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-6 h-6 text-indigo-600" /> Privacy & Account (GDPR)
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Manage your home timezone, review how your GEMBA cohort data is handled, or exercise your GDPR rights.
              </p>
            </div>

            {privacyNotice && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-3 rounded-lg flex items-center justify-between">
                <span className="flex items-center gap-2"><Check className="w-4 h-4 shrink-0" /> {privacyNotice}</span>
                <button onClick={() => setPrivacyNotice('')} className="text-emerald-600 hover:text-emerald-900"><X className="w-4 h-4" /></button>
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col gap-3">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  {currentUser.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-bold text-slate-800">{currentUser.name}</div>
                  <div className="text-xs text-slate-500">{currentUser.email}</div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Home Timezone (Standard IANA • DST Automatic)
                </label>
                <TimezonePicker
                  value={currentUser.timezone}
                  onChange={async (newTz) => {
                    try {
                      await sbFetch(`gemba_users?id=eq.${encodeURIComponent(currentUser.id)}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ timezone: newTz }),
                      });
                      setCohort(prev => prev.map(u => u.id === currentUser.id ? { ...u, timezone: newTz } : u));
                      setPrivacyNotice(`Home timezone updated to ${newTz.replace(/_/g, ' ')}.`);
                    } catch {
                      setPrivacyNotice('Could not update timezone in EU Cloud.');
                    }
                  }}
                  refUtcMs={currentBaseUtc}
                />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col gap-2.5 text-xs text-slate-600">
              <div className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-600" /> Data Minimization & EU Hosting
              </div>
              <ul className="list-disc pl-5 space-y-1.5">
                <li><strong>EU Paris Hosting:</strong> All cohort records are stored in West EU (Paris) servers.</li>
                <li><strong>Minimal Data Stored:</strong> Only your name, <code>@skema.edu</code> email, broad IANA timezone (no GPS or address), and weekly free/busy slots.</li>
                <li><strong>Local-Only Calendar Imports:</strong> Uploaded <code>.ics</code> files are parsed strictly in your browser and never sent to our servers.</li>
                <li><strong>Self-Registration Only:</strong> Bulk uploading classmates' emails is disabled to ensure explicit opt-in consent.</li>
                <li><strong>Independent Student Tool:</strong> Operated voluntarily by GEMBA cohort members, not an official SKEMA IT system.</li>
              </ul>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col gap-3">
              <div className="font-bold text-slate-800 text-sm">Your GDPR Rights</div>

              <button
                onClick={handleExportMyData}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" /> Export My Data (JSON)
              </button>

              {!confirmingDelete ? (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="w-full py-2.5 px-4 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold rounded-lg text-xs flex items-center justify-center gap-2 transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Delete My Account & All Data
                </button>
              ) : (
                <div className="bg-red-50 border border-red-300 rounded-lg p-3 flex flex-col gap-2.5">
                  <p className="text-xs text-red-800 font-medium">
                    Are you sure? This permanently erases your profile, availability, and removes you from all GEMBA study groups.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      className="flex-1 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeleteMyAccount}
                      className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold"
                    >
                      Yes, Permanently Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Tab Navigation */}
      <nav className="bg-white border-t border-slate-200 flex shrink-0 pb-safe z-20">
        <button
          onClick={() => { setActiveTab('avail'); setIsCreatingGroup(false); setIsEditingGroup(false); }}
          className={`flex-1 p-3.5 flex flex-col items-center justify-center gap-1 transition-colors ${activeTab === 'avail' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-wider">My Avail</span>
        </button>
        <button
          onClick={() => { setActiveTab('groups'); }}
          className={`flex-1 p-3.5 flex flex-col items-center justify-center gap-1 transition-colors ${activeTab === 'groups' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
        >
          <Users className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Groups</span>
        </button>
        <button
          onClick={() => { setActiveTab('privacy'); setIsCreatingGroup(false); setIsEditingGroup(false); }}
          className={`flex-1 p-3.5 flex flex-col items-center justify-center gap-1 transition-colors ${activeTab === 'privacy' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
        >
          <ShieldCheck className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Privacy</span>
        </button>
      </nav>
    </div>
  );
}
