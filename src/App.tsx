// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users, AlertCircle, Check, MapPin, Calendar, Clock, Save, Trash2, X, Plus,
  CheckSquare, ChevronLeft, ChevronRight, Lock, Mail, LogOut, ShieldCheck,
  KeyRound, Globe, UserPlus, Download, Search, Info, UserCheck, RefreshCw, Share2, Cloud, Pencil
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
  return mins === 0 ? `UTC${sign}${hrs}
