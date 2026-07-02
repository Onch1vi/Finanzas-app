import React, { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

const HAS_CHARTS = typeof AreaChart === "function";

const STORAGE_KEY = 'finanzas-app-v1';
const TIP_DISMISSED_KEY = 'finanzas-tip-confirm-dismissed';

// ============================================================================
//  SUPABASE CLIENT (optional cloud sync)
//  If SUPABASE_URL / SUPABASE_ANON_KEY are set in the head <script>, the app
//  enables email+password login and syncs your data to a private row.
//  If not set, it falls back to local-only mode (localStorage).
// ============================================================================
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL) || '';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY) || '';
const SUPABASE_CONFIGURED = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
const supabaseClient = SUPABASE_CONFIGURED ? createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

// Pull the current user's data row from Supabase. Returns { data, updatedAt } or null.
async function cloudLoadData() {
  if (!supabaseClient) return null;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabaseClient.from('user_data').select('data, updated_at').eq('user_id', user.id).maybeSingle();
  if (error) { console.error('cloudLoad error', error); return null; }
  return data ? { data: data.data, updatedAt: data.updated_at } : null;
}

// Upsert the current user's data into Supabase with optimistic concurrency.
// If `expectedUpdatedAt` is provided, we only write when the cloud's current
// updated_at matches it — that way, another device's later write won't be lost.
// Returns { ok, conflict, latest } where `latest` is the newer cloud row on conflict.
async function cloudSaveData(payload, expectedUpdatedAt) {
  if (!supabaseClient) return { ok: false, reason: 'not-configured' };
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return { ok: false, reason: 'not-logged-in' };

  const now = new Date().toISOString();

  // Check current cloud version first to detect concurrent edits
  if (expectedUpdatedAt) {
    const current = await cloudLoadData();
    if (current && current.updatedAt && current.updatedAt !== expectedUpdatedAt) {
      // Another device wrote since we last loaded
      return { ok: false, conflict: true, latest: current };
    }
  }

  const { data, error } = await supabaseClient
    .from('user_data')
    .upsert({ user_id: user.id, data: payload, updated_at: now }, { onConflict: 'user_id' })
    .select('updated_at')
    .single();
  if (error) { console.error('cloudSave error', error); return { ok: false, reason: error.message }; }
  return { ok: true, updatedAt: data ? data.updated_at : now };
}

// Supabase MFA (TOTP) helpers — enable Two-Factor Authentication with an
// authenticator app like Google Authenticator / Microsoft Authenticator / Authy.
async function mfaListFactors() {
  if (!supabaseClient) return { totp: [] };
  const { data, error } = await supabaseClient.auth.mfa.listFactors();
  if (error) return { totp: [] };
  return data || { totp: [] };
}
async function mfaEnrollTotp() {
  if (!supabaseClient) throw new Error('Supabase no configurado');
  const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Finanzas TOTP' });
  if (error) throw error;
  return data; // { id, type, totp: { qr_code, secret, uri } }
}
async function mfaVerifyEnrollment(factorId, code) {
  if (!supabaseClient) throw new Error('Supabase no configurado');
  const { data: ch, error: chErr } = await supabaseClient.auth.mfa.challenge({ factorId });
  if (chErr) throw chErr;
  const { data, error } = await supabaseClient.auth.mfa.verify({ factorId, challengeId: ch.id, code });
  if (error) throw error;
  return data;
}
async function mfaUnenroll(factorId) {
  if (!supabaseClient) throw new Error('Supabase no configurado');
  const { data, error } = await supabaseClient.auth.mfa.unenroll({ factorId });
  if (error) throw error;
  return data;
}
async function mfaChallengeAndVerify(factorId, code) {
  if (!supabaseClient) throw new Error('Supabase no configurado');
  const { data: ch, error: chErr } = await supabaseClient.auth.mfa.challenge({ factorId });
  if (chErr) throw chErr;
  const { data, error } = await supabaseClient.auth.mfa.verify({ factorId, challengeId: ch.id, code });
  if (error) throw error;
  return data;
}

// ============================================================================
//  ICONS (Inline SVG)
// ============================================================================
const ic = (children) => function Icon({ size = 20, color = 'currentColor', strokeWidth = 2, className = '' } = {}) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
      strokeLinejoin="round" className={className}>{children}</svg>
  );
};

const Home = ic(<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>);
const CreditCard = ic(<><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></>);
const ArrowLeftRight = ic(<><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></>);
const TrendingUp = ic(<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></>);
const SettingsIcon = ic(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></>);
const Plus = ic(<><path d="M5 12h14"/><path d="M12 5v14"/></>);
const Bell = ic(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>);
const ChevronRight = ic(<polyline points="9 18 15 12 9 6"/>);
const X = ic(<><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>);
const Trash2 = ic(<><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></>);
const Edit3 = ic(<><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></>);
const AlertCircle = ic(<><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></>);
const Calendar = ic(<><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></>);
const Eye = ic(<><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>);
const EyeOff = ic(<><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></>);
const ArrowUp = ic(<><line x1="12" x2="12" y1="19" y2="5"/><polyline points="5 12 12 5 19 12"/></>);
const ArrowDown = ic(<><line x1="12" x2="12" y1="5" y2="19"/><polyline points="19 12 12 19 5 12"/></>);
const Sparkles = ic(<><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></>);
const Receipt = ic(<><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/></>);
const CheckCircle2 = ic(<><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></>);
const Check = ic(<polyline points="20 6 9 17 4 12"/>);
const Clock = ic(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>);
const Download = ic(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></>);
const RotateCcw = ic(<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></>);
const Banknote = ic(<><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></>);
const Target = ic(<><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>);
const Briefcase = ic(<><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></>);
const ShoppingBag = ic(<><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></>);
const Car = ic(<><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></>);
const Heart = ic(<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>);
const Coffee = ic(<><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></>);
const Smartphone = ic(<><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></>);
const Zap = ic(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>);
const MoreHorizontal = ic(<><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>);
const Info = ic(<><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>);
const Wallet = ic(<><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><path d="M3 5v14"/><rect width="9" height="6" x="13" y="10" rx="1"/><circle cx="17" cy="13" r="0.5" fill="currentColor"/></>);
const CalendarIcon = ic(<><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></>);
const TrendingDown = ic(<><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></>);
const Activity = ic(<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>);

// ============================================================================
//  HELPERS
// ============================================================================
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Detect feminine names (Spanish/Colombian context). Used to apply a softer color theme.
const FEMININE_NAMES_SET = new Set([
  'maria','sofia','sofía','isabella','valentina','camila','daniela','laura','natalia',
  'paula','juliana','manuela','mariana','sara','sarah','alejandra','catalina','carolina','diana',
  'gabriela','adriana','angela','ángela','beatriz','carmen','claudia','elena','estefania','estefanía',
  'fernanda','francisca','isabel','jimena','juana','julia','karen','karina','lina','lorena',
  'lucia','lucía','luisa','luna','margarita','marcela','martina','melissa','melisa','michelle',
  'monica','mónica','olivia','paola','patricia','rosa','silvia','susana','tatiana','valeria',
  'veronica','verónica','victoria','vivian','viviana','ximena','yolanda','zoe','zoé','antonia',
  'amanda','ariana','barbara','bárbara','blanca','clara','cristina','cynthia','dora','elsa',
  'emilia','emma','esperanza','eva','florencia','gloria','helena','ingrid','irene','jessica',
  'jessika','johana','johanna','josefina','judith','liliana','linda','liz','lola','luz',
  'magda','marisol','marta','mayra','nancy','nora','norma','pamela',
  'pilar','raquel','regina','renata','rocio','rocío','rosalia','rosalía','salma','sandra',
  'soledad','soraya','stefania','stephanie','susy','teresa','vanessa','wendy','yesica','yésica',
  'amalia','araceli','aurora','azucena','consuelo','dolores','encarnacion','encarnación',
  'esmeralda','genoveva','gertrudis','herminia','ines','inés','leonor','magdalena','milagros',
  'rebecca','rebeca','remedios','rosario','tamara','úrsula','ursula','violeta','virginia',
  'mari','sofi','vale','cami','dani','andre','pau','juli','marian','ali','carito','caro',
  'gaby','adri','isa','jime','julie','kari','lore','lulu','luchi','manu','melli','michi','moni',
  'pao','paty','pati','rosi','silvi','tati','vivi','vicky','xime','tota','andrea',
]);

function isFeminineName(fullName) {
  if (!fullName) return false;
  const first = fullName.trim().split(/\s+/)[0].toLowerCase();
  if (FEMININE_NAMES_SET.has(first)) return true;
  const masculineExceptions = new Set(['luca','elias','elías','noah','tobias','tobías','bautista']);
  if (masculineExceptions.has(first)) return false;
  if (first.length >= 4 && (first.endsWith('a') || first.endsWith('ía'))) return true;
  return false;
}

// Storage with localStorage fallback
const safeStorage = {
  get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(key); return true; } catch (e) { return false; }
  },
};

const CURRENCIES = {
  COP: { code: 'COP', symbol: '$', locale: 'es-CO', decimals: 0 },
  USD: { code: 'USD', symbol: '$', locale: 'en-US', decimals: 2 },
  MXN: { code: 'MXN', symbol: '$', locale: 'es-MX', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', locale: 'es-ES', decimals: 2 },
  PEN: { code: 'PEN', symbol: 'S/', locale: 'es-PE', decimals: 2 },
  ARS: { code: 'ARS', symbol: '$', locale: 'es-AR', decimals: 2 },
  CLP: { code: 'CLP', symbol: '$', locale: 'es-CL', decimals: 0 },
};

// ============================================================================
//  VISUAL FX — confetti bursts + animated number count-ups.
//  Both honor prefers-reduced-motion (no canvas, no RAF loops).
// ============================================================================
function fireConfetti({ x, y, count = 70, spread = 7 } = {}) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const colors = ['#34D399', '#A78BFA', '#FBBF24', '#F472B6', '#38BDF8', '#F4C77B'];
  const cx = x !== null && x !== undefined ? x : window.innerWidth / 2;
  const cy = y !== null && y !== undefined ? y : window.innerHeight * 0.32;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * spread;
    parts.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4.5,
      size: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.35,
      color: colors[i % colors.length],
      life: 1,
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
    });
  }
  let frames = 0;
  const tick = () => {
    frames++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of parts) {
      p.vy += 0.22;          // gravity
      p.vx *= 0.985;         // drag
      p.x += p.vx; p.y += p.vy; p.rot += p.vrot;
      p.life -= 0.011;
      if (p.life <= 0) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (alive && frames < 260) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
}

// Animates a number from its previous value to the new one (ease-out cubic).
// `format` receives the interpolated number and returns the display string.
function CountUp({ value, format, duration = 850 }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = to;
    if (from === to) { setDisplay(to); return; }
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(to); return;
    }
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(Math.round(display))}</>;
}

const formatMoney = (amount, currency = 'COP', hidden = false) => {
  if (hidden) return '••••••';
  const c = CURRENCIES[currency] || CURRENCIES.COP;
  try {
    return new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.code, minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals }).format(amount || 0);
  } catch (e) {
    return `${c.symbol}${Math.round(amount).toLocaleString()}`;
  }
};

const formatCompact = (amount, currency = 'COP', hidden = false) => {
  if (hidden) return '••••';
  const c = CURRENCIES[currency] || CURRENCIES.COP;
  const abs = Math.abs(amount);
  let f;
  if (abs >= 1e9) f = (amount / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  else if (abs >= 1e6) f = (amount / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  else if (abs >= 1e3) f = (amount / 1e3).toFixed(0) + 'K';
  else f = Math.round(amount).toString();
  return `${c.symbol}${f}`;
};

const formatDate = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatDateShort = (date) => {
  if (!date) return '';
  return new Date(date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
};

const daysBetween = (a, b) => {
  const ms = new Date(b).setHours(0,0,0,0) - new Date(a).setHours(0,0,0,0);
  return Math.round(ms / 86400000);
};

// Parse a YYYY-MM-DD string as a LOCAL date (not UTC).
// JS's `new Date('2024-05-19')` interprets the string as UTC midnight,
// which in UTC-5 (Colombia/Peru/etc) becomes May 18 7pm LOCAL — causing
// off-by-one bugs in .getDate() / .getMonth() comparisons.
// Use this helper anywhere you parse a date that came from <input type="date">.
// Returns null only for empty/null input. For malformed strings returns the
// JS-native Invalid Date so existing `isNaN(date)` checks continue to work.
const parseLocalDate = (isoStr) => {
  if (isoStr === null || isoStr === undefined || isoStr === '') return null;
  const s = String(isoStr);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    // Fallback for full ISO timestamps (e.g. createdAt) — JS handles those correctly.
    return new Date(s);
  }
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
};

const getNextPaymentDate = (paymentDay, fromDate = new Date(), adjustForBusinessDay = false) => {
  const from = new Date(fromDate);
  from.setHours(0,0,0,0);
  const day = Math.max(1, Math.min(31, paymentDay || 1));
  const tryMonth = (year, monthIdx) => {
    const lastDay = new Date(year, monthIdx + 1, 0).getDate();
    let d = new Date(year, monthIdx, Math.min(day, lastDay));
    if (adjustForBusinessDay) d = previousBusinessDay(d);
    return d;
  };
  let next = tryMonth(from.getFullYear(), from.getMonth());
  if (next < from) next = tryMonth(from.getFullYear(), from.getMonth() + 1);
  return next;
};

// Colombian holidays - Easter algorithm + fixed/movable holidays
function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const month = Math.floor((h + L - 7 * m + 114) / 31);
  const day = ((h + L - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
function nextMonday(date) {
  const d = new Date(date);
  if (d.getDay() === 1) return d;
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}
const _holidayCache = {};
function getColombianHolidays(year) {
  if (_holidayCache[year]) return _holidayCache[year];
  const fixed = [
    new Date(year, 0, 1), new Date(year, 4, 1), new Date(year, 6, 20),
    new Date(year, 7, 7), new Date(year, 11, 8), new Date(year, 11, 25),
  ];
  const movable = [
    new Date(year, 0, 6), new Date(year, 2, 19), new Date(year, 5, 29),
    new Date(year, 7, 15), new Date(year, 9, 12), new Date(year, 10, 1), new Date(year, 10, 11),
  ].map(nextMonday);
  const easter = easterDate(year);
  const easterBased = [
    new Date(easter.getTime() - 3 * 86400000),
    new Date(easter.getTime() - 2 * 86400000),
    nextMonday(new Date(easter.getTime() + 39 * 86400000)),
    nextMonday(new Date(easter.getTime() + 60 * 86400000)),
    nextMonday(new Date(easter.getTime() + 68 * 86400000)),
  ];
  const all = [...fixed, ...movable, ...easterBased].map(d => { d.setHours(0,0,0,0); return d.getTime(); });
  _holidayCache[year] = new Set(all);
  return _holidayCache[year];
}
function isWeekendOrHoliday(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return true;
  const d = new Date(date); d.setHours(0,0,0,0);
  return getColombianHolidays(d.getFullYear()).has(d.getTime());
}
function previousBusinessDay(date) {
  const d = new Date(date); d.setHours(0,0,0,0);
  while (isWeekendOrHoliday(d)) d.setDate(d.getDate() - 1);
  return d;
}

// ============================================================================
//  CORE PROJECTION ENGINE
//  This simulates every month into the future considering:
//  - Recurring incomes (with monthly/biweekly/biannual/annual frequencies)
//  - Recurring expenses
//  - Debts (each one ends when fully paid, calculated with interest)
//  - Plans (lifestyle changes, purchases, loans with grace periods)
//  - Savings balance evolution
// ============================================================================
// Optional life-window on recurring items: an item only counts in months
// between startDate and endDate (month granularity). Lets you register
// "Netflix empieza el próximo ciclo" or "Disney es el último mes" and the
// engine phases them in/out automatically.
function isItemActiveInMonth(item, year, monthIdx) {
  const key = year * 12 + monthIdx;
  if (item.startDate) {
    const sd = parseLocalDate(item.startDate);
    if (sd && !isNaN(sd) && key < sd.getFullYear() * 12 + sd.getMonth()) return false;
  }
  if (item.endDate) {
    const ed = parseLocalDate(item.endDate);
    if (ed && !isNaN(ed) && key > ed.getFullYear() * 12 + ed.getMonth()) return false;
  }
  return true;
}

// True when this month is the item's LAST month (endDate falls in it) —
// used to show "último mes · recuerda cancelar" reminders.
function isItemLastMonth(item, year, monthIdx) {
  if (!item.endDate) return false;
  const ed = parseLocalDate(item.endDate);
  if (!ed || isNaN(ed)) return false;
  return ed.getFullYear() === year && ed.getMonth() === monthIdx;
}

function getIncomeForMonth(item, year, monthIdx) {
  if (!item.active) return 0;
  if (item.frequency !== 'once' && !isItemActiveInMonth(item, year, monthIdx)) return 0;
  if (item.frequency === 'once') {
    if (!item.onceDate) return 0;
    const d = parseLocalDate(item.onceDate);
    return (d.getFullYear() === year && d.getMonth() === monthIdx) ? item.amount : 0;
  }
  if (item.frequency === 'biannual') {
    let total = 0;
    if (item.firstPayment && item.firstPayment.month === monthIdx + 1) total += item.amount;
    if (item.secondPayment && item.secondPayment.month === monthIdx + 1) total += item.amount;
    return total;
  }
  if (item.frequency === 'annual') {
    return (item.annualMonth || 12) === monthIdx + 1 ? item.amount : 0;
  }
  if (item.frequency === 'biweekly') return item.amount * 2; // approx 2 paychecks per month
  if (item.frequency === 'weekly') return item.amount * 4;
  return item.amount; // monthly
}

function getExpenseForMonth(item, year, monthIdx) {
  return getIncomeForMonth(item, year, monthIdx); // same logic
}

// Simulate full debt payoff schedule month by month
// Returns array of { year, monthIdx, payment, balanceAfter } for each month until paid
// Supports debts that start being paid in the future via debt.startDate (ISO date string).
// If startDate is later than the simulation start, the schedule is shifted (no payments until then).
function simulateDebtPayoff(debt, startDate = new Date()) {
  const schedule = [];
  let balance = debt.totalAmount - (debt.paidAmount || 0);
  if (balance <= 0 || debt.archived) return schedule;
  const monthlyRate = (debt.interestRate || 0) / 100 / 12;
  const minPayment = debt.minimumPayment || 0;
  // Effective first-payment month = max(simulation start, debt.startDate)
  let firstYear = startDate.getFullYear();
  let firstMonth = startDate.getMonth();
  if (debt.startDate) {
    const ds = parseLocalDate(debt.startDate);
    if (!isNaN(ds)) {
      const dsKey = ds.getFullYear() * 12 + ds.getMonth();
      const stKey = firstYear * 12 + firstMonth;
      if (dsKey > stKey) { firstYear = ds.getFullYear(); firstMonth = ds.getMonth(); }
    }
  }
  let safety = 600; // 50 years max
  let m = 0;
  while (balance > 0 && safety-- > 0) {
    const interest = balance * monthlyRate;
    const payment = Math.min(balance + interest, minPayment);
    balance = balance + interest - payment;
    if (balance < 0.01) balance = 0;
    const d = new Date(firstYear, firstMonth + m, 1);
    schedule.push({ year: d.getFullYear(), monthIdx: d.getMonth(), payment, balanceAfter: balance, interest });
    if (payment <= interest && balance > 0) {
      // payment doesn't cover interest - infinite loop, mark as infeasible
      schedule._infeasible = true;
      break;
    }
    m++;
  }
  return schedule;
}

// Returns the effective "next payment date" for a debt, respecting its startDate.
// If startDate is in the future, returns the first occurrence on/after startDate.
function getDebtNextPaymentDate(debt, fromDate = new Date()) {
  const base = (debt.startDate && parseLocalDate(debt.startDate) > fromDate) ? parseLocalDate(debt.startDate) : fromDate;
  return getNextPaymentDate(debt.paymentDay || 1, base);
}

// True if the debt has not started being paid yet (future-start debt)
function isDebtFutureStart(debt, today = new Date()) {
  if (!debt.startDate) return false;
  const ds = parseLocalDate(debt.startDate);
  if (isNaN(ds)) return false;
  // Future-start if start month > current month
  const dsKey = ds.getFullYear() * 12 + ds.getMonth();
  const tKey = today.getFullYear() * 12 + today.getMonth();
  return dsKey > tKey;
}

// Build a 24-month projection that ties everything together
function buildMonthlyProjection(data, monthsAhead = 24, startDate = new Date()) {
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const months = [];

  // Pre-calculate each debt's payoff schedule
  const debtSchedules = data.debts.filter(d => !d.archived && (d.totalAmount - (d.paidAmount || 0)) > 0)
    .map(d => ({ debt: d, schedule: simulateDebtPayoff(d, start) }));

  let cumulativeSavings = data.savings ? (data.savings.current || 0) : 0;

  for (let i = 0; i < monthsAhead; i++) {
    const date = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const year = date.getFullYear();
    const monthIdx = date.getMonth();

    // Income for this month
    let income = 0;
    const incomeBreakdown = [];
    data.incomes.forEach(inc => {
      const amt = getIncomeForMonth(inc, year, monthIdx);
      if (amt > 0) { income += amt; incomeBreakdown.push({ name: inc.name, amount: amt }); }
    });

    // Expense for this month
    let expense = 0;
    const expenseBreakdown = [];
    data.expenses.forEach(exp => {
      const amt = getExpenseForMonth(exp, year, monthIdx);
      if (amt > 0) { expense += amt; expenseBreakdown.push({ name: exp.name, amount: amt }); }
    });

    // Debt payments for this month (only debts still alive)
    let debtPayment = 0;
    const debtBreakdown = [];
    let debtsOutstanding = 0;
    const debtsEndingThisMonth = [];
    debtSchedules.forEach(({ debt, schedule }) => {
      const entry = schedule.find(s => s.year === year && s.monthIdx === monthIdx);
      if (entry) {
        debtPayment += entry.payment;
        debtBreakdown.push({ name: debt.name, amount: entry.payment });
        if (entry.balanceAfter <= 0) debtsEndingThisMonth.push(debt.name);
      }
      // Outstanding at end of this month
      const lastEntry = [...schedule].reverse().find(s => (s.year < year) || (s.year === year && s.monthIdx <= monthIdx));
      if (lastEntry) debtsOutstanding += lastEntry.balanceAfter;
      else if (schedule.length > 0 && (schedule[0].year > year || (schedule[0].year === year && schedule[0].monthIdx > monthIdx))) {
        debtsOutstanding += debt.totalAmount - (debt.paidAmount || 0);
      }
    });

    // Plans that affect this month
    const planEffects = [];
    let planMonthlyDelta = 0;
    let planOneTimeImpact = 0;
    (data.plans || []).forEach(plan => {
      if (!plan.active && plan.active !== undefined) return;
      const planStart = plan.startDate ? parseLocalDate(plan.startDate) : null;
      if (!planStart) return;
      const planStartYear = planStart.getFullYear();
      const planStartMonth = planStart.getMonth();
      const isStartMonth = (year === planStartYear && monthIdx === planStartMonth);
      const isAfterStart = (year > planStartYear) || (year === planStartYear && monthIdx >= planStartMonth);

      if (plan.type === 'lifestyle' && isAfterStart) {
        planMonthlyDelta += (plan.monthlyDelta || 0);
        if (isStartMonth) {
          const upfront = (plan.oneTimeCost || 0) + (plan.penaltyCost || 0);
          if (upfront > 0) {
            planOneTimeImpact -= upfront;
            planEffects.push({ type: 'lifestyle-start', name: plan.name, amount: -upfront });
          }
          if (plan.monthlyDelta) planEffects.push({ type: 'lifestyle-recurring', name: plan.name, amount: plan.monthlyDelta });
        }
      }

      if (plan.type === 'purchase') {
        if (plan.financing === 'own' && isStartMonth) {
          const cost = (plan.cost || 0) + (plan.penaltyCost || 0);
          planOneTimeImpact -= cost;
          planEffects.push({ type: 'purchase', name: plan.name, amount: -cost });
        }
        if (plan.financing === 'loan') {
          // Receive money on startDate
          if (isStartMonth) {
            const upfrontExtra = plan.penaltyCost || 0;
            if (upfrontExtra > 0) {
              planOneTimeImpact -= upfrontExtra;
              planEffects.push({ type: 'loan-extra', name: `${plan.name} (extra)`, amount: -upfrontExtra });
            }
            // The loan money is received but immediately used for the purchase, so net 0 to savings
            // (we don't add the loan principal to savings since it's already spent on the purchase)
            planEffects.push({ type: 'loan-start', name: `Préstamo ${plan.name}`, amount: 0 });
          }
          // Loan payments start after grace period
          const graceMonths = plan.graceMonths || 0;
          const firstPaymentDate = new Date(planStartYear, planStartMonth + graceMonths, 1);
          const lastPaymentDate = new Date(planStartYear, planStartMonth + graceMonths + (plan.loanMonths || 12) - 1, 1);
          if (date >= firstPaymentDate && date <= lastPaymentDate) {
            const payment = calcLoanPayment(plan.cost || 0, plan.loanRate || 0, plan.loanMonths || 12);
            planMonthlyDelta -= payment;
            if (date.getTime() === firstPaymentDate.getTime()) {
              planEffects.push({ type: 'loan-payment-start', name: `Cuota ${plan.name}`, amount: -payment });
            }
          }
        }
      }

      if (plan.type === 'savings' && isStartMonth) {
        // Savings goals: when target date arrives, the money is "spent" on the goal
        // So at that month, deduct the goal amount from cumulative savings
        const cost = plan.cost || 0;
        if (cost > 0) {
          planOneTimeImpact -= cost;
          planEffects.push({ type: 'savings-spent', name: plan.name, amount: -cost });
        }
      }
    });

    const cashFlow = income - expense - debtPayment + planMonthlyDelta + planOneTimeImpact;
    cumulativeSavings += cashFlow;

    months.push({
      date, year, monthIdx,
      label: date.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' }).replace('.', ''),
      fullLabel: date.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }),
      income, expense, debtPayment, planMonthlyDelta, planOneTimeImpact,
      cashFlow,
      cumulativeSavings,
      debtsOutstanding,
      incomeBreakdown, expenseBreakdown, debtBreakdown,
      debtsEndingThisMonth,
      planEffects,
      isPositive: cashFlow >= 0,
    });
  }

  return months;
}

// ============================================================================
//  INTELLIGENT ALLOCATION ENGINE
//  Given the monthly projection, allocates the remaining cash flow each month into:
//  - Buffer for unforeseen events (configurable %, default 10%)
//  - "Life money" (going out, hobbies, comfort, default 15% of after-fixed flow)
//  - Active savings goal contributions (only if other priorities are met)
//  - Debt acceleration (only if high-interest debt exists and surplus available)
//  Returns same projection enriched with allocation per month.
// ============================================================================
function buildSmartAllocation(projection, savingsConfig, plansConfig) {
  const lifeBudgetPct = savingsConfig.lifeBudgetPct != null ? savingsConfig.lifeBudgetPct : 0.15;
  const bufferPct = savingsConfig.bufferPct != null ? savingsConfig.bufferPct : 0.10;
  const minLifeBudget = savingsConfig.minLifeBudget || 0;
  const goal = savingsConfig.goal || 0;
  const currentSavings = savingsConfig.current || 0;
  const goalDate = savingsConfig.goalDate ? parseLocalDate(savingsConfig.goalDate) : null;
  const emergencyTarget = savingsConfig.emergencyTarget || 0;
  const highInterestDebts = (plansConfig && plansConfig.highInterestDebts) || [];

  // Goal target month
  let goalTargetMonthIdx = -1;
  if (goalDate) {
    goalTargetMonthIdx = projection.findIndex(m =>
      m.year === goalDate.getFullYear() && m.monthIdx === goalDate.getMonth()
    );
  }

  // Compute total flow and required savings rate to hit goal by date
  let requiredMonthlyContribution = 0;
  if (goal > currentSavings && goalTargetMonthIdx > 0) {
    const monthsAvailable = goalTargetMonthIdx + 1;
    const totalAvailableFlow = projection.slice(0, monthsAvailable).reduce((s, m) => s + Math.max(0, m.cashFlow), 0);
    const gap = goal - currentSavings;
    if (totalAvailableFlow > 0) {
      requiredMonthlyContribution = Math.max(0, gap / monthsAvailable);
    }
  }

  let runningSavings = currentSavings;

  return projection.map((month, idx) => {
    const flow = month.cashFlow;
    let buffer = 0, lifeMoney = 0, savingsContribution = 0, debtExtra = 0, deficit = 0;

    if (flow <= 0) {
      // Negative or zero month: everything is deficit
      deficit = -flow;
      lifeMoney = 0;
      buffer = 0;
      savingsContribution = 0;
    } else {
      // Positive month: allocate intelligently
      // 1. Life money first (non-negotiable for wellbeing)
      lifeMoney = Math.max(minLifeBudget, flow * lifeBudgetPct);
      lifeMoney = Math.min(lifeMoney, flow); // can't exceed flow
      let remaining = flow - lifeMoney;

      // 2. Buffer for unforeseen
      buffer = remaining * bufferPct;
      remaining -= buffer;

      // 3. If goal date is set and we need to hit it, prioritize goal
      if (goal > 0 && remaining > 0) {
        if (goalTargetMonthIdx > 0 && idx <= goalTargetMonthIdx) {
          // Need to contribute toward goal
          const needed = Math.max(0, requiredMonthlyContribution);
          savingsContribution = Math.min(needed, remaining);
        } else if (runningSavings < goal) {
          // No deadline - use whatever remains for goal
          savingsContribution = remaining;
        }
        remaining -= savingsContribution;
      }

      // 4. Excess goes to debt acceleration (if high-interest) or back to savings
      if (highInterestDebts.length > 0 && remaining > 0) {
        debtExtra = remaining;
        remaining = 0;
      } else if (remaining > 0) {
        // Pile into savings if no goal reached yet, else into life money
        if (goal > 0 && runningSavings < goal) {
          savingsContribution += remaining;
        } else {
          lifeMoney += remaining;
        }
        remaining = 0;
      }
    }

    runningSavings += savingsContribution;
    const goalProgress = goal > 0 ? Math.min(100, (runningSavings / goal) * 100) : 0;
    const goalReached = goal > 0 && runningSavings >= goal;

    return {
      ...month,
      allocation: {
        buffer: Math.round(buffer),
        lifeMoney: Math.round(lifeMoney),
        savingsContribution: Math.round(savingsContribution),
        debtExtra: Math.round(debtExtra),
        deficit: Math.round(deficit),
        runningSavings: Math.round(runningSavings),
        goalProgress,
        goalReached,
      },
    };
  });
}

// Find when goal is reached given a recommended monthly contribution
function findGoalReachMonth(allocatedProjection, goal) {
  const reach = allocatedProjection.find(m => m.allocation && m.allocation.runningSavings >= goal);
  return reach || null;
}

// ============================================================================
//  PLAN-LEVEL ALLOCATION ENGINE
//  Distributes each month's available "savings flow" (after life money + buffer)
//  across all active savings/purchase plans, by priority (closest deadline first).
//  Returns a map of planId -> array of {monthIdx, contribution, runningTotal, isFunded}
//  Plus a global view: each month gets a perPlan breakdown.
// ============================================================================
function buildPlanAllocations(plans, allocatedProjection, currentSavings, mainGoal) {
  // Priority order: by target date (closest first), then by amount (smaller first)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get fundable plans: savings type, or purchase with own financing
  const fundablePlans = (plans || []).filter(p => {
    if (p.type === 'savings' && p.cost > 0) return true;
    if (p.type === 'purchase' && p.financing === 'own' && p.cost > 0) return true;
    return false;
  }).map(p => {
    const targetDate = p.startDate ? parseLocalDate(p.startDate) : null;
    const totalNeeded = (p.cost || 0) + (p.penaltyCost || 0);
    return {
      id: p.id, name: p.name, type: p.type, subcategory: p.subcategory,
      targetDate, totalNeeded,
      isPast: targetDate ? targetDate < today : false,
    };
  }).filter(p => !p.isPast);

  // Add the "main savings goal" as a virtual plan if set
  const allTargets = [...fundablePlans];
  if (mainGoal && mainGoal.amount > 0 && mainGoal.amount > currentSavings) {
    allTargets.push({
      id: '__main_goal__',
      name: 'Meta general',
      type: 'main',
      targetDate: mainGoal.date ? new Date(mainGoal.date) : null,
      totalNeeded: mainGoal.amount - currentSavings, // how much extra we need
    });
  }

  // Sort by target date (closest first); plans without date go last
  allTargets.sort((a, b) => {
    if (!a.targetDate && !b.targetDate) return a.totalNeeded - b.totalNeeded;
    if (!a.targetDate) return 1;
    if (!b.targetDate) return -1;
    return a.targetDate - b.targetDate;
  });

  // For each plan, calculate the "required monthly contribution"
  // based on months between today and its target
  const planContributions = {}; // planId -> { allocations: [], totalAllocated, status }
  allTargets.forEach(p => { planContributions[p.id] = { plan: p, allocations: [], totalAllocated: 0, status: 'pending' }; });

  // Reserve current savings to the first plan in priority order (if user has any saved)
  let availableFromExisting = currentSavings;
  for (const p of allTargets) {
    if (p.id === '__main_goal__') continue; // main goal subtracts current savings already
    const useFromExisting = Math.min(availableFromExisting, p.totalNeeded);
    if (useFromExisting > 0) {
      planContributions[p.id].fromExistingSavings = useFromExisting;
      planContributions[p.id].totalAllocated = useFromExisting;
      availableFromExisting -= useFromExisting;
    }
  }

  // Now distribute monthly savings flow to each plan
  const monthlyView = []; // each month: { date, perPlan: [{planId, name, amount, runningTotal, requiredTotal}], unallocated }

  allocatedProjection.forEach((month, monthIdx) => {
    const a = month.allocation || {};
    let availableThisMonth = a.savingsContribution || 0;
    const monthDate = month.date;
    const monthBreakdown = { monthIdx, year: month.year, month: month.monthIdx, label: month.fullLabel, perPlan: [], unallocated: 0 };

    // Identify plans whose target month is at or after this month and haven't been fully funded
    const activePlans = allTargets.filter(p => {
      if (!planContributions[p.id]) return false;
      if (planContributions[p.id].totalAllocated >= p.totalNeeded) return false;
      if (p.targetDate && monthDate > p.targetDate) {
        // Past the target without funding = won't fund
        if (planContributions[p.id].status === 'pending') planContributions[p.id].status = 'failed';
        return false;
      }
      return true;
    });

    // For each active plan, calculate required monthly contribution to hit target
    const planNeeds = activePlans.map(p => {
      const targetMonth = p.targetDate ? allocatedProjection.findIndex(m => m.year === p.targetDate.getFullYear() && m.monthIdx === p.targetDate.getMonth()) : allocatedProjection.length - 1;
      const monthsRemaining = Math.max(1, targetMonth - monthIdx + 1);
      const stillNeeded = p.totalNeeded - planContributions[p.id].totalAllocated;
      const required = stillNeeded / monthsRemaining;
      return { plan: p, monthsRemaining, stillNeeded, required, targetMonthIdx: targetMonth };
    });

    // Allocate: closest deadline first gets what it needs (capped to available)
    for (const need of planNeeds) {
      if (availableThisMonth <= 0) break;
      const give = Math.min(need.required, need.stillNeeded, availableThisMonth);
      if (give > 0) {
        planContributions[need.plan.id].totalAllocated += give;
        planContributions[need.plan.id].allocations.push({
          monthIdx, year: month.year, month: month.monthIdx, label: month.fullLabel,
          amount: give, runningTotal: planContributions[need.plan.id].totalAllocated,
        });
        monthBreakdown.perPlan.push({
          planId: need.plan.id, name: need.plan.name, type: need.plan.type, subcategory: need.plan.subcategory,
          amount: give, runningTotal: planContributions[need.plan.id].totalAllocated,
          requiredTotal: need.plan.totalNeeded,
          targetDate: need.plan.targetDate,
        });
        availableThisMonth -= give;
        if (planContributions[need.plan.id].totalAllocated >= need.plan.totalNeeded) {
          planContributions[need.plan.id].status = 'funded';
        }
      }
    }

    // Whatever remains unallocated goes back to "free savings"
    monthBreakdown.unallocated = availableThisMonth;
    monthlyView.push(monthBreakdown);
  });

  // Final pass: mark plans that didn't get fully funded
  Object.values(planContributions).forEach(pc => {
    if (pc.status === 'pending') {
      if (pc.totalAllocated >= pc.plan.totalNeeded) pc.status = 'funded';
      else if (pc.plan.targetDate) pc.status = 'underfunded';
    }
  });

  return { planContributions, monthlyView };
}

// Convert any frequency to monthly equivalent (legacy, for current-month sums)
function getMonthlyEquivalent(item) {
  const a = item.amount || 0;
  {
    // Respect the item's life-window relative to the current month
    const now = new Date();
    if (item.frequency !== 'once' && !isItemActiveInMonth(item, now.getFullYear(), now.getMonth())) return 0;
  }
  if (item.frequency === 'once') {
    // One-time only counts in its specific month
    if (!item.onceDate) return 0;
    const d = parseLocalDate(item.onceDate);
    const now = new Date();
    return (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) ? a : 0;
  }
  if (item.frequency === 'biannual') return (a * 2) / 12;
  if (item.frequency === 'annual') return a / 12;
  if (item.frequency === 'biweekly') return a * 26 / 12;
  if (item.frequency === 'weekly') return a * 52 / 12;
  return a; // monthly
}

// Get next occurrence date for any income/expense (handles business day adjust)
function getNextOccurrenceDate(item, fromDate = new Date()) {
  const from = new Date(fromDate); from.setHours(0,0,0,0);
  const adjust = item.adjustForBusinessDay !== false;
  if (item.frequency === 'once') {
    if (!item.onceDate) return null;
    const d = parseLocalDate(item.onceDate);
    return d >= from ? d : null;
  }
  if (item.frequency === 'biannual') {
    const candidates = [];
    [item.firstPayment, item.secondPayment].forEach(p => {
      if (!p || !p.month) return;
      [from.getFullYear(), from.getFullYear() + 1].forEach(year => {
        const monthIdx = p.month - 1;
        const lastDay = new Date(year, monthIdx + 1, 0).getDate();
        let d = new Date(year, monthIdx, Math.min(p.day || 1, lastDay));
        if (adjust) d = previousBusinessDay(d);
        if (d >= from) candidates.push(d);
      });
    });
    candidates.sort((a,b) => a - b);
    return candidates[0] || null;
  }
  if (item.frequency === 'annual') {
    const month = (item.annualMonth || 12) - 1;
    const dayOfMonth = item.dayOfMonth || 1;
    const tryYear = (year) => {
      const lastDay = new Date(year, month + 1, 0).getDate();
      let d = new Date(year, month, Math.min(dayOfMonth, lastDay));
      if (adjust) d = previousBusinessDay(d);
      return d;
    };
    let d = tryYear(from.getFullYear());
    if (d < from) d = tryYear(from.getFullYear() + 1);
    return d;
  }
  return getNextPaymentDate(item.dayOfMonth || 1, from, adjust);
}

// ============================================================================
//  DAILY MONTH SIMULATION
//  Walks every day from today through end of month, accumulating confirmed and
//  pending cashflow. Tells you:
//  - "today balance" (starting cash + already-confirmed movements this month)
//  - When you'd go negative (date) and when you'd recover (date)
//  - End-of-month projected balance
//  Items are placed on their dayOfMonth (or specific date for once/biannual/annual).
//  Future-start debts are skipped if their startDate is after this month.
// ============================================================================
function simulateMonthDaily(data, today = new Date()) {
  const t = new Date(today); t.setHours(0,0,0,0);
  const monthStart = new Date(t.getFullYear(), t.getMonth(), 1);
  const monthEnd = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  const startingCash = (data.savings && data.savings.currentBalance) || 0;
  const monthKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
  const confirms = (data.confirmations && data.confirmations[monthKey]) || {};

  // Build list of events for the month: { date, amount, name, kind, key, confirmed }
  const events = [];
  const clampDay = (day) => {
    const lastDay = monthEnd.getDate();
    return Math.min(Math.max(1, day || 1), lastDay);
  };

  (data.incomes || []).filter(i => i.active && (i.frequency === 'once' || isItemActiveInMonth(i, t.getFullYear(), t.getMonth()))).forEach(i => {
    const freq = i.frequency || 'monthly';
    if (freq === 'once') {
      if (!i.onceDate) return;
      const d = parseLocalDate(i.onceDate);
      if (d >= monthStart && d <= monthEnd) {
        const key = `inc-${i.id}-${monthKey}`;
        events.push({ date: d, amount: i.amount || 0, name: i.name, kind: 'income', key, confirmed: !!confirms[key] });
      }
      return;
    }
    if (freq === 'biannual') {
      [i.firstPayment, i.secondPayment].forEach(p => {
        if (!p) return;
        if (p.month - 1 !== t.getMonth()) return;
        const d = new Date(t.getFullYear(), p.month - 1, clampDay(p.day));
        const key = `inc-${i.id}-${monthKey}`;
        events.push({ date: d, amount: i.amount || 0, name: i.name, kind: 'income', key, confirmed: !!confirms[key] });
      });
      return;
    }
    if (freq === 'annual') {
      if (!i.annualMonth || i.annualMonth - 1 !== t.getMonth()) return;
      const d = new Date(t.getFullYear(), i.annualMonth - 1, clampDay(i.annualDay || i.dayOfMonth || 1));
      const key = `inc-${i.id}-${monthKey}`;
      events.push({ date: d, amount: i.amount || 0, name: i.name, kind: 'income', key, confirmed: !!confirms[key] });
      return;
    }
    if (freq === 'biweekly') {
      // Two paydays: dayOfMonth and dayOfMonth+15 (clamped)
      const day1 = clampDay(i.dayOfMonth || 15);
      const day2 = clampDay(day1 + 15);
      const key = `inc-${i.id}-${monthKey}`;
      events.push({ date: new Date(t.getFullYear(), t.getMonth(), day1), amount: i.amount || 0, name: i.name + ' (1ra quincena)', kind: 'income', key, confirmed: !!confirms[key] });
      events.push({ date: new Date(t.getFullYear(), t.getMonth(), day2), amount: i.amount || 0, name: i.name + ' (2da quincena)', kind: 'income', key: key + '-2', confirmed: !!confirms[key + '-2'] });
      return;
    }
    if (freq === 'weekly') {
      // ~4 events at days 7, 14, 21, 28
      [7, 14, 21, 28].forEach((d, idx) => {
        const key = `inc-${i.id}-${monthKey}-w${idx}`;
        events.push({ date: new Date(t.getFullYear(), t.getMonth(), d), amount: i.amount || 0, name: i.name + ` (sem ${idx+1})`, kind: 'income', key, confirmed: !!confirms[key] });
      });
      return;
    }
    // monthly
    const day = clampDay(i.dayOfMonth || 1);
    const key = `inc-${i.id}-${monthKey}`;
    events.push({ date: new Date(t.getFullYear(), t.getMonth(), day), amount: i.amount || 0, name: i.name, kind: 'income', key, confirmed: !!confirms[key] });
  });

  (data.expenses || []).filter(e => e.active && (e.frequency === 'once' || isItemActiveInMonth(e, t.getFullYear(), t.getMonth()))).forEach(e => {
    const freq = e.frequency || 'monthly';
    if (freq === 'once') {
      if (!e.onceDate) return;
      const d = parseLocalDate(e.onceDate);
      if (d >= monthStart && d <= monthEnd) {
        const key = `exp-${e.id}-${monthKey}`;
        events.push({ date: d, amount: -(e.amount || 0), name: e.name, kind: 'expense', key, confirmed: !!confirms[key] });
      }
      return;
    }
    if (freq === 'biannual') {
      [e.firstPayment, e.secondPayment].forEach(p => {
        if (!p) return;
        if (p.month - 1 !== t.getMonth()) return;
        const d = new Date(t.getFullYear(), p.month - 1, clampDay(p.day));
        const key = `exp-${e.id}-${monthKey}`;
        events.push({ date: d, amount: -(e.amount || 0), name: e.name, kind: 'expense', key, confirmed: !!confirms[key] });
      });
      return;
    }
    if (freq === 'annual') {
      if (!e.annualMonth || e.annualMonth - 1 !== t.getMonth()) return;
      const d = new Date(t.getFullYear(), e.annualMonth - 1, clampDay(e.annualDay || e.dayOfMonth || 1));
      const key = `exp-${e.id}-${monthKey}`;
      events.push({ date: d, amount: -(e.amount || 0), name: e.name, kind: 'expense', key, confirmed: !!confirms[key] });
      return;
    }
    if (freq === 'biweekly') {
      const day1 = clampDay(e.dayOfMonth || 15);
      const day2 = clampDay(day1 + 15);
      const key = `exp-${e.id}-${monthKey}`;
      events.push({ date: new Date(t.getFullYear(), t.getMonth(), day1), amount: -(e.amount || 0), name: e.name + ' (1ra)', kind: 'expense', key, confirmed: !!confirms[key] });
      events.push({ date: new Date(t.getFullYear(), t.getMonth(), day2), amount: -(e.amount || 0), name: e.name + ' (2da)', kind: 'expense', key: key + '-2', confirmed: !!confirms[key + '-2'] });
      return;
    }
    if (freq === 'weekly') {
      [7, 14, 21, 28].forEach((d, idx) => {
        const key = `exp-${e.id}-${monthKey}-w${idx}`;
        events.push({ date: new Date(t.getFullYear(), t.getMonth(), d), amount: -(e.amount || 0), name: e.name + ` (sem ${idx+1})`, kind: 'expense', key, confirmed: !!confirms[key] });
      });
      return;
    }
    // monthly
    const day = clampDay(e.dayOfMonth || 1);
    const key = `exp-${e.id}-${monthKey}`;
    events.push({ date: new Date(t.getFullYear(), t.getMonth(), day), amount: -(e.amount || 0), name: e.name, kind: 'expense', key, confirmed: !!confirms[key] });
  });

  // Debts: one event per active non-archived non-future-start debt
  (data.debts || []).filter(d => !d.archived && (d.totalAmount - (d.paidAmount || 0)) > 0).forEach(d => {
    if (isDebtFutureStart(d, t)) {
      const ds = parseLocalDate(d.startDate);
      // If the future start falls inside this month, include it
      if (ds >= monthStart && ds <= monthEnd) {
        const key = `debt-${d.id}-${monthKey}`;
        const remaining = d.totalAmount - (d.paidAmount || 0);
        const due = Math.max(0, Math.min(d.minimumPayment || 0, remaining));
        events.push({ date: ds, amount: -due, name: d.name + ' (1ra cuota)', kind: 'debt', key, confirmed: !!confirms[key] });
      }
      return;
    }
    const day = clampDay(d.paymentDay || 1);
    const date = new Date(t.getFullYear(), t.getMonth(), day);
    const key = `debt-${d.id}-${monthKey}`;
    const remaining = d.totalAmount - (d.paidAmount || 0);
    const due = Math.max(0, Math.min(d.minimumPayment || 0, remaining));
    events.push({ date, amount: -due, name: d.name, kind: 'debt', key, confirmed: !!confirms[key] });
  });

  // Monthly savings contribution: the user treats it as one more "payment"
  // of the cycle (e.g. Ahorro: 2.000.000). Cash leaves the account when
  // confirmed; the pot increase happens in handleConfirmSavings.
  const savContrib = (data.savings && data.savings.monthlyContribution) || 0;
  if (savContrib > 0) {
    const key = `sav-monthly-${monthKey}`;
    events.push({ date: new Date(monthEnd), amount: -savContrib, name: 'Ahorro del mes', kind: 'savings', key, confirmed: !!confirms[key] });
  }

  events.sort((a, b) => a.date - b.date);

  // Compute today's "real balance" = startingCash + (sum of confirmed events with date <= today)
  // We treat confirmed events as having actually happened regardless of date.
  let realBalanceToday = startingCash;
  events.forEach(ev => { if (ev.confirmed) realBalanceToday += ev.amount; });

  // Walk day by day from today to month end, applying *pending* events on their date.
  // Already-confirmed events are baked into realBalanceToday and do NOT reapply.
  // Already-overdue pending events: applied immediately (today) to reflect they should have happened.
  const days = [];
  let running = realBalanceToday;
  let firstNegativeDate = null;
  let recoveryDate = null;
  let wasNegative = running < 0;
  if (wasNegative) firstNegativeDate = t;

  // Pending events split into overdue (date < today) and upcoming (date >= today)
  const overduePending = events.filter(ev => !ev.confirmed && ev.date < t);
  const futurePending = events.filter(ev => !ev.confirmed && ev.date >= t);

  // Apply overdue pending now so the simulation reflects real obligations
  overduePending.forEach(ev => { running += ev.amount; });
  if (running < 0 && !wasNegative) { firstNegativeDate = t; wasNegative = true; }
  if (wasNegative && running >= 0) { recoveryDate = t; wasNegative = false; }

  // Sort future pending by date
  futurePending.sort((a, b) => a.date - b.date);
  let idx = 0;
  for (let day = new Date(t); day <= monthEnd; day.setDate(day.getDate() + 1)) {
    while (idx < futurePending.length && futurePending[idx].date.getTime() === day.getTime()) {
      running += futurePending[idx].amount;
      idx++;
    }
    if (running < 0 && !wasNegative) { firstNegativeDate = new Date(day); wasNegative = true; recoveryDate = null; }
    if (wasNegative && running >= 0) { recoveryDate = new Date(day); wasNegative = false; }
    days.push({ date: new Date(day), balance: running });
  }

  const endOfMonthBalance = days.length > 0 ? days[days.length - 1].balance : running;
  const lowestPoint = days.reduce((min, d) => d.balance < min.balance ? d : min, { balance: Infinity, date: null });

  // === CASH RUNWAY until next income ===
  // The user thinks day-to-day: "with the cash I have now, after paying what's
  // due before my next paycheck, how much is left?" So we find the next pending
  // income and sum every pending obligation (and any smaller income) that lands
  // BEFORE it. availableUntilIncome = cash today +/- those movements.
  const pendingAll = events.filter(ev => !ev.confirmed);
  const nextIncomeEv = pendingAll
    .filter(ev => ev.amount > 0)
    .sort((a, b) => a.date - b.date)[0] || null;
  let availableUntilIncome;
  if (nextIncomeEv) {
    const before = pendingAll.filter(ev => ev !== nextIncomeEv && ev.date < nextIncomeEv.date);
    availableUntilIncome = realBalanceToday + before.reduce((s, ev) => s + ev.amount, 0);
  } else {
    // No income arriving this month → what you keep after all pending outflows
    availableUntilIncome = endOfMonthBalance;
  }
  // Total still-pending obligations (outflows) this month, for the checklist footer
  const pendingObligations = pendingAll.filter(ev => ev.amount < 0).reduce((s, ev) => s + (-ev.amount), 0);
  const pendingIncome = pendingAll.filter(ev => ev.amount > 0).reduce((s, ev) => s + ev.amount, 0);

  return {
    startingCash,
    realBalanceToday,
    endOfMonthBalance,
    availableUntilIncome,
    nextIncome: nextIncomeEv ? { date: nextIncomeEv.date, amount: nextIncomeEv.amount, name: nextIncomeEv.name } : null,
    pendingObligations,
    pendingIncome,
    firstNegativeDate,
    recoveryDate,
    stillNegativeAtMonthEnd: wasNegative,
    lowestPoint: isFinite(lowestPoint.balance) ? lowestPoint : null,
    days,
    events,
    overdueCount: overduePending.length,
    pendingCount: futurePending.length,
    confirmedCount: events.filter(ev => ev.confirmed).length,
    monthKey,
  };
}

const CATEGORIES = {
  income: [
    { id: 'salary', name: 'Salario', icon: Briefcase, color: '#34D399' },
    { id: 'freelance', name: 'Freelance', icon: Sparkles, color: '#A78BFA' },
    { id: 'investment', name: 'Inversiones', icon: TrendingUp, color: '#F4C77B' },
    { id: 'other-income', name: 'Otros', icon: Banknote, color: '#60A5FA' },
  ],
  expense: [
    { id: 'housing', name: 'Vivienda', icon: Home, color: '#F87171' },
    { id: 'food', name: 'Alimentación', icon: ShoppingBag, color: '#FB923C' },
    { id: 'transport', name: 'Transporte', icon: Car, color: '#60A5FA' },
    { id: 'health', name: 'Salud', icon: Heart, color: '#F472B6' },
    { id: 'leisure', name: 'Ocio', icon: Coffee, color: '#A78BFA' },
    { id: 'subscriptions', name: 'Suscripciones', icon: Smartphone, color: '#34D399' },
    { id: 'utilities', name: 'Servicios', icon: Zap, color: '#FBBF24' },
    { id: 'other-expense', name: 'Otros', icon: MoreHorizontal, color: '#94A3B8' },
  ],
};

const getCategory = (type, id) => {
  const list = CATEGORIES[type];
  if (!list) return null;
  return list.find(c => c.id === id) || list[list.length - 1];
}

// Plan subcategories - dynamic options for each plan type
const PLAN_SUBCATEGORIES = {
  purchase: [
    { id: 'electronics', name: 'Electrónicos', icon: Smartphone, color: '#60A5FA', desc: 'Celular, computador, tablet, audífonos' },
    { id: 'appliance', name: 'Electrodomésticos', icon: Zap, color: '#FBBF24', desc: 'Nevera, lavadora, microondas, TV' },
    { id: 'vehicle', name: 'Vehículo', icon: Car, color: '#A78BFA', desc: 'Carro, moto, bicicleta' },
    { id: 'home', name: 'Hogar / Muebles', icon: Home, color: '#F87171', desc: 'Muebles, decoración, mejoras' },
    { id: 'travel', name: 'Viaje', icon: Sparkles, color: '#34D399', desc: 'Vacaciones, paquete turístico, tiquetes' },
    { id: 'health', name: 'Salud', icon: Heart, color: '#F472B6', desc: 'Procedimiento, ortodoncia, gimnasio' },
    { id: 'education', name: 'Educación', icon: Briefcase, color: '#A78BFA', desc: 'Curso, certificación, posgrado' },
    { id: 'event', name: 'Evento', icon: Coffee, color: '#FB923C', desc: 'Boda, fiesta, regalo grande' },
    { id: 'other-purchase', name: 'Otra compra', icon: ShoppingBag, color: '#94A3B8', desc: 'Cualquier otra cosa' },
  ],
  lifestyle: [
    { id: 'housing-change', name: 'Cambio de vivienda', icon: Home, color: '#F87171', desc: 'Mudarte, comprar casa, cambio de arriendo' },
    { id: 'food-change', name: 'Mercado / Comida', icon: ShoppingBag, color: '#FB923C', desc: 'Cambiar hábitos de mercado o comida' },
    { id: 'transport-change', name: 'Transporte', icon: Car, color: '#60A5FA', desc: 'Comprar carro vs taxi, cambiar de medio' },
    { id: 'subscriptions-change', name: 'Suscripciones', icon: Smartphone, color: '#34D399', desc: 'Agregar/quitar Netflix, Spotify, etc.' },
    { id: 'utilities-change', name: 'Servicios', icon: Zap, color: '#FBBF24', desc: 'Cambio en luz, agua, internet, datos' },
    { id: 'job-change', name: 'Trabajo / Ingresos', icon: Briefcase, color: '#A78BFA', desc: 'Nuevo trabajo, ascenso, freelance, segundo ingreso' },
    { id: 'lifestyle-change', name: 'Otro estilo de vida', icon: Heart, color: '#F472B6', desc: 'Salud, gimnasio, hobby, cambio general' },
    { id: 'other-change', name: 'Otro cambio', icon: MoreHorizontal, color: '#94A3B8', desc: 'Cualquier otro cambio recurrente' },
  ],
  savings: [
    { id: 'emergency', name: 'Fondo de emergencia', icon: AlertCircle, color: '#F87171', desc: 'Colchón para imprevistos' },
    { id: 'travel-savings', name: 'Viaje', icon: Sparkles, color: '#34D399', desc: 'Vacaciones futuras' },
    { id: 'home-savings', name: 'Casa / Inmueble', icon: Home, color: '#F87171', desc: 'Cuota inicial, propiedad' },
    { id: 'vehicle-savings', name: 'Vehículo', icon: Car, color: '#A78BFA', desc: 'Comprar carro/moto al contado' },
    { id: 'education-savings', name: 'Educación', icon: Briefcase, color: '#60A5FA', desc: 'Estudios futuros, cursos' },
    { id: 'retirement', name: 'Retiro / Largo plazo', icon: TrendingUp, color: '#FBBF24', desc: 'Inversión a largo plazo' },
    { id: 'gift', name: 'Regalo / Evento', icon: Heart, color: '#F472B6', desc: 'Boda, regalo grande, celebración' },
    { id: 'business', name: 'Negocio / Inversión', icon: Target, color: '#A78BFA', desc: 'Capital semilla, emprendimiento' },
    { id: 'other-savings', name: 'Otro ahorro', icon: Banknote, color: '#94A3B8', desc: 'Cualquier otra meta' },
  ],
};

// Subcategory-specific templates: placeholder text, examples, default values
const PLAN_TEMPLATES = {
  // Purchases
  'electronics': { namePlaceholder: 'Ej. iPhone 16, MacBook Air', costLabel: '¿Cuánto cuesta el equipo?', extrasLabel: 'Costos extras (envío, accesorios, garantía extendida)', extrasPlaceholder: 'Funda, cargador, audífonos' },
  'appliance': { namePlaceholder: 'Ej. Lavadora Samsung, TV de 55"', costLabel: '¿Cuánto cuesta el electrodoméstico?', extrasLabel: 'Costos extras (instalación, transporte)', extrasPlaceholder: 'Domicilio, instalación' },
  'vehicle': { namePlaceholder: 'Ej. Carro Mazda 3, Moto AKT 125', costLabel: '¿Cuánto cuesta el vehículo?', extrasLabel: 'Costos extras (matrícula, SOAT, traspaso)', extrasPlaceholder: 'Trámites, seguro inicial' },
  'home': { namePlaceholder: 'Ej. Comedor nuevo, remodelar baño', costLabel: '¿Cuánto cuesta?', extrasLabel: 'Costos extras (transporte, instalación)', extrasPlaceholder: 'Mano de obra, domicilio' },
  'travel': { namePlaceholder: 'Ej. Viaje a México, Cartagena en agosto', costLabel: '¿Cuánto cuesta el viaje?', extrasLabel: 'Costos extras (gastos en destino, seguro)', extrasPlaceholder: 'Comida, suvenires, traslados' },
  'health': { namePlaceholder: 'Ej. Ortodoncia, cirugía, gimnasio anual', costLabel: '¿Cuánto cuesta?', extrasLabel: 'Costos extras', extrasPlaceholder: 'Medicamentos, controles' },
  'education': { namePlaceholder: 'Ej. Especialización, curso de inglés', costLabel: '¿Cuánto cuesta el programa?', extrasLabel: 'Costos extras (materiales, transporte)', extrasPlaceholder: 'Libros, certificación' },
  'event': { namePlaceholder: 'Ej. Boda, regalo aniversario, fiesta', costLabel: '¿Cuánto cuesta?', extrasLabel: 'Costos extras', extrasPlaceholder: 'Decoración, transporte' },
  'other-purchase': { namePlaceholder: 'Ej. Mi compra', costLabel: '¿Cuánto cuesta?', extrasLabel: 'Costos extras', extrasPlaceholder: '' },
  // Lifestyle changes
  'housing-change': {
    namePlaceholder: 'Ej. Mudarme con mi pareja, mudar a apto más barato',
    intro: 'Si te mudas a un sitio más barato → ahorro mensual (positivo). Si te mudas a algo más costoso → gasto extra (negativo).',
    deltaLabel: 'Cambio mensual de arriendo + servicios',
    deltaHelp: '+1.000.000 si ahorras esa cantidad al mes, o -300.000 si te toca pagar más',
    oneTimeLabel: 'Costo de mudanza, depósito',
    penaltyLabel: 'Penalidad por romper contrato actual',
  },
  'food-change': {
    namePlaceholder: 'Ej. Hacer mercado en lugar de pedir domicilios',
    intro: 'Cambiar tus hábitos de comida puede reducir o aumentar tu gasto mensual significativamente.',
    deltaLabel: 'Cambio mensual en mercado y comida',
    deltaHelp: '+400.000 si cocinas más en casa, o -200.000 si comes más afuera',
    oneTimeLabel: 'Costo inicial (electrodomésticos, despensa)',
    penaltyLabel: 'Otros costos extras',
  },
  'transport-change': {
    namePlaceholder: 'Ej. Cambiar de carro a moto, dejar el carro',
    intro: 'Cambiar tu medio de transporte afecta tus gastos en gasolina, mantenimiento, parqueaderos.',
    deltaLabel: 'Cambio mensual en transporte',
    deltaHelp: '+500.000 si te ahorras gasolina, parqueaderos. -100.000 si te subes a Uber más',
    oneTimeLabel: 'Costo inicial (compra moto, depósito)',
    penaltyLabel: 'Otros costos extras',
  },
  'subscriptions-change': {
    namePlaceholder: 'Ej. Quitar Netflix, agregar Spotify familiar',
    intro: 'Sumar o quitar suscripciones digitales recurrentes (streaming, apps, gimnasio).',
    deltaLabel: 'Cambio mensual',
    deltaHelp: '+50.000 si quitas suscripciones, -30.000 si agregas Disney+',
    oneTimeLabel: 'Costo inicial (sin penalidad)',
    penaltyLabel: 'Cargo por cancelación anticipada',
  },
  'utilities-change': {
    namePlaceholder: 'Ej. Cambiar plan de internet, ahorrar luz',
    intro: 'Cambios en tus servicios públicos: luz, agua, gas, internet, datos móviles.',
    deltaLabel: 'Cambio mensual en servicios',
    deltaHelp: '+80.000 si bajas el plan de internet, -50.000 si subes a uno más rápido',
    oneTimeLabel: 'Costo inicial (instalación, equipos)',
    penaltyLabel: 'Cargo por terminación de contrato',
  },
  'job-change': {
    namePlaceholder: 'Ej. Nuevo trabajo, freelance, ascenso',
    intro: 'Cambios en tus ingresos: nuevo empleo, segundo trabajo, freelance, ascenso, bajada de sueldo.',
    deltaLabel: 'Cambio mensual en ingresos',
    deltaHelp: '+1.500.000 si te ascienden, -500.000 si bajas a medio tiempo',
    oneTimeLabel: 'Costos iniciales (equipos, capacitación)',
    penaltyLabel: 'Penalidad si dejas el trabajo actual',
  },
  'lifestyle-change': {
    namePlaceholder: 'Ej. Empezar gimnasio, dejar de fumar',
    intro: 'Otros cambios recurrentes en tu estilo de vida que afectan tus gastos o ingresos.',
    deltaLabel: 'Cambio mensual',
    deltaHelp: '+200.000 si dejas un mal hábito, -150.000 si tomas uno nuevo',
    oneTimeLabel: 'Costo inicial',
    penaltyLabel: 'Otros costos extras',
  },
  'other-change': {
    namePlaceholder: 'Ej. Mi cambio',
    intro: 'Cualquier otro cambio recurrente en tus finanzas.',
    deltaLabel: 'Cambio mensual',
    deltaHelp: 'Positivo si ahorras, negativo si gastas más',
    oneTimeLabel: 'Costo inicial',
    penaltyLabel: 'Otros costos extras',
  },
  // Savings
  'emergency': { namePlaceholder: 'Ej. Mi colchón financiero', goalLabel: '¿Cuánto quieres tener de fondo?', goalHelp: 'Recomendado: 3 a 6 meses de tus gastos fijos' },
  'travel-savings': { namePlaceholder: 'Ej. Viaje a Europa 2027', goalLabel: '¿Cuánto cuesta el viaje?', goalHelp: 'Incluye tiquetes, hospedaje, comida, traslados' },
  'home-savings': { namePlaceholder: 'Ej. Cuota inicial casa', goalLabel: '¿Cuánto necesitas reunir?', goalHelp: 'En Colombia, cuota inicial mínima ~30% del valor de la propiedad' },
  'vehicle-savings': { namePlaceholder: 'Ej. Comprar moto al contado', goalLabel: '¿Cuánto cuesta?', goalHelp: 'Comprar al contado evita pagar intereses de crédito' },
  'education-savings': { namePlaceholder: 'Ej. Maestría, MBA', goalLabel: '¿Cuánto necesitas?', goalHelp: 'Considera matrículas, materiales y posibles gastos de manutención' },
  'retirement': { namePlaceholder: 'Ej. Mi pensión voluntaria', goalLabel: 'Meta de inversión', goalHelp: 'Pequeñas cantidades constantes son mejor que grandes esporádicas' },
  'gift': { namePlaceholder: 'Ej. Regalo grande, boda', goalLabel: '¿Cuánto necesitas?', goalHelp: 'Incluye todo lo necesario' },
  'business': { namePlaceholder: 'Ej. Capital para mi emprendimiento', goalLabel: '¿Cuánto capital necesitas?', goalHelp: 'Considera 3-6 meses de gastos del negocio sin ingresos' },
  'other-savings': { namePlaceholder: 'Ej. Mi meta de ahorro', goalLabel: '¿Cuánto quieres ahorrar?', goalHelp: '' },
};

function getPlanTemplate(subcategoryId) {
  return PLAN_TEMPLATES[subcategoryId] || PLAN_TEMPLATES['other-purchase'];
}

function getPlanSubcategory(type, id) {
  const list = PLAN_SUBCATEGORIES[type];
  if (!list) return null;
  return list.find(c => c.id === id) || list[list.length - 1];
}

// Pre-defined common Colombian services for quick setup
const SERVICES_PRESETS = [
  { id: 'arriendo', name: 'Arriendo', category: 'housing', icon: Home, color: '#F87171', day: 5 },
  { id: 'admin', name: 'Administración', category: 'housing', icon: Briefcase, color: '#F87171', day: 5 },
  { id: 'energia', name: 'Energía / Luz', category: 'utilities', icon: Zap, color: '#FBBF24', day: 15 },
  { id: 'agua', name: 'Agua', category: 'utilities', icon: Banknote, color: '#60A5FA', day: 15 },
  { id: 'gas', name: 'Gas', category: 'utilities', icon: Zap, color: '#FB923C', day: 15 },
  { id: 'internet', name: 'Internet', category: 'subscriptions', icon: Smartphone, color: '#34D399', day: 10 },
  { id: 'datos', name: 'Datos móviles', category: 'subscriptions', icon: Smartphone, color: '#A78BFA', day: 10 },
  { id: 'mercado', name: 'Mercado', category: 'food', icon: ShoppingBag, color: '#FB923C', day: 1 },
  { id: 'streaming', name: 'Streaming', category: 'leisure', icon: Coffee, color: '#A78BFA', day: 5 },
  { id: 'seguro', name: 'Seguro', category: 'health', icon: Heart, color: '#F472B6', day: 1 },
];

// Calculate debt payoff schedule with amortization
const calcDebtPayoff = (balance, monthlyPayment, annualRate) => {
  const r = (annualRate || 0) / 100 / 12;
  if (monthlyPayment <= 0 || balance <= 0) return { months: 0, totalInterest: 0, totalPaid: 0, feasible: false };
  if (r === 0) {
    const months = Math.ceil(balance / monthlyPayment);
    return { months, totalInterest: 0, totalPaid: balance, feasible: true };
  }
  const minPaymentForRate = balance * r;
  if (monthlyPayment <= minPaymentForRate) {
    return { months: Infinity, totalInterest: Infinity, totalPaid: Infinity, feasible: false };
  }
  const months = Math.ceil(-Math.log(1 - (balance * r) / monthlyPayment) / Math.log(1 + r));
  const totalPaid = monthlyPayment * months;
  return { months, totalInterest: Math.max(0, totalPaid - balance), totalPaid, feasible: true };
};

// Generate iCalendar (.ics) file content for native iPhone notifications
const generateICS = (data) => {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Finanzas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  const escapeText = t => String(t || '').replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n');

  // Active debts
  data.debts.filter(d => !d.archived && (d.totalAmount - (d.paidAmount||0)) > 0).forEach(d => {
    const start = getDebtNextPaymentDate(d);
    const dt = fmtDate(start);
    lines.push(
      'BEGIN:VEVENT',
      `UID:debt-${d.id}@finanzas`,
      `DTSTAMP:${dt}T090000Z`,
      `DTSTART;VALUE=DATE:${dt}`,
      `DTEND;VALUE=DATE:${dt}`,
      `SUMMARY:💳 Pagar ${escapeText(d.name)}`,
      `DESCRIPTION:Cuota mensual: ${formatMoney(d.minimumPayment, data.user.currency)}${d.creditor ? '\\n' + escapeText(d.creditor) : ''}`,
      `RRULE:FREQ=MONTHLY;BYMONTHDAY=${d.paymentDay}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Recordatorio de pago',
      'TRIGGER:-P1D',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Pago hoy',
      'TRIGGER:PT9H',
      'END:VALARM',
      'END:VEVENT'
    );
  });

  // Recurring expenses
  data.expenses.filter(e => e.active && e.frequency === 'monthly').forEach(e => {
    const start = getNextPaymentDate(e.dayOfMonth);
    const dt = fmtDate(start);
    lines.push(
      'BEGIN:VEVENT',
      `UID:expense-${e.id}@finanzas`,
      `DTSTAMP:${dt}T090000Z`,
      `DTSTART;VALUE=DATE:${dt}`,
      `DTEND;VALUE=DATE:${dt}`,
      `SUMMARY:💸 ${escapeText(e.name)}`,
      `DESCRIPTION:${formatMoney(e.amount, data.user.currency)}`,
      `RRULE:FREQ=MONTHLY;BYMONTHDAY=${e.dayOfMonth}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Recordatorio',
      'TRIGGER:-P1D',
      'END:VALARM',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
};;

// ============================================================================
//  FINANCIAL ADVISOR
//  Builds a concrete, actionable financial plan from the user's data:
//  - Overall health (critical / tight / stable / healthy)
//  - Step-by-step priority list with specific amounts and dates
//  - Leaks: expenses that could be cut (subscriptions, duplicates, leisure)
//  - Debt strategy: avalanche with specific months and interest savings
//  - Monthly allocation: how to split your surplus
// ============================================================================
function buildFinancialAdvice(data, currency) {
  const out = {
    health: 'healthy',
    steps: [],
    leaks: [],
    debtStrategy: null,
    monthlyAllocation: null,
    summary: '',
  };

  const today = new Date(); today.setHours(0,0,0,0);
  const monthlyIncome = (data.incomes || []).filter(i => i.active).reduce((s,i) => s + getMonthlyEquivalent(i), 0);
  const monthlyExpense = (data.expenses || []).filter(e => e.active).reduce((s,e) => s + getMonthlyEquivalent(e), 0);
  const activeDebts = (data.debts || []).filter(d => !d.archived && (d.totalAmount - (d.paidAmount || 0)) > 0);
  const monthlyDebtMin = activeDebts
    .filter(d => !isDebtFutureStart(d, today))
    .reduce((s,d) => s + (d.minimumPayment || 0), 0);
  const surplus = monthlyIncome - monthlyExpense - monthlyDebtMin;
  const cashOnHand = (data.savings && data.savings.currentBalance) || 0;
  const formalSavings = (data.savings && data.savings.current) || 0;
  const totalLiquid = cashOnHand + formalSavings;
  const emergencyMonths = (data.savings && data.savings.emergencyMonths) || 3;
  const emergencyTarget = monthlyExpense * emergencyMonths;
  const goal = (data.savings && data.savings.goal) || 0;
  const goalDate = data.savings && data.savings.goalDate ? parseLocalDate(data.savings.goalDate) : null;
  const lifeBudgetPct = (data.savings && data.savings.lifeBudgetPct) || 0.15;
  const minLifeBudget = (data.savings && data.savings.minLifeBudget) || 0;

  // === HEALTH ASSESSMENT ===
  if (surplus < 0) out.health = 'critical';
  else if (surplus < monthlyExpense * 0.08) out.health = 'tight';
  else if (totalLiquid < emergencyTarget) out.health = 'stable';
  else out.health = 'healthy';

  // === MONTHLY ALLOCATION ===
  if (surplus >= 0) {
    // Life money first
    let lifeMoney = Math.max(minLifeBudget, surplus * lifeBudgetPct);
    lifeMoney = Math.min(lifeMoney, surplus);
    let remaining = surplus - lifeMoney;

    // Priority of remaining: emergency fund → high-interest debt extra → goal → invest
    let toEmergency = 0, toDebtExtra = 0, toGoal = 0, toInvest = 0;
    const emergencyGap = Math.max(0, emergencyTarget - totalLiquid);
    const highInterestDebts = activeDebts.filter(d => (d.interestRate || 0) >= 20);

    if (emergencyGap > 0 && remaining > 0) {
      // Aim to fill emergency in 6 months max
      toEmergency = Math.min(remaining, Math.max(emergencyGap / 6, remaining * 0.4));
      remaining -= toEmergency;
    }
    if (highInterestDebts.length > 0 && remaining > 0) {
      toDebtExtra = remaining * 0.6;
      remaining -= toDebtExtra;
    }
    if (goal > formalSavings && remaining > 0) {
      toGoal = remaining;
      remaining = 0;
    } else if (remaining > 0) {
      toInvest = remaining;
    }
    out.monthlyAllocation = {
      income: monthlyIncome,
      fixedExpenses: monthlyExpense,
      debtMinimums: monthlyDebtMin,
      surplus,
      lifeMoney: Math.round(lifeMoney),
      toEmergency: Math.round(toEmergency),
      toDebtExtra: Math.round(toDebtExtra),
      toGoal: Math.round(toGoal),
      toInvest: Math.round(toInvest),
    };
  } else {
    out.monthlyAllocation = {
      income: monthlyIncome,
      fixedExpenses: monthlyExpense,
      debtMinimums: monthlyDebtMin,
      surplus,
      lifeMoney: 0, toEmergency: 0, toDebtExtra: 0, toGoal: 0, toInvest: 0,
    };
  }

  // === LEAKS: expenses easy to cut ===
  // 1. Many subscriptions
  const subs = (data.expenses || []).filter(e => e.active && e.category === 'subscriptions');
  if (subs.length >= 3) {
    const total = subs.reduce((s,e) => s + getMonthlyEquivalent(e), 0);
    out.leaks.push({
      type: 'subscriptions',
      title: `${subs.length} suscripciones activas`,
      amount: total,
      potentialSavings: Math.round(total * 0.4),
      detail: `Pagas ${formatMoney(total, currency)}/mes en suscripciones. Quedarte solo con las 2 que más usas te ahorraría ~${formatMoney(total * 0.4, currency)}/mes.`,
      items: subs.map(s => s.name),
    });
  }
  // 2. High leisure spend (>15% of income)
  const leisure = (data.expenses || []).filter(e => e.active && e.category === 'leisure');
  if (leisure.length > 0) {
    const total = leisure.reduce((s,e) => s + getMonthlyEquivalent(e), 0);
    if (total > monthlyIncome * 0.15 && monthlyIncome > 0) {
      out.leaks.push({
        type: 'leisure',
        title: 'Ocio gasta más del 15% del ingreso',
        amount: total,
        potentialSavings: Math.round(total * 0.3),
        detail: `${formatMoney(total, currency)}/mes en ocio (${(total/monthlyIncome*100).toFixed(0)}% del ingreso). Bajar a 10% del ingreso libera ~${formatMoney(total * 0.3, currency)}/mes.`,
        items: leisure.map(e => e.name),
      });
    }
  }
  // 2b. Categories that exceeded their user-defined budget
  if (data.budgets && Object.keys(data.budgets).length > 0) {
    const today = new Date();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    Object.entries(data.budgets).forEach(([catId, limit]) => {
      if (!limit || limit <= 0) return;
      const spent = getCategorySpend(data, catId, monthKey);
      if (spent <= limit) return;
      const cat = getCategory('expense', catId);
      if (!cat) return;
      const over = spent - limit;
      out.leaks.push({
        type: 'budget-over',
        title: `${cat.name} sobre tope`,
        amount: spent,
        potentialSavings: Math.round(over),
        detail: `Te pusiste un tope de ${formatMoney(limit, currency)}/mes en ${cat.name}, pero ya llevas ${formatMoney(spent, currency)} (${formatMoney(over, currency)} encima). Identifica qué disparó el gasto este mes y ajusta antes del próximo.`,
        items: (data.expenses || []).filter(e => e.active && e.category === catId).map(e => e.name),
      });
    });
  }

  // 3. Food delivery patterns (heuristic: any expense in 'food' > 25% of income)
  const foodExpenses = (data.expenses || []).filter(e => e.active && e.category === 'food');
  const foodTotal = foodExpenses.reduce((s,e) => s + getMonthlyEquivalent(e), 0);
  if (foodTotal > monthlyIncome * 0.25 && monthlyIncome > 0) {
    out.leaks.push({
      type: 'food',
      title: 'Comida absorbe más del 25% del ingreso',
      amount: foodTotal,
      potentialSavings: Math.round(foodTotal * 0.25),
      detail: `${formatMoney(foodTotal, currency)}/mes en alimentación. Mercado en casa vs. domicilios: cocinar 4 cenas/semana libera ~${formatMoney(foodTotal * 0.25, currency)}/mes.`,
      items: foodExpenses.map(e => e.name),
    });
  }

  // === DEBT STRATEGY (Avalanche: highest interest first) ===
  if (activeDebts.length > 0) {
    const sorted = [...activeDebts].sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0));
    const debtPlan = sorted.map(d => {
      const sched = simulateDebtPayoff(d, today);
      const lastEntry = sched[sched.length - 1];
      const lastDate = lastEntry ? new Date(lastEntry.year, lastEntry.monthIdx, 1) : null;
      const totalInterest = sched.reduce((s, m) => s + (m.interest || 0), 0);
      // Accelerated scenario: pay double
      const accel = simulateDebtPayoff({ ...d, minimumPayment: (d.minimumPayment || 0) * 2 }, today);
      const accelLast = accel[accel.length - 1];
      const accelDate = accelLast ? new Date(accelLast.year, accelLast.monthIdx, 1) : null;
      const accelInterest = accel.reduce((s, m) => s + (m.interest || 0), 0);
      const interestSaved = totalInterest - accelInterest;
      return {
        debt: d, monthsMin: sched.length, monthsDouble: accel.length,
        endDateMin: lastDate, endDateDouble: accelDate,
        interestPaying: Math.round(totalInterest),
        interestSavedDouble: Math.round(interestSaved),
        infeasible: sched._infeasible === true,
      };
    });
    out.debtStrategy = {
      method: 'avalanche',
      plan: debtPlan,
      totalInterest: debtPlan.reduce((s, d) => s + d.interestPaying, 0),
      firstTarget: debtPlan[0],
    };
  }

  // === STEP-BY-STEP PRIORITY PLAN ===
  // Step 1: If negative cashflow, fix it first
  if (surplus < 0) {
    const gap = -surplus;
    // Top 5 biggest "discretionary" expenses (anything NOT housing/utilities/health)
    const cuttable = (data.expenses || []).filter(e => e.active && !['housing', 'utilities', 'health'].includes(e.category))
      .map(e => ({ name: e.name, category: e.category, monthly: getMonthlyEquivalent(e), freq: e.frequency }))
      .sort((a, b) => b.monthly - a.monthly)
      .slice(0, 5);
    const fixHints = [];
    if (out.leaks.length > 0) {
      const savable = out.leaks.reduce((s, l) => s + l.potentialSavings, 0);
      if (savable >= gap * 0.5) {
        fixHints.push(`Cortando los gastos detectados como "fugas" recuperas ~${formatMoney(savable, currency)}/mes${savable >= gap ? ' — alcanza para cerrar la brecha completa' : ''}.`);
      }
    }
    if (cashOnHand < gap * 2) fixHints.push('Tu efectivo no aguanta más de 1-2 meses así. Es urgente.');
    if (cuttable.length > 0) {
      fixHints.push(`Tus 3 gastos discrecionales más altos: ${cuttable.slice(0, 3).map(c => `${c.name} (${formatMoney(c.monthly, currency)})`).join(', ')}. Reducirlos a la mitad libera ${formatMoney(cuttable.slice(0,3).reduce((s,c) => s + c.monthly, 0) * 0.5, currency)}/mes.`);
    }
    out.steps.push({
      n: 1, icon: '🚨', priority: 'urgent', color: 'var(--danger)',
      title: 'Cierra la brecha del mes',
      action: `Gastas ${formatMoney(gap, currency)} más de lo que entra cada mes`,
      how: fixHints.length > 0 ? fixHints.join(' ') : `Reduce gastos por al menos ${formatMoney(gap, currency)}/mes o busca un ingreso extra.`,
      amountPerMonth: gap,
      cuttableExpenses: cuttable,
    });
  }

  // Step 2: High-interest debt (≥20%)
  if (out.debtStrategy && out.debtStrategy.plan.some(p => (p.debt.interestRate || 0) >= 20)) {
    const target = out.debtStrategy.plan.find(p => (p.debt.interestRate || 0) >= 20);
    const dbt = target.debt;
    const monthlyInterest = (dbt.totalAmount - (dbt.paidAmount || 0)) * (dbt.interestRate || 0) / 100 / 12;
    out.steps.push({
      n: out.steps.length + 1, icon: '🔥', priority: 'high', color: 'var(--danger)',
      title: `Ataca primero: ${dbt.name}`,
      action: `Interés ${(dbt.interestRate || 0).toFixed(1)}% anual · pierdes ${formatMoney(monthlyInterest, currency)}/mes solo en intereses`,
      how: target.infeasible
        ? `⚠️ La cuota mínima (${formatMoney(dbt.minimumPayment, currency)}) no cubre los intereses. Tu deuda crece sola. Sube la cuota o renegocia urgentemente.`
        : `Pagando solo la mínima (${formatMoney(dbt.minimumPayment, currency)}) tomas ${target.monthsMin} meses y pagas ${formatMoney(target.interestPaying, currency)} en intereses. Si pagas el doble (${formatMoney(dbt.minimumPayment * 2, currency)}/mes), terminas en ${target.monthsDouble} meses y ahorras ${formatMoney(target.interestSavedDouble, currency)} de intereses. Listo: ${target.endDateDouble ? formatDate(target.endDateDouble) : 'fecha por calcular'}.`,
      amountPerMonth: dbt.minimumPayment * 2,
      target: dbt.id,
    });
  }

  // Step 3: Build emergency fund
  if (totalLiquid < emergencyTarget && monthlyExpense > 0) {
    const gap = emergencyTarget - totalLiquid;
    const monthlyContrib = surplus > 0 ? Math.min(surplus * 0.4, gap / 4) : 0;
    const monthsNeeded = monthlyContrib > 0 ? Math.ceil(gap / monthlyContrib) : null;
    const targetDate = monthsNeeded ? new Date(today.getFullYear(), today.getMonth() + monthsNeeded, 1) : null;
    out.steps.push({
      n: out.steps.length + 1, icon: '🛟', priority: 'high', color: 'var(--warning)',
      title: 'Construye tu colchón de emergencia',
      action: `Necesitas ${formatMoney(emergencyTarget, currency)} (= ${emergencyMonths} meses de tus gastos) · te faltan ${formatMoney(gap, currency)}`,
      how: monthlyContrib > 0
        ? `Aporta ${formatMoney(monthlyContrib, currency)}/mes a una cuenta de ahorros SEPARADA (no la del día a día). En ${monthsNeeded} meses lo logras — ${targetDate ? formatDate(targetDate) : ''}. Abre la cuenta hoy: Nu, Bancolombia Ahorro a la Mano, Rappipay o cualquier banco digital.`
        : `Sin excedente positivo, primero corta gastos. Luego destina al colchón el 40% de cualquier excedente que generes.`,
      amountPerMonth: Math.round(monthlyContrib),
    });
  }

  // Step 4: Pay the rest of debts (medium interest)
  if (out.debtStrategy && out.debtStrategy.plan.some(p => (p.debt.interestRate || 0) > 0 && (p.debt.interestRate || 0) < 20) && !out.steps.find(s => s.icon === '🔥')) {
    const medDebts = out.debtStrategy.plan.filter(p => (p.debt.interestRate || 0) < 20 && !p.infeasible);
    if (medDebts.length > 0) {
      const last = medDebts[medDebts.length - 1];
      out.steps.push({
        n: out.steps.length + 1, icon: '💳', priority: 'medium', color: 'var(--warning)',
        title: 'Acaba con las deudas restantes',
        action: `${medDebts.length} deuda${medDebts.length !== 1 ? 's' : ''} con interés moderado`,
        how: `Mantén las mínimas de todas. Cuando termines la deuda más cara (paso anterior), toma esa cuota y aplícala a la siguiente (método "bola de nieve invertida"). Quedarás libre de deudas el ${last.endDateMin ? formatDate(last.endDateMin) : 'próximo año'} si mantienes esto.`,
      });
    }
  }

  // Step 5: Goal-specific savings
  if (goal > 0 && totalLiquid >= emergencyTarget) {
    const gap = goal - formalSavings;
    if (gap > 0) {
      let monthlyContrib;
      if (goalDate && goalDate > today) {
        const monthsToGoal = (goalDate.getFullYear() - today.getFullYear()) * 12 + (goalDate.getMonth() - today.getMonth());
        monthlyContrib = monthsToGoal > 0 ? gap / monthsToGoal : gap;
      } else if (surplus > 0) {
        monthlyContrib = surplus * 0.3;
      } else {
        monthlyContrib = 0;
      }
      out.steps.push({
        n: out.steps.length + 1, icon: '🎯', priority: 'medium', color: 'var(--primary)',
        title: `Ahorra para tu meta: ${formatMoney(goal, currency)}`,
        action: goalDate ? `Para ${formatDate(goalDate)}` : 'Sin fecha objetivo definida',
        how: monthlyContrib > 0
          ? `Aporta ${formatMoney(monthlyContrib, currency)}/mes. Idealmente programado el día de pago para que no lo veas. Considera un CDT/T-Bills al ${data.user.currency === 'COP' ? '~11% efectivo anual en CO' : '~4-5% en USD'} si tu meta es a más de 1 año.`
          : 'Define primero un excedente positivo o una fecha para calcular el monto.',
        amountPerMonth: Math.round(monthlyContrib),
      });
    }
  }

  // Step 6: Invest excess
  if (totalLiquid >= emergencyTarget && (!out.debtStrategy || out.debtStrategy.plan.every(p => (p.debt.interestRate || 0) < 10)) && surplus > monthlyExpense * 0.2) {
    const invest = Math.round(surplus * 0.3);
    out.steps.push({
      n: out.steps.length + 1, icon: '📈', priority: 'low', color: 'var(--primary)',
      title: 'Pon tu plata a trabajar',
      action: `Tienes ${formatMoney(invest, currency)}/mes que puedes invertir sin afectar tu vida`,
      how: `Considera: 60% en un fondo indexado de bajo costo (Trii, Tyba, Bancolombia Renta Variable), 30% en CDT a 12 meses para liquidez, 10% en algo de mayor riesgo si te interesa explorar. Antes: pregúntale a tu banco por el cobro de comisiones — son la trampa #1.`,
      amountPerMonth: invest,
    });
  }

  // === SUMMARY ===
  if (out.health === 'critical') out.summary = `Mes a mes pierdes ${formatMoney(-surplus, currency)}. Es urgente cortar gastos. Empieza por el paso 1.`;
  else if (out.health === 'tight') out.summary = `Vives al límite — tu margen mensual es de solo ${formatMoney(surplus, currency)}. Un imprevisto te tumba. Construye colchón antes que cualquier otra meta.`;
  else if (out.health === 'stable') out.summary = `Tu flujo está sano (margen ${formatMoney(surplus, currency)}/mes) pero te falta colchón. Termina de armarlo y después atacas metas grandes.`;
  else out.summary = `Estás en buen camino: flujo sano y colchón listo. Es hora de invertir el excedente y trabajar metas específicas.`;

  return out;
}

// ============================================================================
//  NET WORTH — patrimonio neto histórico
//  Net worth = efectivo REAL + ahorros formales - deudas activas.
//  "Efectivo real" = base declarada ajustada por los movimientos confirmados
//  del mes (simulateMonthDaily.realBalanceToday) — así, confirmar un pago
//  baja el patrimonio de inmediato en vez de esperar a que el usuario
//  actualice la base a mano.
// ============================================================================
function computeCurrentNetWorth(data) {
  let cash = (data.savings && data.savings.currentBalance) || 0;
  try { cash = simulateMonthDaily(data).realBalanceToday; } catch (e) { /* fall back to raw base */ }
  const savings = (data.savings && data.savings.current) || 0;
  const debts = (data.debts || []).filter(d => !d.archived)
    .reduce((s, d) => s + Math.max(0, (d.totalAmount || 0) - (d.paidAmount || 0)), 0);
  const netWorth = cash + savings - debts;
  return { cash, savings, debts, netWorth };
}

// Capture a snapshot for a given month if missing. Returns updated history.
function captureNetWorthSnapshot(history, monthKey, snapshot) {
  const list = Array.isArray(history) ? [...history] : [];
  const existing = list.findIndex(h => h.monthKey === monthKey);
  const entry = { monthKey, date: new Date().toISOString(), ...snapshot };
  if (existing >= 0) list[existing] = entry; else list.push(entry);
  // Keep sorted ascending by monthKey and capped at 60 months (5 years)
  list.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  return list.slice(-60);
}

// ============================================================================
//  BUDGETS — per-category monthly limit
//  Stored in data.budgets = { 'food': 1500000, 'leisure': 300000, ... }
//  Spending tracked from BOTH the recurring monthly equivalent AND any
//  one-time expenses confirmed for the current month.
// ============================================================================
function getCategorySpend(data, categoryId, monthKey) {
  // monthKey: 'YYYY-MM'
  let total = 0;
  const [yr, mo] = (monthKey || '').split('-').map(Number);
  if (!yr || !mo) return 0;
  const monthStart = new Date(yr, mo - 1, 1);
  const monthEnd = new Date(yr, mo, 0);
  (data.expenses || []).filter(e => e.active && e.category === categoryId).forEach(e => {
    const freq = e.frequency || 'monthly';
    if (freq === 'monthly') total += e.amount || 0;
    else if (freq === 'biweekly') total += (e.amount || 0) * 2;
    else if (freq === 'weekly') total += (e.amount || 0) * 4;
    else if (freq === 'biannual') {
      [e.firstPayment, e.secondPayment].forEach(p => {
        if (p && p.month === mo) total += (e.amount || 0);
      });
    } else if (freq === 'annual' && e.annualMonth === mo) {
      total += e.amount || 0;
    } else if (freq === 'once' && e.onceDate) {
      const d = parseLocalDate(e.onceDate);
      if (d && d >= monthStart && d <= monthEnd) total += e.amount || 0;
    }
  });
  return total;
}

function getBudgetStatus(data, categoryId, monthKey) {
  const limit = (data.budgets || {})[categoryId];
  if (!limit) return null;
  const spent = getCategorySpend(data, categoryId, monthKey);
  const pct = limit > 0 ? (spent / limit) * 100 : 0;
  return { limit, spent, pct, over: spent > limit, remaining: Math.max(0, limit - spent) };
}

// ============================================================================
//  CSV EXPORT
//  Generates a CSV string with all incomes, expenses, debts and confirmed
//  transactions. Useful for taxes, bookkeeping, or sharing with an accountant.
// ============================================================================
function escapeCsvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function generateCSV(data) {
  const lines = [];
  // Header section: incomes
  lines.push('Tipo,Nombre,Categoría,Monto,Frecuencia,Día/Fecha,Activo,Notas');
  (data.incomes || []).forEach(i => {
    const cat = getCategory('income', i.category);
    let when = '';
    if (i.frequency === 'once') when = i.onceDate || '';
    else if (i.frequency === 'biannual') {
      when = `1ro: ${(i.firstPayment||{}).month||'-'}/${(i.firstPayment||{}).day||'-'} · 2do: ${(i.secondPayment||{}).month||'-'}/${(i.secondPayment||{}).day||'-'}`;
    } else if (i.frequency === 'annual') {
      when = `${i.annualMonth||'-'}/${i.dayOfMonth||'-'}`;
    } else {
      when = `Día ${i.dayOfMonth || '-'}`;
    }
    lines.push([
      'Ingreso', escapeCsvCell(i.name), escapeCsvCell(cat ? cat.name : ''),
      i.amount || 0, i.frequency || 'monthly', escapeCsvCell(when),
      i.active ? 'sí' : 'no', escapeCsvCell(i.notes || ''),
    ].join(','));
  });
  (data.expenses || []).forEach(e => {
    const cat = getCategory('expense', e.category);
    let when = '';
    if (e.frequency === 'once') when = e.onceDate || '';
    else if (e.frequency === 'biannual') {
      when = `1ro: ${(e.firstPayment||{}).month||'-'}/${(e.firstPayment||{}).day||'-'} · 2do: ${(e.secondPayment||{}).month||'-'}/${(e.secondPayment||{}).day||'-'}`;
    } else if (e.frequency === 'annual') {
      when = `${e.annualMonth||'-'}/${e.dayOfMonth||'-'}`;
    } else {
      when = `Día ${e.dayOfMonth || '-'}`;
    }
    lines.push([
      'Egreso', escapeCsvCell(e.name), escapeCsvCell(cat ? cat.name : ''),
      e.amount || 0, e.frequency || 'monthly', escapeCsvCell(when),
      e.active ? 'sí' : 'no', escapeCsvCell(e.notes || ''),
    ].join(','));
  });

  // Debts section
  lines.push('');
  lines.push('--- DEUDAS ---');
  lines.push('Nombre,Acreedor,Total,Pagado,Restante,Cuota mínima,Día de pago,Interés %,Empieza,Archivada,Notas');
  (data.debts || []).forEach(d => {
    const rem = (d.totalAmount || 0) - (d.paidAmount || 0);
    lines.push([
      escapeCsvCell(d.name), escapeCsvCell(d.creditor || ''),
      d.totalAmount || 0, d.paidAmount || 0, rem,
      d.minimumPayment || 0, d.paymentDay || '', d.interestRate || 0,
      d.startDate || '', d.archived ? 'sí' : 'no',
      escapeCsvCell(d.notes || ''),
    ].join(','));
  });

  // Confirmed transactions (this month + history)
  lines.push('');
  lines.push('--- MOVIMIENTOS CONFIRMADOS ---');
  lines.push('Mes,Tipo,Nombre,Monto,Fecha confirmación');
  const confirmations = data.confirmations || {};
  Object.keys(confirmations).sort().forEach(monthKey => {
    const m = confirmations[monthKey];
    Object.keys(m).forEach(key => {
      const c = m[key];
      const type = key.startsWith('inc-') ? 'Ingreso' : key.startsWith('exp-') ? 'Egreso' : key.startsWith('debt-') ? 'Pago deuda' : 'Otro';
      lines.push([
        monthKey, type, escapeCsvCell(c.name || ''), c.amount || 0, c.confirmedAt || '',
      ].join(','));
    });
  });

  // Manual transactions
  if ((data.transactions || []).length > 0) {
    lines.push('');
    lines.push('--- REGISTROS MANUALES ---');
    lines.push('Fecha,Tipo,Monto,Categoría,Notas');
    data.transactions.forEach(t => {
      lines.push([
        t.date || '', t.type || '', t.amount || 0,
        escapeCsvCell(t.category || ''), escapeCsvCell(t.notes || ''),
      ].join(','));
    });
  }

  return '﻿' + lines.join('\r\n'); // BOM for Excel UTF-8 detection
}

// ============================================================================
//  PRIMITIVES
// ============================================================================
// Renders children into a dedicated node on <body>, escaping the app's nested
// stacking contexts / overflow:hidden so overlays always sit on top and are
// never clipped. Applies the current theme attribute so CSS variables resolve.
function Portal({ children }) {
  const elRef = useRef(null);
  if (!elRef.current && typeof document !== 'undefined') {
    elRef.current = document.createElement('div');
    elRef.current.className = 'finanzas-portal';
  }
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    document.body.appendChild(el);
    return () => { if (el.parentNode) el.parentNode.removeChild(el); };
  }, []);
  if (!elRef.current) return null;
  return createPortal(children, elRef.current);
}

function Sheet({ open, onClose, title, children, size = 'md' }) {
  useEffect(() => {
    if (open) { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }
  }, [open]);
  if (!open) return null;
  // On wide screens the sheet becomes a centered modal card; on phones it's a
  // bottom sheet. Both are portaled to body so nothing clips them.
  const isWide = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 1024px)').matches;
  const heights = { sm: '50vh', md: '85vh', lg: '92vh', auto: 'auto' };
  const bodyMaxH = isWide ? 'calc(88vh - 64px)' : `calc(${heights[size] === 'auto' ? '85vh' : heights[size]} - 60px)`;
  return (
    <Portal>
      <div className="sheet-backdrop animate-fadein" onClick={onClose} />
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1001,
        display: 'flex',
        justifyContent: 'center',
        alignItems: isWide ? 'center' : 'flex-end',
        padding: isWide ? 24 : 0,
        pointerEvents: 'none',
      }}>
        <div className={isWide ? 'animate-scale' : 'animate-sheet'} style={{
          width: '100%', maxWidth: isWide ? 560 : 480,
          background: 'var(--bg-2)',
          borderRadius: isWide ? 24 : '28px 28px 0 0',
          maxHeight: isWide ? '88vh' : heights[size],
          paddingBottom: isWide ? 0 : 'env(safe-area-inset-bottom)',
          border: isWide ? '1px solid var(--border-strong)' : 'none',
          borderTop: isWide ? undefined : '1px solid var(--border-strong)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
          pointerEvents: 'auto',
          display: 'flex', flexDirection: 'column',
        }}>
          {!isWide && <div className="sheet-handle" />}
          {title && (
            <div className="flex items-center justify-between" style={{ padding: isWide ? '18px 22px 12px' : '8px 20px 12px', flexShrink: 0 }}>
              <h3 className="display-font" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.025em' }}>{title}</h3>
              <button onClick={onClose} className="btn-ghost flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: '50%' }}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="overflow-y-auto no-scrollbar" style={{ padding: isWide ? '0 22px 22px' : '0 20px 20px', maxHeight: bodyMaxH }}>
            {children}
          </div>
        </div>
      </div>
    </Portal>
  );
}

function ConfirmDialog({ open, title, message, onConfirm, onCancel, danger = false }) {
  if (!open) return null;
  return (
    <Portal>
      <div className="sheet-backdrop animate-fadein" onClick={onCancel} style={{ zIndex: 1100 }} />
      <div className="fixed inset-0 flex items-center justify-center px-6 pointer-events-none" style={{ zIndex: 1101 }}>
        <div className="w-full max-w-sm rounded-3xl p-6 animate-scale pointer-events-auto" style={{ background: 'var(--bg-2)', border: '1px solid var(--border-strong)', boxShadow: '0 24px 60px rgba(0,0,0,0.6)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: danger ? 'var(--danger-glow)' : 'var(--primary-glow)' }}>
              <AlertCircle size={20} color={danger ? 'var(--danger)' : 'var(--primary)'} />
            </div>
            <h3 className="display-font text-lg font-semibold">{title}</h3>
          </div>
          <p className="text-sm mb-5" style={{ color: 'var(--text-dim)' }}>{message}</p>
          <div className="flex gap-2">
            <button onClick={onCancel} className="flex-1 btn-ghost rounded-xl py-3 text-sm font-medium">Cancelar</button>
            <button onClick={onConfirm} className="flex-1 rounded-xl py-3 text-sm font-semibold" style={{ background: danger ? 'var(--danger)' : 'var(--primary)', color: danger ? '#3F0A0A' : '#052E20', border: 'none' }}>Confirmar</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function Toast({ message, onClose }) {
  useEffect(() => {
    if (message) { const t = setTimeout(onClose, 2400); return () => clearTimeout(t); }
  }, [message, onClose]);
  if (!message) return null;
  // Auto-detect type based on message content
  const lower = (message || '').toLowerCase();
  const isDanger = lower.includes('eliminad') || lower.includes('borrad') || lower.includes('descart') || lower.includes('quitad') || lower.includes('error') || lower.includes('restablec');
  const isWarn = lower.includes('archivad') || lower.includes('advert');
  const Icon = isDanger ? AlertCircle : (isWarn ? AlertCircle : CheckCircle2);
  const color = isDanger ? 'var(--danger)' : (isWarn ? 'var(--warning)' : 'var(--primary)');
  const bg = isDanger ? 'var(--danger-glow)' : (isWarn ? 'var(--warning-glow)' : 'var(--primary-glow)');
  return (
    <Portal>
      <div className="fixed left-1/2 animate-toast-slide" style={{ top: 'max(16px, env(safe-area-inset-top))', transform: 'translateX(-50%)', zIndex: 1200 }}>
        <div style={{
          padding: '10px 16px', borderRadius: 999,
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, fontWeight: 500, letterSpacing: '-0.005em',
          background: 'var(--surface-2)',
          border: `1px solid ${color}55`,
          boxShadow: `0 12px 32px rgba(0,0,0,0.4), 0 0 0 1px ${bg}`,
          color: 'var(--text)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={15} color={color} strokeWidth={2.5} />
          </span>
          <span>{message}</span>
        </div>
      </div>
    </Portal>
  );
}

function DayInput({ value, onChange, max = 31, placeholder = 'Día', className = '' }) {
  const [str, setStr] = useState(value !== undefined && value !== null && value !== '' ? String(value) : '');
  useEffect(() => {
    setStr(value !== undefined && value !== null && value !== '' ? String(value) : '');
  }, [value]);
  return (
    <input type="text" inputMode="numeric" value={str} placeholder={placeholder}
      onChange={e => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 2);
        setStr(v);
        if (v !== '') {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 1 && n <= max) onChange(n);
        }
      }}
      onBlur={() => {
        const n = parseInt(str, 10);
        if (str === '' || isNaN(n) || n < 1) {
          setStr('1'); onChange(1);
        } else if (n > max) {
          setStr(String(max)); onChange(max);
        }
      }}
      className={`input-base w-full rounded-xl px-4 py-3 text-base tabular ${className}`} />
  );
}

function NumberInput({ value, onChange, placeholder = '', min = 0, max = 999999, decimals = false, className = '' }) {
  const [str, setStr] = useState(value !== undefined && value !== null && value !== '' ? String(value) : '');
  useEffect(() => {
    setStr(value !== undefined && value !== null && value !== '' ? String(value) : '');
  }, [value]);
  const re = decimals ? /[^\d.,-]/g : /[^\d-]/g;
  return (
    <input type="text" inputMode={decimals ? 'decimal' : 'numeric'} value={str} placeholder={placeholder}
      onChange={e => {
        const v = e.target.value.replace(re, '');
        setStr(v);
        if (v === '' || v === '-') return;
        const n = decimals ? parseFloat(v.replace(',', '.')) : parseInt(v, 10);
        if (!isNaN(n)) onChange(n);
      }}
      onBlur={() => {
        if (str === '' || str === '-') { setStr(String(min)); onChange(min); return; }
        const n = decimals ? parseFloat(str.replace(',', '.')) : parseInt(str, 10);
        if (isNaN(n)) { setStr(String(min)); onChange(min); return; }
        const c = Math.max(min, Math.min(max, n));
        if (c !== n) { setStr(String(c)); onChange(c); }
      }}
      className={`input-base w-full rounded-xl px-4 py-3 text-base tabular ${className}`} />
  );
}

function MoneyInput({ value, onChange, currency = 'COP', placeholder = '0' }) {
  const c = CURRENCIES[currency] || CURRENCIES.COP;
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => { setText(value ? String(value) : ''); }, [value]);
  const handle = (e) => {
    const raw = e.target.value.replace(/[^\d.]/g, '');
    setText(raw);
    onChange(raw === '' ? 0 : parseFloat(raw) || 0);
  };
  return (
    <div className="relative">
      <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 17, color: 'var(--text-muted)', fontWeight: 500, pointerEvents: 'none' }}>{c.symbol}</span>
      <input type="text" inputMode="decimal" value={text} onChange={handle} placeholder={placeholder}
        className="input-base w-full tabular"
        style={{ borderRadius: 14, padding: '14px 16px 14px 38px', fontSize: 17, fontWeight: 600, letterSpacing: '-0.015em' }}
      />
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, type = 'text', icon: Icon }) {
  return (
    <label className="block">
      {label && <span style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{label}</span>}
      <div className="relative">
        {Icon && <Icon size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />}
        <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="input-base w-full"
          style={{ borderRadius: 14, padding: `12px 16px 12px ${Icon ? 42 : 16}px`, fontSize: 15.5 }}
        />
      </div>
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      {label && <span style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{label}</span>}
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}
        className="input-base w-full"
        style={{ borderRadius: 14, padding: '12px 40px 12px 16px', fontSize: 15.5, appearance: 'none', backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg width=%2212%22 height=%228%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cpath d=%22M1 1l5 5 5-5%22 stroke=%22%238C99B8%22 stroke-width=%221.5%22 fill=%22none%22/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

// ============================================================================
//  ONBOARDING
// ============================================================================
function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('COP');

  const steps = [
    { title: 'Tus finanzas,\nclaras y bajo control', subtitle: 'Controla deudas, proyecta tu flujo y nunca pierdas un pago.', action: 'Empezar' },
    { title: '¿Cómo te llamas?', subtitle: 'Personalizaremos tu experiencia.', input: 'name', action: 'Continuar' },
    { title: 'Elige tu moneda', subtitle: 'Puedes cambiarla después en ajustes.', input: 'currency', action: 'Comenzar' },
  ];

  const cur = steps[step];
  const canNext = (cur.input === 'name' ? name.trim().length > 0 : true);
  const next = () => { if (step < steps.length - 1) setStep(step + 1); else onComplete({ name: name.trim(), currency }); };

  return (
    <div className="finanzas-app min-h-screen flex flex-col safe-top safe-bottom" style={{ padding: '16px 24px 0' }}>
      <div className="flex" style={{ gap: 6, marginBottom: 56 }}>
        {steps.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 999,
            background: i <= step ? 'var(--primary)' : 'var(--border)',
            boxShadow: i <= step ? '0 0 8px var(--primary-glow)' : 'none',
            transition: 'all 0.5s var(--ease-out)',
          }} />
        ))}
      </div>
      <div className="flex-1 flex flex-col justify-center">
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--primary)', boxShadow: '0 0 8px var(--primary)' }} />
          <span style={{ fontSize: 11, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 600 }}>Finanzas</span>
        </div>
        <h1 className="display-font animate-slideup" key={`t-${step}`} style={{
          fontSize: 38, lineHeight: 1.05, fontWeight: 500, marginBottom: 14,
          letterSpacing: '-0.035em', whiteSpace: 'pre-line',
        }}>{cur.title}</h1>
        <p className="animate-slideup" style={{ fontSize: 16, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 32, letterSpacing: '-0.005em' }} key={`s-${step}`}>{cur.subtitle}</p>
        {cur.input === 'name' && (
          <div className="animate-slideup" key="ni">
            <TextField value={name} onChange={setName} placeholder="Tu nombre" />
          </div>
        )}
        {cur.input === 'currency' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }} className="animate-slideup">
            {Object.values(CURRENCIES).map(c => {
              const sel = currency === c.code;
              return (
                <button key={c.code} onClick={() => setCurrency(c.code)} style={{
                  padding: 16, borderRadius: 16, textAlign: 'left',
                  background: sel ? 'var(--primary-glow)' : 'var(--surface)',
                  border: sel ? '1px solid var(--primary)' : '1px solid var(--border)',
                  cursor: 'pointer', transition: 'all 0.2s var(--ease-soft)',
                  boxShadow: sel ? '0 4px 16px -4px var(--primary-glow)' : 'none',
                }}>
                  <div className="display-font" style={{ fontSize: 26, fontWeight: 500, color: sel ? 'var(--primary)' : 'var(--text)', marginBottom: 4 }}>{c.symbol}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.02em' }}>{c.code}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <button onClick={next} disabled={!canNext} className="btn-primary" style={{ width: '100%', borderRadius: 16, padding: '16px 0', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
        {cur.action}
      </button>
    </div>
  );
}

// ============================================================================
//  HEADER
// ============================================================================
function Header({ name, hideAmounts, onToggleHide, onOpenNotifications, upcomingCount }) {
  const today = new Date();
  const dateStr = today.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <header className="px-5 pt-3 pb-5 relative z-10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 6 }}>
            {dateStr}
          </p>
          <h1 className="display-font" style={{ fontSize: 28, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.03em' }}>
            Hola, <span key={name || 'amigo'} className="animate-fadein" style={{ color: 'var(--primary)', fontWeight: 600, display: 'inline-block' }}>{name || 'amigo'}</span>
            <span className="tagline-script" style={{ marginLeft: 10, fontSize: 22, color: 'var(--accent)', display: 'inline-block', verticalAlign: 'baseline' }}>
              tu dinero, claro ✦
            </span>
          </h1>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={onToggleHide} className="btn-ghost flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: '50%' }}>
            {hideAmounts ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
          <button onClick={onOpenNotifications} className="btn-ghost flex items-center justify-center relative" style={{ width: 40, height: 40, borderRadius: '50%' }}>
            <Bell size={17} />
            {upcomingCount > 0 && (
              <span style={{
                position: 'absolute', top: -2, right: -2,
                minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                fontSize: 10, fontWeight: 700, lineHeight: '18px',
                background: 'var(--danger)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid var(--bg)',
              }}>
                {upcomingCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

// ============================================================================
//  BOTTOM NAVIGATION
// ============================================================================
function BottomNav({ active, onChange }) {
  const tabs = [
    { id: 'home', label: 'Inicio', Icon: Home },
    { id: 'debts', label: 'Deudas', Icon: CreditCard },
    { id: 'movements', label: 'Movimientos', Icon: ArrowLeftRight },
    { id: 'projection', label: 'Planes', Icon: TrendingUp },
    { id: 'settings', label: 'Ajustes', Icon: SettingsIcon },
  ];
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <nav className="bottom-nav glass"
        style={{ width: '100%', maxWidth: '480px', borderTop: '1px solid var(--border)', borderRadius: 0, pointerEvents: 'auto' }}>
        <div className="flex justify-around items-stretch px-1 pt-1">
          {tabs.map(({ id, label, Icon }) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                onClick={() => onChange(id)}
                className="flex flex-col items-center justify-center gap-0.5 py-2 px-1 flex-1 relative"
                style={{
                  background: 'none', border: 'none',
                  transition: 'transform 0.15s var(--ease-spring)',
                }}
              >
                {isActive && <span className="nav-active-indicator animate-fadein" />}
                <div style={{
                  transform: isActive ? 'scale(1.05) translateY(-1px)' : 'scale(1)',
                  transition: 'transform 0.25s var(--ease-spring)',
                  marginTop: 4,
                }}>
                  <Icon size={20} color={isActive ? 'var(--primary)' : 'var(--text-muted)'} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span style={{
                  fontSize: 10, fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                  letterSpacing: '-0.01em',
                  transition: 'color 0.2s ease',
                }}>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// ============================================================================
//  DASHBOARD
// ============================================================================
function ConfirmTip() {
  const [dismissed, setDismissed] = useState(() => safeStorage.get(TIP_DISMISSED_KEY) === '1');
  if (dismissed) return null;
  const dismiss = () => {
    safeStorage.set(TIP_DISMISSED_KEY, '1');
    setDismissed(true);
  };
  return (
    <div className="animate-fadein" style={{
      marginTop: 8, padding: '10px 12px', borderRadius: 12,
      background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)',
      display: 'flex', alignItems: 'flex-start', gap: 8,
    }}>
      <Info size={13} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
      <p style={{ flex: 1, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.45 }}>
        <strong style={{ color: 'var(--accent)', fontWeight: 600 }}>Tip:</strong> Toca el círculo a la izquierda cuando ya pagaste o recibiste algo. Tu flujo del mes se actualizará al instante.
      </p>
      <button onClick={dismiss} aria-label="Cerrar tip" style={{
        flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
        background: 'transparent', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', padding: 0,
      }}>
        <X size={12} />
      </button>
    </div>
  );
}

// === Real-balance "today" card ===
// Shows: starting cash + sum of confirmed movements = real balance today.
// Plus a 30-day forecast highlighting when you'd go negative and when you'd recover.
function RealBalanceCard({ sim, savings, currency, hideAmounts, onNavigate, onSetBalance }) {
  const fmt = (n) => formatMoney(n, currency, hideAmounts);
  const startingCash = sim.startingCash || 0;
  const balanceToday = sim.realBalanceToday || 0;
  const eom = sim.endOfMonthBalance || 0;
  const goesNegative = !!sim.firstNegativeDate;
  const recovers = !!sim.recoveryDate;
  // Inline editor state when user clicks "Define ahora"
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(0);
  const startEdit = () => { setDraft(startingCash); setEditing(true); };
  const saveEdit = () => { if (onSetBalance) onSetBalance(draft); setEditing(false); };

  // No-balance state: show a prominent inline editor — without this number the
  // whole "real money today" computation is meaningless.
  if (startingCash === 0) {
    return (
      <div className="animate-slideup card-elevated" style={{ padding: 18, border: '2px dashed var(--warning)', background: 'rgba(251,191,36,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--warning-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Wallet size={17} color="var(--warning)" strokeWidth={2.3} />
          </div>
          <div className="flex-1">
            <p style={{ fontSize: 13.5, fontWeight: 700 }}>Falta tu plata de hoy</p>
            <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.4 }}>Sin este número, todos los balances aparecen en $0. Métele lo que tienes en cuenta + efectivo ahora mismo:</p>
          </div>
        </div>
        {editing ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <MoneyInput value={draft} onChange={setDraft} currency={currency} />
            </div>
            <button onClick={saveEdit} className="btn-primary" style={{ borderRadius: 12, padding: '0 16px', fontSize: 13, fontWeight: 600 }}>Guardar</button>
          </div>
        ) : (
          <button onClick={startEdit} className="btn-primary w-full" style={{ borderRadius: 12, padding: '12px 0', fontSize: 14, fontWeight: 600 }}>
            Definir mi plata ahora
          </button>
        )}
        {sim.events.length > 0 && (
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.4 }}>
            Mientras tanto, este mes se proyectan {sim.events.length} movimientos pero no se sabe sobre qué base aplicarlos.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="animate-slideup card-elevated" style={{ padding: '20px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="flex items-center gap-2">
          <Wallet size={14} color="var(--primary)" strokeWidth={2.4} />
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Tu plata hoy</span>
        </div>
        <button onClick={startEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>Editar</button>
      </div>
      {editing ? (
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 6 }}>Cuánto tienes ahora (cuenta + efectivo)</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <MoneyInput value={draft} onChange={setDraft} currency={currency} />
            </div>
            <button onClick={saveEdit} className="btn-primary" style={{ borderRadius: 12, padding: '0 16px', fontSize: 13, fontWeight: 600 }}>Guardar</button>
            <button onClick={() => setEditing(false)} className="btn-ghost" style={{ borderRadius: 12, padding: '0 12px', fontSize: 12, fontWeight: 500 }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="display-font tabular" style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1.05, color: balanceToday >= 0 ? 'var(--text)' : 'var(--danger)' }}>
            <CountUp value={balanceToday} format={fmt} />
          </h2>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
            Base {fmt(startingCash)} {sim.confirmedCount > 0 ? `· ${sim.confirmedCount} movimiento${sim.confirmedCount !== 1 ? 's' : ''} confirmado${sim.confirmedCount !== 1 ? 's' : ''}` : ''}
          </p>
        </>
      )}

      {/* Forecast strip */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-soft)', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <div>
          <p style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Al cierre de mes</p>
          <p className="tabular" style={{ fontSize: 16, fontWeight: 600, color: eom >= 0 ? 'var(--primary)' : 'var(--danger)' }}>{fmt(eom)}</p>
        </div>
        <div>
          <p style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Punto más bajo</p>
          <p className="tabular" style={{ fontSize: 16, fontWeight: 600, color: sim.lowestPoint && sim.lowestPoint.balance < 0 ? 'var(--danger)' : 'var(--text)' }}>
            {sim.lowestPoint ? fmt(sim.lowestPoint.balance) : '—'}
          </p>
          {sim.lowestPoint && sim.lowestPoint.date && (
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{formatDateShort(sim.lowestPoint.date)}</p>
          )}
        </div>
      </div>

      {/* Negative window alert */}
      {goesNegative && (
        <div className="rounded-xl" style={{ marginTop: 12, padding: 12, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <TrendingDown size={14} color="var(--danger)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)' }}>
              {sim.firstNegativeDate <= new Date() ? 'Ya estás en negativo' : `Entras en negativo el ${formatDateShort(sim.firstNegativeDate)}`}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.45 }}>
              {recovers
                ? <>Te estabilizas el <strong style={{ color: 'var(--primary)' }}>{formatDateShort(sim.recoveryDate)}</strong>{sim.recoveryDate.getMonth() !== new Date().getMonth() && <> · {sim.recoveryDate.toLocaleDateString('es-CO', { month: 'long' })}</>}.</>
                : <>No te estabilizas en este mes. Revisa egresos o consigue un ingreso extra.</>}
            </p>
          </div>
        </div>
      )}
      {!goesNegative && eom > 0 && (
        <div className="rounded-xl" style={{ marginTop: 12, padding: 12, background: 'var(--primary-glow)', border: '1px solid rgba(52,211,153,0.2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <CheckCircle2 size={14} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45 }}>Llegarás al fin de mes con <strong style={{ color: 'var(--primary)' }}>{fmt(eom)}</strong> de margen.</p>
        </div>
      )}
    </div>
  );
}

// === Key dates: meta de ahorro, libre de deudas, estabilidad ===
function KeyDatesCard({ goalReachDate, debtFreeDate, dailySim, savings, currency, hideAmounts }) {
  const items = [];
  if (goalReachDate) {
    items.push({
      icon: Target, color: 'var(--primary)',
      label: 'Meta de ahorro',
      detail: savings.goal > 0 ? formatMoney(savings.goal, currency, hideAmounts) : '',
      dateLabel: goalReachDate instanceof Date ? formatDate(goalReachDate) : '—',
      hint: savings.goalDate
        ? (parseLocalDate(savings.goalDate) >= goalReachDate ? 'A tiempo con tu objetivo' : `Tu fecha objetivo era ${formatDateShort(parseLocalDate(savings.goalDate))}`)
        : 'Sin fecha objetivo'
    });
  }
  if (debtFreeDate && debtFreeDate !== 'infeasible') {
    items.push({
      icon: CheckCircle2, color: 'var(--primary)',
      label: 'Libre de deudas',
      detail: '',
      dateLabel: formatDate(debtFreeDate),
      hint: 'Última cuota programada'
    });
  } else if (debtFreeDate === 'infeasible') {
    items.push({
      icon: AlertCircle, color: 'var(--danger)',
      label: 'Una deuda no es viable',
      detail: '',
      dateLabel: '—',
      hint: 'La cuota no cubre los intereses · ajústala'
    });
  }
  if (dailySim && dailySim.firstNegativeDate && dailySim.recoveryDate) {
    items.push({
      icon: Activity, color: 'var(--warning)',
      label: 'Vuelves a positivo',
      detail: '',
      dateLabel: formatDate(dailySim.recoveryDate),
      hint: `Estarás corto desde ${formatDateShort(dailySim.firstNegativeDate)}`
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="animate-slideup card" style={{ padding: 16 }}>
      <div className="flex items-center gap-2 mb-3">
        <CalendarIcon size={13} color="var(--accent)" />
        <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Fechas clave</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it, i) => {
          const Icon = it.icon;
          return (
            <div key={i} className="flex items-start gap-3" style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 12 }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: `${it.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={14} color={it.color} strokeWidth={2.4} />
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 12.5, fontWeight: 600 }}>{it.label}{it.detail ? ` · ${it.detail}` : ''}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{it.hint}</p>
              </div>
              <p className="display-font tabular" style={{ fontSize: 13.5, fontWeight: 600, color: it.color, whiteSpace: 'nowrap' }}>{it.dateLabel}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === FINANCIAL ADVISOR CARD ===
// Comprehensive step-by-step financial plan based on user's full data.
function FinancialAdvisorCard({ data, currency, hideAmounts, onNavigate }) {
  const [expanded, setExpanded] = useState(false);
  const advice = useMemo(() => buildFinancialAdvice(data, currency), [data, currency]);
  const fmt = (n) => formatMoney(n, currency, hideAmounts);
  const healthColors = {
    critical: { bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.3)', text: 'var(--danger)', label: 'Crítico' },
    tight: { bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.3)', text: 'var(--warning)', label: 'Apretado' },
    stable: { bg: 'var(--primary-glow)', border: 'rgba(139,111,188,0.3)', text: 'var(--accent)', label: 'Estable' },
    healthy: { bg: 'var(--primary-glow)', border: 'rgba(52,211,153,0.3)', text: 'var(--primary)', label: 'Sano' },
  };
  const hc = healthColors[advice.health] || healthColors.stable;
  const hasContent = advice.steps.length > 0 || advice.leaks.length > 0;

  if (!hasContent && advice.health === 'healthy') {
    return null; // Nothing actionable to show
  }

  return (
    <div className="animate-slideup card-elevated" style={{ padding: 18, position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="flex items-center gap-2">
          <Sparkles size={14} color="var(--accent)" />
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Tu asesor</span>
        </div>
        <span style={{ padding: '3px 10px', borderRadius: 999, background: hc.bg, border: `1px solid ${hc.border}`, fontSize: 10.5, fontWeight: 700, color: hc.text, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{hc.label}</span>
      </div>
      <p className="display-font" style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.35, marginBottom: 14 }}>
        {advice.summary}
      </p>

      {/* Steps preview (first 2 always visible, rest behind expand) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(expanded ? advice.steps : advice.steps.slice(0, 2)).map((step) => (
          <div key={step.n} className="rounded-xl" style={{ padding: 12, background: 'var(--surface-2)', border: `1px solid var(--border)` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: `${step.color}22`, color: step.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, fontWeight: 700 }}>
                {step.n}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 3 }}>
                  <span style={{ marginRight: 6 }}>{step.icon}</span>{step.title}
                </p>
                <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 6, lineHeight: 1.45 }}>{step.action}</p>
                <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
                  <strong style={{ color: step.color, fontWeight: 600 }}>Cómo: </strong>{step.how}
                </p>
                {step.amountPerMonth > 0 && (
                  <p className="tabular" style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: step.color }}>
                    {fmt(step.amountPerMonth)}/mes
                  </p>
                )}
                {/* Concrete expense list for "close the gap" step */}
                {expanded && step.cuttableExpenses && step.cuttableExpenses.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                    <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Candidatos a recortar</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {step.cuttableExpenses.map((c, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                          <span className="truncate" style={{ color: 'var(--text-dim)' }}>{c.name}</span>
                          <span className="tabular" style={{ fontWeight: 600, color: 'var(--danger)' }}>{fmt(c.monthly)}/mes</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Leaks section, when expanded */}
      {expanded && advice.leaks.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-soft)' }}>
          <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
            💧 Fugas detectadas
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {advice.leaks.map((leak, i) => (
              <div key={i} className="rounded-xl" style={{ padding: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                  <p style={{ fontSize: 13, fontWeight: 600 }}>{leak.title}</p>
                  <p className="tabular" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                    +{fmt(leak.potentialSavings)}/mes
                  </p>
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.45 }}>{leak.detail}</p>
                {leak.items && leak.items.length > 0 && (
                  <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
                    Implicados: {leak.items.slice(0, 4).join(' · ')}{leak.items.length > 4 ? '…' : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly allocation when expanded */}
      {expanded && advice.monthlyAllocation && advice.monthlyAllocation.surplus > 0 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-soft)' }}>
          <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
            🍰 Reparto sugerido del excedente ({fmt(advice.monthlyAllocation.surplus)}/mes)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { label: 'Vivir (salir, antojos, hobbies)', amount: advice.monthlyAllocation.lifeMoney, color: 'var(--accent)' },
              { label: 'Colchón de emergencia', amount: advice.monthlyAllocation.toEmergency, color: 'var(--warning)' },
              { label: 'Pago extra a deudas', amount: advice.monthlyAllocation.toDebtExtra, color: 'var(--danger)' },
              { label: 'Meta de ahorro', amount: advice.monthlyAllocation.toGoal, color: 'var(--primary)' },
              { label: 'Invertir', amount: advice.monthlyAllocation.toInvest, color: 'var(--primary-2)' },
            ].filter(r => r.amount > 0).map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{row.label}</span>
                <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600, color: row.color }}>{fmt(row.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {advice.steps.length > 2 || advice.leaks.length > 0 ? (
        <button onClick={() => setExpanded(!expanded)} className="w-full" style={{
          marginTop: 14, background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 12, fontWeight: 600, color: 'var(--primary)',
          padding: '8px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}>
          {expanded ? 'Ver menos' : `Ver plan completo (${advice.steps.length} pasos${advice.leaks.length > 0 ? ` · ${advice.leaks.length} fugas` : ''})`}
          <ChevronRight size={13} style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
        </button>
      ) : null}
    </div>
  );
}

// === NET WORTH HISTORY card ===
// Shows the historical trend of (cash + savings - debts) with an area chart.
// Tells the user direction (up/down) and how much in the last 6 months.
function NetWorthCard({ data, currency, hideAmounts }) {
  const history = (data.netWorthHistory || []).slice(-12); // last 12 months max
  const current = useMemo(() => computeCurrentNetWorth(data), [data]);
  if (history.length < 2) {
    // Not enough history yet — show current value + hint
    return (
      <div className="animate-slideup card-elevated" style={{ padding: 18 }}>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={14} color="var(--primary)" />
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Patrimonio neto</span>
        </div>
        <h2 className="display-font tabular" style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em', color: current.netWorth >= 0 ? 'var(--text)' : 'var(--danger)' }}>
          {formatMoney(current.netWorth, currency, hideAmounts)}
        </h2>
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
          Efectivo {formatCompact(current.cash, currency, hideAmounts)} + ahorros {formatCompact(current.savings, currency, hideAmounts)} − deudas {formatCompact(current.debts, currency, hideAmounts)}
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, fontStyle: 'italic' }}>
          La gráfica histórica aparece después de 2 meses con datos.
        </p>
      </div>
    );
  }
  const first = history[0].netWorth;
  const last = history[history.length - 1].netWorth;
  const delta = last - first;
  const pctChange = first !== 0 ? (delta / Math.abs(first)) * 100 : 0;
  const trend = delta >= 0 ? 'up' : 'down';
  // Min/max for the chart Y axis
  const values = history.map(h => h.netWorth);
  const yMin = Math.min(...values, 0);
  const yMax = Math.max(...values, 0);
  const range = yMax - yMin || 1;
  const chartHeight = 90;
  const chartPad = 8;
  const chartWidth = 300;
  const stepX = history.length > 1 ? (chartWidth - chartPad * 2) / (history.length - 1) : 0;
  const points = history.map((h, i) => {
    const x = chartPad + i * stepX;
    const y = chartPad + (1 - (h.netWorth - yMin) / range) * (chartHeight - chartPad * 2);
    return { x, y, h };
  });
  const pathLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const pathArea = pathLine + ` L ${points[points.length - 1].x.toFixed(1)} ${(chartHeight - chartPad).toFixed(1)} L ${points[0].x.toFixed(1)} ${(chartHeight - chartPad).toFixed(1)} Z`;
  const trendColor = trend === 'up' ? 'var(--primary)' : 'var(--danger)';
  return (
    <div className="animate-slideup card-elevated" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="flex items-center gap-2">
          {trend === 'up' ? <TrendingUp size={14} color="var(--primary)" /> : <TrendingDown size={14} color="var(--danger)" />}
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Patrimonio neto</span>
        </div>
        <span className="tabular" style={{ fontSize: 11, fontWeight: 600, color: trendColor }}>
          {delta >= 0 ? '+' : ''}{formatCompact(delta, currency, hideAmounts)} ({pctChange.toFixed(1)}%)
        </span>
      </div>
      <h2 className="display-font tabular" style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.03em', color: last >= 0 ? 'var(--text)' : 'var(--danger)' }}>
        <CountUp value={last} format={(v) => formatMoney(v, currency, hideAmounts)} />
      </h2>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
        Efectivo {formatCompact(current.cash, currency, hideAmounts)} + ahorros {formatCompact(current.savings, currency, hideAmounts)} − deudas {formatCompact(current.debts, currency, hideAmounts)}
      </p>

      {/* Inline SVG sparkline chart */}
      <div style={{ marginTop: 14, position: 'relative' }}>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" style={{ width: '100%', height: 90 }}>
          <defs>
            <linearGradient id="nwGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={trendColor} stopOpacity="0.35" />
              <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Zero line if range crosses zero */}
          {yMin < 0 && yMax > 0 && (
            <line x1={chartPad} y1={chartPad + (1 - (0 - yMin) / range) * (chartHeight - chartPad * 2)}
                  x2={chartWidth - chartPad} y2={chartPad + (1 - (0 - yMin) / range) * (chartHeight - chartPad * 2)}
                  stroke="var(--border-strong)" strokeWidth="0.5" strokeDasharray="2 3" />
          )}
          <path className="area-reveal" d={pathArea} fill="url(#nwGradient)" />
          {/* pathLength=1 normalizes the dash so the draw-in animation works for any path length */}
          <path className="draw-line" pathLength="1" d={pathLine} fill="none" stroke={trendColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          {points.length > 0 && (
            <circle className="point-pop" cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3} fill={trendColor} />
          )}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9.5, color: 'var(--text-muted)' }}>
          <span>{history[0].monthKey}</span>
          <span>{history[history.length - 1].monthKey}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
//  CYCLE CHECKLIST — the user's notepad, as a living widget.
//  Groups this month's payments like their sheet (Hogar / Personales /
//  Deudas / Ahorro), each with a check circle (their "blue highlight"),
//  per-section subtotals, grand total, and "cuánto te queda libre".
// ============================================================================
const CHECKLIST_GROUPS = [
  { id: 'hogar', label: 'Hogar', cats: ['housing', 'utilities', 'food', 'transport'] },
  { id: 'personal', label: 'Pagos personales', cats: ['subscriptions', 'leisure', 'health', 'other-expense'] },
];

function CycleChecklist({ data, currency, hideAmounts, projection, sim, onConfirm, onConfirmDebt, onConfirmSavings }) {
  const today = new Date();
  const year = today.getFullYear(), monthIdx = today.getMonth();
  const monthKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
  const confirms = (data.confirmations && data.confirmations[monthKey]) || {};
  const fmt = (n) => formatMoney(n, currency, hideAmounts);
  const monthName = today.toLocaleDateString('es-CO', { month: 'long' });

  // Amount an expense contributes THIS month (0 = doesn't apply this month)
  const monthAmount = (e) => {
    const freq = e.frequency || 'monthly';
    if (freq !== 'once' && !isItemActiveInMonth(e, year, monthIdx)) return 0;
    if (freq === 'monthly') return e.amount || 0;
    if (freq === 'biweekly') return (e.amount || 0) * 2;
    if (freq === 'weekly') return (e.amount || 0) * 4;
    if (freq === 'biannual') {
      let hits = 0;
      [e.firstPayment, e.secondPayment].forEach(p => { if (p && p.month === monthIdx + 1) hits++; });
      return (e.amount || 0) * hits;
    }
    if (freq === 'annual') return (e.annualMonth || 12) === monthIdx + 1 ? (e.amount || 0) : 0;
    if (freq === 'once' && e.onceDate) {
      const d = parseLocalDate(e.onceDate);
      return d && d.getFullYear() === year && d.getMonth() === monthIdx ? (e.amount || 0) : 0;
    }
    return 0;
  };

  // Build sections
  const sections = [];
  CHECKLIST_GROUPS.forEach(g => {
    const items = (data.expenses || []).filter(e => e.active && g.cats.includes(e.category))
      .map(e => ({ raw: e, amount: monthAmount(e) }))
      .filter(x => x.amount > 0)
      .map(x => ({
        id: `exp-${x.raw.id}`,
        confirmKey: `exp-${x.raw.id}-${monthKey}`,
        name: x.raw.name,
        note: x.raw.notes || '',
        lastMonth: isItemLastMonth(x.raw, year, monthIdx),
        multi: x.raw.frequency === 'biweekly' ? '×2 quincenas' : x.raw.frequency === 'weekly' ? '×4 semanas' : '',
        amount: x.amount,
        kind: 'expense',
      }));
    if (items.length > 0) sections.push({ ...g, items });
  });

  // Debts due this month
  const debtItems = (data.debts || [])
    .filter(d => !d.archived && (d.totalAmount - (d.paidAmount || 0)) > 0)
    .filter(d => {
      if (!isDebtFutureStart(d, today)) return true;
      const ds = parseLocalDate(d.startDate);
      return ds && ds.getFullYear() === year && ds.getMonth() === monthIdx;
    })
    .map(d => {
      const remaining = d.totalAmount - (d.paidAmount || 0);
      const due = Math.max(0, Math.min(d.minimumPayment || 0, remaining));
      const isLastPayment = due >= remaining;
      return {
        id: `debt-${d.id}`,
        confirmKey: `debt-${d.id}-${monthKey}`,
        debtId: d.id,
        name: d.name + (d.creditor ? ` (${d.creditor})` : ''),
        note: d.notes || (isLastPayment ? 'termino de pagar' : ''),
        amount: due,
        kind: 'debt',
      };
    })
    .filter(x => x.amount > 0);
  if (debtItems.length > 0) sections.push({ id: 'deudas', label: 'Deudas', items: debtItems });

  // Savings contribution as one more "payment" (their Ahorro: 2.000.000 line)
  const savContrib = (data.savings && data.savings.monthlyContribution) || 0;
  if (savContrib > 0) {
    sections.push({
      id: 'ahorro', label: 'Ahorro',
      items: [{
        id: 'sav-monthly', confirmKey: `sav-monthly-${monthKey}`,
        name: 'Ahorro del mes', note: 'se suma a tus ahorros al marcarlo',
        amount: savContrib, kind: 'savings',
      }],
    });
  }

  if (sections.length === 0) return null;

  const allItems = sections.flatMap(s => s.items);
  const grandTotal = allItems.reduce((s, it) => s + it.amount, 0);
  const paidTotal = allItems.filter(it => !!confirms[it.confirmKey]).reduce((s, it) => s + it.amount, 0);
  const paidCount = allItems.filter(it => !!confirms[it.confirmKey]).length;
  const progress = grandTotal > 0 ? (paidTotal / grandTotal) * 100 : 0;

  // CASH-BASED footer (day-to-day reality, not future income):
  // what you have now, what's still owed this month, and what's left to spend
  // with the cash you actually have until your next paycheck lands.
  const cashToday = sim ? sim.realBalanceToday : ((data.savings && data.savings.currentBalance) || 0);
  const pendingOut = allItems.filter(it => !confirms[it.confirmKey]).reduce((s, it) => s + it.amount, 0);
  const leftover = cashToday - pendingOut; // "te queda para gastar" hasta el próximo ingreso
  const nextIncome = sim ? sim.nextIncome : null;

  const toggle = (item) => {
    if (item.kind === 'debt') onConfirmDebt(item.debtId, item.amount, monthKey);
    else if (item.kind === 'savings') onConfirmSavings(monthKey, item.amount);
    else onConfirm(item.confirmKey, { monthKey, amount: item.amount, name: item.name });
  };

  return (
    <div className="animate-slideup card-elevated desk-full" style={{ padding: '20px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} color="var(--primary)" strokeWidth={2.4} />
            <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Checklist de {monthName}</span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Marca cada pago como en tu bloc de notas</p>
        </div>
        <span className="tabular" style={{ fontSize: 11.5, fontWeight: 700, color: paidCount === allItems.length ? 'var(--primary)' : 'var(--text-dim)' }}>
          {paidCount}/{allItems.length} pagados
        </span>
      </div>

      <div className="progress-track" style={{ margin: '10px 0 16px' }}>
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {sections.map(section => {
        const subtotal = section.items.reduce((s, it) => s + it.amount, 0);
        const subPaid = section.items.filter(it => !!confirms[it.confirmKey]).reduce((s, it) => s + it.amount, 0);
        return (
          <div key={section.id} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <h4 className="display-font" style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{section.label}</h4>
              <span className="tabular" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                {subPaid > 0 && <span style={{ color: 'var(--primary)' }}>{formatCompact(subPaid, currency, hideAmounts)} ✓ · </span>}
                Total: <span style={{ color: 'var(--text)' }}>{fmt(subtotal)}</span>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {section.items.map(item => {
                const done = !!confirms[item.confirmKey];
                return (
                  <button key={item.id} onClick={() => toggle(item)} className="w-full text-left" style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderRadius: 12, cursor: 'pointer',
                    background: done ? 'var(--primary-glow)' : 'var(--surface-2)',
                    border: done ? '1px solid rgba(52,211,153,0.3)' : '1px solid var(--border-soft)',
                    transition: 'all 0.2s var(--ease-soft)',
                  }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      border: done ? 'none' : '2px solid var(--border-strong)',
                      background: done ? 'var(--primary)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.2s var(--ease-spring)',
                    }}>
                      {done && <Check size={12} color="#04130D" strokeWidth={3.5} />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="truncate" style={{
                        display: 'block', fontSize: 13.5, fontWeight: 500,
                        textDecoration: done ? 'line-through' : 'none',
                        color: done ? 'var(--text-dim)' : 'var(--text)',
                      }}>{item.name}{item.multi ? ` · ${item.multi}` : ''}</span>
                      {(item.note || item.lastMonth) && (
                        <span style={{ display: 'block', fontSize: 10.5, color: item.lastMonth ? 'var(--warning)' : 'var(--text-muted)', marginTop: 1 }}>
                          {item.lastMonth ? '⚠ último mes · recuerda cancelar' : `// ${item.note}`}
                        </span>
                      )}
                    </span>
                    <span className="tabular" style={{
                      fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap',
                      color: done ? 'var(--primary)' : 'var(--text)',
                    }}>{fmt(item.amount)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Footer: CASH reality — what you have vs. what's still owed this month */}
      <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ color: 'var(--text-dim)' }}>Tienes hoy</span>
          <span className="tabular" style={{ fontWeight: 600, color: 'var(--text)' }}>{fmt(cashToday)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ color: 'var(--text-dim)' }}>Te falta pagar este mes</span>
          <span className="tabular" style={{ fontWeight: 600, color: 'var(--danger)' }}>−{fmt(pendingOut)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 6, borderTop: '1px dashed var(--border-soft)' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Te queda para gastar</span>
          <span className="display-font tabular" style={{ fontSize: 20, fontWeight: 600, color: leftover >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
            {fmt(leftover)}
          </span>
        </div>
        {nextIncome && (
          <div className="rounded-xl" style={{ marginTop: 6, padding: '8px 12px', background: 'var(--primary-glow)', border: '1px solid rgba(52,211,153,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ArrowUp size={13} color="var(--primary)" strokeWidth={2.5} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.4 }}>
              Tu ingreso de <strong style={{ color: 'var(--primary)' }}>{fmt(nextIncome.amount)}</strong> llega el <strong style={{ color: 'var(--text)' }}>{formatDate(nextIncome.date)}</strong>. Ahí tu saldo sube.
            </span>
          </div>
        )}
        {leftover < 0 && (
          <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2, lineHeight: 1.4 }}>
            ⚠ Con tu plata de hoy no alcanzas a cubrir todo lo del mes antes de tu próximo ingreso. Te faltan {fmt(-leftover)}.
          </p>
        )}
      </div>
    </div>
  );
}

// === Personal notes — their "Anotaciones para mi" section ===
function PersonalNotesCard({ notes, onSave }) {
  const [draft, setDraft] = useState(notes || '');
  useEffect(() => { setDraft(notes || ''); }, [notes]);
  return (
    <div className="animate-slideup card desk-full" style={{ padding: 16 }}>
      <div className="flex items-center gap-2 mb-2">
        <Edit3 size={13} color="var(--accent)" />
        <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Anotaciones para mí</span>
      </div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== (notes || '')) onSave(draft); }}
        placeholder={'Ej. "Este mes no pedir más préstamos"\n"La deuda de amor se paga con ahorro"'}
        className="input-base w-full handwritten"
        rows={3}
        style={{ borderRadius: 12, padding: '10px 12px', fontSize: 17, lineHeight: 1.5, resize: 'vertical', background: 'var(--surface-2)', border: '1px solid var(--border-soft)', color: 'var(--text-dim)' }}
      />
    </div>
  );
}

function Dashboard({ data, currency, hideAmounts, onNavigate, onPayDebt, onAddTransaction, onConfirm, onConfirmDebt, onUpdateSavings, onConfirmSavings, onSaveNotes }) {
  const { debts, incomes, expenses, transactions } = data;

  const totalDebt = useMemo(() => debts.filter(d => !d.archived).reduce((s, d) => s + Math.max(0, d.totalAmount - (d.paidAmount || 0)), 0), [debts]);
  const monthlyIncome = useMemo(() => incomes.filter(i => i.active).reduce((s, i) => s + getMonthlyEquivalent(i), 0), [incomes]);
  const monthlyExpense = useMemo(() => expenses.filter(e => e.active).reduce((s, e) => s + getMonthlyEquivalent(e), 0), [expenses]);
  const monthlyDebtPayment = useMemo(() => debts.filter(d => !d.archived && (d.totalAmount - (d.paidAmount || 0)) > 0).reduce((s, d) => s + (d.minimumPayment || 0), 0), [debts]);
  const monthlyNet = monthlyIncome - monthlyExpense - monthlyDebtPayment;

  // Current month tracking key (for confirmations)
  // Use state + interval so it updates if the app stays open across midnight
  const [currentMonthKey, setCurrentMonthKey] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      setCurrentMonthKey(prev => prev === key ? prev : key);
    };
    // Check every 5 minutes - cheap and catches month transitions reliably
    const id = setInterval(tick, 5 * 60 * 1000);
    // Also check on visibility change (when user returns to app)
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  const monthConfirmations = (data.confirmations && data.confirmations[currentMonthKey]) || {};

  // Calculate "real" position vs "projected"
  // confirmedIncome: ingresos del mes que ya marcaste como recibidos
  // confirmedExpense: egresos del mes que ya marcaste como pagados
  // pendingIncome: lo que aún espera llegar este mes
  // pendingExpense: lo que aún tienes que pagar este mes
  const monthRealStats = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0); monthEnd.setHours(23,59,59,999);
    let confirmedIncome = 0, confirmedExpense = 0, confirmedDebt = 0;
    let pendingIncome = 0, pendingExpense = 0, pendingDebt = 0;

    // Helper: how much of this item belongs to the current month?
    // For 'once' items, only counts if the date falls in the month.
    // For monthly/biweekly/weekly: use monthly equivalent.
    // For biannual/annual: only counts in months when they fire.
    const monthAmount = (item) => {
      const freq = item.frequency || 'monthly';
      if (freq !== 'once' && !isItemActiveInMonth(item, monthStart.getFullYear(), monthStart.getMonth())) return 0;
      if (freq === 'once') {
        if (!item.onceDate) return 0;
        const d = parseLocalDate(item.onceDate);
        return (d >= monthStart && d <= monthEnd) ? (item.amount || 0) : 0;
      }
      if (freq === 'monthly') return item.amount || 0;
      if (freq === 'biweekly') return (item.amount || 0) * 2.17; // ~26 / 12
      if (freq === 'weekly') return (item.amount || 0) * 4.33;
      if (freq === 'biannual') {
        // Hits twice a year - check if either falls this month
        let hits = 0;
        [item.firstPayment, item.secondPayment].forEach(p => {
          if (!p) return;
          const d = new Date(monthStart.getFullYear(), p.month - 1, p.day);
          if (d >= monthStart && d <= monthEnd) hits++;
        });
        return (item.amount || 0) * hits;
      }
      if (freq === 'annual') {
        if (!item.annualMonth || !item.annualDay) return 0;
        const d = new Date(monthStart.getFullYear(), item.annualMonth - 1, item.annualDay);
        return (d >= monthStart && d <= monthEnd) ? (item.amount || 0) : 0;
      }
      return item.amount || 0;
    };

    incomes.filter(i => i.active).forEach(i => {
      const amt = monthAmount(i);
      if (amt <= 0) return;
      const key = `inc-${i.id}-${currentMonthKey}`;
      const isConfirmed = !!monthConfirmations[key];
      if (isConfirmed) confirmedIncome += amt;
      else pendingIncome += amt;
    });

    expenses.filter(e => e.active).forEach(e => {
      const amt = monthAmount(e);
      if (amt <= 0) return;
      const key = `exp-${e.id}-${currentMonthKey}`;
      const isConfirmed = !!monthConfirmations[key];
      if (isConfirmed) confirmedExpense += amt;
      else pendingExpense += amt;
    });

    debts.filter(d => !d.archived && (d.totalAmount - (d.paidAmount || 0)) > 0).forEach(d => {
      // Skip if debt hasn't started yet (future-start)
      if (d.startDate) {
        const ds = parseLocalDate(d.startDate);
        if (!isNaN(ds) && ds > monthEnd) return;
      }
      const date = getDebtNextPaymentDate(d, monthStart);
      if (!date || date > monthEnd || date < monthStart) return;
      const key = `debt-${d.id}-${currentMonthKey}`;
      const isConfirmed = !!monthConfirmations[key];
      const remaining = d.totalAmount - (d.paidAmount || 0);
      const due = Math.max(0, Math.min(d.minimumPayment || 0, remaining));
      if (isConfirmed) confirmedDebt += due;
      else pendingDebt += due;
    });

    const realFlow = confirmedIncome - confirmedExpense - confirmedDebt;
    const projectedRemaining = pendingIncome - pendingExpense - pendingDebt;
    const totalProjected = realFlow + projectedRemaining;
    const hasAnyConfirmed = (confirmedIncome + confirmedExpense + confirmedDebt) > 0;
    return {
      confirmedIncome, confirmedExpense, confirmedDebt,
      pendingIncome, pendingExpense, pendingDebt,
      realFlow, projectedRemaining, totalProjected, hasAnyConfirmed,
    };
  }, [incomes, expenses, debts, monthConfirmations, currentMonthKey]);

  // Use dynamic projection so the dashboard knows about future relief
  const projection = useMemo(() => buildMonthlyProjection(data, 12), [data]);
  const thisMonthFlow = projection[0] ? projection[0].cashFlow : monthlyNet;
  const lastDebtMonth = projection.find(m => m.debtsOutstanding === 0 && projection.indexOf(m) > 0);
  const futurePositive = monthlyNet < 0 && projection.find(m => m.cashFlow >= 0 && projection.indexOf(m) > 0);
  // Build "why" explanation for futurePositive: what changes between previous month and this one?
  const futurePositiveReason = useMemo(() => {
    if (!futurePositive) return null;
    const idx = projection.indexOf(futurePositive);
    if (idx <= 0) return null;
    const prev = projection[idx - 1];
    const reasons = [];
    // Debts ending: any debt that ends in the prev month (so the savings free up)
    const endingDebts = [];
    // Walk months 0..idx and collect debts that ended at any point before futurePositive
    for (let i = 0; i <= idx; i++) {
      if (projection[i].debtsEndingThisMonth && projection[i].debtsEndingThisMonth.length > 0) {
        projection[i].debtsEndingThisMonth.forEach(name => {
          // Find the debt to estimate the freed amount
          const debt = data.debts.find(d => d.name === name);
          if (debt) endingDebts.push({ name, freed: debt.minimumPayment || 0, month: projection[i] });
        });
      }
    }
    if (endingDebts.length > 0) {
      const totalFreed = endingDebts.reduce((s, e) => s + e.freed, 0);
      reasons.push(`Para esa fecha ya termina${endingDebts.length === 1 ? '' : 'n'} ${endingDebts.map(e => `"${e.name}"`).join(', ')}, liberando ${formatMoney(totalFreed, currency, hideAmounts)}/mes que antes pagabas en cuotas.`);
    }
    // Income change: an income that starts before this month
    const incomeStarts = (data.incomes || []).filter(i => i.active && i.frequency === 'once' && i.onceDate)
      .filter(i => {
        const d = parseLocalDate(i.onceDate);
        return d.getFullYear() < futurePositive.year || (d.getFullYear() === futurePositive.year && d.getMonth() <= futurePositive.monthIdx);
      });
    if (incomeStarts.length > 0) {
      reasons.push(`Recibirás ${incomeStarts.map(i => `${formatMoney(i.amount, currency, hideAmounts)} (${i.name})`).join(' + ')} ese mes.`);
    }
    // Cashflow delta vs previous month
    const delta = futurePositive.cashFlow - prev.cashFlow;
    if (reasons.length === 0 && delta > 0) {
      reasons.push(`Tu flujo mejora en ${formatMoney(delta, currency, hideAmounts)} respecto al mes anterior por cambios en tus deudas activas.`);
    }
    // Explicit date: first day of that month (granular monthly)
    const date = new Date(futurePositive.year, futurePositive.monthIdx, 1);
    return { date, reasons };
  }, [futurePositive, projection, data.debts, data.incomes, currency, hideAmounts]);

  // Smart allocation for this-month plan card
  const allocatedProjection = useMemo(() => {
    const activeDebts = debts.filter(d => !d.archived && (d.totalAmount-(d.paidAmount||0)) > 0);
    const highInterestDebts = activeDebts.filter(d => (d.interestRate || 0) >= 20);
    return buildSmartAllocation(projection, {
      ...data.savings,
      emergencyTarget: monthlyExpense * (data.savings.emergencyMonths || 3),
    }, { highInterestDebts });
  }, [projection, data.savings, monthlyExpense, debts]);

  // Plan-level allocation
  const planAllocations = useMemo(() => {
    return buildPlanAllocations(
      data.plans || [],
      allocatedProjection,
      data.savings.current || 0,
      data.savings.goal > 0 ? { amount: data.savings.goal, date: data.savings.goalDate } : null
    );
  }, [data.plans, allocatedProjection, data.savings.current, data.savings.goal, data.savings.goalDate]);

  // Comprehensive upcoming payments list:
  // - Debts (with their payment day)
  // - Recurring expenses (arriendo, servicios, suscripciones, etc.)
  // - One-time expenses planned ahead
  // - Expected incomes (salario, prima, ingresos puntuales)
  // Within the next 30 days, sorted by date
  const upcomingPayments = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const horizon = new Date(today); horizon.setDate(horizon.getDate() + 30);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const items = [];

    const getMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const getConfirm = (key, monthKey) => {
      const monthData = (data.confirmations && data.confirmations[monthKey]) || {};
      return monthData[key] ? true : false;
    };
    // Compute the "would-have-been" date for an item this month (used to detect overdue)
    const thisMonthOccurrence = (item) => {
      const freq = item.frequency || 'monthly';
      if (freq === 'monthly' || freq === 'biweekly' || freq === 'weekly') {
        const day = Math.min(item.dayOfMonth || 1, 28);
        return new Date(today.getFullYear(), today.getMonth(), day);
      }
      if (freq === 'biannual') {
        // Find one this month if any
        for (const p of [item.firstPayment, item.secondPayment]) {
          if (!p) continue;
          if (p.month - 1 === today.getMonth()) return new Date(today.getFullYear(), p.month - 1, p.day);
        }
        return null;
      }
      if (freq === 'annual') {
        if (item.annualMonth && item.annualMonth - 1 === today.getMonth()) {
          return new Date(today.getFullYear(), item.annualMonth - 1, item.annualDay || 1);
        }
        return null;
      }
      if (freq === 'once' && item.onceDate) {
        const d = parseLocalDate(item.onceDate);
        return d;
      }
      return null;
    };

    // Debts (next payment + check for overdue current month)
    debts.filter(d => !d.archived && (d.totalAmount - (d.paidAmount || 0)) > 0).forEach(d => {
      // Future-start debts: only show if their start date is within the horizon
      if (isDebtFutureStart(d, today)) {
        const startD = parseLocalDate(d.startDate);
        if (startD > horizon) return; // too far in the future
        const monthKey = getMonthKey(startD);
        const confirmKey = `debt-${d.id}-${monthKey}`;
        items.push({
          id: 'debt-' + d.id, kind: 'debt', name: d.name, amount: d.minimumPayment, date: startD,
          icon: CreditCard, color: 'var(--accent)', tag: 'Empieza',
          rawData: d, confirmKey, monthKey, isConfirmed: false, overdue: false, futureStart: true,
        });
        return;
      }
      // Current month occurrence (for overdue detection)
      const day = Math.min(d.paymentDay || 1, 28);
      const thisMonthDate = new Date(today.getFullYear(), today.getMonth(), day);
      const monthKey = getMonthKey(thisMonthDate);
      const confirmKey = `debt-${d.id}-${monthKey}`;
      const isConfirmed = getConfirm(confirmKey, monthKey);

      if (thisMonthDate < today && !isConfirmed) {
        // Overdue this month
        items.push({
          id: 'debt-' + d.id, kind: 'debt', name: d.name, amount: d.minimumPayment, date: thisMonthDate,
          icon: CreditCard, color: 'var(--warning)', tag: 'Deuda',
          rawData: d, confirmKey, monthKey, isConfirmed: false, overdue: true,
        });
      } else {
        const nextDate = getDebtNextPaymentDate(d, today);
        if (nextDate <= horizon) {
          const nMonthKey = getMonthKey(nextDate);
          const nConfirmKey = `debt-${d.id}-${nMonthKey}`;
          items.push({
            id: 'debt-' + d.id, kind: 'debt', name: d.name, amount: d.minimumPayment, date: nextDate,
            icon: CreditCard, color: 'var(--warning)', tag: 'Deuda',
            rawData: d, confirmKey: nConfirmKey, monthKey: nMonthKey,
            isConfirmed: getConfirm(nConfirmKey, nMonthKey), overdue: false,
          });
        }
      }
    });

    // Recurring expenses (with overdue detection for current month)
    expenses.filter(e => e.active && (e.frequency === 'once' || isItemActiveInMonth(e, today.getFullYear(), today.getMonth()))).forEach(e => {
      try {
        const occThis = thisMonthOccurrence(e);
        const monthKey = getMonthKey(today);
        const confirmKey = `exp-${e.id}-${monthKey}`;
        const isConfirmed = getConfirm(confirmKey, monthKey);
        // Overdue if this-month date is in past and not confirmed
        if (occThis && occThis < today && occThis >= monthStart && !isConfirmed) {
          const cat = getCategory('expense', e.category);
          items.push({
            id: 'exp-' + e.id, kind: 'expense', name: e.name, amount: e.amount, date: occThis,
            icon: cat ? cat.icon : ShoppingBag, color: cat ? cat.color : 'var(--danger)',
            tag: cat ? cat.name : 'Egreso',
            rawData: e, confirmKey, monthKey, isConfirmed: false, overdue: true,
          });
          return;
        }
        const nextDate = getNextOccurrenceDate(e, today);
        if (nextDate && nextDate >= today && nextDate <= horizon) {
          const cat = getCategory('expense', e.category);
          const nMonthKey = getMonthKey(nextDate);
          const nConfirmKey = `exp-${e.id}-${nMonthKey}`;
          items.push({
            id: 'exp-' + e.id, kind: 'expense', name: e.name, amount: e.amount, date: nextDate,
            icon: cat ? cat.icon : ShoppingBag, color: cat ? cat.color : 'var(--danger)',
            tag: cat ? cat.name : 'Egreso',
            rawData: e, confirmKey: nConfirmKey, monthKey: nMonthKey,
            isConfirmed: getConfirm(nConfirmKey, nMonthKey), overdue: false,
          });
        }
      } catch (err) { /* skip */ }
    });

    // Expected incomes (with overdue: salary expected but not received yet)
    incomes.filter(i => i.active && (i.frequency === 'once' || isItemActiveInMonth(i, today.getFullYear(), today.getMonth()))).forEach(i => {
      try {
        const occThis = thisMonthOccurrence(i);
        const monthKey = getMonthKey(today);
        const confirmKey = `inc-${i.id}-${monthKey}`;
        const isConfirmed = getConfirm(confirmKey, monthKey);
        if (occThis && occThis < today && occThis >= monthStart && !isConfirmed) {
          items.push({
            id: 'inc-' + i.id, kind: 'income', name: i.name, amount: i.amount, date: occThis,
            icon: ArrowUp, color: 'var(--primary)',
            tag: i.frequency === 'biannual' ? 'Prima' : i.frequency === 'annual' ? 'Bono anual' : 'Ingreso',
            rawData: i, confirmKey, monthKey, isConfirmed: false, overdue: true,
          });
          return;
        }
        const nextDate = getNextOccurrenceDate(i, today);
        if (nextDate && nextDate >= today && nextDate <= horizon) {
          const nMonthKey = getMonthKey(nextDate);
          const nConfirmKey = `inc-${i.id}-${nMonthKey}`;
          items.push({
            id: 'inc-' + i.id, kind: 'income', name: i.name, amount: i.amount, date: nextDate,
            icon: ArrowUp, color: 'var(--primary)',
            tag: i.frequency === 'biannual' ? 'Prima' : i.frequency === 'annual' ? 'Bono anual' : 'Ingreso',
            rawData: i, confirmKey: nConfirmKey, monthKey: nMonthKey,
            isConfirmed: getConfirm(nConfirmKey, nMonthKey), overdue: false,
          });
        }
      } catch (err) { /* skip */ }
    });

    // Sort: overdue first, then pending by date, then confirmed at the bottom
    return items.sort((a, b) => {
      if (a.isConfirmed !== b.isConfirmed) return a.isConfirmed ? 1 : -1;
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return a.date - b.date;
    });
  }, [debts, expenses, incomes, data.confirmations]);

  // Total expected outflow/inflow (only for pending — already-confirmed is reflected in real flow)
  const upcomingOutflow = useMemo(() =>
    upcomingPayments.filter(p => p.kind !== 'income' && !p.isConfirmed).reduce((s, p) => s + (p.amount || 0), 0),
    [upcomingPayments]);
  const upcomingInflow = useMemo(() =>
    upcomingPayments.filter(p => p.kind === 'income' && !p.isConfirmed).reduce((s, p) => s + (p.amount || 0), 0),
    [upcomingPayments]);

  const chartData = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = d.getMonth(), y = d.getFullYear();
      const monthTx = transactions.filter(t => { const td = new Date(t.date); return td.getMonth() === m && td.getFullYear() === y; });
      const inc = monthTx.filter(t => t.type === 'income').reduce((s,t) => s+t.amount, 0);
      const exp = monthTx.filter(t => t.type !== 'income').reduce((s,t) => s+t.amount, 0);
      months.push({ name: d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''), ingresos: inc, egresos: exp });
    }
    return months;
  }, [transactions]);

  // Daily simulation of current month: tells us when we go negative and when we recover
  const dailySim = useMemo(() => simulateMonthDaily(data), [data]);
  // Goal reach date (exact)
  const goalReachDate = useMemo(() => {
    if (!data.savings.goal || data.savings.goal <= 0) return null;
    const start = (data.savings.currentBalance || 0) + (data.savings.current || 0);
    if (start >= data.savings.goal) return new Date();
    for (const m of allocatedProjection) {
      if (m.allocation && m.allocation.goalReached) {
        // First payment day of that month
        return new Date(m.year, m.monthIdx, 1);
      }
    }
    return null;
  }, [allocatedProjection, data.savings.goal, data.savings.current, data.savings.currentBalance]);
  // Debt-free date (exact, day-level)
  const debtFreeDate = useMemo(() => {
    if (debts.filter(d => !d.archived && (d.totalAmount - (d.paidAmount || 0)) > 0).length === 0) return null;
    let latest = null;
    debts.filter(d => !d.archived && (d.totalAmount - (d.paidAmount || 0)) > 0).forEach(d => {
      const sched = simulateDebtPayoff(d, new Date());
      if (sched.length === 0 || sched._infeasible) { latest = 'infeasible'; return; }
      const last = sched[sched.length - 1];
      const lastDate = new Date(last.year, last.monthIdx, Math.min(d.paymentDay || 1, 28));
      if (latest !== 'infeasible' && (!latest || lastDate > latest)) latest = lastDate;
    });
    return latest;
  }, [debts]);

  const hasData = debts.length > 0 || incomes.length > 0 || expenses.length > 0;

  // Hero headline = spendable cash until the next paycheck (day-to-day reality)
  const heroValue = dailySim.availableUntilIncome;
  const heroPositive = heroValue >= 0;
  return (
    <div className="px-5 pb-32 space-y-4 stagger">
      <div className="animate-slideup card-hero" style={{
        padding: '24px 22px',
        background: heroPositive
          ? 'linear-gradient(160deg, #0F2E22 0%, #0A1A2E 60%, #07090F 100%)'
          : 'linear-gradient(160deg, #2E0F1A 0%, #1A0E2E 60%, #0E0710 100%)',
      }}>
        {/* Decorative orb */}
        <div style={{
          position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%',
          background: `radial-gradient(circle, ${heroPositive ? 'var(--primary)' : 'var(--danger)'}, transparent 65%)`,
          opacity: 0.18, filter: 'blur(8px)', pointerEvents: 'none',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="flex items-center gap-1.5">
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: heroPositive ? 'var(--primary)' : 'var(--danger)',
              boxShadow: `0 0 10px ${heroPositive ? 'var(--primary)' : 'var(--danger)'}`,
            }} />
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              Te queda para gastar
            </p>
          </div>
          {dailySim.confirmedCount > 0 && (
            <span className="pill pill-good" style={{ padding: '3px 8px' }}>EN VIVO</span>
          )}
        </div>

        <div className="animate-fadein">
          {/* CASH REALITY: spendable money with the cash you have now, after the
              obligations due before your next paycheck. This is the day-to-day
              truth — future income is NOT counted here, it's shown below. */}
          <h2 className="display-font animate-count" style={{
            fontSize: 42, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1,
            color: heroPositive ? 'var(--primary)' : 'var(--danger)',
            marginBottom: 6, fontVariantNumeric: 'tabular-nums',
          }}>
            <CountUp value={heroValue} format={(v) => (v >= 0 ? '' : '') + formatMoney(v, currency, hideAmounts)} />
          </h2>
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)', letterSpacing: '-0.005em', lineHeight: 1.45 }}>
            {dailySim.nextIncome
              ? <>Con tu plata de hoy, después de pagar lo que falta este mes. Tu ingreso de <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{formatCompact(dailySim.nextIncome.amount, currency, hideAmounts)}</span> llega el <span style={{ color: 'var(--text)', fontWeight: 600 }}>{formatDate(dailySim.nextIncome.date)}</span>.</>
              : <>Con tu plata de hoy, después de pagar lo que falta este mes.</>}
          </p>
          {heroValue < 0 && (
            <p style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 6, lineHeight: 1.4 }}>
              ⚠ No te alcanza para cubrir todo antes de tu próximo ingreso. Te faltan {formatMoney(-heroValue, currency, hideAmounts)}.
            </p>
          )}

          {/* Cash reconciliation */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Wallet size={12} color="var(--text-dim)" strokeWidth={2.5} />
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500 }}>Tienes hoy</span>
              </div>
              <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600 }}>{formatCompact(dailySim.realBalanceToday, currency, hideAmounts)}</span>
            </div>
            {dailySim.pendingObligations > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={12} color="var(--text-muted)" strokeWidth={2.5} />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500 }}>Te falta pagar</span>
                </div>
                <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--danger)' }}>−{formatCompact(dailySim.pendingObligations, currency, hideAmounts)}</span>
              </div>
            )}
          </div>
        </div>

        {(futurePositive || lastDebtMonth) && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {futurePositive && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Info size={13} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45 }}>
                    Vuelves a flujo positivo el <strong style={{ color: 'var(--primary)', fontWeight: 600 }}>{futurePositiveReason ? formatDate(futurePositiveReason.date) : futurePositive.fullLabel}</strong>
                  </p>
                  {futurePositiveReason && futurePositiveReason.reasons.length > 0 && (
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 4 }}>
                      <strong style={{ color: 'var(--text-dim)' }}>Por qué: </strong>{futurePositiveReason.reasons.join(' ')}
                    </p>
                  )}
                </div>
              </div>
            )}
            {lastDebtMonth && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <CheckCircle2 size={13} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45 }}>
                  Libre de deudas el <strong style={{ color: 'var(--primary)', fontWeight: 600 }}>{formatDate(new Date(lastDebtMonth.year, lastDebtMonth.monthIdx, 1))}</strong> — esa cuota mensual queda disponible para ti
                </p>
              </div>
            )}
          </div>
        )}

        {/* Stat strip: shows what actually happens THIS month (not annualized average).
            Uses projection[0] which respects future-start debts and current-month
            primas/anuales — so the numbers reconcile with the hero number above. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 20, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          {[
            { Icon: ArrowUp,    color: 'var(--primary)', label: 'Ingresos este mes',  value: projection[0] ? projection[0].income      : monthlyIncome },
            { Icon: ArrowDown,  color: 'var(--danger)',  label: 'Egresos este mes',   value: projection[0] ? projection[0].expense     : monthlyExpense },
            { Icon: CreditCard, color: 'var(--warning)', label: 'Cuotas este mes',    value: projection[0] ? projection[0].debtPayment : monthlyDebtPayment },
          ].map((item, i) => (
            <div key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <item.Icon size={11} color={item.color} strokeWidth={2.5} />
                <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{item.label}</span>
              </div>
              <p className="tabular" style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.015em' }}>
                {formatCompact(item.value, currency, hideAmounts)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* === CYCLE CHECKLIST: the user's notepad as a living widget === */}
      <CycleChecklist data={data} currency={currency} hideAmounts={hideAmounts} projection={projection} sim={dailySim} onConfirm={onConfirm} onConfirmDebt={onConfirmDebt} onConfirmSavings={onConfirmSavings} />

      {/* === REAL BALANCE TODAY: live cash on hand + day-by-day simulation === */}
      <RealBalanceCard sim={dailySim} savings={data.savings} currency={currency} hideAmounts={hideAmounts} onNavigate={onNavigate} onSetBalance={(amount) => onUpdateSavings && onUpdateSavings({ currentBalance: amount, balanceUpdatedAt: new Date().toISOString() })} />

      {/* === NET WORTH: historical trend === */}
      <NetWorthCard data={data} currency={currency} hideAmounts={hideAmounts} />

      {/* === FINANCIAL ADVISOR: step-by-step plan with specific amounts === */}
      <FinancialAdvisorCard data={data} currency={currency} hideAmounts={hideAmounts} onNavigate={onNavigate} />

      {/* === KEY DATES: when goal reached, when debt-free, when stable === */}
      <KeyDatesCard goalReachDate={goalReachDate} debtFreeDate={debtFreeDate} dailySim={dailySim} savings={data.savings} currency={currency} hideAmounts={hideAmounts} />

      {/* This month's plan: how to split the surplus */}
      {projection[0] && projection[0].cashFlow > 0 && (
        <div className="animate-slideup">
          <MonthAllocationPlan allocatedProjection={allocatedProjection} planMonthlyView={planAllocations.monthlyView} savings={data.savings} currency={currency} hideAmounts={hideAmounts} />
        </div>
      )}

      <div className="animate-slideup grid grid-cols-2 gap-3">
        <button onClick={() => onNavigate('debts')} className="card card-press text-left" style={{ padding: 16 }}>
          <div className="flex items-center gap-2 mb-3">
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--danger-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><CreditCard size={14} color="var(--danger)" strokeWidth={2.4} /></div>
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)', fontWeight: 500 }}>Deuda total</span>
          </div>
          <p className="display-font tabular" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{formatCompact(totalDebt, currency, hideAmounts)}</p>
          <p style={{ fontSize: 11, marginTop: 2, color: 'var(--text-muted)', fontWeight: 500 }}>{debts.filter(d => !d.archived).length} deuda{debts.filter(d => !d.archived).length !== 1 ? 's' : ''} activa{debts.filter(d => !d.archived).length !== 1 ? 's' : ''}</p>
        </button>
        <button onClick={() => onNavigate('projection')} className="card card-press text-left" style={{ padding: 16 }}>
          <div className="flex items-center gap-2 mb-3">
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--primary-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Target size={14} color="var(--primary)" strokeWidth={2.4} /></div>
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)', fontWeight: 500 }}>Próximo pago</span>
          </div>
          {(() => {
            const next = upcomingPayments.find(p => p.kind !== 'income');
            if (!next) {
              return (
                <>
                  <p className="display-font" style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-muted)', letterSpacing: '-0.025em', lineHeight: 1.1 }}>—</p>
                  <p style={{ fontSize: 11, marginTop: 2, color: 'var(--text-muted)', fontWeight: 500 }}>Nada en 30 días</p>
                </>
              );
            }
            const days = daysBetween(new Date(), next.date);
            return (
              <>
                <p className="display-font tabular" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{formatCompact(next.amount, currency, hideAmounts)}</p>
                <p style={{ fontSize: 11, marginTop: 2, color: 'var(--text-muted)', fontWeight: 500 }} className="truncate">{next.name} · {days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days}d`}</p>
              </>
            );
          })()}
        </button>
      </div>

      {upcomingPayments.length > 0 && (
        <div className="animate-slideup desk-full">
          <div className="flex items-center justify-between mb-3 px-1">
            <div>
              <h3 className="display-font" style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-0.02em' }}>Próximos pagos</h3>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginTop: 2 }}>30 días · deudas, egresos e ingresos</p>
            </div>
            {(() => {
              const overdueCount = upcomingPayments.filter(p => p.overdue && !p.isConfirmed).length;
              if (overdueCount === 0) return null;
              return (
                <button
                  onClick={() => {
                    upcomingPayments.filter(p => p.overdue && !p.isConfirmed).forEach(p => {
                      if (p.kind === 'debt') onConfirmDebt(p.rawData.id, p.amount, p.monthKey);
                      else onConfirm(p.confirmKey, { monthKey: p.monthKey, amount: p.amount, name: p.name });
                    });
                  }}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 999,
                    background: 'var(--primary-glow)', color: 'var(--primary)',
                    border: '1px solid rgba(52,211,153,0.3)', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    letterSpacing: '-0.005em',
                  }}
                >
                  <Check size={12} strokeWidth={2.6} /> Marcar {overdueCount} vencido{overdueCount !== 1 ? 's' : ''}
                </button>
              );
            })()}
          </div>

          {/* Summary header */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="card" style={{ padding: 14, background: 'linear-gradient(180deg, rgba(248,113,113,0.06), transparent)', border: '1px solid rgba(248,113,113,0.2)' }}>
              <div className="flex items-center gap-1.5 mb-1.5"><ArrowDown size={11} color="var(--danger)" strokeWidth={2.5} /><span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Por pagar</span></div>
              <p className="display-font tabular" style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-0.025em', color: 'var(--danger)' }}>{formatCompact(upcomingOutflow, currency, hideAmounts)}</p>
            </div>
            <div className="card" style={{ padding: 14, background: 'linear-gradient(180deg, rgba(52,211,153,0.06), transparent)', border: '1px solid rgba(52,211,153,0.2)' }}>
              <div className="flex items-center gap-1.5 mb-1.5"><ArrowUp size={11} color="var(--primary)" strokeWidth={2.5} /><span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Por recibir</span></div>
              <p className="display-font tabular" style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-0.025em', color: 'var(--primary)' }}>{formatCompact(upcomingInflow, currency, hideAmounts)}</p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {upcomingPayments.map(p => {
              const days = daysBetween(new Date(), p.date);
              const isOverdue = !!p.overdue && !p.isConfirmed;
              const urgent = isOverdue || (days <= 3 && p.kind !== 'income' && !p.isConfirmed);
              const todayItem = days === 0;
              const Icon = p.icon;
              const isIncome = p.kind === 'income';
              const confirmed = p.isConfirmed;
              const verb = isIncome ? 'recibí' : 'pagué';
              const verbDone = isIncome ? 'recibido' : 'pagado';

              const handleConfirmClick = (e) => {
                e.stopPropagation();
                if (p.kind === 'debt') {
                  onConfirmDebt(p.rawData.id, p.amount, p.monthKey);
                } else {
                  onConfirm(p.confirmKey, { monthKey: p.monthKey, amount: p.amount, name: p.name });
                }
              };
              const handleRowClick = () => {
                if (p.kind === 'debt') onPayDebt(p.rawData);
                else onNavigate('movements');
              };

              const overdueColor = isIncome ? 'var(--warning)' : 'var(--danger)';
              const borderColor = isOverdue ? `${overdueColor}55` : (urgent ? 'rgba(248,113,113,0.3)' : 'var(--border)');

              return (
                <div
                  key={p.id}
                  className="card"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    border: `1px solid ${borderColor}`,
                    background: isOverdue ? `linear-gradient(180deg, ${isIncome ? 'rgba(251,191,36,0.04)' : 'rgba(248,113,113,0.04)'}, var(--surface))` : 'var(--surface)',
                    opacity: confirmed ? 0.6 : 1,
                    transition: 'opacity 0.25s var(--ease-soft)',
                  }}
                >
                  {/* Confirmation toggle circle */}
                  <button
                    key={`circle-${confirmed}`}
                    onClick={handleConfirmClick}
                    aria-label={confirmed ? `Quitar marca de ${verbDone}` : `Marcar como ${verbDone}`}
                    className="animate-confirm-pop"
                    style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      background: confirmed ? 'var(--primary)' : 'transparent',
                      border: confirmed ? '2px solid var(--primary)' : `2px solid ${isOverdue ? overdueColor : 'var(--border-strong)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.2s var(--ease-spring)',
                      cursor: 'pointer', padding: 0,
                      boxShadow: confirmed ? '0 0 12px var(--primary-glow)' : 'none',
                    }}
                  >
                    {confirmed && <Check size={13} color="#fff" strokeWidth={3.5} />}
                  </button>

                  {/* Main content (tap to navigate) */}
                  <button
                    onClick={handleRowClick}
                    className="card-press"
                    style={{
                      flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10,
                      padding: 0, background: 'none', border: 'none', textAlign: 'left',
                    }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 11, flexShrink: 0,
                      background: confirmed ? 'var(--surface-2)' : (isOverdue ? `${overdueColor}1F` : (urgent ? 'var(--danger-glow)' : `${p.color}1A`)),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon size={14} color={confirmed ? 'var(--text-muted)' : (isOverdue ? overdueColor : (urgent ? 'var(--danger)' : p.color))} strokeWidth={2.4} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <p className="truncate" style={{
                          fontSize: 13.5, fontWeight: 500, letterSpacing: '-0.005em',
                          textDecoration: confirmed ? 'line-through' : 'none',
                          color: confirmed ? 'var(--text-muted)' : 'var(--text)',
                        }}>{p.name}</p>
                        {isOverdue && (
                          <span className={isIncome ? "pill pill-warn" : "pill pill-bad"} style={{ flexShrink: 0 }}>
                            {isIncome ? 'Esperado' : 'Vencido'}
                          </span>
                        )}
                        {!confirmed && !isOverdue && (
                          <span style={{
                            fontSize: 9, padding: '2px 6px', borderRadius: 999,
                            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600,
                            background: `${p.color}22`, color: p.color, flexShrink: 0,
                          }}>{p.tag}</span>
                        )}
                        {confirmed && (
                          <span className="pill pill-good" style={{ flexShrink: 0 }}>{verbDone}</span>
                        )}
                      </div>
                      <p style={{
                        fontSize: 11, marginTop: 1, fontWeight: 500,
                        color: confirmed ? 'var(--text-faint)' : (isOverdue ? overdueColor : (urgent ? 'var(--danger)' : 'var(--text-muted)')),
                      }}>
                        {confirmed
                          ? `Marcado como ${verbDone}`
                          : isOverdue
                            ? `${isIncome ? 'No has recibido aún' : 'Vencido'} · ${formatDateShort(p.date)}`
                            : (todayItem ? 'Hoy' : days === 1 ? 'Mañana' : `En ${days} días`) + ` · ${formatDateShort(p.date)}`}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p className="tabular" style={{
                        fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em',
                        textDecoration: confirmed ? 'line-through' : 'none',
                        color: confirmed ? 'var(--text-muted)' : (isIncome ? 'var(--primary)' : 'var(--text)'),
                      }}>
                        {isIncome ? '+' : ''}{formatMoney(p.amount, currency, hideAmounts)}
                      </p>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Onboarding hint - dismissible & persistent */}
          {upcomingPayments.length > 0 && <ConfirmTip />}
        </div>
      )}

      {HAS_CHARTS && chartData.some(m => m.ingresos > 0 || m.egresos > 0) && (
        <div className="animate-slideup card desk-full" style={{ padding: 18 }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="display-font" style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.02em' }}>Últimos 6 meses</h3>
            <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-dim)' }}><span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--primary)' }} />Ingresos</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-dim)' }}><span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--danger)' }} />Egresos</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} barGap={3}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#5C6788' }} />
              <Tooltip cursor={{ fill: 'rgba(52,211,153,0.05)' }} contentStyle={{ background: '#1C2440', border: '1px solid #232E4D', borderRadius: 12, fontSize: 12 }} formatter={(v) => formatCompact(v, currency)} />
              <Bar dataKey="ingresos" fill="#34D399" radius={[4,4,0,0]} />
              <Bar dataKey="egresos" fill="#F87171" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="animate-slideup grid grid-cols-3 gap-2 desk-full">
        <button onClick={() => onAddTransaction('income')} className="flex flex-col items-center gap-2 p-3.5 rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--primary-glow)' }}><ArrowUp size={16} color="var(--primary)" /></div>
          <span className="text-xs font-medium">Ingreso</span>
        </button>
        <button onClick={() => onAddTransaction('expense')} className="flex flex-col items-center gap-2 p-3.5 rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--danger-glow)' }}><ArrowDown size={16} color="var(--danger)" /></div>
          <span className="text-xs font-medium">Egreso</span>
        </button>
        <button onClick={() => onNavigate('debts')} className="flex flex-col items-center gap-2 p-3.5 rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'rgba(251,191,36,0.15)' }}><CreditCard size={16} color="var(--warning)" /></div>
          <span className="text-xs font-medium">Pagar deuda</span>
        </button>
      </div>

      {/* === PERSONAL NOTES: freeform reminders, like the notepad's last section === */}
      <PersonalNotesCard notes={data.userNotes} onSave={onSaveNotes} />

      {!hasData && (
        <div className="animate-slideup rounded-2xl p-6 text-center desk-full" style={{ background: 'var(--surface)', border: '1px dashed var(--border)' }}>
          <div className="flex justify-center mb-3"><Sparkles size={28} color="var(--primary)" /></div>
          <h3 className="display-font text-lg font-semibold mb-1">Comienza a registrar</h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-dim)' }}>Añade tus deudas, ingresos y egresos para ver tu proyección financiera.</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
//  DEBTS
// ============================================================================
function DebtsScreen({ data, currency, hideAmounts, onSave, onDelete, onPay, onArchive }) {
  const [filter, setFilter] = useState('active');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [detailDebt, setDetailDebt] = useState(null);
  const [payingDebt, setPayingDebt] = useState(null);
  const debts = data.debts;
  const filtered = useMemo(() => {
    return debts.filter(d => {
      const remaining = d.totalAmount - (d.paidAmount || 0);
      if (filter === 'active') return !d.archived && remaining > 0;
      if (filter === 'paid') return remaining <= 0 || d.archived;
      return true;
    }).map(d => ({ ...d, nextDate: getDebtNextPaymentDate(d), remaining: d.totalAmount - (d.paidAmount || 0) }))
      .sort((a, b) => a.nextDate - b.nextDate);
  }, [debts, filter]);
  const totalActive = debts.filter(d => !d.archived).reduce((s,d) => s + Math.max(0, d.totalAmount - (d.paidAmount||0)), 0);
  const totalPaid = debts.reduce((s,d) => s + (d.paidAmount || 0), 0);

  return (
    <div className="px-5 pb-32 space-y-4 stagger">
      <div className="animate-slideup card-hero" style={{
        padding: '24px 22px',
        background: 'linear-gradient(160deg, #2A0F1A 0%, #1A0E2E 60%, #0E0710 100%)',
      }}>
        <div style={{
          position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: '50%',
          background: 'radial-gradient(circle, var(--danger), transparent 65%)',
          opacity: 0.18, filter: 'blur(8px)', pointerEvents: 'none',
        }} />
        <div className="flex items-center gap-1.5 mb-3">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)', boxShadow: '0 0 10px var(--danger)' }} />
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Total adeudado</p>
        </div>
        <h2 className="display-font animate-count tabular" style={{
          fontSize: 36, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1,
          color: 'var(--danger)', marginBottom: 14,
        }}>
          <CountUp value={totalActive} format={(v) => formatMoney(v, currency, hideAmounts)} />
        </h2>
        <div style={{ display: 'flex', gap: 24, fontSize: 11.5 }}>
          <div>
            <p style={{ color: 'var(--text-muted)', fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Pagado</p>
            <p className="tabular" style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)', letterSpacing: '-0.01em' }}>{formatMoney(totalPaid, currency, hideAmounts)}</p>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)', fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Activas</p>
            <p className="tabular" style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>{debts.filter(d => !d.archived && (d.totalAmount-(d.paidAmount||0)) > 0).length}</p>
          </div>
        </div>
      </div>

      <div className="animate-slideup desk-full" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {[{id:'active',label:'Activas'},{id:'paid',label:'Pagadas'},{id:'all',label:'Todas'}].map(t => {
          const sel = filter === t.id;
          return (
            <button key={t.id} onClick={() => setFilter(t.id)} style={{
              flex: 1, padding: '8px 0', borderRadius: 10,
              fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em',
              transition: 'all 0.2s var(--ease-soft)', cursor: 'pointer',
              background: sel ? 'linear-gradient(180deg, var(--primary-glow), rgba(52,211,153,0.04))' : 'transparent',
              border: sel ? '1px solid rgba(52,211,153,0.3)' : '1px solid transparent',
              color: sel ? 'var(--primary)' : 'var(--text-dim)',
            }}>{t.label}</button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="animate-slideup desk-full" style={{ padding: 28, textAlign: 'center', background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><CreditCard size={28} color="var(--text-muted)" strokeWidth={1.8} /></div>
          <p className="display-font" style={{ fontSize: 18, fontWeight: 500, marginBottom: 4, letterSpacing: '-0.02em' }}>Sin deudas</p>
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>{filter === 'active' ? '¡Vas bien! Aún sin deudas activas.' : 'Aquí verás tus deudas.'}</p>
        </div>
      ) : (
        <div className="animate-slideup desk-full desk-cardgrid" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{filtered.map(d => <DebtCard key={d.id} debt={d} currency={currency} hideAmounts={hideAmounts} onTap={() => setDetailDebt(d)} />)}</div>
      )}

      <button onClick={() => setCreating(true)} className="fab" aria-label="Añadir deuda"><Plus size={24} strokeWidth={2.5} /></button>

      <Sheet open={creating || !!editing} onClose={() => { setCreating(false); setEditing(null); }} title={editing ? 'Editar deuda' : 'Nueva deuda'} size="lg">
        <DebtForm initial={editing} currency={currency} onSave={(d) => { onSave(d); setCreating(false); setEditing(null); }} />
      </Sheet>
      <Sheet open={!!detailDebt} onClose={() => setDetailDebt(null)} title="Detalle" size="lg">
        {detailDebt && (
          <DebtDetail debt={debts.find(x => x.id === detailDebt.id) || detailDebt} currency={currency} hideAmounts={hideAmounts}
            onEdit={() => { setEditing(debts.find(x => x.id === detailDebt.id)); setDetailDebt(null); }}
            onDelete={() => { onDelete(detailDebt.id); setDetailDebt(null); }}
            onArchive={() => { onArchive(detailDebt.id); setDetailDebt(null); }}
            onPay={() => { setPayingDebt(detailDebt); setDetailDebt(null); }} />
        )}
      </Sheet>
      <Sheet open={!!payingDebt} onClose={() => setPayingDebt(null)} title="Registrar pago" size="md">
        {payingDebt && (
          <PayDebtForm debt={debts.find(x => x.id === payingDebt.id) || payingDebt} currency={currency}
            onPay={(amount, note) => { onPay(payingDebt.id, amount, note); setPayingDebt(null); }} />
        )}
      </Sheet>
    </div>
  );
}

function DebtCard({ debt, currency, hideAmounts, onTap }) {
  const remaining = debt.totalAmount - (debt.paidAmount || 0);
  const progress = Math.min(100, ((debt.paidAmount || 0) / debt.totalAmount) * 100);
  const today = new Date();
  const futureStart = isDebtFutureStart(debt, today);
  const effectiveNext = futureStart ? parseLocalDate(debt.startDate) : debt.nextDate;
  const days = daysBetween(today, effectiveNext);
  const urgent = !futureStart && days <= 3 && remaining > 0;
  const completed = remaining <= 0;
  return (
    <button onClick={onTap} className="card card-press" style={{ width: '100%', textAlign: 'left', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: completed ? 'var(--primary-glow)' : urgent ? 'var(--danger-glow)' : 'var(--surface-2)',
            border: `1px solid ${completed ? 'rgba(52,211,153,0.25)' : urgent ? 'rgba(248,113,113,0.25)' : 'var(--border)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {completed ? <CheckCircle2 size={17} color="var(--primary)" strokeWidth={2.4} /> : <CreditCard size={17} color={urgent ? 'var(--danger)' : 'var(--text-dim)'} strokeWidth={2.2} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="truncate" style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{debt.name}</p>
            {debt.creditor && <p className="truncate" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>{debt.creditor}</p>}
          </div>
        </div>
        <div style={{ textAlign: 'right', marginLeft: 8, flexShrink: 0 }}>
          <p className="tabular" style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>{formatCompact(remaining, currency, hideAmounts)}</p>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>de {formatCompact(debt.totalAmount, currency, hideAmounts)}</p>
        </div>
      </div>
      <div className="progress-track" style={{ marginBottom: 8 }}><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, fontWeight: 500 }}>
        <span style={{ color: 'var(--text-muted)' }}>{progress.toFixed(0)}% pagado</span>
        {!completed && futureStart && <span style={{ color: 'var(--accent)' }}>Empieza {formatDateShort(effectiveNext)}</span>}
        {!completed && !futureStart && <span style={{ color: urgent ? 'var(--danger)' : 'var(--text-dim)' }}>{days === 0 ? 'Pago hoy' : days === 1 ? 'Pago mañana' : `Pago en ${days}d`}</span>}
        {completed && <span className="pill pill-good" style={{ padding: '2px 8px' }}>Completada</span>}
      </div>
    </button>
  );
}

function DebtForm({ initial, currency, onSave }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const defaults = { id: uid(), name: '', creditor: '', totalAmount: 0, paidAmount: 0, interestRate: 0, minimumPayment: 0, paymentDay: 1, startDate: todayStr, notes: '', createdAt: new Date().toISOString(), archived: false };
  const [form, setForm] = useState(initial ? { ...defaults, ...initial, startDate: initial.startDate || todayStr } : defaults);
  const update = (k, v) => setForm(s => ({ ...s, [k]: v }));
  const valid = form.name.trim() && form.totalAmount > 0 && form.paymentDay >= 1 && form.paymentDay <= 31;
  const startDateObj = form.startDate ? parseLocalDate(form.startDate) : null;
  const today0 = new Date(); today0.setHours(0,0,0,0);
  const isFuture = startDateObj && startDateObj > today0;
  // Estimate months to payoff for preview
  const previewMonths = useMemo(() => {
    if (!valid) return null;
    const sched = simulateDebtPayoff(form, startDateObj || new Date());
    if (sched._infeasible || sched.length === 0) return null;
    return sched.length;
  }, [form.totalAmount, form.paidAmount, form.minimumPayment, form.interestRate, form.startDate, valid]);
  return (
    <div className="space-y-4">
      <TextField label="Nombre de la deuda" value={form.name} onChange={v => update('name', v)} placeholder="Ej. Tarjeta de crédito" />
      <TextField label="Acreedor (opcional)" value={form.creditor} onChange={v => update('creditor', v)} placeholder="Ej. Bancolombia" />
      <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Monto total</span><MoneyInput value={form.totalAmount} onChange={v => update('totalAmount', v)} currency={currency} /></div>
      <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Ya pagado</span><MoneyInput value={form.paidAmount} onChange={v => update('paidAmount', v)} currency={currency} /></div>
      <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Cuota mínima mensual</span><MoneyInput value={form.minimumPayment} onChange={v => update('minimumPayment', v)} currency={currency} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Día de pago</span><DayInput value={form.paymentDay} onChange={v => update('paymentDay', v)} max={31} /></div>
        <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Interés % anual</span><NumberInput value={form.interestRate} onChange={v => update('interestRate', v)} min={0} max={500} decimals /></div>
      </div>
      <div>
        <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>¿Cuándo empiezas a pagarla?</span>
        <input type="date" value={form.startDate || ''} onChange={e => update('startDate', e.target.value)} className="input-base w-full rounded-xl px-4 py-3 text-base" style={{ colorScheme: 'dark' }} />
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Si la primera cuota es en el futuro (ej. julio), pon esa fecha. La app no contará esta deuda en tu flujo hasta entonces.</p>
      </div>
      <TextField label="Notas (opcional)" value={form.notes} onChange={v => update('notes', v)} placeholder="..." />
      {valid && (
        <div className="rounded-2xl p-3 text-xs space-y-1" style={{ background: isFuture ? 'rgba(167,139,250,0.10)' : 'var(--primary-glow)', border: `1px solid ${isFuture ? 'rgba(167,139,250,0.25)' : 'rgba(52,211,153,0.25)'}` }}>
          {isFuture && <p style={{ color: 'var(--accent)' }}>📅 Primera cuota: <strong>{formatDate(startDateObj)}</strong>. Hasta entonces no descontará nada.</p>}
          {previewMonths != null && (
            <p style={{ color: 'var(--text-dim)' }}>Plan: <strong style={{ color: 'var(--text)' }}>{previewMonths} cuotas</strong> pagando {formatMoney(form.minimumPayment, currency)} al mes. Última cuota: <strong style={{ color: 'var(--text)' }}>{formatDate(new Date((startDateObj || new Date()).getFullYear(), (startDateObj || new Date()).getMonth() + previewMonths - 1, 1))}</strong>.</p>
          )}
        </div>
      )}
      <button onClick={() => onSave(form)} disabled={!valid} className="btn-primary w-full rounded-2xl py-3.5 text-base font-semibold mt-2">{initial ? 'Guardar cambios' : 'Crear deuda'}</button>
    </div>
  );
}

function DebtDetail({ debt, currency, hideAmounts, onEdit, onDelete, onArchive, onPay }) {
  const remaining = debt.totalAmount - (debt.paidAmount || 0);
  const progress = Math.min(100, ((debt.paidAmount || 0) / debt.totalAmount) * 100);
  const today = new Date();
  const futureStart = isDebtFutureStart(debt, today);
  const nextDate = getDebtNextPaymentDate(debt, today);
  const schedule = useMemo(() => simulateDebtPayoff(debt, today), [debt.totalAmount, debt.paidAmount, debt.minimumPayment, debt.interestRate, debt.startDate]);
  const lastPaymentDate = schedule.length > 0 ? new Date(schedule[schedule.length-1].year, schedule[schedule.length-1].monthIdx, debt.paymentDay || 1) : null;
  const monthsLeft = schedule.length || (debt.minimumPayment > 0 ? Math.ceil(remaining / debt.minimumPayment) : 0);
  const completed = remaining <= 0;
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="display-font text-2xl font-semibold mb-1">{debt.name}</h2>
        {debt.creditor && <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{debt.creditor}</p>}
      </div>
      <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex justify-between items-baseline mb-2"><span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Restante</span><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{progress.toFixed(0)}%</span></div>
        <p className="display-font text-3xl font-semibold tabular mb-2" style={{ color: completed ? 'var(--primary)' : 'var(--text)' }}>{formatMoney(remaining, currency, hideAmounts)}</p>
        <div className="progress-track mb-3"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div><p style={{ color: 'var(--text-muted)' }}>Total original</p><p className="font-semibold tabular">{formatMoney(debt.totalAmount, currency, hideAmounts)}</p></div>
          <div><p style={{ color: 'var(--text-muted)' }}>Pagado</p><p className="font-semibold tabular" style={{ color: 'var(--primary)' }}>{formatMoney(debt.paidAmount || 0, currency, hideAmounts)}</p></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl p-3.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Cuota mensual</p><p className="font-semibold tabular">{formatMoney(debt.minimumPayment, currency, hideAmounts)}</p></div>
        <div className="rounded-2xl p-3.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Interés anual</p><p className="font-semibold tabular">{(debt.interestRate || 0).toFixed(1)}%</p></div>
        <div className="rounded-2xl p-3.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>{futureStart ? 'Primera cuota' : 'Próximo pago'}</p><p className="font-semibold" style={{ color: futureStart ? 'var(--accent)' : 'var(--text)' }}>{formatDateShort(nextDate)}</p></div>
        <div className="rounded-2xl p-3.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Cuotas restantes</p><p className="font-semibold tabular">{monthsLeft || '—'}</p></div>
      </div>
      {lastPaymentDate && !completed && (
        <div className="rounded-2xl p-3.5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Quedarás libre el</p>
          <p className="display-font font-semibold text-lg" style={{ color: 'var(--primary)' }}>{formatDate(lastPaymentDate)}</p>
        </div>
      )}
      {debt.notes && (
        <div className="rounded-2xl p-3.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Notas</p>
          <p className="text-sm">{debt.notes}</p>
        </div>
      )}
      {!completed && debt.minimumPayment > 0 && <DebtAnalysis debt={debt} currency={currency} hideAmounts={hideAmounts} />}
      {!completed && <button onClick={onPay} className="btn-primary w-full rounded-2xl py-3.5 text-base font-semibold">Registrar pago</button>}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={onEdit} className="btn-ghost rounded-xl py-3 flex items-center justify-center gap-1 text-sm font-medium"><Edit3 size={14} /> Editar</button>
        <button onClick={onArchive} className="btn-ghost rounded-xl py-3 flex items-center justify-center gap-1 text-sm font-medium">{debt.archived ? <RotateCcw size={14} /> : <Receipt size={14} />}{debt.archived ? 'Activar' : 'Archivar'}</button>
        <button onClick={() => setConfirmDelete(true)} className="rounded-xl py-3 flex items-center justify-center gap-1 text-sm font-medium" style={{ background: 'var(--danger-glow)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.2)' }}><Trash2 size={14} /> Borrar</button>
      </div>
      <ConfirmDialog open={confirmDelete} title="¿Eliminar deuda?" message="Esta acción no se puede deshacer. Se borrarán también los pagos registrados." onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); onDelete(); }} danger />
    </div>
  );
}

function DebtAnalysis({ debt, currency, hideAmounts }) {
  const remaining = debt.totalAmount - (debt.paidAmount || 0);
  const min = debt.minimumPayment;
  const rate = debt.interestRate || 0;
  const minPayoff = useMemo(() => calcDebtPayoff(remaining, min, rate), [remaining, min, rate]);
  const doublePayoff = useMemo(() => calcDebtPayoff(remaining, min * 2, rate), [remaining, min, rate]);
  const interestSavedDouble = minPayoff.feasible && doublePayoff.feasible ? minPayoff.totalInterest - doublePayoff.totalInterest : 0;

  let recommendation, recColor, recIcon;
  if (!minPayoff.feasible) {
    recommendation = 'La cuota mínima no cubre los intereses. Tu deuda crecería. Sube la cuota urgentemente.';
    recColor = 'var(--danger)'; recIcon = AlertCircle;
  } else if (rate === 0) {
    recommendation = 'Sin intereses, no hay urgencia. Pagar la mínima está bien si tu flujo lo necesita.';
    recColor = 'var(--text-dim)'; recIcon = Info;
  } else if (rate >= 20) {
    recommendation = `Interés alto (${rate}%). Si puedes pagar el total ahora, hazlo: te ahorras ${formatCompact(minPayoff.totalInterest, currency, hideAmounts)} en intereses.`;
    recColor = 'var(--danger)'; recIcon = AlertCircle;
  } else if (rate >= 10) {
    recommendation = `Interés medio (${rate}%). Pagar más de la mínima reduce mucho los intereses. Considera duplicar la cuota si puedes.`;
    recColor = 'var(--warning)'; recIcon = TrendingUp;
  } else {
    recommendation = `Interés bajo (${rate}%). Pagar la mínima es razonable; podrías invertir el excedente en otra cosa.`;
    recColor = 'var(--primary)'; recIcon = CheckCircle2;
  }

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        <Sparkles size={14} color="var(--accent)" />
        <h4 className="display-font text-sm font-semibold uppercase tracking-wide">Análisis de pago</h4>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-soft)' }}>
          <p className="text-[10px] uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Pagando mínima</p>
          {minPayoff.feasible ? (
            <>
              <p className="font-semibold tabular text-sm">{minPayoff.months} mes{minPayoff.months !== 1 ? 'es' : ''}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--danger)' }}>+{formatCompact(minPayoff.totalInterest, currency, hideAmounts)} intereses</p>
            </>
          ) : <p className="font-semibold text-sm" style={{ color: 'var(--danger)' }}>Nunca termina</p>}
        </div>
        <div className="rounded-xl p-3" style={{ background: 'var(--primary-glow)', border: '1px solid rgba(52,211,153,0.25)' }}>
          <p className="text-[10px] uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Pagando doble</p>
          {doublePayoff.feasible ? (
            <>
              <p className="font-semibold tabular text-sm">{doublePayoff.months} mes{doublePayoff.months !== 1 ? 'es' : ''}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--primary)' }}>ahorra {formatCompact(interestSavedDouble, currency, hideAmounts)}</p>
            </>
          ) : <p className="font-semibold text-sm">—</p>}
        </div>
      </div>

      <div className="rounded-xl p-3 flex gap-2" style={{ background: 'var(--surface-2)', border: `1px solid ${recColor}33` }}>
        <div className="flex-shrink-0 mt-0.5">{React.createElement(recIcon, { size: 16, color: recColor })}</div>
        <p className="text-xs leading-relaxed">{recommendation}</p>
      </div>

      {rate > 0 && minPayoff.feasible && remaining > 0 && (
        <div className="text-center pt-1">
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Pagar el total ahora ({formatCompact(remaining, currency, hideAmounts)}) ahorra <span style={{ color: 'var(--primary)' }}>{formatCompact(minPayoff.totalInterest, currency, hideAmounts)}</span> en intereses.</p>
        </div>
      )}
    </div>
  );
}

function PayDebtForm({ debt, currency, onPay }) {
  const remaining = debt.totalAmount - (debt.paidAmount || 0);
  const [amount, setAmount] = useState(debt.minimumPayment || 0);
  const [note, setNote] = useState('');
  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Saldo restante</p>
        <p className="display-font text-2xl font-semibold tabular">{formatMoney(remaining, currency)}</p>
      </div>
      <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Monto a pagar</span><MoneyInput value={amount} onChange={setAmount} currency={currency} /></div>
      <div className="flex gap-2">
        <button onClick={() => setAmount(debt.minimumPayment || 0)} className="btn-ghost px-3 py-2 rounded-xl text-xs font-medium">Cuota mínima</button>
        <button onClick={() => setAmount(remaining)} className="btn-ghost px-3 py-2 rounded-xl text-xs font-medium">Pago total</button>
      </div>
      <TextField label="Nota (opcional)" value={note} onChange={setNote} placeholder="Ej. Mes de octubre" />
      <button onClick={() => onPay(amount, note)} disabled={amount <= 0 || amount > remaining} className="btn-primary w-full rounded-2xl py-3.5 text-base font-semibold">Registrar {formatMoney(amount, currency)}</button>
    </div>
  );
}

// ============================================================================
//  MOVEMENTS
// ============================================================================
// === BudgetEditor: small sheet to set a monthly limit on an expense category ===
function BudgetEditor({ categoryName, color, currentLimit, currentSpend, currency, onSave, onClear }) {
  const [amount, setAmount] = useState(currentLimit);
  const remaining = amount > 0 ? Math.max(0, amount - currentSpend) : 0;
  const over = amount > 0 && currentSpend > amount;
  const pct = amount > 0 ? Math.min(100, (currentSpend / amount) * 100) : 0;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>Este mes en {categoryName}</p>
        <p className="display-font tabular" style={{ fontSize: 24, fontWeight: 500, color: 'var(--text)' }}>{formatMoney(currentSpend, currency)}</p>
        {currentLimit > 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Tope actual: {formatMoney(currentLimit, currency)}</p>
        )}
      </div>

      <div>
        <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Tope mensual</span>
        <MoneyInput value={amount} onChange={setAmount} currency={currency} />
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Cuando el gasto del mes supere este tope, te lo avisamos en la lista. Pon 0 para quitar el tope.</p>
      </div>

      {amount > 0 && (
        <div className="rounded-2xl p-3" style={{ background: over ? 'var(--danger-glow)' : 'var(--surface)', border: `1px solid ${over ? 'rgba(248,113,113,0.25)' : 'var(--border)'}` }}>
          <div className="flex justify-between text-xs mb-2">
            <span style={{ color: 'var(--text-dim)' }}>Llevas {pct.toFixed(0)}%</span>
            <span className="tabular" style={{ color: over ? 'var(--danger)' : 'var(--primary)', fontWeight: 600 }}>
              {over ? `+${formatMoney(currentSpend - amount, currency)} encima` : `${formatMoney(remaining, currency)} restantes`}
            </span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%`, background: over ? 'var(--danger)' : pct > 80 ? 'var(--warning)' : color || 'var(--primary)' }} />
          </div>
        </div>
      )}

      <button onClick={() => onSave(amount)} disabled={amount < 0} className="btn-primary w-full rounded-2xl py-3.5 text-base font-semibold">
        {currentLimit > 0 ? 'Actualizar tope' : 'Guardar tope'}
      </button>
      {currentLimit > 0 && (
        <button onClick={onClear} className="w-full rounded-2xl py-3 text-sm font-medium" style={{ background: 'var(--danger-glow)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.2)' }}>Quitar tope</button>
      )}
    </div>
  );
}

function MovementsScreen({ data, currency, hideAmounts, onSave, onDelete, onBulkAdd, onSetBudget }) {
  const [type, setType] = useState('income');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [budgetSheet, setBudgetSheet] = useState(null); // { categoryId, name }
  const currentMonthKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const items = type === 'income' ? data.incomes : data.expenses;
  // Split: "constant" = things that hit every month (monthly/biweekly/weekly).
  //        "extras"   = things averaged across the year (biannual/annual/once-this-year).
  // This is what users mentally call "what arrives in my account each month" vs "bonuses/primas".
  const constantTotal = items.filter(x => x.active && (!x.frequency || x.frequency === 'monthly' || x.frequency === 'biweekly' || x.frequency === 'weekly'))
    .reduce((s,x) => s + getMonthlyEquivalent(x), 0);
  const extrasTotal = items.filter(x => x.active && (x.frequency === 'biannual' || x.frequency === 'annual' || x.frequency === 'once'))
    .reduce((s,x) => s + getMonthlyEquivalent(x), 0);
  const total = constantTotal + extrasTotal; // (kept for backward compat in this scope)
  const byCategory = useMemo(() => {
    const map = {};
    items.filter(x => x.active).forEach(x => {
      const cat = getCategory(type, x.category);
      const k = cat.id;
      if (!map[k]) map[k] = { ...cat, total: 0, count: 0 };
      map[k].total += getMonthlyEquivalent(x);
      map[k].count += 1;
    });
    return Object.values(map).sort((a,b) => b.total - a.total);
  }, [items, type]);

  // This-month real vs pending for the selected type
  const monthBreakdown = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const monthConf = (data.confirmations && data.confirmations[monthKey]) || {};
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0); monthEnd.setHours(23,59,59,999);
    let confirmed = 0, pending = 0;
    const prefix = type === 'income' ? 'inc-' : 'exp-';
    items.filter(x => x.active).forEach(x => {
      const freq = x.frequency || 'monthly';
      let amt = 0;
      if (freq === 'monthly') amt = x.amount || 0;
      else if (freq === 'biweekly') amt = (x.amount || 0) * 2.17;
      else if (freq === 'weekly') amt = (x.amount || 0) * 4.33;
      else if (freq === 'biannual') {
        let hits = 0;
        [x.firstPayment, x.secondPayment].forEach(p => {
          if (!p) return;
          const d = new Date(monthStart.getFullYear(), p.month - 1, p.day);
          if (d >= monthStart && d <= monthEnd) hits++;
        });
        amt = (x.amount || 0) * hits;
      }
      else if (freq === 'annual' && x.annualMonth) {
        const d = new Date(monthStart.getFullYear(), x.annualMonth - 1, x.annualDay || 1);
        if (d >= monthStart && d <= monthEnd) amt = x.amount || 0;
      }
      else if (freq === 'once' && x.onceDate) {
        const d = parseLocalDate(x.onceDate);
        if (d >= monthStart && d <= monthEnd) amt = x.amount || 0;
      }
      if (amt <= 0) return;
      const isConf = !!monthConf[`${prefix}${x.id}-${monthKey}`];
      if (isConf) confirmed += amt;
      else pending += amt;
    });
    return { confirmed, pending, hasAny: confirmed > 0 };
  }, [items, type, data.confirmations]);

  return (
    <div className="px-5 pb-32 space-y-4 stagger">
      <div className="animate-slideup" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <button onClick={() => setType('income')} style={{
          flex: 1, padding: '10px 0', borderRadius: 10,
          fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          transition: 'all 0.2s var(--ease-soft)', cursor: 'pointer',
          background: type === 'income' ? 'linear-gradient(180deg, var(--primary-glow), rgba(52,211,153,0.04))' : 'transparent',
          border: type === 'income' ? '1px solid rgba(52,211,153,0.3)' : '1px solid transparent',
          color: type === 'income' ? 'var(--primary)' : 'var(--text-dim)',
        }}><ArrowUp size={14} strokeWidth={2.4} /> Ingresos</button>
        <button onClick={() => setType('expense')} style={{
          flex: 1, padding: '10px 0', borderRadius: 10,
          fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          transition: 'all 0.2s var(--ease-soft)', cursor: 'pointer',
          background: type === 'expense' ? 'linear-gradient(180deg, var(--danger-glow), rgba(248,113,113,0.04))' : 'transparent',
          border: type === 'expense' ? '1px solid rgba(248,113,113,0.3)' : '1px solid transparent',
          color: type === 'expense' ? 'var(--danger)' : 'var(--text-dim)',
        }}><ArrowDown size={14} strokeWidth={2.4} /> Egresos</button>
      </div>
      <div className="animate-slideup card-hero" style={{
        padding: '22px 22px',
        background: type === 'income'
          ? 'linear-gradient(160deg, #0F2E22 0%, #0A1A2E 60%, #07090F 100%)'
          : 'linear-gradient(160deg, #2E0F1A 0%, #1A0E2E 60%, #0E0710 100%)',
      }}>
        <div style={{
          position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: '50%',
          background: `radial-gradient(circle, ${type === 'income' ? 'var(--primary)' : 'var(--danger)'}, transparent 65%)`,
          opacity: 0.18, filter: 'blur(8px)', pointerEvents: 'none',
        }} />
        <div className="flex items-center gap-1.5 mb-3">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: type === 'income' ? 'var(--primary)' : 'var(--danger)', boxShadow: `0 0 10px ${type === 'income' ? 'var(--primary)' : 'var(--danger)'}` }} />
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{type === 'income' ? 'Llega cada mes' : 'Sale cada mes'}</p>
        </div>
        <h2 className="display-font animate-count tabular" style={{
          fontSize: 36, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1,
          color: type === 'income' ? 'var(--primary)' : 'var(--danger)',
        }}>
          {type === 'income' ? '+' : '−'}{formatMoney(constantTotal, currency, hideAmounts)}
        </h2>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontWeight: 500 }}>
          Solo lo que se repite cada mes (mensual, quincenal, semanal)
        </p>
        {extrasTotal > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed rgba(255,255,255,0.06)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              + Primas y {type === 'income' ? 'bonos puntuales' : 'gastos puntuales'} (promedio /12 meses)
            </span>
            <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)' }}>
              {formatCompact(extrasTotal, currency, hideAmounts)}
            </span>
          </div>
        )}
        {monthBreakdown.hasAny && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={12} color="var(--primary)" strokeWidth={2.5} />
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500 }}>{type === 'income' ? 'Recibido este mes' : 'Pagado este mes'}</span>
              </div>
              <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--primary)' }}>{formatCompact(monthBreakdown.confirmed, currency, hideAmounts)}</span>
            </div>
            {monthBreakdown.pending > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={12} color="var(--text-muted)" strokeWidth={2.5} />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500 }}>Pendiente</span>
                </div>
                <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)' }}>{formatCompact(monthBreakdown.pending, currency, hideAmounts)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {byCategory.length > 0 && (
        <div className="animate-slideup" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingLeft: 4 }}>
            <h3 className="display-font" style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.02em' }}>Por categoría</h3>
            {type === 'expense' && <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Toca para presupuestar</p>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {byCategory.map(cat => {
              const pct = total > 0 ? (cat.total / total) * 100 : 0;
              const Icon = cat.icon;
              const budget = type === 'expense' ? getBudgetStatus(data, cat.id, currentMonthKey) : null;
              const cardProps = type === 'expense'
                ? { onClick: () => setBudgetSheet({ categoryId: cat.id, name: cat.name, color: cat.color }), className: 'card card-press', style: { padding: 14, textAlign: 'left', cursor: 'pointer' } }
                : { className: 'card', style: { padding: 14 } };
              const Tag = type === 'expense' ? 'button' : 'div';
              return (
                <Tag key={cat.id} {...cardProps}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: `${cat.color}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={13} color={cat.color} strokeWidth={2.4} /></div>
                    <span className="truncate" style={{ fontSize: 12, fontWeight: 500 }}>{cat.name}</span>
                  </div>
                  <p className="tabular" style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>{formatCompact(cat.total, currency, hideAmounts)}</p>
                  {budget ? (
                    <>
                      <div className="progress-track" style={{ height: 4, marginTop: 8 }}>
                        <div className="progress-fill" style={{ width: `${Math.min(100, budget.pct)}%`, background: budget.over ? 'var(--danger)' : budget.pct > 80 ? 'var(--warning)' : 'var(--primary)' }} />
                      </div>
                      <p className="tabular" style={{ fontSize: 10, color: budget.over ? 'var(--danger)' : 'var(--text-muted)', marginTop: 4, fontWeight: 500 }}>
                        {budget.over ? `+${formatCompact(budget.spent - budget.limit, currency, hideAmounts)} sobre tope` : `de ${formatCompact(budget.limit, currency, hideAmounts)} · ${budget.pct.toFixed(0)}%`}
                      </p>
                    </>
                  ) : (
                    <p className="tabular" style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>{pct.toFixed(0)}%{type === 'expense' ? ' · sin tope' : ''}</p>
                  )}
                </Tag>
              );
            })}
          </div>
        </div>
      )}

      {/* Budget editor sheet */}
      <Sheet open={!!budgetSheet} onClose={() => setBudgetSheet(null)} title={budgetSheet ? `Tope para ${budgetSheet.name}` : ''} size="md">
        {budgetSheet && (
          <BudgetEditor
            categoryName={budgetSheet.name}
            color={budgetSheet.color}
            currentLimit={((data.budgets || {})[budgetSheet.categoryId]) || 0}
            currentSpend={getCategorySpend(data, budgetSheet.categoryId, currentMonthKey)}
            currency={currency}
            onSave={(amount) => { onSetBudget(budgetSheet.categoryId, amount); setBudgetSheet(null); }}
            onClear={() => { onSetBudget(budgetSheet.categoryId, 0); setBudgetSheet(null); }}
          />
        )}
      </Sheet>

      <div className="animate-slideup" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 4 }}>
          <h3 className="display-font" style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.02em' }}>Mis {type === 'income' ? 'ingresos' : 'egresos'}</h3>
          {type === 'expense' && (
            <button onClick={() => setServicesOpen(true)} style={{ fontSize: 12, fontWeight: 500, color: 'var(--primary)', background: 'none', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Sparkles size={12} /> Servicios rápidos
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Aún sin {type === 'income' ? 'ingresos' : 'egresos'} registrados.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map(item => {
              const cat = getCategory(type, item.category);
              const Icon = cat.icon;
              return (
                <button key={item.id} onClick={() => setEditing(item)} className="card card-press" style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                  opacity: item.active ? 1 : 0.55,
                }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: `${cat.color}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={15} color={cat.color} strokeWidth={2.4} /></div>
                  <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                    <p className="truncate" style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: '-0.005em' }}>{item.name}</p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, fontWeight: 500 }}>{cat.name} · {item.frequency === 'once' ? (item.onceDate ? `Una vez · ${formatDateShort(parseLocalDate(item.onceDate))}` : 'Una vez') : item.frequency === 'biannual' ? `Semestral` : item.frequency === 'annual' ? `Anual` : `día ${item.dayOfMonth} · ${item.frequency === 'monthly' ? 'Mensual' : item.frequency === 'biweekly' ? 'Quincenal' : 'Semanal'}`}</p>
                    {item.notes && <p className="truncate" style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 1, fontStyle: 'italic' }}>// {item.notes}</p>}
                    {isItemLastMonth(item, new Date().getFullYear(), new Date().getMonth()) && <p style={{ fontSize: 10.5, color: 'var(--warning)', marginTop: 1, fontWeight: 600 }}>⚠ último mes · recuerda cancelar</p>}
                  </div>
                  <span className="tabular" style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', color: type === 'income' ? 'var(--primary)' : 'var(--danger)' }}>{type === 'income' ? '+' : '−'}{formatCompact(item.amount, currency, hideAmounts)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button onClick={() => setCreating(true)} className="fab" aria-label={`Añadir ${type}`}><Plus size={24} strokeWidth={2.5} /></button>

      <Sheet open={creating || !!editing} onClose={() => { setCreating(false); setEditing(null); }} title={editing ? `Editar ${type === 'income' ? 'ingreso' : 'egreso'}` : `Nuevo ${type === 'income' ? 'ingreso' : 'egreso'}`} size="lg">
        <MovementForm type={type} initial={editing} currency={currency} onSave={(item, opts) => { onSave(type, item, opts); setCreating(false); setEditing(null); }} onDelete={editing ? () => { onDelete(type, editing.id); setEditing(null); } : null} />
      </Sheet>
      <Sheet open={servicesOpen} onClose={() => setServicesOpen(false)} title="Servicios rápidos" size="lg">
        <ServicesSetup currency={currency} existing={data.expenses} onSave={(items) => { onBulkAdd(items); setServicesOpen(false); }} />
      </Sheet>
    </div>
  );
}

function ServicesSetup({ currency, existing, onSave }) {
  const [items, setItems] = useState(() => {
    return SERVICES_PRESETS.map(p => {
      const found = existing.find(e => e.name.toLowerCase() === p.name.toLowerCase());
      return { ...p, enabled: !!found, amount: found ? found.amount : 0, dayOfMonth: found ? found.dayOfMonth : p.day, existingId: found ? found.id : null };
    });
  });
  const update = (id, k, v) => setItems(arr => arr.map(it => it.id === id ? { ...it, [k]: v } : it));
  const enabledCount = items.filter(i => i.enabled).length;
  const total = items.filter(i => i.enabled).reduce((s,i) => s + i.amount, 0);
  const handleSave = () => {
    const toSave = items.filter(i => i.enabled && i.amount > 0).map(i => ({
      id: i.existingId || uid(),
      name: i.name,
      amount: i.amount,
      category: i.category,
      frequency: 'monthly',
      dayOfMonth: i.dayOfMonth,
      active: true,
    }));
    onSave(toSave);
  };
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Activa los servicios que pagas mensualmente, ingresa el monto y el día. Puedes editarlos después.</p>
      </div>
      {items.map(item => {
        const Icon = item.icon;
        return (
          <div key={item.id} className="rounded-2xl p-3" style={{ background: 'var(--surface)', border: `1px solid ${item.enabled ? item.color + '55' : 'var(--border)'}`, opacity: item.enabled ? 1 : 0.65 }}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${item.color}22` }}><Icon size={16} color={item.color} /></div>
              <span className="flex-1 font-medium">{item.name}</span>
              <button onClick={() => update(item.id, 'enabled', !item.enabled)} className="relative" style={{ width: '2.5rem', height: '1.4rem', borderRadius: '9999px', background: item.enabled ? 'var(--primary)' : 'var(--border)', border: 'none', transition: 'background-color 0.2s' }}>
                <span style={{ position: 'absolute', top: '2px', left: '2px', width: '1rem', height: '1rem', borderRadius: '9999px', background: '#fff', transition: 'transform 0.2s', transform: item.enabled ? 'translateX(20px)' : 'translateX(0)' }} />
              </button>
            </div>
            {item.enabled && (
              <div className="grid grid-cols-3 gap-2 mt-2 animate-fadein">
                <div className="col-span-2"><MoneyInput value={item.amount} onChange={v => update(item.id, 'amount', v)} currency={currency} placeholder="Monto" /></div>
                <DayInput value={item.dayOfMonth} onChange={v => update(item.id, 'dayOfMonth', v)} className="text-center" />
              </div>
            )}
          </div>
        );
      })}
      {enabledCount > 0 && (
        <div className="rounded-2xl p-3 flex justify-between items-center" style={{ background: 'var(--primary-glow)', border: '1px solid rgba(52,211,153,0.3)' }}>
          <span className="text-sm font-medium">Total mensual</span>
          <span className="display-font text-lg font-semibold tabular" style={{ color: 'var(--primary)' }}>{formatMoney(total, currency)}</span>
        </div>
      )}
      <button onClick={handleSave} disabled={enabledCount === 0 || items.some(i => i.enabled && i.amount <= 0)} className="btn-primary w-full rounded-2xl py-3.5 text-base font-semibold sticky" style={{ bottom: '1rem' }}>Guardar {enabledCount} servicio{enabledCount !== 1 ? 's' : ''}</button>
    </div>
  );
}

function MovementForm({ type, initial, currency, onSave, onDelete }) {
  const today = new Date().toISOString().slice(0, 10);
  const todayDate = new Date(); todayDate.setHours(0,0,0,0);
  // Default anchor: today (means "next payment is today" → day-of-month = today's day)
  const defaultForm = {
    id: uid(), name: '', amount: 0, category: CATEGORIES[type][0].id,
    frequency: 'monthly', dayOfMonth: new Date().getDate(),
    anchorDate: today, // NEW: real date that anchors the recurring schedule
    active: true,
    adjustForBusinessDay: type === 'income',
    firstPayment: { month: 6, day: 30 }, secondPayment: { month: 12, day: 20 },
    annualMonth: 12,
    onceDate: today,
    notes: '',        // e.g. "mensual fijo", "último mes de la promoción"
    startDate: '',    // vigencia: empieza a contar desde este mes
    endDate: '',      // vigencia: deja de contar después de este mes
  };
  // Backfill anchorDate for items created before this field existed
  const initialFilled = initial ? { ...defaultForm, ...initial } : defaultForm;
  if (initial && !initial.anchorDate && (initial.frequency === 'monthly' || initial.frequency === 'biweekly' || !initial.frequency)) {
    const d = initial.dayOfMonth || 1;
    initialFilled.anchorDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), Math.min(d, 28)).toISOString().slice(0, 10);
  }
  const [form, setForm] = useState(initialFilled);
  const [paidThisMonth, setPaidThisMonth] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const update = (k, v) => setForm(s => ({ ...s, [k]: v }));
  // Sync dayOfMonth with anchorDate so the rest of the app keeps working
  const updateAnchor = (isoDate) => {
    if (!isoDate) { update('anchorDate', ''); return; }
    const parts = isoDate.split('-').map(Number);
    const day = parts[2] || 1;
    setForm(s => ({ ...s, anchorDate: isoDate, dayOfMonth: day }));
  };
  const updatePayment = (which, k, v) => setForm(s => ({ ...s, [which]: { ...s[which], [k]: v } }));
  const valid = form.name.trim() && form.amount > 0 && (form.frequency !== 'once' || form.onceDate);
  const monthlyEq = getMonthlyEquivalent(form);
  const nextDate = useMemo(() => { try { return getNextOccurrenceDate(form); } catch (e) { return null; } }, [form]);
  // Has the day-of-month already passed for the current month?
  const dayAlreadyPassed = useMemo(() => {
    if (form.frequency !== 'monthly') return false;
    const d = Math.min(form.dayOfMonth || 1, 28);
    return d < todayDate.getDate();
  }, [form.dayOfMonth, form.frequency]);
  const monthOptions = [
    {value:1,label:'Enero'},{value:2,label:'Febrero'},{value:3,label:'Marzo'},{value:4,label:'Abril'},
    {value:5,label:'Mayo'},{value:6,label:'Junio'},{value:7,label:'Julio'},{value:8,label:'Agosto'},
    {value:9,label:'Septiembre'},{value:10,label:'Octubre'},{value:11,label:'Noviembre'},{value:12,label:'Diciembre'},
  ];
  const usePrimaPreset = () => setForm(s => ({ ...s, name: s.name || 'Prima', frequency: 'biannual', firstPayment: { month: 6, day: 30 }, secondPayment: { month: 12, day: 20 } }));
  const submit = () => onSave(form, { paidThisMonth: paidThisMonth && (form.frequency === 'monthly' || form.frequency === 'biweekly') });

  return (
    <div className="space-y-4">
      <TextField label="Nombre" value={form.name} onChange={v => update('name', v)} placeholder={type === 'income' ? (form.frequency === 'once' ? 'Ej. Regalo de mi tío' : 'Ej. Salario empresa') : (form.frequency === 'once' ? 'Ej. Cuenta médica' : 'Ej. Arriendo')} />
      <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Monto</span><MoneyInput value={form.amount} onChange={v => update('amount', v)} currency={currency} /></div>
      <div>
        <span className="text-xs font-medium block mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Categoría</span>
        <div className="grid grid-cols-4 gap-2">
          {CATEGORIES[type].map(c => {
            const Icon = c.icon;
            const sel = form.category === c.id;
            return (
              <button key={c.id} onClick={() => update('category', c.id)} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all" style={{ background: sel ? `${c.color}22` : 'var(--surface)', border: sel ? `1px solid ${c.color}` : '1px solid var(--border)' }}>
                <Icon size={16} color={sel ? c.color : 'var(--text-dim)'} />
                <span className="text-[10px] font-medium text-center leading-tight">{c.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="text-xs font-medium block mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>¿Cada cuánto se repite?</span>
        <div className="grid grid-cols-2 gap-2 mb-2">
          {[
            { v: 'monthly', l: 'Mensual' },
            { v: 'biweekly', l: 'Quincenal' },
            { v: 'biannual', l: type === 'income' ? 'Semestral (prima)' : 'Cada 6 meses' },
            { v: 'annual', l: 'Anual' },
            { v: 'once', l: 'Una sola vez', span: 2 },
          ].map(o => (
            <button key={o.v} onClick={() => update('frequency', o.v)} className="rounded-xl py-2.5 text-sm font-medium" style={{ gridColumn: o.span === 2 ? 'span 2' : 'span 1', background: form.frequency === o.v ? 'var(--primary-glow)' : 'var(--surface)', border: form.frequency === o.v ? '1px solid var(--primary)' : '1px solid var(--border)', color: form.frequency === o.v ? 'var(--primary)' : 'var(--text)' }}>{o.l}</button>
          ))}
        </div>
        {type === 'income' && form.frequency !== 'biannual' && form.frequency !== 'once' && (
          <button onClick={usePrimaPreset} className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--accent)', background: 'none', border: 'none' }}><Sparkles size={11} /> Usar plantilla "Prima Colombia"</button>
        )}
      </div>

      {form.frequency === 'once' && (
        <div className="animate-fadein space-y-3">
          <div className="rounded-2xl p-3 text-xs" style={{ background: 'var(--surface)', border: '1px solid rgba(167,139,250,0.25)', color: 'var(--text-dim)' }}>
            <p>{type === 'income' ? 'Para ingresos puntuales: regalos, ventas únicas, ayudas, devoluciones, bonos no recurrentes.' : 'Para gastos puntuales: cuentas médicas, regalos, viajes únicos, devoluciones, multas.'} Solo afecta el mes en que ocurre.</p>
          </div>
          <div>
            <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Fecha del {type === 'income' ? 'ingreso' : 'gasto'}</span>
            <input type="date" value={form.onceDate || ''} onChange={e => update('onceDate', e.target.value)} className="input-base w-full rounded-xl px-4 py-3 text-base" style={{ colorScheme: 'dark' }} />
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Puede ser una fecha pasada (para registrar lo que ya recibiste/gastaste) o futura (para algo planeado).</p>
          </div>
        </div>
      )}

      {(form.frequency === 'monthly' || form.frequency === 'biweekly') && (
        <div className="space-y-3 animate-fadein">
          <div>
            <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Fecha de {type === 'income' ? 'cobro' : 'pago'}</span>
            <input type="date" value={form.anchorDate || ''} onChange={e => updateAnchor(e.target.value)}
              className="input-base w-full rounded-xl px-4 py-3 text-base"
              style={{ colorScheme: 'dark' }} />
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Pon la fecha del próximo {type === 'income' ? 'cobro' : 'pago'}. El día <strong style={{ color: 'var(--text)' }}>{form.dayOfMonth}</strong> de cada mes se repetirá. Si pones una fecha pasada (ej. el {type === 'income' ? 'salario' : 'arriendo'} ya entró/saliste este mes), abajo te preguntamos si ya pasó.
            </p>
          </div>

          {dayAlreadyPassed && (
            <label className="flex items-start justify-between gap-3 p-3 rounded-xl" style={{ background: paidThisMonth ? 'var(--primary-glow)' : 'var(--surface)', border: paidThisMonth ? '1px solid var(--primary)' : '1px solid var(--border)' }}>
              <div className="flex-1">
                <span className="text-sm font-medium block">¿Ya {type === 'income' ? 'lo recibiste' : 'lo pagaste'} este mes?</span>
                <span className="text-[11px] block mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Hoy es {todayDate.getDate()} y la fecha de {type === 'income' ? 'cobro' : 'pago'} fue el {form.dayOfMonth}. Marca sí para que no aparezca como vencido.
                </span>
              </div>
              <button type="button" onClick={() => setPaidThisMonth(!paidThisMonth)} className="relative flex-shrink-0" style={{ width: '2.75rem', height: '1.5rem', borderRadius: '9999px', background: paidThisMonth ? 'var(--primary)' : 'var(--border)', border: 'none' }}>
                <span style={{ position: 'absolute', top: '2px', left: '2px', width: '1.25rem', height: '1.25rem', borderRadius: '9999px', background: '#fff', transition: 'transform 0.2s', transform: paidThisMonth ? 'translateX(20px)' : 'translateX(0)' }} />
              </button>
            </label>
          )}
        </div>
      )}

      {form.frequency === 'biannual' && (
        <div className="space-y-3 animate-fadein">
          <div className="rounded-2xl p-3 text-xs" style={{ background: 'var(--surface)', border: '1px solid rgba(167,139,250,0.25)', color: 'var(--text-dim)' }}>
            <p>Pagos dos veces al año. Por defecto: prima de junio (30 jun) y diciembre (20 dic).</p>
          </div>
          <div className="rounded-2xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>1er pago</p>
            <div className="grid grid-cols-2 gap-2">
              <SelectField label="" value={form.firstPayment.month} onChange={v => updatePayment('firstPayment', 'month', parseInt(v,10))} options={monthOptions.map(o => ({value:o.value,label:o.label}))} />
              <DayInput value={form.firstPayment.day} onChange={v => updatePayment('firstPayment', 'day', v)} />
            </div>
          </div>
          <div className="rounded-2xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>2do pago</p>
            <div className="grid grid-cols-2 gap-2">
              <SelectField label="" value={form.secondPayment.month} onChange={v => updatePayment('secondPayment', 'month', parseInt(v,10))} options={monthOptions.map(o => ({value:o.value,label:o.label}))} />
              <DayInput value={form.secondPayment.day} onChange={v => updatePayment('secondPayment', 'day', v)} />
            </div>
          </div>
        </div>
      )}

      {form.frequency === 'annual' && (
        <div className="grid grid-cols-2 gap-2 animate-fadein">
          <SelectField label="Mes" value={form.annualMonth} onChange={v => update('annualMonth', parseInt(v,10))} options={monthOptions.map(o => ({value:o.value,label:o.label}))} />
          <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Día</span><DayInput value={form.dayOfMonth} onChange={v => update('dayOfMonth', v)} /></div>
        </div>
      )}

      {form.frequency !== 'once' && (
        <label className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex-1">
            <span className="text-sm font-medium block">Ajustar a día hábil</span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Si cae sábado, domingo o festivo, mover al viernes hábil anterior</span>
          </div>
          <button onClick={() => update('adjustForBusinessDay', !form.adjustForBusinessDay)} className="relative" style={{ width: '2.75rem', height: '1.5rem', borderRadius: '9999px', background: form.adjustForBusinessDay ? 'var(--primary)' : 'var(--border)', border: 'none', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: '2px', left: '2px', width: '1.25rem', height: '1.25rem', borderRadius: '9999px', background: '#fff', transition: 'transform 0.2s', transform: form.adjustForBusinessDay ? 'translateX(20px)' : 'translateX(0)' }} />
          </button>
        </label>
      )}

      <label className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <span className="text-sm font-medium">Activo</span>
        <input type="checkbox" checked={form.active} onChange={e => update('active', e.target.checked)} className="w-5 h-5 rounded accent-emerald-500" />
      </label>

      <TextField label="Nota (como en tu bloc)" value={form.notes} onChange={v => update('notes', v)} placeholder='Ej. "mensual fijo", "último mes de la promoción"' />

      {form.frequency !== 'once' && (
        <details className="rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px 14px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, userSelect: 'none' }}>
            Vigencia (opcional) {form.startDate || form.endDate ? '· configurada' : ''}
          </summary>
          <div className="space-y-3" style={{ marginTop: 12 }}>
            <div>
              <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Empieza a contar desde</span>
              <input type="date" value={form.startDate || ''} onChange={e => update('startDate', e.target.value)} className="input-base w-full rounded-xl px-4 py-3 text-base" style={{ colorScheme: 'dark' }} />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Para gastos que empiezan el próximo ciclo (ej. Netflix desde el 30 de julio). Antes de esta fecha no cuenta.</p>
            </div>
            <div>
              <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Último mes (recordatorio de cancelar)</span>
              <input type="date" value={form.endDate || ''} onChange={e => update('endDate', e.target.value)} className="input-base w-full rounded-xl px-4 py-3 text-base" style={{ colorScheme: 'dark' }} />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Ej. Disney termina la promoción este mes, o Upwork que vas a cancelar. En su último mes verás el aviso "recuerda cancelar" y después deja de contar solo.</p>
            </div>
          </div>
        </details>
      )}

      {valid && (form.frequency !== 'monthly' || form.adjustForBusinessDay) && (
        <div className="rounded-2xl p-3 text-xs" style={{ background: 'var(--primary-glow)', border: '1px solid rgba(52,211,153,0.25)' }}>
          <p style={{ color: 'var(--text-dim)' }}>
            {form.frequency === 'once' && nextDate && <>Se registrará el <span className="font-semibold" style={{ color: 'var(--text)' }}>{formatDate(nextDate)}</span> como un evento único.</>}
            {form.frequency !== 'monthly' && form.frequency !== 'once' && <>Equivalente mensual promedio: <span className="font-semibold tabular" style={{ color: 'var(--text)' }}>{formatMoney(monthlyEq, currency)}</span><br/></>}
            {form.frequency !== 'once' && nextDate && <>Próxima ocurrencia: <span className="font-semibold" style={{ color: 'var(--text)' }}>{formatDate(nextDate)}</span></>}
          </p>
        </div>
      )}

      <button onClick={submit} disabled={!valid} className="btn-primary w-full rounded-2xl py-3.5 text-base font-semibold">{initial ? 'Guardar cambios' : 'Crear'}</button>
      {onDelete && (
        <>
          <button onClick={() => setConfirmDel(true)} className="w-full rounded-2xl py-3 text-sm font-medium" style={{ background: 'var(--danger-glow)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.2)' }}>Eliminar</button>
          <ConfirmDialog open={confirmDel} title="¿Eliminar?" message="Esta acción no se puede deshacer." onCancel={() => setConfirmDel(false)} onConfirm={() => { setConfirmDel(false); onDelete(); }} danger />
        </>
      )}
    </div>
  );
}

// ============================================================================
//  PLANES (Projection + Savings + Plans)
// ============================================================================
function PlanesScreen({ data, currency, hideAmounts, onUpdateSavings, onSavePlan, onDeletePlan }) {
  const { debts, incomes, expenses } = data;
  const [planSheet, setPlanSheet] = useState(null);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [savingsSheet, setSavingsSheet] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState(null);

  const monthlyIncome = incomes.filter(i => i.active).reduce((s,i) => s+getMonthlyEquivalent(i), 0);
  const monthlyExpense = expenses.filter(e => e.active).reduce((s,e) => s+getMonthlyEquivalent(e), 0);
  const activeDebts = debts.filter(d => !d.archived && (d.totalAmount-(d.paidAmount||0)) > 0);
  const monthlyDebtPayment = activeDebts.reduce((s,d) => s+(d.minimumPayment||0), 0);
  const totalDebtRemaining = activeDebts.reduce((s,d) => s+(d.totalAmount-(d.paidAmount||0)), 0);
  const monthlyNet = monthlyIncome - monthlyExpense - monthlyDebtPayment;

  // The dynamic projection - month by month, knowing each debt's end date
  const projection = useMemo(() => buildMonthlyProjection(data, 24), [data]);

  // Smart allocation: distribute each month's flow into life money, buffer, savings, debt
  const allocatedProjection = useMemo(() => {
    const highInterestDebts = activeDebts.filter(d => (d.interestRate || 0) >= 20);
    return buildSmartAllocation(projection, {
      ...data.savings,
      emergencyTarget: monthlyExpense * (data.savings.emergencyMonths || 3),
    }, { highInterestDebts });
  }, [projection, data.savings, monthlyExpense, activeDebts]);

  // Plan-level allocation: distribute monthly savings across all active plans
  const planAllocations = useMemo(() => {
    return buildPlanAllocations(
      data.plans || [],
      allocatedProjection,
      data.savings.current || 0,
      data.savings.goal > 0 ? { amount: data.savings.goal, date: data.savings.goalDate } : null
    );
  }, [data.plans, allocatedProjection, data.savings.current, data.savings.goal, data.savings.goalDate]);

  // Cumulative savings 12 months
  const projection12 = projection.slice(0, 12);
  const projection24 = projection;
  const totalNet12Months = projection12.reduce((s, m) => s + m.cashFlow, 0);
  const cumulativeAt12 = projection12.length ? projection12[projection12.length - 1].cumulativeSavings : (data.savings.current || 0);

  // Find the first month where flow turns positive (if any)
  const firstPositiveMonth = projection.find(m => m.cashFlow >= 0);
  const firstNegativeMonth = projection.find(m => m.cashFlow < 0);
  const allPositive = !firstNegativeMonth;
  const allNegative = !firstPositiveMonth;
  const currentMonthIsNegative = projection[0] && projection[0].cashFlow < 0;
  const futureBetters = currentMonthIsNegative && firstPositiveMonth && projection.indexOf(firstPositiveMonth) > 0;

  // Find when last debt is paid
  const lastDebtMonth = useMemo(() => {
    const withDebts = projection.filter(m => m.debtsOutstanding > 0);
    const allPaid = projection.find(m => m.debtsOutstanding === 0 && projection.indexOf(m) > 0);
    return allPaid;
  }, [projection]);

  const emergencyTarget = monthlyExpense * (data.savings.emergencyMonths || 3);
  const emergencyProgress = emergencyTarget > 0 ? Math.min(100, ((data.savings.current || 0) / emergencyTarget) * 100) : 0;
  const goalProgress = data.savings.goal > 0 ? Math.min(100, ((data.savings.current || 0) / data.savings.goal) * 100) : 0;

  // Smart savings recommendation that uses projection
  const savingsRecommendation = useMemo(() => {
    if (allNegative) return { type: 'danger', text: 'Vas a tener flujo negativo todo el año al ritmo actual. Antes de ahorrar, prioriza reducir gastos o pagar deudas de alto interés.' };
    if (currentMonthIsNegative && futureBetters) {
      const monthsUntilPositive = projection.indexOf(firstPositiveMonth);
      return { type: 'warning', text: `Este mes tu flujo es negativo, pero a partir de ${firstPositiveMonth.fullLabel} (en ${monthsUntilPositive} mes${monthsUntilPositive !== 1 ? 'es' : ''}) cambiarás a positivo cuando termines de pagar deudas. Hasta entonces, evita ahorrar agresivamente.` };
    }
    if (totalDebtRemaining > 0 && activeDebts.some(d => (d.interestRate||0) >= 20)) {
      return { type: 'warning', text: 'Tienes deudas con interés alto (20%+). Pagarlas extra rinde más que ahorrar. Mantén un fondo mínimo y enfócate en deudas.' };
    }
    if (emergencyProgress < 100) {
      const monthlyAvgFlow = totalNet12Months / 12;
      const monthsToEmergency = monthlyAvgFlow > 0 ? Math.ceil((emergencyTarget - (data.savings.current||0)) / monthlyAvgFlow) : 999;
      return { type: 'primary', text: `Tu prioridad: completar el fondo de emergencia (${data.savings.emergencyMonths} meses de gastos = ${formatCompact(emergencyTarget, currency, hideAmounts)}). Al ritmo proyectado lo logras en ${monthsToEmergency} meses.` };
    }
    return { type: 'primary', text: `¡Bien! Tu fondo de emergencia está completo. En 12 meses acumularás ${formatCompact(totalNet12Months, currency, hideAmounts)} extra. Puedes destinarlo a metas, inversión o disfrute.` };
  }, [allNegative, currentMonthIsNegative, futureBetters, firstPositiveMonth, totalDebtRemaining, activeDebts, emergencyProgress, emergencyTarget, totalNet12Months, projection, data.savings, currency, hideAmounts]);

  const hasData = monthlyIncome > 0 || monthlyExpense > 0 || activeDebts.length > 0;

  // Financial context for plan analysis includes the projection
  const financialContext = useMemo(() => {
    // Build summary of all fundable plans for cross-plan awareness
    const today = new Date(); today.setHours(0,0,0,0);
    const allFundablePlans = (data.plans || []).filter(p => {
      if (p.type === 'savings' && p.cost > 0) return true;
      if (p.type === 'purchase' && p.financing === 'own' && p.cost > 0) return true;
      return false;
    }).map(p => ({
      id: p.id, name: p.name, type: p.type,
      targetDate: p.startDate ? parseLocalDate(p.startDate) : null,
      totalNeeded: (p.cost || 0) + (p.penaltyCost || 0),
    }));
    return {
      monthlyNet, monthlyIncome, monthlyExpense,
      currentSavings: data.savings.current || 0,
      projection, allocatedProjection,
      planContributions: planAllocations.planContributions,
      planMonthlyView: planAllocations.monthlyView,
      allFundablePlans,
    };
  }, [monthlyNet, monthlyIncome, monthlyExpense, data.savings.current, data.plans, projection, allocatedProjection, planAllocations]);

  return (
    <div className="px-5 pb-32 space-y-4 stagger">
      {/* Hero: 12-month outlook */}
      <div className="animate-slideup card-hero" style={{
        padding: '24px 22px',
        background: totalNet12Months >= 0
          ? 'linear-gradient(160deg, #0F2E22 0%, #0A1A2E 60%, #07090F 100%)'
          : 'linear-gradient(160deg, #2E0F1A 0%, #1A0E2E 60%, #0E0710 100%)',
      }}>
        <div style={{
          position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: '50%',
          background: `radial-gradient(circle, ${totalNet12Months >= 0 ? 'var(--primary)' : 'var(--danger)'}, transparent 65%)`,
          opacity: 0.18, filter: 'blur(8px)', pointerEvents: 'none',
        }} />
        <div className="flex items-center gap-1.5 mb-3">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: totalNet12Months >= 0 ? 'var(--primary)' : 'var(--danger)', boxShadow: `0 0 10px ${totalNet12Months >= 0 ? 'var(--primary)' : 'var(--danger)'}` }} />
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Próximos 12 meses</p>
        </div>
        <h2 className="display-font animate-count tabular" style={{
          fontSize: 36, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1,
          color: totalNet12Months >= 0 ? 'var(--primary)' : 'var(--danger)',
          marginBottom: 8,
        }}>{totalNet12Months >= 0 ? '+' : ''}{formatMoney(totalNet12Months, currency, hideAmounts)}</h2>
        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          {totalNet12Months >= 0 ? 'Eso es lo que acumularás extra' : 'Ese es el déficit total esperado'} considerando deudas que terminan, primas, gastos anuales y todos tus planes activos.
        </p>
        {(currentMonthIsNegative && futureBetters || lastDebtMonth) && (
          <div style={{ marginTop: 16, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            {currentMonthIsNegative && futureBetters && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Info size={13} color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.45 }}>
                  Este mes estás en rojo, pero <strong style={{ color: 'var(--text)', fontWeight: 600 }}>desde {firstPositiveMonth.fullLabel} cambias a positivo</strong> cuando se reducen tus deudas.
                </p>
              </div>
            )}
            {lastDebtMonth && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <CheckCircle2 size={13} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.45 }}>
                  <strong style={{ color: 'var(--primary)', fontWeight: 600 }}>Libre de deudas en {lastDebtMonth.fullLabel}</strong>. Ese mes sumarás {formatCompact(monthlyDebtPayment, currency, hideAmounts)} extra a tu flujo cada mes.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Smart negative flow advisor (only if negative AND won't fix itself) */}
      {currentMonthIsNegative && !futureBetters && <div className="animate-slideup"><NegativeFlowAdvisor data={data} projection={projection} currency={currency} hideAmounts={hideAmounts} /></div>}

      {/* This month's intelligent allocation plan */}
      {hasData && projection[0] && projection[0].cashFlow > 0 && (
        <div className="animate-slideup">
          <MonthAllocationPlan allocatedProjection={allocatedProjection} planMonthlyView={planAllocations.monthlyView} savings={data.savings} currency={currency} hideAmounts={hideAmounts} />
        </div>
      )}

      {/* Monthly calendar view */}
      {hasData && (
        <div className="animate-slideup">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingLeft: 4 }}>
            <h3 className="display-font" style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.02em' }}>Calendario financiero</h3>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Toca para detalle</span>
          </div>
          <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
            {projection12.map((month, idx) => {
              const isExpanded = expandedMonth === idx;
              const isCurrentMonth = idx === 0;
              return (
                <div key={idx} style={{ borderBottom: idx < 11 ? '1px solid var(--border-soft)' : 'none' }}>
                  <button onClick={() => setExpandedMonth(isExpanded ? null : idx)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 14px', textAlign: 'left',
                    background: isCurrentMonth ? 'rgba(52,211,153,0.04)' : 'transparent',
                    border: 'none', cursor: 'pointer',
                    transition: 'background 0.2s ease',
                  }}>
                    <div style={{ width: 38, textAlign: 'center', flexShrink: 0 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: isCurrentMonth ? 'var(--primary)' : 'var(--text-muted)', letterSpacing: '0.06em' }}>{month.label.split(' ')[0]}</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>'{month.label.split(' ')[1]}</p>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <p style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: '-0.005em' }}>{isCurrentMonth ? 'Este mes' : month.fullLabel.split(' ')[0]}</p>
                        {month.debtsEndingThisMonth.length > 0 && <span className="pill pill-good">Última deuda</span>}
                        {month.planEffects.some(p => p.type === 'lifestyle-start') && <span className="pill pill-info">Plan inicia</span>}
                        {month.planEffects.some(p => p.type === 'purchase') && <span className="pill pill-warn">Compra</span>}
                        {month.planEffects.some(p => p.type === 'loan-payment-start') && <span className="pill pill-bad">Cuota préstamo</span>}
                      </div>
                      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>
                        Ahorrado: {formatCompact(month.cumulativeSavings, currency, hideAmounts)}
                        {month.planEffects.length > 0 && month.planEffects.filter(e => e.amount !== 0).length > 0 && (
                          <span style={{ color: 'var(--accent)' }}> · {month.planEffects.filter(e => e.amount !== 0).map(e => e.name).slice(0,2).join(', ')}</span>
                        )}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p className="tabular" style={{
                        fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em',
                        color: month.cashFlow >= 0 ? 'var(--primary)' : 'var(--danger)',
                      }}>
                        {month.cashFlow >= 0 ? '+' : ''}{formatCompact(month.cashFlow, currency, hideAmounts)}
                      </p>
                    </div>
                    <ChevronRight size={15} color="var(--text-muted)" style={{
                      transform: isExpanded ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.25s var(--ease-spring)',
                      flexShrink: 0,
                    }} />
                  </button>
                  {isExpanded && (
                    <div className="animate-fadein" style={{ padding: '0 14px 14px', background: 'var(--bg-2)' }}>
                      <MonthDetail month={month} currency={currency} hideAmounts={hideAmounts} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Savings */}
      <div className="animate-slideup" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 4 }}>
          <h3 className="display-font" style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.02em' }}>Mis ahorros</h3>
          <button onClick={() => setSavingsSheet(true)} style={{ fontSize: 12, fontWeight: 500, color: 'var(--primary)', background: 'none', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Edit3 size={11} /> Editar
          </button>
        </div>

        <div className="card-hero" style={{
          padding: '22px 22px',
          background: 'linear-gradient(160deg, #0F2E22 0%, #0A1A2E 60%, #07090F 100%)',
        }}>
          <div style={{
            position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: '50%',
            background: 'radial-gradient(circle, var(--primary), transparent 65%)',
            opacity: 0.18, filter: 'blur(8px)', pointerEvents: 'none',
          }} />
          <div className="flex items-center gap-1.5 mb-3">
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', boxShadow: '0 0 10px var(--primary)' }} />
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Ahorros actuales</p>
          </div>
          <h2 className="display-font animate-count tabular" style={{
            fontSize: 36, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1,
            color: 'var(--primary)', marginBottom: 10,
          }}>{formatMoney(data.savings.current || 0, currency, hideAmounts)}</h2>
          <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 18 }}>
            En 12 meses tendrás aproximadamente <span className="tabular" style={{ color: 'var(--text)', fontWeight: 600 }}>{formatMoney(cumulativeAt12, currency, hideAmounts)}</span>
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="flex justify-between" style={{ fontSize: 11, marginBottom: 6 }}>
                <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>Fondo de emergencia ({data.savings.emergencyMonths}m de gastos)</span>
                <span className="tabular" style={{ color: 'var(--text)', fontWeight: 600 }}>{emergencyProgress.toFixed(0)}%</span>
              </div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${emergencyProgress}%` }} /></div>
              <p style={{ fontSize: 10, marginTop: 5, color: 'var(--text-muted)', fontWeight: 500 }}>Meta: {formatCompact(emergencyTarget, currency, hideAmounts)} · colchón para imprevistos</p>
            </div>

            {data.savings.goal > 0 && (
              <div>
                <div className="flex justify-between" style={{ fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>Meta personal</span>
                  <span className="tabular" style={{ color: 'var(--text)', fontWeight: 600 }}>{goalProgress.toFixed(0)}%</span>
                </div>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${goalProgress}%`, background: 'linear-gradient(90deg, var(--accent), var(--primary))' }} /></div>
                <p style={{ fontSize: 10, marginTop: 5, color: 'var(--text-muted)', fontWeight: 500 }}>Meta: {formatCompact(data.savings.goal, currency, hideAmounts)}</p>
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{
          padding: 14, display: 'flex', gap: 12,
          border: `1px solid ${savingsRecommendation.type === 'danger' ? 'rgba(248,113,113,0.3)' : savingsRecommendation.type === 'warning' ? 'rgba(251,191,36,0.3)' : 'rgba(52,211,153,0.3)'}`,
        }}>
          <div style={{ flexShrink: 0, marginTop: 1 }}>
            {savingsRecommendation.type === 'danger' ? <AlertCircle size={15} color="var(--danger)" /> : savingsRecommendation.type === 'warning' ? <AlertCircle size={15} color="var(--warning)" /> : <CheckCircle2 size={15} color="var(--primary)" />}
          </div>
          <p className="text-xs leading-relaxed">{savingsRecommendation.text}</p>
        </div>

        {data.savings.goal > 0 && data.savings.current < data.savings.goal && (
          <Fragment>
            <SavingsAdvisor data={data} projection={projection} allocatedProjection={allocatedProjection} currency={currency} hideAmounts={hideAmounts} />
            <SavingsCalendar allocatedProjection={allocatedProjection} savings={data.savings} currency={currency} hideAmounts={hideAmounts} />
          </Fragment>
        )}
      </div>

      {/* Plans */}
      <div className="animate-slideup" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 4 }}>
          <div>
            <h3 className="display-font" style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.02em' }}>Mis planes</h3>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>Lo que quieres lograr en el futuro</p>
          </div>
          <button onClick={() => setCreatingPlan(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 999,
            fontSize: 12, fontWeight: 600, letterSpacing: '-0.005em',
            color: 'var(--primary)', background: 'var(--primary-glow)',
            border: '1px solid rgba(52,211,153,0.3)',
            transition: 'all 0.2s var(--ease-soft)', cursor: 'pointer',
          }}><Plus size={13} strokeWidth={2.6} /> Nuevo</button>
        </div>

        {/* Plans funding summary */}
        {(data.plans || []).filter(p => (p.type === 'savings' || (p.type === 'purchase' && p.financing === 'own')) && p.cost > 0).length > 0 && (
          <PlansFundingSummary planAllocations={planAllocations} currency={currency} hideAmounts={hideAmounts} />
        )}

        {(data.plans || []).length === 0 ? (
          <div style={{ padding: 22, textAlign: 'center', background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><Target size={24} color="var(--text-muted)" strokeWidth={1.8} /></div>
            <p className="display-font" style={{ fontSize: 15, fontWeight: 500, marginBottom: 4, letterSpacing: '-0.02em' }}>¿Qué quieres lograr?</p>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 14 }}>Comprar algo, mudarte, cambiar de trabajo, ahorrar para un viaje. Te diré si es viable y cuándo.</p>
            <button onClick={() => setCreatingPlan(true)} style={{
              fontSize: 12, fontWeight: 600, padding: '8px 18px', borderRadius: 999,
              color: 'var(--primary)', background: 'var(--primary-glow)',
              border: '1px solid rgba(52,211,153,0.3)', cursor: 'pointer',
            }}>Crear mi primer plan</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(data.plans || []).map(p => <PlanCard key={p.id} plan={p} financialContext={financialContext} currency={currency} hideAmounts={hideAmounts} onTap={() => setPlanSheet(p)} />)}
          </div>
        )}
      </div>

      {/* Chart */}
      {hasData && HAS_CHARTS && (
        <div className="animate-slideup rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="display-font text-base font-semibold mb-1">Cómo crecerán tus ahorros</h3>
          <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>Considera primas, gastos anuales y deudas que terminan</p>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={projection24.map(m => ({ name: m.label, ahorro: Math.round(m.cumulativeSavings), deuda: Math.round(m.debtsOutstanding) }))} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs><linearGradient id="g1p" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34D399" stopOpacity={0.5} /><stop offset="100%" stopColor="#34D399" stopOpacity={0} /></linearGradient></defs>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#5C6788' }} interval={1} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#5C6788' }} tickFormatter={v => formatCompact(v, currency)} />
              <Tooltip contentStyle={{ background: '#1C2440', border: '1px solid #232E4D', borderRadius: 12, fontSize: 12 }} formatter={v => formatMoney(v, currency)} />
              <Area type="monotone" dataKey="ahorro" name="Ahorros" stroke="#34D399" strokeWidth={2} fill="url(#g1p)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {!hasData && (
        <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--surface)', border: '1px dashed var(--border)' }}>
          <div className="flex justify-center mb-3"><TrendingUp size={28} color="var(--text-muted)" /></div>
          <p className="display-font text-lg font-semibold mb-1">Aún sin datos</p>
          <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Añade tus ingresos, egresos y deudas en las otras pestañas. Aquí verás todo conectado.</p>
        </div>
      )}

      <Sheet open={!!planSheet || creatingPlan} onClose={() => { setPlanSheet(null); setCreatingPlan(false); }} title={planSheet ? planSheet.name : 'Nuevo plan'} size="lg">
        <PlanForm initial={planSheet} currency={currency} financialContext={financialContext} hideAmounts={hideAmounts}
          onSave={(plan) => { onSavePlan(plan); setPlanSheet(null); setCreatingPlan(false); }}
          onDelete={planSheet ? () => { onDeletePlan(planSheet.id); setPlanSheet(null); } : null} />
      </Sheet>

      <Sheet open={savingsSheet} onClose={() => setSavingsSheet(false)} title="Mis ahorros" size="md">
        <SavingsForm savings={data.savings} currency={currency} onSave={(s) => { onUpdateSavings(s); setSavingsSheet(false); }} />
      </Sheet>
    </div>
  );
}

// Detail breakdown for one month in the calendar
function MonthDetail({ month, currency, hideAmounts }) {
  return (
    <div className="space-y-2 pt-1">
      {month.income > 0 && (
        <div className="rounded-xl p-2.5" style={{ background: 'rgba(52,211,153,0.08)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--primary)' }}>Ingresos</span>
            <span className="font-semibold tabular text-sm" style={{ color: 'var(--primary)' }}>+{formatMoney(month.income, currency, hideAmounts)}</span>
          </div>
          {month.incomeBreakdown.map((b, i) => (
            <div key={i} className="flex justify-between text-[11px]" style={{ color: 'var(--text-dim)' }}>
              <span>{b.name}</span>
              <span className="tabular">{formatMoney(b.amount, currency, hideAmounts)}</span>
            </div>
          ))}
        </div>
      )}
      {month.expense > 0 && (
        <div className="rounded-xl p-2.5" style={{ background: 'rgba(248,113,113,0.05)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--danger)' }}>Egresos</span>
            <span className="font-semibold tabular text-sm" style={{ color: 'var(--danger)' }}>−{formatMoney(month.expense, currency, hideAmounts)}</span>
          </div>
          {month.expenseBreakdown.slice(0, 6).map((b, i) => (
            <div key={i} className="flex justify-between text-[11px]" style={{ color: 'var(--text-dim)' }}>
              <span>{b.name}</span>
              <span className="tabular">{formatMoney(b.amount, currency, hideAmounts)}</span>
            </div>
          ))}
          {month.expenseBreakdown.length > 6 && <p className="text-[10px] text-center" style={{ color: 'var(--text-muted)' }}>+{month.expenseBreakdown.length - 6} más</p>}
        </div>
      )}
      {month.debtPayment > 0 && (
        <div className="rounded-xl p-2.5" style={{ background: 'rgba(251,191,36,0.05)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--warning)' }}>Deudas</span>
            <span className="font-semibold tabular text-sm" style={{ color: 'var(--warning)' }}>−{formatMoney(month.debtPayment, currency, hideAmounts)}</span>
          </div>
          {month.debtBreakdown.map((b, i) => (
            <div key={i} className="flex justify-between text-[11px]" style={{ color: 'var(--text-dim)' }}>
              <span>{b.name}</span>
              <span className="tabular">{formatMoney(b.amount, currency, hideAmounts)}</span>
            </div>
          ))}
          {month.debtsEndingThisMonth.length > 0 && (
            <p className="text-[10px] mt-1.5 pt-1.5" style={{ color: 'var(--primary)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              ✓ Terminas: {month.debtsEndingThisMonth.join(', ')}
            </p>
          )}
        </div>
      )}
      {month.planEffects.length > 0 && (
        <div className="rounded-xl p-2.5" style={{ background: 'rgba(167,139,250,0.08)' }}>
          <span className="text-[11px] uppercase tracking-wide font-semibold block mb-1" style={{ color: 'var(--accent)' }}>Eventos de planes</span>
          {month.planEffects.map((p, i) => (
            <div key={i} className="flex justify-between text-[11px]" style={{ color: 'var(--text-dim)' }}>
              <span>{p.name}</span>
              {p.amount !== 0 && <span className="tabular" style={{ color: p.amount >= 0 ? 'var(--primary)' : 'var(--danger)' }}>{p.amount >= 0 ? '+' : ''}{formatMoney(p.amount, currency, hideAmounts)}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-between items-center pt-2" style={{ borderTop: '1px solid var(--border-soft)' }}>
        <span className="text-xs font-semibold uppercase tracking-wide">Flujo del mes</span>
        <span className="display-font text-base font-semibold tabular" style={{ color: month.cashFlow >= 0 ? 'var(--primary)' : 'var(--danger)' }}>{month.cashFlow >= 0 ? '+' : ''}{formatMoney(month.cashFlow, currency, hideAmounts)}</span>
      </div>
    </div>
  );
}

function SavingsForm({ savings, currency, onSave }) {
  const [form, setForm] = useState({ ...savings });
  const lifePct = Math.round((form.lifeBudgetPct || 0.15) * 100);
  const bufPct = Math.round((form.bufferPct || 0.10) * 100);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-3 space-y-3" style={{ background: 'var(--primary-glow)', border: '1px solid rgba(52,211,153,0.25)' }}>
        <div className="flex items-center gap-2">
          <Wallet size={14} color="var(--primary)" />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--primary)' }}>Tu plata hoy</span>
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>Cuánto dinero <strong style={{ color: 'var(--text)' }}>tienes ahora mismo</strong> en cuenta + efectivo. Esto es la base del cálculo "Balance real". <em>Actualízalo cuando notes que se desfasa.</em></p>
        <div>
          <span className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Efectivo disponible hoy</span>
          <MoneyInput value={form.currentBalance || 0} onChange={v => setForm(s => ({...s, currentBalance: v, balanceUpdatedAt: new Date().toISOString()}))} currency={currency} />
        </div>
      </div>

      <div>
        <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Ahorros formales (cuenta de ahorros / inversiones)</span>
        <MoneyInput value={form.current} onChange={v => setForm(s => ({...s, current: v}))} currency={currency} />
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Lo que ya tienes guardado y separado para metas. No incluye la plata para gastos del mes.</p>
      </div>

      <div>
        <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Cuánto ahorras cada mes (aparece en tu checklist)</span>
        <MoneyInput value={form.monthlyContribution || 0} onChange={v => setForm(s => ({...s, monthlyContribution: v}))} currency={currency} />
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Como la línea "Ahorro: 2.000.000" de tu bloc. Sale en el checklist del mes como un pago más; al marcarlo, se suma a tus ahorros formales automáticamente.</p>
      </div>

      <div className="rounded-2xl p-3 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <Target size={14} color="var(--accent)" />
          <span className="text-xs font-semibold uppercase tracking-wide">Tu meta de ahorro</span>
        </div>
        <div>
          <span className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>¿Cuánto quieres ahorrar? (opcional)</span>
          <MoneyInput value={form.goal} onChange={v => setForm(s => ({...s, goal: v}))} currency={currency} />
        </div>
        <div>
          <span className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>¿Para cuándo? (opcional)</span>
          <input type="date" value={form.goalDate || ''} onChange={e => setForm(s => ({...s, goalDate: e.target.value}))} className="input-base w-full rounded-xl px-4 py-3 text-base" style={{ colorScheme: 'dark' }} />
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Si pones fecha, la app calcula cuánto ahorrar cada mes considerando tus deudas y planes. Si la dejas vacía, te dirá cuándo lo lograrás al ritmo natural.</p>
        </div>
      </div>

      <div className="rounded-2xl p-3 space-y-3" style={{ background: 'var(--surface)', border: '1px solid rgba(167,139,250,0.25)' }}>
        <div className="flex items-center gap-2">
          <Heart size={14} color="var(--accent)" />
          <span className="text-xs font-semibold uppercase tracking-wide">Dinero para vivir</span>
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>Cuánto del flujo extra mensual reservas para salir, comer rico, hobbies, antojos. <strong style={{ color: 'var(--text)' }}>Esto NO se toca</strong> aunque tengas metas de ahorro grandes — es para que no te sientas privándote.</p>
        <div>
          <div className="flex justify-between mb-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Porcentaje del flujo extra</span>
            <span className="text-xs font-semibold tabular" style={{ color: 'var(--accent)' }}>{lifePct}%</span>
          </div>
          <input type="range" min="0" max="50" step="5" value={lifePct} onChange={e => setForm(s => ({...s, lifeBudgetPct: parseInt(e.target.value, 10) / 100}))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
          <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
            <span>Austero (0%)</span><span>Equilibrio (15%)</span><span>Disfrute (50%)</span>
          </div>
        </div>
        <div>
          <span className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Mínimo absoluto al mes (opcional)</span>
          <MoneyInput value={form.minLifeBudget || 0} onChange={v => setForm(s => ({...s, minLifeBudget: v}))} currency={currency} />
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Sin importar el porcentaje, nunca te recomendaremos vivir con menos de este monto al mes.</p>
        </div>
      </div>

      <div className="rounded-2xl p-3 space-y-3" style={{ background: 'var(--surface)', border: '1px solid rgba(251,191,36,0.25)' }}>
        <div className="flex items-center gap-2">
          <AlertCircle size={14} color="var(--warning)" />
          <span className="text-xs font-semibold uppercase tracking-wide">Reserva para imprevistos</span>
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>Cuánto reservas cada mes para gastos inesperados (un médico, reparación, regalo de último minuto). Va al fondo de emergencia.</p>
        <div>
          <div className="flex justify-between mb-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Porcentaje del flujo extra</span>
            <span className="text-xs font-semibold tabular" style={{ color: 'var(--warning)' }}>{bufPct}%</span>
          </div>
          <input type="range" min="0" max="30" step="5" value={bufPct} onChange={e => setForm(s => ({...s, bufferPct: parseInt(e.target.value, 10) / 100}))} style={{ width: '100%', accentColor: 'var(--warning)' }} />
        </div>
      </div>

      <div>
        <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Fondo de emergencia (meses de gastos)</span>
        <div className="grid grid-cols-3 gap-2">
          {[3, 6, 12].map(m => (
            <button key={m} onClick={() => setForm(s => ({...s, emergencyMonths: m}))} className="rounded-xl py-3 text-sm font-medium transition-all" style={{ background: form.emergencyMonths === m ? 'var(--primary-glow)' : 'var(--surface)', border: form.emergencyMonths === m ? '1px solid var(--primary)' : '1px solid var(--border)', color: form.emergencyMonths === m ? 'var(--primary)' : 'var(--text)' }}>
              {m} meses
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-3 text-xs" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}>
        <div className="flex gap-2"><Info size={14} className="flex-shrink-0 mt-0.5" /><p>El fondo de emergencia recomendado es 3-6 meses de tus gastos fijos. Es lo primero que deberías ahorrar antes de cualquier otra meta personal.</p></div>
      </div>

      <button onClick={() => onSave(form)} className="btn-primary w-full rounded-2xl py-3.5 text-base font-semibold">Guardar</button>
    </div>
  );
}

function calcLoanPayment(principal, annualRate, months) {
  const r = (annualRate || 0) / 100 / 12;
  if (r === 0) return principal / months;
  return principal * r / (1 - Math.pow(1 + r, -months));
}

function analyzePlan(plan, ctx) {
  const cost = plan.cost || 0;
  const monthlyDelta = plan.monthlyDelta || 0;
  const oneTimeCost = (plan.oneTimeCost || 0) + (plan.penaltyCost || 0);
  const cur = plan.currency || 'COP';

  // Build a hypothetical projection WITH this plan included (for the analysis)
  const planStart = plan.startDate ? parseLocalDate(plan.startDate) : null;
  const today = new Date(); today.setHours(0,0,0,0);
  const monthsUntilStart = planStart ? Math.max(0, Math.round((planStart - today) / (30.44 * 86400000))) : 0;

  // Use ctx.projection (already-built without this plan) to know baseline
  const baseProj = ctx.projection || [];
  const projWithPlan = ctx.projectionWithPlan || baseProj;

  if (plan.type === 'lifestyle') {
    const newMonthlyNet = ctx.monthlyNet + monthlyDelta;
    if (monthlyDelta >= 0) {
      // Improving cash flow
      const totalUpfront = oneTimeCost;
      // Projected savings at planStart in baseline
      let savingsAtStart = ctx.currentSavings;
      if (planStart && baseProj.length) {
        const startMonth = baseProj.find(m => m.year === planStart.getFullYear() && m.monthIdx === planStart.getMonth());
        if (startMonth) savingsAtStart = startMonth.cumulativeSavings;
      } else {
        savingsAtStart = ctx.currentSavings + (ctx.monthlyNet * monthsUntilStart);
      }
      const canAffordAtStart = savingsAtStart >= totalUpfront;
      const payback = totalUpfront > 0 && monthlyDelta > 0 ? Math.ceil(totalUpfront / monthlyDelta) : 0;
      const details = [
        `Tu flujo mensual cambiará de ${formatMoney(ctx.monthlyNet, cur)} a ${formatMoney(newMonthlyNet, cur)} (${monthlyDelta > 0 ? '+' : ''}${formatMoney(monthlyDelta, cur)}/mes).`,
      ];
      if (totalUpfront > 0) {
        details.push(`Costo inicial: ${formatMoney(totalUpfront, cur)}${plan.penaltyCost > 0 ? ` (incluye ${formatMoney(plan.penaltyCost, cur)} de penalidad)` : ''}.`);
        if (canAffordAtStart) details.push(`✓ Para ${planStart ? formatDate(planStart) : 'la fecha indicada'} tendrás ${formatMoney(savingsAtStart, cur)} ahorrados — alcanza para el costo inicial.`);
        else details.push(`⚠ Te faltan ${formatMoney(totalUpfront - savingsAtStart, cur)} para esa fecha. Considera moverla más adelante o aumentar tus ahorros.`);
      }
      if (payback > 0) details.push(`Recuperarías el costo inicial en ${payback} meses con el ahorro mensual.`);
      return {
        viability: canAffordAtStart ? 'good' : 'caution',
        title: canAffordAtStart ? '✓ Es viable' : '⚠ Espera o ajusta la fecha',
        details,
      };
    } else {
      // Spending more
      const newCovered = newMonthlyNet >= 0;
      // Check if the new flow is feasible in the projection
      let willStayPositive = true;
      if (projWithPlan.length) {
        for (let i = 0; i < Math.min(12, projWithPlan.length); i++) {
          if (projWithPlan[i].cumulativeSavings < 0) { willStayPositive = false; break; }
        }
      }
      return {
        viability: newCovered && willStayPositive ? 'caution' : 'bad',
        title: newCovered ? '⚠ Reduce tu margen' : '✗ Compromete tu flujo',
        details: [
          `Tu flujo mensual pasaría de ${formatMoney(ctx.monthlyNet, cur)} a ${formatMoney(newMonthlyNet, cur)}.`,
          `Costo extra mensual: ${formatMoney(-monthlyDelta, cur)}.`,
          newCovered ? 'Aún positivo, pero con menos margen para imprevistos.' : 'Tu flujo se vuelve negativo. No recomendable.',
        ],
      };
    }
  }

  if (plan.type === 'savings') {
    // Use plan allocations from ctx (knows about ALL other plans competing for the flow)
    const planContrib = ctx.planContributions && ctx.planContributions[plan.id];
    const targetDate = plan.startDate ? parseLocalDate(plan.startDate) : null;
    const allocProj = ctx.allocatedProjection || baseProj;

    if (planContrib) {
      // We have real allocation data: the engine already decided how much this plan gets each month
      const totalAllocated = planContrib.totalAllocated;
      const status = planContrib.status; // 'funded' | 'underfunded' | 'failed'
      const monthlyAlloc = planContrib.allocations || [];

      const details = [`Meta: ${formatMoney(cost, cur)}${targetDate ? ` para ${formatDate(targetDate)}` : ''}.`];

      // Was this plan in conflict with others?
      const otherActivePlans = (ctx.allFundablePlans || []).filter(p => p.id !== plan.id && p.totalNeeded > 0);
      const closerPlans = otherActivePlans.filter(p => p.targetDate && targetDate && p.targetDate < targetDate);

      if (status === 'funded') {
        // Plan fully covered
        const lastAlloc = monthlyAlloc[monthlyAlloc.length - 1];
        details.push(`Tienes asignados ${formatMoney(totalAllocated, cur)} para esta meta.`);
        if (lastAlloc) details.push(`Estará completa en ${lastAlloc.label}${targetDate && new Date(lastAlloc.year, lastAlloc.month) < targetDate ? ' (antes de tu fecha)' : ''}.`);
        if (closerPlans.length > 0) {
          details.push(`Considera: tienes ${closerPlans.length} otro${closerPlans.length > 1 ? 's' : ''} plan${closerPlans.length > 1 ? 'es' : ''} con fecha más cercana que también recibe${closerPlans.length === 1 ? '' : 'n'} dinero antes que este. La app prioriza el más cercano.`);
        }
        // Show monthly contribution summary
        if (monthlyAlloc.length > 0) {
          const avgMonthly = totalAllocated / monthlyAlloc.length;
          details.push(`En promedio aportas ${formatMoney(avgMonthly, cur)}/mes a este plan. Mira el calendario para el plan exacto.`);
        }
        return { viability: 'good', title: '✓ Vas a lograrlo', details };
      }

      if (status === 'underfunded') {
        const gap = cost - totalAllocated;
        details.push(`Te faltan ${formatMoney(gap, cur)} para esa fecha (al ritmo actual y compitiendo con tus otros planes).`);
        if (otherActivePlans.length > 0) {
          details.push(`Tienes ${otherActivePlans.length} otro${otherActivePlans.length > 1 ? 's' : ''} plan${otherActivePlans.length > 1 ? 'es' : ''} consumiendo parte de tu flujo.`);
        }
        details.push(`Opciones: 1) mover la fecha más adelante, 2) reducir la meta, 3) reducir % para "vivir" o "imprevistos" en Ajustes, 4) revisar si algún otro plan se puede ajustar, o 5) financiar parte con préstamo.`);
        return { viability: 'caution', title: '⚠ No alcanza para esa fecha', details };
      }

      if (status === 'failed') {
        details.push(`Tu fecha objetivo (${targetDate ? formatDate(targetDate) : 'sin fecha'}) ya pasó o tu flujo no permite acumular nada para este plan.`);
        return { viability: 'bad', title: '✗ Fecha imposible', details };
      }
    }

    // Fallback (no plan allocation data yet — used only when plan is being created)
    if (allocProj.length) {
      const monthAtTarget = targetDate ? allocProj.find(m => m.year === targetDate.getFullYear() && m.monthIdx === targetDate.getMonth()) : null;
      if (targetDate && monthAtTarget) {
        const naturalAtTarget = monthAtTarget.allocation ? monthAtTarget.allocation.runningSavings : monthAtTarget.cumulativeSavings;
        const otherCommitments = (ctx.totalOtherCommitments || 0); // amount committed to other plans by target date
        const realAvailable = Math.max(0, naturalAtTarget - otherCommitments);
        const gap = cost - realAvailable;

        const monthsAvailable = allocProj.indexOf(monthAtTarget) + 1;
        const requiredPerMonth = gap > 0 ? Math.ceil(gap / monthsAvailable) : 0;

        if (gap <= 0) {
          return {
            viability: 'good',
            title: '✓ Es viable',
            details: [
              `Meta: ${formatMoney(cost, cur)} para ${formatDate(targetDate)}.`,
              `Tu flujo permite cubrir esto${otherCommitments > 0 ? ' además de tus otros planes activos' : ''}.`,
              `Se reservará automáticamente cuando guardes el plan.`,
            ],
          };
        }
        return {
          viability: requiredPerMonth > 0 && requiredPerMonth <= (ctx.monthlyNet * 0.5) ? 'caution' : 'bad',
          title: '⚠ Necesita ajustes',
          details: [
            `Meta: ${formatMoney(cost, cur)} para ${formatDate(targetDate)} (${monthsAvailable} mes${monthsAvailable !== 1 ? 'es' : ''}).`,
            otherCommitments > 0 ? `Tus otros planes ya comprometen ${formatMoney(otherCommitments, cur)} para esa fecha.` : null,
            `Te faltarían ${formatMoney(gap, cur)} a esa fecha.`,
            `Considera: mover la fecha, reducir la meta, o revisar tus otros planes.`,
          ].filter(Boolean),
        };
      }
      // No date set
      const reach = allocProj.find(m => m.allocation && m.allocation.runningSavings >= cost + (ctx.totalOtherCommitments || 0));
      if (reach) {
        const monthsAway = allocProj.indexOf(reach);
        return {
          viability: monthsAway <= 12 ? 'good' : 'caution',
          title: monthsAway <= 12 ? '✓ Alcanzable' : '⚠ Toma tiempo',
          details: [
            `Meta: ${formatMoney(cost, cur)}.`,
            `Considerando tus otros planes activos, lo lograrás en ${reach.fullLabel} (${monthsAway} mes${monthsAway !== 1 ? 'es' : ''}).`,
            `Si quieres una fecha específica, fíjala arriba.`,
          ],
        };
      }
      return { viability: 'bad', title: '✗ Difícil al ritmo actual', details: ['Junto con tus otros planes activos no alcanzas a juntar este monto en 24 meses.'] };
    }
    if (ctx.monthlyNet <= 0) return { viability: 'bad', title: '✗ Sin capacidad de ahorro', details: ['Tu flujo mensual es 0 o negativo. Primero equilibra tus finanzas.'] };
    const monthsNeeded = Math.ceil((cost - ctx.currentSavings) / Math.max(ctx.monthlyNet, 1));
    return {
      viability: monthsNeeded <= 12 ? 'good' : 'caution',
      title: monthsNeeded <= 12 ? '✓ Alcanzable' : '⚠ Toma tiempo',
      details: [`Necesitas ${formatMoney(cost - ctx.currentSavings, cur)} más.`, `A tu ritmo actual lo logras en ${monthsNeeded} meses.`],
    };
  }

  // Purchase
  const totalCost = cost + (plan.penaltyCost || 0);
  if (plan.financing === 'own') {
    // Use allocated projection if available (more realistic - respects life money)
    const allocProj = ctx.allocatedProjection || baseProj;
    let savingsAtStart = ctx.currentSavings;
    if (planStart && allocProj.length) {
      const startMonth = allocProj.find(m => m.year === planStart.getFullYear() && m.monthIdx === planStart.getMonth());
      if (startMonth) {
        // Use runningSavings (allocation respects life budget) when available
        savingsAtStart = startMonth.allocation ? startMonth.allocation.runningSavings : startMonth.cumulativeSavings;
      }
    }
    if (savingsAtStart >= totalCost) {
      const remaining = savingsAtStart - totalCost;
      const emergencyMin = ctx.monthlyExpense * 3;
      const keepsEmergency = remaining >= emergencyMin;
      return {
        viability: keepsEmergency ? 'good' : 'caution',
        title: keepsEmergency ? '✓ Lo puedes hacer' : '⚠ Drena tu colchón',
        details: [
          `Para ${planStart ? formatDate(planStart) : 'esa fecha'} habrás ahorrado ${formatMoney(savingsAtStart, cur)} (respetando tu dinero para vivir).`,
          `Después de la compra te quedarían ${formatMoney(remaining, cur)}.`,
          keepsEmergency ? `Mantienes un colchón de emergencia adecuado.` : `Quedarías por debajo del colchón mínimo recomendado (${formatMoney(emergencyMin, cur)}). Considera mover la fecha o reducir el costo.`,
        ],
      };
    }
    if (ctx.monthlyNet <= 0) return { viability: 'bad', title: '✗ No es viable', details: ['Tu flujo mensual no permite ahorrar en este momento.'] };
    // Find first month allocation covers it (respecting life money)
    if (allocProj.length) {
      const targetMonth = allocProj.find(m => {
        const saved = m.allocation ? m.allocation.runningSavings : m.cumulativeSavings;
        return saved >= totalCost;
      });
      if (targetMonth) {
        const monthsAway = allocProj.indexOf(targetMonth);
        return {
          viability: monthsAway <= 12 ? 'good' : monthsAway <= 36 ? 'caution' : 'bad',
          title: monthsAway <= 12 ? '✓ Alcanzable' : monthsAway <= 36 ? '⚠ Toma tiempo' : '✗ Largo plazo',
          details: [
            `Necesitas ${formatMoney(totalCost, cur)} (faltan ${formatMoney(totalCost - savingsAtStart, cur)} para tu fecha actual).`,
            `Mejor fecha realista: ${targetMonth.fullLabel} (${monthsAway} mes${monthsAway !== 1 ? 'es' : ''}). Esta fecha respeta tu dinero para vivir y reservas.`,
          ],
        };
      }
    }
    return { viability: 'bad', title: '✗ No alcanzas en 24 meses', details: ['Considera financiarlo, aumentar ingresos, o reducir el porcentaje destinado a "vivir/imprevistos" en Ajustes de Ahorros.'] };
  }
  if (plan.financing === 'loan') {
    const months = plan.loanMonths || 12;
    const rate = plan.loanRate || 0;
    const grace = plan.graceMonths || 0;
    const payment = calcLoanPayment(cost, rate, months);
    const totalPaid = payment * months;
    const interest = totalPaid - cost;
    const newMonthlyNet = ctx.monthlyNet - payment;
    const debtRatio = ctx.monthlyIncome > 0 ? (payment / ctx.monthlyIncome) : 1;
    let viability, title;
    if (newMonthlyNet < 0) { viability = 'bad'; title = '✗ Compromete tu flujo'; }
    else if (debtRatio > 0.3 || newMonthlyNet < ctx.monthlyExpense * 0.1) { viability = 'caution'; title = '⚠ Margen ajustado'; }
    else { viability = 'good'; title = '✓ Manejable'; }
    const firstPaymentDate = planStart ? new Date(planStart.getFullYear(), planStart.getMonth() + grace, 1) : null;
    const lastPaymentDate = planStart ? new Date(planStart.getFullYear(), planStart.getMonth() + grace + months - 1, 1) : null;
    return {
      viability, title,
      details: [
        `Cuota mensual del préstamo: ${formatMoney(payment, cur)} por ${months} meses.`,
        grace > 0 && firstPaymentDate ? `Primera cuota: ${formatDate(firstPaymentDate)} (después de ${grace} mes${grace>1?'es':''} de gracia).` : firstPaymentDate ? `Primera cuota: ${formatDate(firstPaymentDate)}.` : null,
        lastPaymentDate ? `Última cuota: ${formatDate(lastPaymentDate)}.` : null,
        `Pagarás ${formatMoney(interest, cur)} en intereses (${formatMoney(totalPaid, cur)} total).`,
        `Tu flujo mensual durante el préstamo: ${formatMoney(newMonthlyNet, cur)} (antes ${formatMoney(ctx.monthlyNet, cur)}).`,
        debtRatio > 0.3 ? `La cuota representa ${(debtRatio*100).toFixed(0)}% de tus ingresos (recomendado <30%).` : null,
        plan.penaltyCost > 0 ? `Costo extra inicial: ${formatMoney(plan.penaltyCost, cur)}.` : null,
      ].filter(Boolean),
    };
  }
  return { viability: 'caution', title: 'Sin análisis', details: ['Define tipo y financiamiento para un análisis completo.'] };
}

// Shows how this month's flow will be distributed
// Month-by-month savings plan calendar
function SavingsCalendar({ allocatedProjection, savings, currency, hideAmounts }) {
  if (!allocatedProjection || !allocatedProjection.length || !savings.goal) return null;
  const months = allocatedProjection.slice(0, 12);
  const [expanded, setExpanded] = useState(false);

  const totalSaved = months.reduce((s, m) => s + (m.allocation ? m.allocation.savingsContribution : 0), 0);
  const totalLife = months.reduce((s, m) => s + (m.allocation ? m.allocation.lifeMoney : 0), 0);
  const totalBuffer = months.reduce((s, m) => s + (m.allocation ? m.allocation.buffer : 0), 0);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between p-4 text-left" style={{ background: 'none', border: 'none' }}>
        <div className="flex items-center gap-2">
          <Calendar size={14} color="var(--primary)" />
          <span className="display-font text-sm font-semibold uppercase tracking-wide">Tu plan de ahorro mensual</span>
        </div>
        <ChevronRight size={16} color="var(--text-muted)" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      <div className="px-4 pb-3 -mt-1">
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Próximos 12 meses · Toca para ver detalle</p>
      </div>

      {expanded && (
        <div className="animate-fadein">
          <div className="grid grid-cols-3 gap-2 px-4 pb-3">
            <div className="rounded-xl p-2.5 text-center" style={{ background: 'var(--primary-glow)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--primary)' }}>Ahorro 12m</p>
              <p className="font-semibold tabular text-xs">{formatCompact(totalSaved, currency, hideAmounts)}</p>
            </div>
            <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.25)' }}>
              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--accent)' }}>Para vivir</p>
              <p className="font-semibold tabular text-xs">{formatCompact(totalLife, currency, hideAmounts)}</p>
            </div>
            <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.25)' }}>
              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--warning)' }}>Imprevistos</p>
              <p className="font-semibold tabular text-xs">{formatCompact(totalBuffer, currency, hideAmounts)}</p>
            </div>
          </div>

          {months.map((m, idx) => {
            const a = m.allocation;
            if (!a) return null;
            const isCurrent = idx === 0;
            const hasFlow = m.cashFlow > 0;
            const monthName = isCurrent ? 'Este mes' : (m.fullLabel.charAt(0).toUpperCase() + m.fullLabel.slice(1).split(' ').filter((_,i) => i !== 1).join(' '));
            return (
              <div key={idx} className="px-4 py-3" style={{ background: isCurrent ? 'var(--primary-glow)' : 'transparent', borderTop: '1px solid var(--border-soft)' }}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold">{monthName}</p>
                      {isCurrent && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--primary)', color: 'var(--bg)' }}>AHORA</span>}
                      {!hasFlow && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--danger-glow)', color: 'var(--danger)' }}>Mes ajustado</span>}
                    </div>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Disponible este mes: {formatCompact(m.cashFlow, currency, hideAmounts)}</p>
                  </div>
                  {hasFlow && a.savingsContribution > 0 && (
                    <div className="text-right ml-2">
                      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Aporta a meta</p>
                      <p className="display-font text-base font-semibold tabular" style={{ color: 'var(--primary)' }}>{formatMoney(a.savingsContribution, currency, hideAmounts)}</p>
                    </div>
                  )}
                </div>

                {hasFlow && (
                  <>
                    <div className="flex gap-0.5 h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--bg-2)' }}>
                      {a.lifeMoney > 0 && <div style={{ flex: a.lifeMoney, background: 'var(--accent)' }} title="Vivir" />}
                      {a.buffer > 0 && <div style={{ flex: a.buffer, background: 'var(--warning)' }} title="Imprevistos" />}
                      {a.savingsContribution > 0 && <div style={{ flex: a.savingsContribution, background: 'var(--primary)' }} title="A meta" />}
                      {a.debtExtra > 0 && <div style={{ flex: a.debtExtra, background: 'var(--danger)' }} title="Deuda extra" />}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                      {a.lifeMoney > 0 && <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'var(--accent)', marginRight: 4, verticalAlign: 'middle' }} />Vivir {formatCompact(a.lifeMoney, currency, hideAmounts)}</span>}
                      {a.buffer > 0 && <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'var(--warning)', marginRight: 4, verticalAlign: 'middle' }} />Imprev. {formatCompact(a.buffer, currency, hideAmounts)}</span>}
                      {a.debtExtra > 0 && <span><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'var(--danger)', marginRight: 4, verticalAlign: 'middle' }} />Deuda extra {formatCompact(a.debtExtra, currency, hideAmounts)}</span>}
                    </div>
                    {savings.goal > 0 && a.runningSavings > 0 && (
                      <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                        Ahorrado total a fin de mes: <strong className="tabular" style={{ color: 'var(--text)' }}>{formatCompact(a.runningSavings, currency, hideAmounts)}</strong>
                        {' '}({a.goalProgress.toFixed(0)}% de tu meta)
                        {a.goalReached && idx === months.findIndex(mm => mm.allocation && mm.allocation.goalReached) && <span style={{ color: 'var(--primary)' }}> · ✓ ¡Meta lograda!</span>}
                      </p>
                    )}
                  </>
                )}

                {m.planEffects && m.planEffects.length > 0 && (
                  <div className="mt-2 pt-2 space-y-0.5" style={{ borderTop: '1px dashed var(--border-soft)' }}>
                    {m.planEffects.filter(e => e.amount !== 0).map((e, i) => (
                      <p key={i} className="text-[10px] flex items-center gap-1.5" style={{ color: e.amount < 0 ? 'var(--danger)' : 'var(--primary)' }}>
                        <span style={{ width: 4, height: 4, borderRadius: 999, background: 'currentColor', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-dim)' }}>{e.name}:</span>
                        <span className="tabular font-semibold">{e.amount < 0 ? '−' : '+'}{formatCompact(Math.abs(e.amount), currency, hideAmounts)}</span>
                      </p>
                    ))}
                  </div>
                )}
                {m.debtsEndingThisMonth && m.debtsEndingThisMonth.length > 0 && (
                  <p className="text-[10px] mt-1.5" style={{ color: 'var(--primary)' }}>
                    ✓ Pagas última cuota: {m.debtsEndingThisMonth.join(', ')}
                  </p>
                )}
              </div>
            );
          })}

          <div className="p-3" style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--border-soft)' }}>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text)' }}>Cómo leer esto:</strong> cada mes muestra cuánto ahorrar respetando tu vida personal. Los meses con planes activos (cumpleaños, viajes, compras) ahorran menos. Cuando termines deudas, los meses siguientes ahorran más automáticamente.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PlansFundingSummary({ planAllocations, currency, hideAmounts }) {
  const contribs = Object.values(planAllocations.planContributions || {}).filter(c => c.plan.id !== '__main_goal__');
  if (contribs.length === 0) return null;

  const funded = contribs.filter(c => c.status === 'funded');
  const underfunded = contribs.filter(c => c.status === 'underfunded');
  const failed = contribs.filter(c => c.status === 'failed');
  const totalNeeded = contribs.reduce((s, c) => s + c.plan.totalNeeded, 0);
  const totalAllocated = contribs.reduce((s, c) => s + c.totalAllocated, 0);
  const overallProgress = totalNeeded > 0 ? Math.min(100, (totalAllocated / totalNeeded) * 100) : 0;

  const allFundable = underfunded.length === 0 && failed.length === 0;
  const headerColor = allFundable ? 'var(--primary)' : (failed.length > 0 ? 'var(--danger)' : 'var(--warning)');
  const headerBg = allFundable ? 'var(--primary-glow)' : (failed.length > 0 ? 'var(--danger-glow)' : 'rgba(251,191,36,0.15)');

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface)', border: `1px solid ${headerColor}33` }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} color={headerColor} />
          <span className="display-font text-sm font-semibold uppercase tracking-wide" style={{ color: headerColor }}>
            {allFundable ? 'Todos tus planes son viables' : underfunded.length > 0 ? 'Algunos planes necesitan ajustes' : 'Conflicto entre planes'}
          </span>
        </div>
        <span className="text-[10px] tabular" style={{ color: 'var(--text-muted)' }}>{funded.length}/{contribs.length} ✓</span>
      </div>

      <div>
        <div className="flex justify-between text-[11px] mb-1.5">
          <span style={{ color: 'var(--text-dim)' }}>Total reunido entre todos tus planes</span>
          <span className="tabular" style={{ color: 'var(--text)' }}>{formatCompact(totalAllocated, currency, hideAmounts)} / {formatCompact(totalNeeded, currency, hideAmounts)}</span>
        </div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${overallProgress}%` }} /></div>
      </div>

      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
        Tus planes se priorizan por <strong style={{ color: 'var(--text)' }}>fecha más cercana</strong>. La app distribuye automáticamente tu ahorro mensual entre los planes activos.
        {underfunded.length > 0 && <> <strong style={{ color: 'var(--warning)' }}>{underfunded.length} plan{underfunded.length > 1 ? 'es no llegan' : ' no llega'}</strong> al monto requerido a tiempo — al tocarlo te explico qué ajustar.</>}
        {failed.length > 0 && <> <strong style={{ color: 'var(--danger)' }}>{failed.length} plan{failed.length > 1 ? 'es son inviables' : ' es inviable'}</strong> con tu flujo actual.</>}
      </p>
    </div>
  );
}

function MonthAllocationPlan({ allocatedProjection, planMonthlyView, savings, currency, hideAmounts }) {
  if (!allocatedProjection || !allocatedProjection.length) return null;
  const m = allocatedProjection[0];
  if (!m.allocation) return null;
  const a = m.allocation;
  const totalFlow = m.cashFlow;
  const isPositive = totalFlow > 0;
  const thisMonthPlanView = (planMonthlyView && planMonthlyView[0]) ? planMonthlyView[0] : null;
  const perPlan = thisMonthPlanView ? thisMonthPlanView.perPlan : [];

  const blocks = [];
  if (a.lifeMoney > 0) blocks.push({ label: 'Para vivir', amount: a.lifeMoney, color: 'var(--accent)', icon: Heart, desc: 'Salidas, comida fuera, hobbies, antojos. Es tuyo, gástalo.' });
  if (a.buffer > 0) blocks.push({ label: 'Reserva imprevistos', amount: a.buffer, color: 'var(--warning)', icon: AlertCircle, desc: 'Para gastos inesperados (médico, reparaciones). Va a tu fondo de emergencia.' });
  if (a.savingsContribution > 0) blocks.push({
    label: 'A tus ahorros y planes', amount: a.savingsContribution, color: 'var(--primary)', icon: Target,
    desc: perPlan.length > 0 ? `Distribuido entre ${perPlan.length} plan${perPlan.length > 1 ? 'es' : ''} (ver detalle abajo)` : (savings.goal > 0 ? `Va a tu meta de ${formatCompact(savings.goal, currency, hideAmounts)}` : 'Ahorro libre (sin meta definida)'),
    perPlan,
  });
  if (a.debtExtra > 0) blocks.push({ label: 'Pago extra de deuda', amount: a.debtExtra, color: 'var(--danger)', icon: CreditCard, desc: 'Acelera pagar deudas con interés alto' });
  if (a.deficit > 0) blocks.push({ label: 'Faltante', amount: a.deficit, color: 'var(--danger)', icon: AlertCircle, desc: 'Tu flujo es negativo este mes' });

  return (
    <div className="card-elevated" style={{ padding: 18 }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(167,139,250,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Sparkles size={13} color="var(--accent)" strokeWidth={2.4} />
          </div>
          <div>
            <h4 className="display-font" style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.1 }}>Plan de este mes</h4>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginTop: 2 }}>{m.fullLabel}</p>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: 14 }}>
        Después de gastos fijos, deudas y planes, te quedan <strong className="tabular" style={{ color: isPositive ? 'var(--primary)' : 'var(--danger)', fontWeight: 600 }}>{isPositive ? '+' : ''}{formatMoney(totalFlow, currency, hideAmounts)}</strong> libres. Distribuidos así:
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {blocks.map((b, i) => {
          const pct = totalFlow !== 0 ? Math.abs(b.amount / totalFlow * 100) : 0;
          const Icon = b.icon;
          return (
            <div key={i} style={{
              padding: 12, borderRadius: 14,
              background: 'var(--bg-2)', border: `1px solid ${b.color}26`,
            }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                <div className="flex items-center gap-2">
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: `${b.color}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={13} color={b.color} strokeWidth={2.4} />
                  </div>
                  <span style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: '-0.005em' }}>{b.label}</span>
                </div>
                <span className="tabular" style={{ fontSize: 14, fontWeight: 600, color: b.color, letterSpacing: '-0.01em' }}>{formatMoney(b.amount, currency, hideAmounts)}</span>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>{b.desc}</p>
              <div style={{ width: '100%', height: 4, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(100, pct)}%`, height: '100%',
                  background: `linear-gradient(90deg, ${b.color}99, ${b.color})`,
                  transition: 'width 0.8s var(--ease-out)',
                }} />
              </div>
              {b.perPlan && b.perPlan.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px dashed var(--border-soft)' }}>
                  {b.perPlan.map((p, pi) => (
                    <div key={pi} className="flex items-center justify-between gap-2" style={{ fontSize: 11 }}>
                      <span className="flex items-center gap-1.5 min-w-0" style={{ color: 'var(--text-dim)' }}>
                        <span style={{ width: 5, height: 5, borderRadius: 999, background: p.name === 'Meta general' ? 'var(--primary)' : 'var(--accent)', flexShrink: 0 }} />
                        <span className="truncate">{p.name}</span>
                        {p.targetDate && <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}> · {formatDateShort(p.targetDate)}</span>}
                      </span>
                      <span className="tabular flex-shrink-0" style={{ fontWeight: 600, color: 'var(--primary)' }}>+{formatCompact(p.amount, currency, hideAmounts)}</span>
                    </div>
                  ))}
                  {thisMonthPlanView && thisMonthPlanView.unallocated > 0 && (
                    <div className="flex items-center justify-between" style={{ fontSize: 11 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Sin asignar</span>
                      <span className="tabular" style={{ fontWeight: 600, color: 'var(--text-dim)' }}>+{formatCompact(thisMonthPlanView.unallocated, currency, hideAmounts)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {a.lifeMoney > 0 && (
        <div className="rounded-xl p-3" style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)' }}>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
            <strong style={{ color: 'var(--accent)' }}>Importante:</strong> el dinero "para vivir" es tuyo, gástalo en lo que disfrutes. La app no te lo recortará por más metas grandes que tengas — porque ahorrar privándote no funciona.
          </p>
        </div>
      )}
    </div>
  );
}

function SavingsAdvisor({ data, projection, allocatedProjection, currency, hideAmounts }) {
  const goal = data.savings.goal || 0;
  const current = data.savings.current || 0;
  if (goal <= 0 || current >= goal) return null;
  if (!projection || !projection.length) return null;
  if (!allocatedProjection || !allocatedProjection.length) return null;

  // Find when goal will actually be reached with the smart allocation
  const reach = findGoalReachMonth(allocatedProjection, goal);
  const reachMonths = reach ? allocatedProjection.indexOf(reach) + 1 : -1;

  // What the user might've thought (naive: cashFlow without buffer/life)
  const naturalReach = projection.find(m => m.cumulativeSavings >= goal);
  const naturalMonths = naturalReach ? projection.indexOf(naturalReach) + 1 : -1;

  // Difference between naive and realistic
  const monthsDifference = (naturalMonths > 0 && reachMonths > 0) ? reachMonths - naturalMonths : 0;

  // Calculate total contributions across the period
  const periodMonths = reachMonths > 0 && reachMonths <= 24 ? reachMonths : 24;
  const totalLifeMoney = allocatedProjection.slice(0, periodMonths).reduce((s,m) => s + (m.allocation ? m.allocation.lifeMoney : 0), 0);
  const totalBuffer = allocatedProjection.slice(0, periodMonths).reduce((s,m) => s + (m.allocation ? m.allocation.buffer : 0), 0);

  // Goal date from user
  const goalDate = data.savings.goalDate ? parseLocalDate(data.savings.goalDate) : null;
  let goalDateMonthIdx = -1;
  if (goalDate) {
    goalDateMonthIdx = allocatedProjection.findIndex(m => m.year === goalDate.getFullYear() && m.monthIdx === goalDate.getMonth());
  }
  // If goal date is set, did we reach goal by then?
  let onTrackForDate = false;
  let amountAtGoalDate = 0;
  if (goalDateMonthIdx >= 0) {
    amountAtGoalDate = allocatedProjection[goalDateMonthIdx].allocation.runningSavings;
    onTrackForDate = amountAtGoalDate >= goal;
  }

  // Find debt-free month
  const debtFreeIdx = allocatedProjection.findIndex(m => m.debtsOutstanding === 0);
  const debtFreeMonth = debtFreeIdx > 0 ? allocatedProjection[debtFreeIdx] : null;
  const hadDebt = allocatedProjection[0] && allocatedProjection[0].debtPayment > 0;

  let title, color, viability;
  if (goalDateMonthIdx >= 0) {
    if (onTrackForDate) { title = '✓ Llegas a tiempo'; color = 'var(--primary)'; viability = 'good'; }
    else if (amountAtGoalDate >= goal * 0.7) { title = '⚠ Te quedas corto'; color = 'var(--warning)'; viability = 'caution'; }
    else { title = '✗ Difícil para esa fecha'; color = 'var(--danger)'; viability = 'bad'; }
  } else if (reach && reachMonths <= 12) {
    title = '✓ Realista'; color = 'var(--primary)'; viability = 'good';
  } else if (reach && reachMonths <= 36) {
    title = '⚠ Toma tiempo'; color = 'var(--warning)'; viability = 'caution';
  } else {
    title = '✗ Necesita ajustes'; color = 'var(--danger)'; viability = 'bad';
  }

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface)', border: `1px solid ${color}55` }}>
      <div className="flex items-center gap-2">
        <Target size={16} color={color} />
        <h4 className="display-font text-sm font-semibold uppercase tracking-wide" style={{ color }}>{title}</h4>
      </div>

      <p className="text-xs leading-relaxed">Tu meta: <strong className="tabular">{formatMoney(goal, currency, hideAmounts)}</strong>{goalDate ? ` para ${formatDate(goalDate)}` : ''} (te faltan {formatMoney(goal - current, currency, hideAmounts)}).</p>

      {goalDateMonthIdx >= 0 ? (
        <div className="rounded-xl p-3" style={{ background: onTrackForDate ? 'rgba(52,211,153,0.08)' : 'rgba(251,191,36,0.08)', border: `1px solid ${onTrackForDate ? 'rgba(52,211,153,0.25)' : 'rgba(251,191,36,0.25)'}` }}>
          <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Para tu fecha objetivo</p>
          <p className="text-sm">
            {onTrackForDate ? (
              <>Llegarás con <strong style={{ color: 'var(--primary)' }}>{formatMoney(amountAtGoalDate, currency, hideAmounts)}</strong> — eso es {formatMoney(amountAtGoalDate - goal, currency, hideAmounts)} de margen.</>
            ) : (
              <>Solo lograrás juntar <strong style={{ color: 'var(--warning)' }}>{formatMoney(amountAtGoalDate, currency, hideAmounts)}</strong>. Te faltarían <strong className="tabular">{formatMoney(goal - amountAtGoalDate, currency, hideAmounts)}</strong>.</>
            )}
          </p>
        </div>
      ) : reach ? (
        <div className="rounded-xl p-3" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)' }}>
          <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--primary)' }}>Fecha realista</p>
          <p className="text-sm leading-relaxed">Lo lograrás en <strong style={{ color: 'var(--primary)' }}>{reach.fullLabel}</strong> ({reachMonths} mes{reachMonths !== 1 ? 'es' : ''}), <strong>respetando tu dinero para vivir y reservas para imprevistos</strong>.</p>
        </div>
      ) : (
        <div className="rounded-xl p-3" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
          <p className="text-xs">Al ritmo actual no alcanzas en 24 meses respetando tu dinero para vivir. Considera: aumentar ingresos, reducir gastos fijos, o reducir el porcentaje destinado a vivir/imprevistos.</p>
        </div>
      )}

      {monthsDifference > 0 && (
        <div className="rounded-xl p-3" style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)' }}>
          <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>Por qué tarda más de lo que pensabas</p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>
            Si ahorraras <strong>todo</strong> tu flujo extra tardarías {naturalMonths} meses, pero eso significa no salir, no comer rico, y sin reserva para imprevistos. Reservando <strong className="tabular">{formatMoney(totalLifeMoney, currency, hideAmounts)}</strong> para vivir y <strong className="tabular">{formatMoney(totalBuffer, currency, hideAmounts)}</strong> para imprevistos en este período, tarda {monthsDifference} mes{monthsDifference !== 1 ? 'es' : ''} más, pero es <strong style={{ color: 'var(--text)' }}>real y sostenible</strong>.
          </p>
        </div>
      )}

      {hadDebt && debtFreeMonth && debtFreeIdx < periodMonths && (
        <div className="rounded-xl p-3" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)' }}>
          <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--primary)' }}>Plan recomendado</p>
          <p className="text-xs leading-relaxed">
            Hasta <strong>{debtFreeMonth.fullLabel}</strong> ahorra poco a poco mientras pagas deudas (la app te dirá cuánto cada mes en el calendario). Cuando termines de pagarlas, tu flujo se libera y empiezas a ahorrar fuerte.
          </p>
        </div>
      )}
    </div>
  );
}

function NegativeFlowAdvisor({ data, projection, currency, hideAmounts }) {
  const monthlyIncome = data.incomes.filter(i => i.active).reduce((s,i) => s + getMonthlyEquivalent(i), 0);
  const monthlyExpense = data.expenses.filter(e => e.active).reduce((s,e) => s + getMonthlyEquivalent(e), 0);
  const monthlyDebtPayment = data.debts.filter(d => !d.archived && (d.totalAmount-(d.paidAmount||0)) > 0).reduce((s,d) => s + (d.minimumPayment||0), 0);
  const monthlyNet = monthlyIncome - monthlyExpense - monthlyDebtPayment;
  if (monthlyNet >= 0) return null;
  const gap = -monthlyNet;
  const expensesByCategory = {};
  data.expenses.filter(e => e.active).forEach(e => {
    const cat = getCategory('expense', e.category);
    if (!cat) return;
    if (!expensesByCategory[cat.id]) expensesByCategory[cat.id] = { ...cat, total: 0, items: [] };
    expensesByCategory[cat.id].total += getMonthlyEquivalent(e);
    expensesByCategory[cat.id].items.push(e);
  });
  const sorted = Object.values(expensesByCategory).sort((a,b) => b.total - a.total);
  const topCat = sorted[0];

  // Check if there's relief coming from debts ending
  const reliefMonth = projection ? projection.find((m, i) => i > 0 && m.cashFlow >= 0) : null;
  const monthsUntilRelief = reliefMonth && projection ? projection.indexOf(reliefMonth) : null;

  return (
    <div className="rounded-3xl p-5 space-y-3" style={{ background: 'linear-gradient(135deg, #2A0F1A 0%, #1A0E2E 100%)', border: '1px solid rgba(248,113,113,0.3)' }}>
      <div className="flex items-center gap-2">
        <AlertCircle size={18} color="var(--danger)" />
        <h3 className="display-font text-lg font-semibold" style={{ color: 'var(--danger)' }}>Tu flujo será negativo todo el año</h3>
      </div>
      <p className="text-sm">Cada mes gastas <span className="font-semibold tabular" style={{ color: 'var(--danger)' }}>{formatMoney(gap, currency, hideAmounts)}</span> más de lo que ingresas. Para llegar a equilibrio tienes tres caminos:</p>

      <div className="space-y-2 mt-3">
        <div className="rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-1.5"><TrendingUp size={14} color="var(--primary)" /><p className="text-xs font-semibold uppercase tracking-wide">Opción A: aumentar ingresos</p></div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>Necesitas <span className="tabular font-semibold" style={{ color: 'var(--text)' }}>+{formatMoney(gap, currency, hideAmounts)}/mes</span>. Por ejemplo: trabajos freelance, vender cosas que no usas, pedir aumento, segundo trabajo de medio tiempo.</p>
        </div>

        {topCat && (
          <div className="rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-1.5"><ArrowDown size={14} color="var(--warning)" /><p className="text-xs font-semibold uppercase tracking-wide">Opción B: reducir gastos</p></div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>Tu mayor gasto es <span style={{ color: topCat.color, fontWeight: 600 }}>{topCat.name}</span> ({formatMoney(topCat.total, currency, hideAmounts)}/mes). Reducirlo en <span className="tabular font-semibold" style={{ color: 'var(--text)' }}>{Math.min(100, (gap/topCat.total)*100).toFixed(0)}%</span> ({formatMoney(Math.min(gap, topCat.total), currency, hideAmounts)}) cierra la brecha.</p>
          </div>
        )}

        <div className="rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-1.5"><Sparkles size={14} color="var(--accent)" /><p className="text-xs font-semibold uppercase tracking-wide">Opción C: combinar</p></div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>Mitad y mitad: {formatMoney(gap/2, currency, hideAmounts)} en ingresos extras + {formatMoney(gap/2, currency, hideAmounts)} en recortes. Es la opción más realista para la mayoría.</p>
        </div>
      </div>

      {sorted.length > 0 && (
        <div className="pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Tus mayores gastos</p>
          <div className="space-y-1.5">
            {sorted.slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="tabular font-medium">{formatCompact(c.total, currency, hideAmounts)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, financialContext, currency, hideAmounts, onTap }) {
  const analysis = useMemo(() => analyzePlan({ ...plan, currency }, financialContext), [plan, financialContext, currency]);
  const colors = { good: 'var(--primary)', caution: 'var(--warning)', bad: 'var(--danger)' };
  const bgColors = { good: 'var(--primary-glow)', caution: 'rgba(251,191,36,0.15)', bad: 'var(--danger-glow)' };
  const pillClasses = { good: 'pill-good', caution: 'pill-warn', bad: 'pill-bad' };
  const subcat = getPlanSubcategory(plan.type, plan.subcategory);
  const Icon = subcat ? subcat.icon : (plan.type === 'lifestyle' ? ArrowLeftRight : plan.type === 'savings' ? Target : ShoppingBag);
  const iconColor = subcat ? subcat.color : 'var(--accent)';
  const typeLabels = { purchase: 'Compra', lifestyle: 'Cambio', savings: 'Ahorro' };

  const contrib = financialContext.planContributions && financialContext.planContributions[plan.id];
  const showProgress = contrib && contrib.plan && contrib.plan.totalNeeded > 0;
  const progress = showProgress ? Math.min(100, (contrib.totalAllocated / contrib.plan.totalNeeded) * 100) : 0;
  const nextAllocation = showProgress && contrib.allocations && contrib.allocations.length > 0 ? contrib.allocations[0] : null;

  return (
    <button onClick={onTap} className="card card-press" style={{ width: '100%', padding: 16, textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: showProgress ? 12 : 8 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: `${iconColor}1A`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${iconColor}26`,
        }}>
          <Icon size={16} color={iconColor} strokeWidth={2.4} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="truncate" style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{plan.name}</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontWeight: 500 }}>
            {typeLabels[plan.type]}{subcat ? ` · ${subcat.name}` : ''}{plan.cost ? ` · ${formatCompact(plan.cost, currency, hideAmounts)}` : ''}{plan.monthlyDelta ? ` · ${plan.monthlyDelta > 0 ? '+' : ''}${formatCompact(plan.monthlyDelta, currency, hideAmounts)}/mes` : ''}
          </p>
        </div>
        <span className={`pill ${pillClasses[analysis.viability]}`} style={{ flexShrink: 0 }}>{analysis.title}</span>
      </div>

      {showProgress && (
        <div style={{ marginBottom: 8 }}>
          <div className="flex justify-between" style={{ fontSize: 10.5, marginBottom: 5, color: 'var(--text-muted)', fontWeight: 500 }}>
            <span>Reunido {formatCompact(contrib.totalAllocated, currency, hideAmounts)} / {formatCompact(contrib.plan.totalNeeded, currency, hideAmounts)}</span>
            <span className="tabular" style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{progress.toFixed(0)}%</span>
          </div>
          <div className="progress-track" style={{ height: 4 }}><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          {nextAllocation && (
            <p style={{ fontSize: 10.5, marginTop: 6, color: 'var(--text-dim)', fontWeight: 500 }}>
              Próximo aporte en {nextAllocation.label}: <span className="tabular" style={{ color: 'var(--primary)', fontWeight: 600 }}>+{formatCompact(nextAllocation.amount, currency, hideAmounts)}</span>
            </p>
          )}
        </div>
      )}

      <p style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{analysis.details[0]}</p>
    </button>
  );
}

function PlanMonthlySchedule({ planId, financialContext, currency, hideAmounts }) {
  const contrib = financialContext.planContributions[planId];
  if (!contrib) return null;
  const allocations = contrib.allocations || [];
  const fromExisting = contrib.fromExistingSavings || 0;
  const totalAllocated = contrib.totalAllocated;
  const required = contrib.plan.totalNeeded;
  const status = contrib.status;
  const progress = required > 0 ? Math.min(100, (totalAllocated / required) * 100) : 0;

  const statusInfo = {
    funded: { color: 'var(--primary)', bg: 'var(--primary-glow)', label: 'Financiado completo' },
    underfunded: { color: 'var(--warning)', bg: 'rgba(251,191,36,0.15)', label: 'Falta dinero' },
    failed: { color: 'var(--danger)', bg: 'var(--danger-glow)', label: 'Fecha imposible' },
    pending: { color: 'var(--text-dim)', bg: 'var(--surface)', label: 'Pendiente' },
  };
  const info = statusInfo[status] || statusInfo.pending;

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={14} color="var(--primary)" />
          <h4 className="display-font text-sm font-semibold uppercase tracking-wide">Cómo se reúne este plan</h4>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide" style={{ background: info.bg, color: info.color }}>{info.label}</span>
      </div>

      <div>
        <div className="flex justify-between text-xs mb-1.5">
          <span style={{ color: 'var(--text-dim)' }}>Reunido</span>
          <span className="tabular font-semibold">{formatMoney(totalAllocated, currency, hideAmounts)} / {formatMoney(required, currency, hideAmounts)}</span>
        </div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        <p className="text-[10px] mt-1 tabular" style={{ color: 'var(--text-muted)' }}>{progress.toFixed(0)}% completado</p>
      </div>

      {fromExisting > 0 && (
        <div className="rounded-xl p-2.5" style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
            <strong style={{ color: 'var(--accent)' }}>Desde tus ahorros actuales:</strong> {formatMoney(fromExisting, currency, hideAmounts)} ya están reservados para este plan (porque tiene la fecha más cercana).
          </p>
        </div>
      )}

      {allocations.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Aporte mes a mes</p>
          <div className="space-y-1">
            {allocations.map((a, i) => (
              <div key={i} className="flex justify-between items-center px-3 py-2 rounded-lg" style={{ background: 'var(--bg-2)', border: '1px solid var(--border-soft)' }}>
                <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{a.label}</span>
                <div className="text-right">
                  <span className="text-sm font-semibold tabular" style={{ color: 'var(--primary)' }}>+{formatMoney(a.amount, currency, hideAmounts)}</span>
                  <p className="text-[10px] tabular" style={{ color: 'var(--text-muted)' }}>Total: {formatCompact(a.runningTotal, currency, hideAmounts)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {allocations.length === 0 && fromExisting > 0 && (
        <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>Este plan ya está cubierto con tus ahorros actuales — no necesita aportes mensuales.</p>
      )}

      {status === 'underfunded' && (
        <div className="rounded-xl p-3" style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)' }}>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
            <strong style={{ color: 'var(--warning)' }}>Importante:</strong> tus otros planes con fechas más cercanas tienen prioridad y consumen el flujo antes que este. Para reunir todo, considera mover la fecha más adelante, reducir el monto, o financiar parte con préstamo.
          </p>
        </div>
      )}
    </div>
  );
}

function PlanForm({ initial, currency, financialContext, hideAmounts, onSave, onDelete }) {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const defaultStart = nextMonth.toISOString().slice(0,10);
  const [form, setForm] = useState(initial || {
    id: uid(), name: '', type: 'purchase', subcategory: PLAN_SUBCATEGORIES.purchase[0].id,
    cost: 0, financing: 'own', oneTimeCost: 0, monthlyDelta: 0,
    loanRate: 12, loanMonths: 24, graceMonths: 0,
    notes: '', earliestDate: defaultStart, startDate: defaultStart, penaltyCost: 0, active: true,
  });
  const [confirmDel, setConfirmDel] = useState(false);
  const [step, setStep] = useState('type'); // type | details | review

  const update = (k, v) => setForm(s => ({ ...s, [k]: v }));
  const updateType = (newType) => {
    setForm(s => ({ ...s, type: newType, subcategory: PLAN_SUBCATEGORIES[newType][0].id }));
    setStep('details');
  };

  const valid = form.name.trim() && form.subcategory && (form.cost > 0 || (form.type === 'lifestyle' && form.monthlyDelta !== 0));
  const analysis = useMemo(() => valid ? analyzePlan({ ...form, currency }, financialContext) : null, [form, currency, financialContext, valid]);

  const colors = { good: 'var(--primary)', caution: 'var(--warning)', bad: 'var(--danger)' };
  const bgColors = { good: 'var(--primary-glow)', caution: 'rgba(251,191,36,0.15)', bad: 'var(--danger-glow)' };

  const subcategories = PLAN_SUBCATEGORIES[form.type] || [];
  const selectedSubcat = getPlanSubcategory(form.type, form.subcategory);

  // Step 1: Choose type
  if (step === 'type' && !initial) {
    const types = [
      { id: 'purchase', label: 'Comprar algo', icon: ShoppingBag, desc: 'Una compra puntual: electrónicos, electrodomésticos, vehículo, viaje, etc.', examples: 'Carro, computador, lavadora, vacaciones' },
      { id: 'lifestyle', label: 'Cambiar mis gastos / ingresos', icon: ArrowLeftRight, desc: 'Algo que cambia tu flujo de cada mes: mudarte, cambio de trabajo, sumar/quitar un gasto fijo.', examples: 'Mudarme, cambiar de internet, ascenso laboral' },
      { id: 'savings', label: 'Ahorrar para una meta', icon: Target, desc: 'Acumular dinero a futuro para algo específico.', examples: 'Cuota inicial casa, viaje, retiro' },
    ];
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>¿Qué quieres planear? Elige la opción que mejor describa tu plan:</p>
        {types.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => updateType(t.id)} className="w-full text-left rounded-2xl p-4 transition-transform active:scale-[0.98]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--primary-glow)' }}><Icon size={18} color="var(--primary)" /></div>
                <div className="flex-1">
                  <p className="font-semibold mb-0.5">{t.label}</p>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-dim)' }}>{t.desc}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Ej: {t.examples}</p>
                </div>
                <ChevronRight size={16} color="var(--text-muted)" className="flex-shrink-0 mt-1" />
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!initial && (
        <button onClick={() => setStep('type')} className="text-xs flex items-center gap-1" style={{ color: 'var(--primary)', background: 'none', border: 'none' }}>← Cambiar tipo</button>
      )}

      <div className="rounded-2xl p-3 flex items-center gap-2" style={{ background: 'var(--primary-glow)', border: '1px solid rgba(52,211,153,0.25)' }}>
        {(() => {
          const TypeIcon = form.type === 'purchase' ? ShoppingBag : form.type === 'lifestyle' ? ArrowLeftRight : Target;
          return <TypeIcon size={16} color="var(--primary)" />;
        })()}
        <span className="text-sm font-medium">{form.type === 'purchase' ? 'Compra' : form.type === 'lifestyle' ? 'Cambio en mis gastos / ingresos' : 'Meta de ahorro'}</span>
      </div>

      {/* Subcategory selector */}
      <div>
        <span className="text-xs font-medium block mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>¿De qué se trata?</span>
        <div className="grid grid-cols-3 gap-2">
          {subcategories.map(sc => {
            const Icon = sc.icon;
            const sel = form.subcategory === sc.id;
            return (
              <button key={sc.id} onClick={() => update('subcategory', sc.id)} className="flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all" style={{ background: sel ? `${sc.color}22` : 'var(--surface)', border: sel ? `1px solid ${sc.color}` : '1px solid var(--border)' }}>
                <Icon size={16} color={sel ? sc.color : 'var(--text-dim)'} />
                <span className="text-[10px] font-medium text-center leading-tight">{sc.name}</span>
              </button>
            );
          })}
        </div>
        {selectedSubcat && <p className="text-[11px] mt-2 px-1" style={{ color: 'var(--text-muted)' }}>Ejemplos: {selectedSubcat.desc}</p>}
      </div>

      <TextField label="Nombre del plan" value={form.name} onChange={v => update('name', v)} placeholder={(getPlanTemplate(form.subcategory).namePlaceholder) || 'Ej. Mi plan'} />

      {/* PURCHASE */}
      {form.type === 'purchase' && (
        <>
          <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{getPlanTemplate(form.subcategory).costLabel || '¿Cuánto cuesta?'}</span><MoneyInput value={form.cost} onChange={v => update('cost', v)} currency={currency} /></div>
          <div>
            <span className="text-xs font-medium block mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>¿Cómo lo pagarías?</span>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => update('financing', 'own')} className="rounded-xl py-3 text-sm font-medium" style={{ background: form.financing === 'own' ? 'var(--primary-glow)' : 'var(--surface)', border: form.financing === 'own' ? '1px solid var(--primary)' : '1px solid var(--border)', color: form.financing === 'own' ? 'var(--primary)' : 'var(--text)' }}>Mi dinero</button>
              <button onClick={() => update('financing', 'loan')} className="rounded-xl py-3 text-sm font-medium" style={{ background: form.financing === 'loan' ? 'var(--primary-glow)' : 'var(--surface)', border: form.financing === 'loan' ? '1px solid var(--primary)' : '1px solid var(--border)', color: form.financing === 'loan' ? 'var(--primary)' : 'var(--text)' }}>Préstamo / Crédito</button>
            </div>
          </div>

          {form.financing === 'loan' && (
            <div className="space-y-3 animate-fadein rounded-2xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Detalles del préstamo</p>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Plazo (meses)</span><NumberInput value={form.loanMonths} onChange={v => update('loanMonths', v)} min={1} max={360} /></div>
                <div><span className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Tasa % anual</span><NumberInput value={form.loanRate} onChange={v => update('loanRate', v)} min={0} max={500} decimals /></div>
              </div>
              <div>
                <span className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>¿Cuándo recibes el dinero?</span>
                <input type="date" value={form.startDate || ''} onChange={e => update('startDate', e.target.value)} className="input-base w-full rounded-xl px-4 py-3 text-base" style={{ colorScheme: 'dark' }} />
              </div>
              <div>
                <span className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Período de gracia</span>
                <div className="grid grid-cols-4 gap-2">
                  {[0, 1, 2, 3].map(m => (
                    <button key={m} onClick={() => update('graceMonths', m)} className="rounded-xl py-2 text-xs font-medium" style={{ background: form.graceMonths === m ? 'var(--primary-glow)' : 'var(--bg-2)', border: form.graceMonths === m ? '1px solid var(--primary)' : '1px solid var(--border)', color: form.graceMonths === m ? 'var(--primary)' : 'var(--text)' }}>{m === 0 ? 'Sin gracia' : `${m} mes${m > 1 ? 'es' : ''}`}</button>
                  ))}
                </div>
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Cuántos meses pasan antes de que empieces a pagar la cuota. Algunos prestamistas dan plazo flexible.</p>
              </div>
            </div>
          )}

          {form.financing === 'own' && (
            <div>
              <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>¿Cuándo lo harías?</span>
              <input type="date" value={form.startDate || ''} onChange={e => update('startDate', e.target.value)} className="input-base w-full rounded-xl px-4 py-3 text-base" style={{ colorScheme: 'dark' }} />
            </div>
          )}

          <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{getPlanTemplate(form.subcategory).extrasLabel || 'Costos extras'} — opcional</span><MoneyInput value={form.penaltyCost} onChange={v => update('penaltyCost', v)} currency={currency} placeholder={getPlanTemplate(form.subcategory).extrasPlaceholder || ''} /></div>
        </>
      )}

      {/* LIFESTYLE */}
      {form.type === 'lifestyle' && (
        <>
          <div className="rounded-2xl p-3 text-xs space-y-1" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}>
            <p><strong style={{ color: 'var(--text)' }}>¿Cómo funciona?</strong></p>
            <p>{getPlanTemplate(form.subcategory).intro || 'Si el cambio te ahorra dinero: número positivo. Si te cuesta más: número negativo.'}</p>
            <p>Ahorras → <strong style={{ color: 'var(--primary)' }}>positivo</strong>. Gastas más → <strong style={{ color: 'var(--danger)' }}>negativo</strong>.</p>
          </div>
          <div>
            <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{getPlanTemplate(form.subcategory).deltaLabel || 'Cambio mensual'}</span>
            <NumberInput value={form.monthlyDelta} onChange={v => update('monthlyDelta', v)} min={-99999999} max={99999999} placeholder={getPlanTemplate(form.subcategory).deltaHelp || 'Ej. 1000000 (ahorras) ó -200000 (gastas más)'} />
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>{form.monthlyDelta > 0 ? `Ahorrarás ${formatMoney(form.monthlyDelta, currency)} cada mes desde el inicio.` : form.monthlyDelta < 0 ? `Gastarás ${formatMoney(-form.monthlyDelta, currency)} extra cada mes.` : (getPlanTemplate(form.subcategory).deltaHelp || 'Cuánto más ahorras (+) o gastas (−) cada mes con este cambio.')}</p>
          </div>
          <div>
            <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>¿Desde cuándo aplica?</span>
            <input type="date" value={form.startDate || ''} onChange={e => update('startDate', e.target.value)} className="input-base w-full rounded-xl px-4 py-3 text-base" style={{ colorScheme: 'dark' }} />
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>Considera tus pagos pendientes (ej. arriendo del próximo mes, fin de contrato actual).</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{getPlanTemplate(form.subcategory).oneTimeLabel || 'Costo inicial único'}</span><MoneyInput value={form.oneTimeCost} onChange={v => update('oneTimeCost', v)} currency={currency} /></div>
            <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{getPlanTemplate(form.subcategory).penaltyLabel || 'Penalidad / multa'}</span><MoneyInput value={form.penaltyCost} onChange={v => update('penaltyCost', v)} currency={currency} /></div>
          </div>
        </>
      )}

      {/* SAVINGS */}
      {form.type === 'savings' && (
        <>
          <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{getPlanTemplate(form.subcategory).goalLabel || '¿Cuánto quieres ahorrar?'}</span><MoneyInput value={form.cost} onChange={v => update('cost', v)} currency={currency} />
            {getPlanTemplate(form.subcategory).goalHelp && <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>{getPlanTemplate(form.subcategory).goalHelp}</p>}
          </div>
          <div>
            <span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Fecha objetivo (opcional)</span>
            <input type="date" value={form.startDate || ''} onChange={e => update('startDate', e.target.value)} className="input-base w-full rounded-xl px-4 py-3 text-base" style={{ colorScheme: 'dark' }} />
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>¿Para cuándo necesitas tener este ahorro?</p>
          </div>
        </>
      )}

      <TextField label="Notas (opcional)" value={form.notes} onChange={v => update('notes', v)} placeholder="..." />

      {/* Live analysis */}
      {analysis && (
        <div className="rounded-2xl p-4 space-y-2 animate-fadein" style={{ background: bgColors[analysis.viability], border: `1px solid ${colors[analysis.viability]}55` }}>
          <div className="flex items-center gap-2">
            <Sparkles size={14} color={colors[analysis.viability]} />
            <h4 className="display-font text-sm font-semibold" style={{ color: colors[analysis.viability] }}>{analysis.title}</h4>
          </div>
          {analysis.details.map((d, i) => (<p key={i} className="text-xs leading-relaxed">{d}</p>))}
        </div>
      )}

      {/* When creating a NEW fundable plan: warn about impact on existing plans */}
      {!initial && (form.type === 'savings' || (form.type === 'purchase' && form.financing === 'own')) && form.cost > 0 && form.startDate && financialContext && financialContext.allFundablePlans && financialContext.allFundablePlans.length > 0 && (
        <div className="rounded-2xl p-3 text-xs space-y-1.5" style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)' }}>
          <div className="flex items-center gap-2">
            <Info size={14} color="var(--accent)" />
            <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--accent)' }}>Impacto en tus otros planes</span>
          </div>
          <p style={{ color: 'var(--text-dim)' }}>
            Ya tienes {financialContext.allFundablePlans.length} plan{financialContext.allFundablePlans.length > 1 ? 'es' : ''} de ahorro/compra activos. Al crear este, la app redistribuye automáticamente el flujo mensual: <strong style={{ color: 'var(--text)' }}>los planes con fecha más cercana tienen prioridad</strong>.
          </p>
          {(() => {
            const formDate = form.startDate ? parseLocalDate(form.startDate) : null;
            if (!formDate) return null;
            const sooner = financialContext.allFundablePlans.filter(p => p.targetDate && p.targetDate < formDate);
            const later = financialContext.allFundablePlans.filter(p => p.targetDate && p.targetDate >= formDate);
            return (
              <>
                {sooner.length > 0 && (
                  <p style={{ color: 'var(--text-dim)' }}>
                    📅 Antes de este plan: <strong>{sooner.map(p => p.name).join(', ')}</strong> — recibirán dinero primero.
                  </p>
                )}
                {later.length > 0 && (
                  <p style={{ color: 'var(--text-dim)' }}>
                    ⚠ Después de este plan: <strong>{later.map(p => p.name).join(', ')}</strong> — al insertar este, el dinero que les llegaba se reduce. Verifica que aún sean viables después de guardar.
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Plan-specific monthly schedule: shows exactly how much to save each month for THIS plan */}
      {initial && financialContext && financialContext.planContributions && financialContext.planContributions[initial.id] && (
        <PlanMonthlySchedule planId={initial.id} financialContext={financialContext} currency={currency} hideAmounts={hideAmounts} />
      )}

      <button onClick={() => onSave(form)} disabled={!valid} className="btn-primary w-full rounded-2xl py-3.5 text-base font-semibold">{initial ? 'Guardar cambios' : 'Crear plan'}</button>
      {onDelete && (
        <>
          <button onClick={() => setConfirmDel(true)} className="w-full rounded-2xl py-3 text-sm font-medium" style={{ background: 'var(--danger-glow)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.2)' }}>Eliminar plan</button>
          <ConfirmDialog open={confirmDel} title="¿Eliminar plan?" message="No podrás deshacer esta acción." onCancel={() => setConfirmDel(false)} onConfirm={() => { setConfirmDel(false); onDelete(); }} danger />
        </>
      )}
    </div>
  );
}

// ============================================================================
//  PROJECTION (legacy, kept for safety)
// ============================================================================
// ============================================================================
//  SETTINGS
// ============================================================================
function CurrencySelector({ data, onUpdateUser, onUpdateAllAmounts }) {
  const [pending, setPending] = useState(null); // { from, to, hasAmounts }
  const handleChange = (newCode) => {
    const oldCode = data.user.currency;
    if (newCode === oldCode) return;
    // Detect if there are amounts that would be reinterpreted
    const hasAmounts = (data.debts || []).some(d => d.totalAmount > 0)
      || (data.incomes || []).some(i => i.amount > 0)
      || (data.expenses || []).some(e => e.amount > 0)
      || (data.plans || []).some(p => (p.cost || 0) > 0)
      || (data.savings && (data.savings.current > 0 || data.savings.goal > 0));
    if (!hasAmounts) {
      // Safe to switch directly
      onUpdateUser({ currency: newCode });
      return;
    }
    setPending({ from: oldCode, to: newCode });
  };
  const apply = (mode) => {
    if (!pending) return;
    if (mode === 'keep') {
      onUpdateUser({ currency: pending.to });
    } else if (mode === 'cancel') {
      // do nothing
    }
    setPending(null);
  };
  return (
    <>
      <div className="card flex items-center gap-3" style={{ padding: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Banknote size={15} color="var(--text-dim)" /></div>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>Moneda</span>
        <select value={data.user.currency} onChange={e => handleChange(e.target.value)} style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer' }}>
          {Object.values(CURRENCIES).map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
        </select>
      </div>
      {pending && (
        <>
          <div className="sheet-backdrop animate-fadein" onClick={() => apply('cancel')} style={{ zIndex: 70 }} />
          <div className="fixed inset-0 flex items-center justify-center px-6 pointer-events-none" style={{ zIndex: 71 }}>
            <div className="w-full max-w-sm rounded-3xl p-6 animate-scale pointer-events-auto" style={{ background: 'var(--bg-2)', border: '1px solid var(--border-strong)', boxShadow: '0 24px 60px rgba(0,0,0,0.6)' }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--warning-glow)' }}>
                  <AlertCircle size={20} color="var(--warning)" />
                </div>
                <h3 className="display-font text-lg font-semibold">Cambiar a {pending.to}</h3>
              </div>
              <p className="text-sm mb-3" style={{ color: 'var(--text-dim)', lineHeight: 1.55 }}>
                Tus montos actuales están en <strong style={{ color: 'var(--text)' }}>{pending.from}</strong>. La app no convierte tasas automáticamente.
              </p>
              <p className="text-xs mb-5" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Ejemplo: si tienes 1.500.000 {pending.from}, al cambiar a {pending.to} verás <span className="tabular">1.500.000 {pending.to}</span>. Tendrás que actualizar los montos manualmente.
              </p>
              <div className="flex gap-2">
                <button onClick={() => apply('cancel')} className="flex-1 btn-ghost rounded-xl py-3 text-sm font-medium">Cancelar</button>
                <button onClick={() => apply('keep')} className="flex-1 rounded-xl py-3 text-sm font-semibold" style={{ background: 'var(--primary)', color: '#052E20', border: 'none' }}>Cambiar de todos modos</button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// === MFA (2FA) panel for SettingsScreen ===
// Enrolls or removes a TOTP factor via Supabase MFA.
// Shows a QR code that the user scans with Google/Microsoft Authenticator,
// then asks them to type the 6-digit code to confirm.
function MfaPanel({ onClose }) {
  const [factors, setFactors] = useState({ totp: [] });
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(null); // { id, qr, secret, uri }
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);

  const refresh = async () => {
    setLoading(true);
    const f = await mfaListFactors();
    setFactors(f);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const startEnroll = async () => {
    setErr('');
    try {
      const f = await mfaEnrollTotp();
      setEnrolling({ id: f.id, qr: f.totp.qr_code, secret: f.totp.secret, uri: f.totp.uri });
    } catch (e) { setErr(e.message || 'No se pudo iniciar 2FA'); }
  };
  const confirmEnroll = async () => {
    if (!enrolling) return;
    if (code.length !== 6) { setErr('El código tiene 6 dígitos'); return; }
    setBusy(true); setErr('');
    try {
      await mfaVerifyEnrollment(enrolling.id, code);
      setEnrolling(null); setCode('');
      await refresh();
    } catch (e) { setErr(e.message || 'Código incorrecto'); }
    finally { setBusy(false); }
  };
  const cancelEnroll = async () => {
    if (enrolling) { try { await mfaUnenroll(enrolling.id); } catch (e) {} }
    setEnrolling(null); setCode(''); setErr('');
  };
  const remove = async (id) => {
    setBusy(true);
    try { await mfaUnenroll(id); await refresh(); }
    catch (e) { setErr(e.message || 'No se pudo desactivar'); }
    finally { setBusy(false); setConfirmRemove(null); }
  };

  const verifiedFactors = (factors.totp || []).filter(f => f.status === 'verified');

  if (loading) return <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Cargando…</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          La 2FA agrega un paso extra al login: además de tu contraseña, tendrás que poner un código de 6 dígitos generado por una app como <strong style={{ color: 'var(--text)' }}>Google Authenticator</strong>, <strong style={{ color: 'var(--text)' }}>Microsoft Authenticator</strong> o <strong style={{ color: 'var(--text)' }}>Authy</strong>. Si alguien adivina tu contraseña, no puede entrar sin tu teléfono.
        </p>
      </div>

      {verifiedFactors.length > 0 ? (
        <div className="space-y-3">
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>2FA activa</p>
          {verifiedFactors.map(f => (
            <div key={f.id} className="rounded-2xl p-3 flex items-center justify-between" style={{ background: 'var(--primary-glow)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600 }}>{f.friendly_name || 'App authenticator'}</p>
                <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>Activada · TOTP</p>
              </div>
              <button onClick={() => setConfirmRemove(f.id)} className="btn-ghost" style={{ padding: '6px 10px', borderRadius: 9, fontSize: 11.5, fontWeight: 600 }}>Quitar</button>
            </div>
          ))}
        </div>
      ) : (
        !enrolling && (
          <button onClick={startEnroll} className="btn-primary w-full rounded-2xl py-3.5 text-base font-semibold">
            Activar 2FA
          </button>
        )
      )}

      {enrolling && (
        <div className="space-y-3 animate-fadein">
          <p style={{ fontSize: 12, fontWeight: 600 }}>1. Escanea este código con tu app authenticator</p>
          {enrolling.qr && (
            <div style={{ background: '#fff', padding: 16, borderRadius: 16, display: 'flex', justifyContent: 'center' }}>
              <img src={enrolling.qr} alt="QR code para 2FA" style={{ width: 200, height: 200, display: 'block' }} />
            </div>
          )}
          <details style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            <summary style={{ cursor: 'pointer', userSelect: 'none' }}>¿No puedes escanear? Ingresa el código manual</summary>
            <code style={{ display: 'block', marginTop: 8, padding: 8, background: 'var(--surface)', borderRadius: 6, fontSize: 11, wordBreak: 'break-all' }}>{enrolling.secret}</code>
          </details>

          <p style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>2. Escribe el código de 6 dígitos que ves en la app</p>
          <input
            type="text" inputMode="numeric" maxLength={6}
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="input-base w-full tabular"
            style={{ borderRadius: 14, padding: '14px 16px', fontSize: 22, letterSpacing: '0.3em', textAlign: 'center', fontWeight: 600 }}
          />

          {err && (
            <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--danger-glow)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--danger)' }}>{err}</div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={cancelEnroll} className="btn-ghost rounded-2xl py-3 text-sm font-semibold">Cancelar</button>
            <button onClick={confirmEnroll} disabled={busy || code.length !== 6} className="btn-primary rounded-2xl py-3 text-sm font-semibold">{busy ? 'Verificando…' : 'Activar'}</button>
          </div>
        </div>
      )}

      {err && !enrolling && (
        <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--danger-glow)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--danger)' }}>{err}</div>
      )}

      <ConfirmDialog open={!!confirmRemove} title="¿Quitar 2FA?" message="Tu cuenta volverá a requerir solo contraseña para entrar. Puedes reactivar 2FA en cualquier momento." onCancel={() => setConfirmRemove(null)} onConfirm={() => remove(confirmRemove)} danger />
    </div>
  );
}

function SettingsScreen({ data, onUpdateUser, onUpdateSettings, onExport, onExportCSV, onImport, onExportCalendar, onReset, onRequestNotifications, notifPermission, onUpdateAllAmounts, session, syncStatus, onLogout, currency }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(data.user.name);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [mfaSheetOpen, setMfaSheetOpen] = useState(false);
  const importInputRef = useRef(null);
  // Days since last backup (null if never)
  const daysSinceBackup = useMemo(() => {
    const last = data.settings && data.settings.lastBackupAt;
    if (!last) return null;
    const ms = Date.now() - new Date(last).getTime();
    return Math.floor(ms / 86400000);
  }, [data.settings && data.settings.lastBackupAt]);
  return (
    <div className="px-5 pb-32 space-y-5 stagger">
      {session && (
        <div className="animate-slideup card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--primary-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <CheckCircle2 size={16} color="var(--primary)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{session.user.email}</p>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1 }}>
              {syncStatus === 'syncing' ? 'Sincronizando…' : syncStatus === 'error' ? 'Error al sincronizar' : 'Sincronizado en la nube'}
            </p>
          </div>
          <button onClick={() => setConfirmLogout(true)} className="btn-ghost" style={{ padding: '7px 12px', borderRadius: 10, fontSize: 11.5, fontWeight: 600 }}>Cerrar sesión</button>
        </div>
      )}
      <div className="animate-slideup card-elevated" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="display-font" style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--primary-glow), rgba(167,139,250,0.15))',
          color: 'var(--primary)', fontSize: 24, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid var(--primary-glow)',
          boxShadow: '0 4px 16px -4px var(--primary-glow)',
          letterSpacing: '-0.02em',
        }}>
          {(data.user.name || '?')[0].toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editingName ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={tempName} onChange={e => setTempName(e.target.value)} className="input-base flex-1" style={{ borderRadius: 10, padding: '8px 12px', fontSize: 14 }} autoFocus />
              <button onClick={() => { onUpdateUser({ name: tempName.trim() }); setEditingName(false); }} className="btn-primary" style={{ padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>OK</button>
            </div>
          ) : (
            <>
              <p className="display-font truncate" style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-0.025em' }}>{data.user.name || 'Sin nombre'}</p>
              <button onClick={() => { setTempName(data.user.name); setEditingName(true); }} style={{
                fontSize: 12, color: 'var(--primary)', background: 'none', border: 'none',
                padding: 0, marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 500,
              }}>
                <Edit3 size={11} /> Cambiar nombre
              </button>
            </>
          )}
        </div>
      </div>

      <SettingsGroup title="Preferencias">
        <CurrencySelector data={data} onUpdateUser={onUpdateUser} onUpdateAllAmounts={onUpdateAllAmounts} />

        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--primary-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Sparkles size={15} color="var(--primary)" /></div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 500 }}>Tema de color</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Se ajusta al nombre o elige uno</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {[
              { v: null, l: 'Automático', swatch: 'linear-gradient(135deg, #34D399, #F472B6)' },
              { v: 'default', l: 'Esmeralda', swatch: 'linear-gradient(135deg, #34D399, #10B981)' },
              { v: 'feminine', l: 'Rosa', swatch: 'linear-gradient(135deg, #F472B6, #EC4899)' },
              { v: 'ocean', l: 'Océano', swatch: 'linear-gradient(135deg, #38BDF8, #0EA5E9)' },
              { v: 'sunset', l: 'Atardecer', swatch: 'linear-gradient(135deg, #FB923C, #F97316)' },
              { v: 'forest', l: 'Bosque', swatch: 'linear-gradient(135deg, #84CC16, #65A30D)' },
              { v: 'gold', l: 'Dorado', swatch: 'linear-gradient(135deg, #F59E0B, #D97706)' },
              { v: 'midnight', l: 'Medianoche', swatch: 'linear-gradient(135deg, #818CF8, #6366F1)' },
              { v: 'studio', l: 'Studio (claro)', swatch: 'linear-gradient(135deg, #F4EFE3, #8B6FBC)' },
            ].map(o => {
              const sel = (data.user.themeOverride || null) === o.v;
              return (
                <button key={o.l} onClick={() => onUpdateUser({ themeOverride: o.v })} style={{
                  padding: '10px 12px', borderRadius: 12,
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: sel ? 'var(--primary-glow)' : 'var(--bg-2)',
                  border: sel ? '1px solid var(--primary)' : '1px solid var(--border)',
                  color: sel ? 'var(--primary)' : 'var(--text)',
                  cursor: 'pointer', transition: 'all 0.2s var(--ease-soft)',
                  fontSize: 13, fontWeight: 500, letterSpacing: '-0.005em',
                  boxShadow: sel ? '0 4px 12px -4px var(--primary-glow)' : 'none',
                }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%',
                    background: o.swatch, flexShrink: 0,
                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15), 0 2px 6px rgba(0,0,0,0.3)',
                  }} />
                  <span>{o.l}</span>
                </button>
              );
            })}
          </div>
        </div>

        <SettingsToggle icon={Eye} label="Ocultar montos" description="Oculta valores en pantalla por privacidad" value={data.settings.hideAmounts} onChange={v => onUpdateSettings({ hideAmounts: v })} />
      </SettingsGroup>

      <SettingsGroup title="Recordatorios">
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid rgba(52,211,153,0.25)' }}>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--primary-glow)' }}>
              <Calendar size={16} color="var(--primary)" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">Exportar a Calendario (recomendado)</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>Crea eventos mensuales en tu Calendar de iPhone con notificaciones nativas reales 1 día antes y el día del pago.</p>
            </div>
          </div>
          <button onClick={onExportCalendar} className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2"><Download size={14} /> Descargar .ics</button>
        </div>
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: notifPermission === 'granted' ? 'var(--primary-glow)' : 'var(--surface-2)' }}>
              <Bell size={16} color={notifPermission === 'granted' ? 'var(--primary)' : 'var(--text-dim)'} />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">Notificaciones del navegador</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>Solo funcionan con la app abierta. Para avisos reales en iPhone usa la opción de Calendario.</p>
            </div>
          </div>
          {notifPermission !== 'granted' && (
            <button onClick={onRequestNotifications} disabled={notifPermission === 'denied'} className="btn-ghost w-full rounded-xl py-2.5 text-sm font-medium">
              {notifPermission === 'denied' ? 'Bloqueadas en el navegador' : 'Activar (limitado)'}
            </button>
          )}
        </div>
      </SettingsGroup>

      {session && (
        <SettingsGroup title="Seguridad de cuenta">
          <SettingsRow icon={Sparkles} label="Autenticación en 2 pasos (2FA)" onPress={() => setMfaSheetOpen(true)} />
        </SettingsGroup>
      )}

      <SettingsGroup title="Datos">
        {/* Backup info banner */}
        <div className="rounded-2xl p-3" style={{ background: daysSinceBackup === null || daysSinceBackup > 30 ? 'rgba(251,191,36,0.10)' : 'var(--surface)', border: `1px solid ${daysSinceBackup === null || daysSinceBackup > 30 ? 'rgba(251,191,36,0.25)' : 'var(--border)'}`, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={14} color={daysSinceBackup === null || daysSinceBackup > 30 ? 'var(--warning)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
            <p style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.45 }}>
              {daysSinceBackup === null
                ? <>Nunca has descargado un backup. Hazlo para tener una copia fuera de la nube.</>
                : daysSinceBackup === 0
                  ? 'Backup descargado hoy ✓'
                  : daysSinceBackup === 1
                    ? 'Último backup hace 1 día'
                    : daysSinceBackup > 30
                      ? <><strong style={{ color: 'var(--warning)' }}>Hace {daysSinceBackup} días</strong> sin backup. Te recomendamos descargar uno.</>
                      : `Último backup hace ${daysSinceBackup} días`}
            </p>
          </div>
        </div>
        <SettingsRow icon={Download} label="Descargar backup (.json)" onPress={onExport} />
        <SettingsRow icon={Download} label="Exportar a CSV / Excel" onPress={onExportCSV} />
        <SettingsRow icon={Calendar} label="Exportar a calendario (.ics)" onPress={onExportCalendar} />
        <SettingsRow icon={RotateCcw} label="Importar backup (.json)" onPress={() => importInputRef.current && importInputRef.current.click()} />
        <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { onImport(f); e.target.value = ''; } }} />
        <SettingsRow icon={RotateCcw} label="Restablecer todo" onPress={() => setConfirmReset(true)} danger />
      </SettingsGroup>

      <Sheet open={mfaSheetOpen} onClose={() => setMfaSheetOpen(false)} title="Autenticación en 2 pasos" size="lg">
        <MfaPanel onClose={() => setMfaSheetOpen(false)} />
      </Sheet>

      <div style={{ textAlign: 'center', paddingTop: 16 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--primary)', boxShadow: '0 0 8px var(--primary)',
          }} />
          <p className="display-font" style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--primary)' }}>Finanzas</p>
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.02em' }}>Versión 1.0 · Hecha con cuidado</p>
      </div>

      <ConfirmDialog open={confirmReset} title="¿Borrar todo?" message="Se eliminarán todas tus deudas, ingresos, egresos y configuración. Esta acción es irreversible." onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); onReset(); }} danger />
      <ConfirmDialog open={confirmLogout} title="¿Cerrar sesión?" message="Tus datos quedan guardados en la nube. Volverás a verlos cuando inicies sesión de nuevo." onCancel={() => setConfirmLogout(false)} onConfirm={() => { setConfirmLogout(false); onLogout && onLogout(); }} />
    </div>
  );
}

function SettingsGroup({ title, children }) {
  return (
    <div className="animate-slideup">
      <p style={{ fontSize: 10.5, fontWeight: 600, marginBottom: 10, paddingLeft: 4, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}

function SettingsRow({ icon: Icon, label, onPress, danger = false }) {
  return (
    <button onClick={onPress} className="card card-press" style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: 14, textAlign: 'left',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: danger ? 'var(--danger-glow)' : 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={15} color={danger ? 'var(--danger)' : 'var(--text-dim)'} strokeWidth={2.2} />
      </div>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: danger ? 'var(--danger)' : 'var(--text)' }}>{label}</span>
      <ChevronRight size={15} color="var(--text-muted)" />
    </button>
  );
}

function SettingsToggle({ icon: Icon, label, description, value, onChange }) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={15} color="var(--text-dim)" strokeWidth={2.2} />
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 14, fontWeight: 500 }}>{label}</p>
        {description && <p style={{ fontSize: 11, marginTop: 2, color: 'var(--text-muted)', lineHeight: 1.4 }}>{description}</p>}
      </div>
      <button onClick={() => onChange(!value)} style={{
        position: 'relative', width: 44, height: 24, borderRadius: 999,
        background: value ? 'var(--primary)' : 'var(--surface-3)',
        border: 'none', flexShrink: 0,
        transition: 'background-color 0.25s var(--ease-soft)',
        boxShadow: value ? '0 0 0 1px var(--primary), 0 4px 12px -2px var(--primary-glow)' : 'inset 0 0 0 1px var(--border)',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: 2, width: 20, height: 20, borderRadius: '50%',
          background: '#fff',
          transition: 'transform 0.3s var(--ease-spring)',
          transform: value ? 'translateX(20px)' : 'translateX(0)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        }} />
      </button>
    </div>
  );
}

// ============================================================================
//  NOTIFICATIONS LIST
// ============================================================================
function NotificationsList({ data, currency, hideAmounts, onPay, onClose }) {
  const upcoming = useMemo(() => data.debts
    .filter(d => !d.archived && (d.totalAmount - (d.paidAmount||0)) > 0)
    .map(d => ({ ...d, nextDate: getDebtNextPaymentDate(d) }))
    .sort((a, b) => a.nextDate - b.nextDate), [data.debts]);

  if (upcoming.length === 0) {
    return (
      <div className="text-center py-4" style={{ paddingTop: '2.5rem', paddingBottom: '2.5rem' }}>
        <div className="flex justify-center mb-3"><CheckCircle2 size={32} color="var(--primary)" /></div>
        <p className="display-font text-lg font-semibold mb-1">Todo al día</p>
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No tienes pagos pendientes.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {upcoming.map(d => {
        const days = daysBetween(new Date(), d.nextDate);
        const urgent = days <= 3;
        return (
          <button key={d.id} onClick={() => { onPay(d); onClose(); }} className="w-full flex items-center gap-3 p-3.5 rounded-2xl text-left" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: urgent ? 'var(--danger-glow)' : 'var(--surface-2)' }}><Calendar size={16} color={urgent ? 'var(--danger)' : 'var(--text-dim)'} /></div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{d.name}</p>
              <p className="text-xs" style={{ color: urgent ? 'var(--danger)' : 'var(--text-muted)' }}>{days === 0 ? 'Hoy' : days === 1 ? 'Mañana' : `En ${days} días`} · {formatDate(d.nextDate)}</p>
            </div>
            <span className="font-semibold tabular text-sm">{formatCompact(d.minimumPayment, currency, hideAmounts)}</span>
          </button>
        );
      })}
    </div>
  );
}

function QuickTransactionForm({ type, currency, onSave }) {
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState(CATEGORIES[type][0].id);
  const [notes, setNotes] = useState('');
  return (
    <div className="space-y-4">
      <div><span className="text-xs font-medium block mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Monto</span><MoneyInput value={amount} onChange={setAmount} currency={currency} /></div>
      <div>
        <span className="text-xs font-medium block mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Categoría</span>
        <div className="grid grid-cols-4 gap-2">
          {CATEGORIES[type].map(c => {
            const Icon = c.icon;
            const sel = category === c.id;
            return (
              <button key={c.id} onClick={() => setCategory(c.id)} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all" style={{ background: sel ? `${c.color}22` : 'var(--surface)', border: sel ? `1px solid ${c.color}` : '1px solid var(--border)' }}>
                <Icon size={16} color={sel ? c.color : 'var(--text-dim)'} />
                <span className="text-[10px] font-medium text-center leading-tight">{c.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <TextField label="Nota (opcional)" value={notes} onChange={setNotes} placeholder="..." />
      <button onClick={() => onSave({ amount, category, notes })} disabled={amount <= 0} className="btn-primary w-full rounded-2xl py-3.5 text-base font-semibold">Registrar {formatMoney(amount, currency)}</button>
    </div>
  );
}

// ============================================================================
//  ROOT APP
// ============================================================================
// === AUTH SCREEN (only used when Supabase is configured) ===
function AuthScreen({ onLoggedIn }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot' | 'mfa'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  // MFA challenge state during login
  const [mfaFactorId, setMfaFactorId] = useState(null);
  const [mfaCode, setMfaCode] = useState('');

  // After password login, check if MFA is required. If yes, switch to 'mfa' mode.
  const checkMfaAfterLogin = async () => {
    try {
      const aalResp = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
      const aal = aalResp && aalResp.data;
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const factors = await mfaListFactors();
        const verified = (factors.totp || []).find(f => f.status === 'verified');
        if (verified) {
          setMfaFactorId(verified.id);
          setMode('mfa');
          return false; // need MFA
        }
      }
    } catch (e) { /* if MFA check fails, fall through and let user in */ }
    return true; // no MFA needed
  };

  // Basic RFC-5322-lite email format check (good enough for client-side; server validates too)
  const emailValid = (em) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);
  // Password strength: ≥8 chars, ≥1 letter, ≥1 number (low bar for usability)
  const passwordStrong = (pw) => pw.length >= 8 && /[a-zA-Z]/.test(pw) && /\d/.test(pw);

  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setErr(''); setInfo('');
    if (!email.trim()) { setErr('Escribe tu correo'); return; }
    if (!emailValid(email.trim())) { setErr('Ese correo no parece válido'); return; }
    // For MFA mode, password isn't being verified — only the 6-digit code
    if (mode === 'mfa') {
      if (mfaCode.length !== 6) { setErr('El código tiene 6 dígitos'); return; }
      setBusy(true);
      try {
        await mfaChallengeAndVerify(mfaFactorId, mfaCode);
        if (onLoggedIn) onLoggedIn();
      } catch (e) {
        setErr(e.message || 'Código incorrecto');
      } finally { setBusy(false); }
      return;
    }
    if (mode !== 'forgot' && !passwordStrong(password)) {
      setErr('La contraseña debe tener mínimo 8 caracteres, con letras y números');
      return;
    }
    if (mode === 'signup' && password !== password2) { setErr('Las contraseñas no coinciden'); return; }
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await supabaseClient.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        const ok = await checkMfaAfterLogin();
        if (ok && onLoggedIn) onLoggedIn();
      } else if (mode === 'signup') {
        const { data, error } = await supabaseClient.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (data && data.session) {
          if (onLoggedIn) onLoggedIn();
        } else {
          setInfo('Revisa tu correo para confirmar la cuenta. Después vuelve aquí e inicia sesión.');
          setMode('login');
        }
      } else if (mode === 'forgot') {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setInfo('Te enviamos un correo para restablecer la contraseña.');
        setMode('login');
      }
    } catch (e2) {
      setErr(e2.message || 'No se pudo procesar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="finanzas-app min-h-screen flex flex-col safe-top safe-bottom" style={{ padding: '24px 24px 0' }}>
      <div className="flex-1 flex flex-col justify-center" style={{ maxWidth: 420, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 18 }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--primary)', boxShadow: '0 0 8px var(--primary)' }} />
          <span style={{ fontSize: 11, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 600 }}>Finanzas</span>
        </div>
        <h1 className="display-font" style={{ fontSize: 36, lineHeight: 1.05, fontWeight: 500, marginBottom: 6, letterSpacing: '-0.035em' }}>
          {mode === 'login' ? 'Inicia sesión' : mode === 'signup' ? 'Crea tu cuenta' : mode === 'mfa' ? 'Verificación 2FA' : 'Recuperar contraseña'}
        </h1>
        <p className="tagline-script" style={{ fontSize: 22, marginBottom: 24 }}>
          {mode === 'mfa' ? 'un paso más para entrar' : 'tus datos, en todos tus dispositivos'}
        </p>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'mfa' ? (
            <div>
              <p style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.5 }}>
                Abre tu app authenticator (Google/Microsoft Authenticator, Authy) y escribe el código de 6 dígitos para <strong style={{ color: 'var(--text)' }}>{email}</strong>.
              </p>
              <input
                type="text" inputMode="numeric" maxLength={6} autoFocus
                value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="input-base w-full tabular"
                style={{ borderRadius: 14, padding: '14px 16px', fontSize: 22, letterSpacing: '0.3em', textAlign: 'center', fontWeight: 600 }}
              />
            </div>
          ) : (
          <>
          <div>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Correo</span>
            <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className="input-base w-full"
              style={{ borderRadius: 14, padding: '14px 16px', fontSize: 15.5 }} />
          </div>
          {mode !== 'forgot' && (
            <div>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Contraseña</span>
              <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-base w-full"
                style={{ borderRadius: 14, padding: '14px 16px', fontSize: 15.5 }} />
            </div>
          )}
          {mode === 'signup' && (
            <div>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Repite la contraseña</span>
              <input type="password" autoComplete="new-password"
                value={password2} onChange={e => setPassword2(e.target.value)}
                placeholder="••••••••"
                className="input-base w-full"
                style={{ borderRadius: 14, padding: '14px 16px', fontSize: 15.5 }} />
            </div>
          )}
          </>
          )}

          {err && (
            <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--danger-glow)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--danger)' }}>{err}</div>
          )}
          {info && (
            <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--primary-glow)', border: '1px solid rgba(52,211,153,0.25)', color: 'var(--text-dim)' }}>{info}</div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full" style={{ borderRadius: 14, padding: '14px 0', fontSize: 15.5, fontWeight: 600, marginTop: 6 }}>
            {busy ? 'Procesando…' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : mode === 'mfa' ? 'Verificar' : 'Enviar correo'}
          </button>
        </form>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, fontSize: 12.5 }}>
          {mode === 'login' ? (
            <>
              <button onClick={() => { setMode('signup'); setErr(''); setInfo(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontWeight: 600 }}>Crear cuenta</button>
              <button onClick={() => { setMode('forgot'); setErr(''); setInfo(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>Olvidé mi contraseña</button>
            </>
          ) : mode === 'mfa' ? (
            <button onClick={async () => { try { await supabaseClient.auth.signOut(); } catch (e) {} setMode('login'); setMfaCode(''); setMfaFactorId(null); setErr(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontWeight: 600 }}>← Cancelar y volver a inicio</button>
          ) : (
            <button onClick={() => { setMode('login'); setErr(''); setInfo(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontWeight: 600 }}>← Volver a iniciar sesión</button>
          )}
        </div>

        <p style={{ marginTop: 32, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
          Tus datos viven en tu cuenta privada — solo tú los ves.<br/>
          Se sincronizan automáticamente entre tus dispositivos.
        </p>
      </div>
    </div>
  );
}

// Detects whether the viewport is desktop-width (≥ 1024px). Updates on resize.
function useIsDesktop(breakpoint = 1024) {
  const query = `(min-width: ${breakpoint}px)`;
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e) => setIsDesktop(e.matches);
    setIsDesktop(mql.matches);
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, [query]);
  return isDesktop;
}

// Desktop-only left sidebar navigation. Replaces the bottom nav on wide screens.
function SideNav({ active, onChange, name, upcomingCount, onOpenNotifications, hideAmounts, onToggleHide }) {
  const tabs = [
    { id: 'home', label: 'Inicio', Icon: Home },
    { id: 'debts', label: 'Deudas', Icon: CreditCard },
    { id: 'movements', label: 'Movimientos', Icon: ArrowLeftRight },
    { id: 'projection', label: 'Planes', Icon: TrendingUp },
    { id: 'settings', label: 'Ajustes', Icon: SettingsIcon },
  ];
  return (
    <aside className="desktop-sidenav">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px 22px' }}>
        <div className="display-font" style={{
          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
          background: 'linear-gradient(135deg, var(--primary), var(--primary-3))',
          color: '#04130D', fontSize: 20, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>$</div>
        <div style={{ minWidth: 0 }}>
          <p className="display-font" style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1 }}>Finanzas</p>
          <p className="tagline-script" style={{ fontSize: 15, marginTop: 1 }}>tu dinero, claro ✦</p>
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        {tabs.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <button key={id} onClick={() => onChange(id)} className={`sidenav-item${isActive ? ' is-active' : ''}`} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
              borderRadius: 12, border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
              background: isActive ? 'var(--primary-glow)' : 'transparent',
              color: isActive ? 'var(--primary)' : 'var(--text-dim)',
              fontSize: 14, fontWeight: isActive ? 600 : 500,
              transition: 'background 0.18s ease, color 0.18s ease',
            }}>
              <Icon size={19} color={isActive ? 'var(--primary)' : 'var(--text-muted)'} strokeWidth={isActive ? 2.5 : 2} />
              {label}
            </button>
          );
        })}
      </nav>

      <div style={{ display: 'flex', gap: 8, padding: '14px 6px 4px', borderTop: '1px solid var(--border-soft)' }}>
        <button onClick={onToggleHide} className="btn-ghost flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 11 }} title="Ocultar montos">
          {hideAmounts ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
        <button onClick={onOpenNotifications} className="btn-ghost flex items-center justify-center relative" style={{ width: 40, height: 40, borderRadius: 11 }} title="Próximos pagos">
          <Bell size={17} />
          {upcomingCount > 0 && (
            <span style={{
              position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, padding: '0 5px',
              borderRadius: 999, fontSize: 10, fontWeight: 700, lineHeight: '18px',
              background: 'var(--danger)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid var(--surface)',
            }}>{upcomingCount}</span>
          )}
        </button>
      </div>
    </aside>
  );
}

function FinanzasApp() {
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState('home');
  const [toast, setToast] = useState('');
  const [notifSheetOpen, setNotifSheetOpen] = useState(false);
  const [payDebtSheet, setPayDebtSheet] = useState(null);
  const [quickAdd, setQuickAdd] = useState(null);
  const [notifPermission, setNotifPermission] = useState('default');
  const isDesktop = useIsDesktop();

  // 3D tilt: one delegated listener animates any hovered hero/elevated card.
  // Pointer-fine devices only; mobile stays untouched.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const SEL = '.card-hero, .card-elevated';
    const MAX_DEG = 5;
    let current = null;
    let raf = null;
    let lastEvent = null;
    const reset = (el) => {
      el.classList.remove('is-tilting');
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    };
    const apply = () => {
      raf = null;
      if (!current || !lastEvent) return;
      const r = current.getBoundingClientRect();
      const px = (lastEvent.clientX - r.left) / r.width;
      const py = (lastEvent.clientY - r.top) / r.height;
      current.style.setProperty('--rx', ((0.5 - py) * MAX_DEG).toFixed(2) + 'deg');
      current.style.setProperty('--ry', ((px - 0.5) * MAX_DEG).toFixed(2) + 'deg');
      current.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
      current.style.setProperty('--my', (py * 100).toFixed(1) + '%');
    };
    const onOver = (e) => {
      const card = e.target.closest(SEL);
      if (card && card !== current) {
        if (current) reset(current);
        current = card;
        card.classList.add('is-tilting');
      }
    };
    const onOut = (e) => {
      if (current && !current.contains(e.relatedTarget)) { reset(current); current = null; }
    };
    const onMove = (e) => {
      if (!current) return;
      lastEvent = e;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
      if (current) reset(current);
    };
  }, []);
  // Auth & cloud sync state (only meaningful if SUPABASE_CONFIGURED)
  const [session, setSession] = useState(null);
  const [authChecking, setAuthChecking] = useState(SUPABASE_CONFIGURED);
  const [syncStatus, setSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'synced' | 'error' | 'conflict'
  const cloudSaveTimerRef = useRef(null);
  // Track the cloud's updated_at we've seen, so we can detect concurrent edits
  // from another device. Updated on every successful cloud load/save.
  const cloudVersionRef = useRef(null);
  const [conflictData, setConflictData] = useState(null); // { data, updatedAt }
  const [mfaRequired, setMfaRequired] = useState(false);

  const [data, setData] = useState({
    user: { name: '', currency: 'COP', themeOverride: null },
    debts: [], incomes: [], expenses: [], transactions: [], plans: [],
    savings: { current: 0, goal: 0, goalDate: '', emergencyMonths: 3, lifeBudgetPct: 0.15, bufferPct: 0.10, minLifeBudget: 0, currentBalance: 0, balanceUpdatedAt: '', monthlyContribution: 0 },
    settings: { hideAmounts: false, notificationsEnabled: false },
    // confirmations: tracks which payments/incomes have been marked as "actually happened"
    // Format: { 'YYYY-MM': { 'incomeId-itemId': { amount, date, note }, 'expenseId-itemId': {...}, 'debtPayment-itemId': {...} } }
    confirmations: {},
  });

  // Apply theme: explicit override wins over auto-detection
  const activeTheme = useMemo(() => {
    const override = data.user.themeOverride;
    const validThemes = ['default', 'feminine', 'ocean', 'sunset', 'forest', 'gold', 'midnight', 'studio'];
    // null/undefined = automatic; explicit string (including 'default') = manual choice
    if (override !== null && override !== undefined && validThemes.includes(override)) return override;
    return isFeminineName(data.user.name) ? 'feminine' : 'default';
  }, [data.user.name, data.user.themeOverride]);

  useEffect(() => {
    const themeColors = {
      default: '#07090F', feminine: '#110C19', ocean: '#04111E',
      sunset: '#170B11', forest: '#07120E', gold: '#110E08', midnight: '#07090F',
      studio: '#F4EFE3',
    };
    if (activeTheme && activeTheme !== 'default') {
      document.body.setAttribute('data-theme', activeTheme);
    } else {
      document.body.removeAttribute('data-theme');
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', themeColors[activeTheme] || '#07090F');
  }, [activeTheme]);

  // Helper: merge a payload into the data model with sensible defaults
  const applyPayload = (parsed) => {
    const cleanConfirmations = {};
    if (parsed && parsed.confirmations) {
      const now = new Date();
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      Object.keys(parsed.confirmations).forEach(monthKey => {
        const [yr, mo] = monthKey.split('-').map(Number);
        if (!isNaN(yr) && !isNaN(mo)) {
          const monthDate = new Date(yr, mo - 1, 1);
          if (monthDate >= cutoff) cleanConfirmations[monthKey] = parsed.confirmations[monthKey];
        }
      });
    }
    setData(prev => ({
      ...prev,
      ...(parsed || {}),
      plans: (parsed && parsed.plans) || [],
      confirmations: cleanConfirmations,
      savings: {
        current: 0, goal: 0, goalDate: '', emergencyMonths: 3,
        lifeBudgetPct: 0.15, bufferPct: 0.10, minLifeBudget: 0,
        currentBalance: 0, balanceUpdatedAt: '', monthlyContribution: 0,
        ...((parsed && parsed.savings) || {}),
      },
    }));
  };

  // Auth state listener (no-op when Supabase is not configured)
  useEffect(() => {
    if (!supabaseClient) { setAuthChecking(false); return; }
    let mounted = true;
    supabaseClient.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      setAuthChecking(false);
    });
    const { data: sub } = supabaseClient.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => { mounted = false; if (sub && sub.subscription) sub.subscription.unsubscribe(); };
  }, []);

  // Data load: cloud first (if logged in), then local fallback. Migrates local → cloud on first login.
  useEffect(() => {
    if (authChecking) return;
    let cancelled = false;
    (async () => {
      // Always read localStorage first (fast paint)
      let local = null;
      try {
        const raw = safeStorage.get(STORAGE_KEY);
        if (raw) local = JSON.parse(raw);
      } catch (e) {}

      if (supabaseClient && session) {
        setSyncStatus('syncing');
        const cloud = await cloudLoadData();
        if (cancelled) return;
        if (cloud && cloud.data && Object.keys(cloud.data).length > 0) {
          applyPayload(cloud.data);
          cloudVersionRef.current = cloud.updatedAt;
          try { safeStorage.set(STORAGE_KEY, JSON.stringify(cloud.data)); } catch (e) {}
          setSyncStatus('synced');
        } else if (local) {
          // First-time login on this user: push local → cloud
          applyPayload(local);
          const r = await cloudSaveData(local);
          if (r.ok) cloudVersionRef.current = r.updatedAt;
          setSyncStatus(r.ok ? 'synced' : 'error');
        } else {
          applyPayload(null);
          cloudVersionRef.current = null;
          setSyncStatus('synced');
        }
      } else {
        applyPayload(local);
      }
      setLoaded(true);
    })();
    if (typeof Notification !== 'undefined') setNotifPermission(Notification.permission);
    return () => { cancelled = true; };
  }, [session, authChecking]);

  // Auto-capture net worth snapshots on load and whenever the month changes.
  // We capture for the CURRENT month so the chart always has the latest data;
  // and we also backfill the PREVIOUS month if it's missing (avoids gaps).
  useEffect(() => {
    if (!loaded) return;
    const now = new Date();
    const curMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    updateData(d => {
      const snap = computeCurrentNetWorth(d);
      let history = d.netWorthHistory || [];
      // Backfill last month if missing — same numbers as today (best estimate)
      const hasPrev = history.find(h => h.monthKey === prevMonthKey);
      if (!hasPrev && history.length === 0) {
        history = captureNetWorthSnapshot(history, prevMonthKey, snap);
      }
      history = captureNetWorthSnapshot(history, curMonthKey, snap);
      return { ...d, netWorthHistory: history };
    });
    // Re-check every hour in case the user keeps the app open across month change
    const id = setInterval(() => {
      const now2 = new Date();
      const k = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}`;
      updateData(d => ({
        ...d,
        netWorthHistory: captureNetWorthSnapshot(d.netWorthHistory || [], k, computeCurrentNetWorth(d)),
      }));
    }, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [loaded]);

  // saveData: always write localStorage; if cloud + logged in, debounce a cloud upsert
  // with optimistic concurrency. If another device wrote after our last load,
  // we don't overwrite — we surface a conflict dialog so the user can choose.
  const saveData = useCallback((newData) => {
    try { safeStorage.set(STORAGE_KEY, JSON.stringify(newData)); } catch (e) {}
    if (supabaseClient && session) {
      setSyncStatus('syncing');
      if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
      cloudSaveTimerRef.current = setTimeout(async () => {
        const r = await cloudSaveData(newData, cloudVersionRef.current);
        if (r.ok) {
          cloudVersionRef.current = r.updatedAt;
          setSyncStatus('synced');
        } else if (r.conflict) {
          setConflictData(r.latest);
          setSyncStatus('conflict');
        } else {
          setSyncStatus('error');
        }
      }, 1200);
    }
  }, [session]);

  // User chose to keep their local changes — force-push, overwriting cloud
  const handleResolveKeepLocal = async () => {
    setSyncStatus('syncing');
    setConflictData(null);
    // Bypass conflict check by setting version to whatever is now in cloud
    if (conflictData) cloudVersionRef.current = conflictData.updatedAt;
    const r = await cloudSaveData(data, cloudVersionRef.current);
    if (r.ok) { cloudVersionRef.current = r.updatedAt; setSyncStatus('synced'); setToast('Tus cambios sobrescribieron la nube'); }
    else setSyncStatus('error');
  };

  // User chose to keep the other device's version — replace local with cloud
  const handleResolveKeepCloud = () => {
    if (!conflictData) return;
    applyPayload(conflictData.data);
    try { safeStorage.set(STORAGE_KEY, JSON.stringify(conflictData.data)); } catch (e) {}
    cloudVersionRef.current = conflictData.updatedAt;
    setConflictData(null);
    setSyncStatus('synced');
    setToast('Restauramos la versión de tu otro dispositivo');
  };

  const handleLogout = async () => {
    if (!supabaseClient) return;
    // Cancel any pending cloud upsert before signing out so we don't leak the
    // current state to a stale session.
    if (cloudSaveTimerRef.current) { clearTimeout(cloudSaveTimerRef.current); cloudSaveTimerRef.current = null; }
    await supabaseClient.auth.signOut();
    setSession(null);
    setSyncStatus('idle');
    // Clear local cache so the next user starts fresh
    try { safeStorage.remove(STORAGE_KEY); } catch (e) {}
    setLoaded(false);
    setToast('Sesión cerrada');
  };
  const updateData = useCallback((updater) => {
    setData(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveData(next);
      return next;
    });
  }, [saveData]);

  // Notifications scheduler — uses the Service Worker for showing notifications
  // (works on iOS 16.4+ when installed as PWA, plus better persistence on Android).
  // Falls back to `new Notification(...)` if no SW is registered.
  useEffect(() => {
    if (notifPermission !== 'granted') return;
    let swReg = null;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(r => { swReg = r; }).catch(() => {});
    }
    // Try to enable periodic background sync (Chrome only) — wakes the SW
    // once a day to message the page that something might need checking.
    if ('serviceWorker' in navigator && 'permissions' in navigator) {
      navigator.permissions.query({ name: 'periodic-background-sync' }).then((status) => {
        if (status.state === 'granted') {
          navigator.serviceWorker.ready.then(reg => {
            if ('periodicSync' in reg) {
              reg.periodicSync.register('check-payments', { minInterval: 24 * 60 * 60 * 1000 }).catch(() => {});
            }
          });
        }
      }).catch(() => {});
    }

    const sentKey = (k) => 'finanzas-notif-sent-' + k;
    const wasSent = (k) => {
      try { return !!localStorage.getItem(sentKey(k)); } catch (e) { return false; }
    };
    const markSent = (k) => {
      try { localStorage.setItem(sentKey(k), '1'); } catch (e) {}
    };

    const showNotif = (title, options) => {
      // Prefer the service worker registration (works on iOS PWA + persistent)
      if (swReg) {
        try { swReg.showNotification(title, { ...options, icon: undefined, badge: undefined }); return; }
        catch (e) {}
      }
      try { new Notification(title, options); } catch (e) {}
    };

    const checkNotifs = () => {
      const now = new Date();
      const todayStr = now.toDateString();
      // Debts
      (data.debts || []).forEach(d => {
        if (d.archived) return;
        const remaining = (d.totalAmount || 0) - (d.paidAmount || 0);
        if (remaining <= 0) return;
        if (isDebtFutureStart(d, now)) return;
        const next = getDebtNextPaymentDate(d, now);
        const days = daysBetween(now, next);
        const key = `debt-${d.id}-${days}-${todayStr}`;
        if ((days === 1 || days === 0) && !wasSent(key)) {
          showNotif(`Recordatorio: ${d.name}`, {
            body: days === 0
              ? `Hoy vence tu pago de ${formatMoney(d.minimumPayment, data.user.currency)}`
              : `Mañana vence tu pago de ${formatMoney(d.minimumPayment, data.user.currency)}`,
            tag: key,
            renotify: false,
          });
          markSent(key);
        }
      });
      // Recurring expenses due tomorrow or today (only if not confirmed for this month)
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const confirms = (data.confirmations && data.confirmations[monthKey]) || {};
      (data.expenses || []).filter(e => e.active && (e.frequency === 'monthly' || e.frequency === 'biweekly')).forEach(e => {
        const day = Math.min(e.dayOfMonth || 1, 28);
        const due = new Date(now.getFullYear(), now.getMonth(), day);
        const days = daysBetween(now, due);
        if (days !== 0 && days !== 1) return;
        if (confirms[`exp-${e.id}-${monthKey}`]) return;
        const key = `exp-${e.id}-${monthKey}-${days}`;
        if (wasSent(key)) return;
        showNotif(`Recordatorio: ${e.name}`, {
          body: days === 0
            ? `Hoy pagas ${formatMoney(e.amount, data.user.currency)}`
            : `Mañana pagas ${formatMoney(e.amount, data.user.currency)}`,
          tag: key,
        });
        markSent(key);
      });
    };
    checkNotifs();
    const interval = setInterval(checkNotifs, 60 * 60 * 1000); // every hour
    const onFocus = () => checkNotifs();
    const onSwMessage = (ev) => { if (ev.data && ev.data.type === 'CHECK_PAYMENTS') checkNotifs(); };
    window.addEventListener('focus', onFocus);
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onSwMessage);
    };
  }, [data.debts, data.expenses, data.confirmations, data.user.currency, notifPermission]);

  const handleSaveDebt = (debt) => {
    let wasNew = true;
    updateData(prev => {
      const exists = prev.debts.find(d => d.id === debt.id);
      wasNew = !exists;
      const debts = exists ? prev.debts.map(d => d.id === debt.id ? debt : d) : [...prev.debts, debt];
      return { ...prev, debts };
    });
    setToast(wasNew ? 'Deuda creada' : 'Deuda actualizada');
  };
  const handleDeleteDebt = (id) => {
    updateData(prev => ({ ...prev, debts: prev.debts.filter(d => d.id !== id), transactions: prev.transactions.filter(t => t.debtId !== id) }));
    setToast('Deuda eliminada');
  };
  const handleArchiveDebt = (id) => {
    let wasArchived = false;
    updateData(prev => {
      const debt = prev.debts.find(d => d.id === id);
      wasArchived = debt ? !!debt.archived : false;
      return { ...prev, debts: prev.debts.map(d => d.id === id ? { ...d, archived: !d.archived } : d) };
    });
    setToast(wasArchived ? 'Deuda restaurada' : 'Deuda archivada');
  };

  // Toggle confirmation: mark a payment/income as actually happened (or unmark)
  const handleConfirm = (key, info) => {
    let wasMarked = false;
    updateData(prev => {
      const monthKey = info.monthKey;
      const monthData = prev.confirmations[monthKey] || {};
      const next = { ...monthData };
      if (next[key]) {
        delete next[key];
        wasMarked = false;
      } else {
        next[key] = { confirmedAt: new Date().toISOString(), amount: info.amount, name: info.name };
        wasMarked = true;
      }
      return { ...prev, confirmations: { ...prev.confirmations, [monthKey]: next } };
    });
    const isIncome = key.startsWith('inc-');
    if (wasMarked) {
      setToast(isIncome ? 'Marcado como recibido' : 'Marcado como pagado');
      fireConfetti({ count: isIncome ? 80 : 50 });
    }
    else setToast('Marca quitada');
  };
  // Special handler: confirm a debt payment (also actually deducts from debt)
  const handleConfirmDebtPayment = (debtId, amount, monthKey) => {
    const key = `debt-${debtId}-${monthKey}`;
    let confirmed = false;
    updateData(prev => {
      const monthData = prev.confirmations[monthKey] || {};
      const isUnconfirming = !!monthData[key];
      let debts = prev.debts;
      let transactions = prev.transactions;
      if (isUnconfirming) {
        // Unconfirm: roll back using the actual amount that was applied
        const stored = monthData[key];
        const appliedAmount = stored && stored.appliedAmount != null ? stored.appliedAmount : amount;
        const debt = prev.debts.find(d => d.id === debtId);
        if (debt) {
          debts = prev.debts.map(d => d.id === debtId ? { ...d, paidAmount: Math.max(0, (d.paidAmount || 0) - appliedAmount) } : d);
          transactions = prev.transactions.filter(t => !(t.type === 'debt-payment' && t.debtId === debtId && t.autoConfirmKey === key));
        }
        confirmed = false;
      } else {
        // Confirm: apply, but clamp to remaining
        const debt = prev.debts.find(d => d.id === debtId);
        if (debt) {
          const remaining = debt.totalAmount - (debt.paidAmount || 0);
          const apply = Math.max(0, Math.min(amount, remaining));
          debts = prev.debts.map(d => d.id === debtId ? { ...d, paidAmount: (d.paidAmount || 0) + apply } : d);
          transactions = [...prev.transactions, { id: uid(), type: 'debt-payment', amount: apply, date: new Date().toISOString(), debtId, notes: 'Confirmado desde próximos pagos', autoConfirmKey: key }];
        }
        confirmed = true;
      }
      const next = { ...monthData };
      if (next[key]) delete next[key];
      else {
        // Store the applied amount so unconfirm rolls back the correct value
        const debt = prev.debts.find(d => d.id === debtId);
        const remaining = debt ? debt.totalAmount - (debt.paidAmount || 0) : amount;
        const apply = Math.max(0, Math.min(amount, remaining));
        next[key] = { confirmedAt: new Date().toISOString(), amount, appliedAmount: apply, debtId };
      }
      return {
        ...prev,
        debts, transactions,
        confirmations: { ...prev.confirmations, [monthKey]: next },
      };
    });
    setToast(confirmed ? 'Pago confirmado' : 'Pago descartado');
    if (confirmed) fireConfetti({ count: 55 });
  };
  const handlePayDebt = (id, amount, note) => {
    let debtCompleted = false;
    updateData(prev => {
      const debt = prev.debts.find(d => d.id === id);
      if (!debt) return prev;
      const newPaid = (debt.paidAmount || 0) + amount;
      debtCompleted = newPaid >= debt.totalAmount;
      return {
        ...prev,
        debts: prev.debts.map(d => d.id === id ? { ...d, paidAmount: newPaid } : d),
        transactions: [...prev.transactions, { id: uid(), type: 'debt-payment', amount, date: new Date().toISOString(), debtId: id, notes: note }],
      };
    });
    setToast(debtCompleted ? '🎉 ¡Deuda saldada por completo!' : `Pago de ${formatMoney(amount, data.user.currency)} registrado`);
    // Paying off a debt entirely earns the big celebration
    fireConfetti(debtCompleted ? { count: 160, spread: 10 } : { count: 60 });
  };
  const handleSaveMovement = (type, item, opts = {}) => {
    updateData(prev => {
      const key = type === 'income' ? 'incomes' : 'expenses';
      const exists = prev[key].find(x => x.id === item.id);
      const list = exists ? prev[key].map(x => x.id === item.id ? item : x) : [...prev[key], item];
      let next = { ...prev, [key]: list };
      // Auto-confirm this month's payment if requested ("ya pagué este mes")
      if (opts && opts.paidThisMonth) {
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const confirmKey = `${type === 'income' ? 'inc' : 'exp'}-${item.id}-${monthKey}`;
        const monthConfirms = { ...(prev.confirmations[monthKey] || {}) };
        monthConfirms[confirmKey] = {
          confirmedAt: new Date().toISOString(),
          amount: item.amount,
          name: item.name,
          autoMarked: true,
        };
        next.confirmations = { ...prev.confirmations, [monthKey]: monthConfirms };
      }
      return next;
    });
    setToast(opts && opts.paidThisMonth
      ? (type === 'income' ? 'Guardado y marcado como recibido' : 'Guardado y marcado como pagado')
      : (type === 'income' ? 'Ingreso guardado' : 'Egreso guardado'));
  };
  const handleBulkAddExpenses = (items) => {
    updateData(prev => {
      let list = [...prev.expenses];
      items.forEach(item => {
        const idx = list.findIndex(x => x.id === item.id);
        if (idx >= 0) list[idx] = item;
        else list.push(item);
      });
      return { ...prev, expenses: list };
    });
    setToast(`${items.length} servicio${items.length !== 1 ? 's' : ''} guardado${items.length !== 1 ? 's' : ''}`);
  };
  const handleSavePlan = (plan) => {
    updateData(prev => {
      const exists = (prev.plans || []).find(p => p.id === plan.id);
      const plans = exists ? prev.plans.map(p => p.id === plan.id ? plan : p) : [...(prev.plans || []), plan];
      return { ...prev, plans };
    });
    setToast('Plan guardado');
  };
  const handleDeletePlan = (id) => {
    updateData(prev => ({ ...prev, plans: (prev.plans || []).filter(p => p.id !== id) }));
    setToast('Plan eliminado');
  };
  const handleUpdateSavings = (savings) => {
    updateData(prev => ({ ...prev, savings: { ...prev.savings, ...savings } }));
    setToast('Ahorros actualizados');
  };
  // Checklist "Ahorro del mes": confirming moves the amount into formal savings;
  // unconfirming rolls it back (mirrors the debt-confirm pattern).
  const handleConfirmSavings = (monthKey, amount) => {
    const key = `sav-monthly-${monthKey}`;
    let confirmed = false;
    updateData(prev => {
      const monthData = prev.confirmations[monthKey] || {};
      const next = { ...monthData };
      let savings = prev.savings;
      if (next[key]) {
        const stored = next[key];
        const applied = stored.appliedAmount != null ? stored.appliedAmount : amount;
        savings = { ...prev.savings, current: Math.max(0, (prev.savings.current || 0) - applied) };
        delete next[key];
        confirmed = false;
      } else {
        savings = { ...prev.savings, current: (prev.savings.current || 0) + amount };
        next[key] = { confirmedAt: new Date().toISOString(), amount, appliedAmount: amount, name: 'Ahorro del mes' };
        confirmed = true;
      }
      return { ...prev, savings, confirmations: { ...prev.confirmations, [monthKey]: next } };
    });
    setToast(confirmed ? 'Ahorro del mes guardado 💰' : 'Ahorro desmarcado');
    if (confirmed) fireConfetti({ count: 90 });
  };
  const handleSaveNotes = (text) => {
    updateData(prev => ({ ...prev, userNotes: text }));
    setToast('Anotación guardada');
  };
  const handleExportCalendar = () => {
    try {
      const ics = generateICS(data);
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `finanzas-recordatorios.ics`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
      setToast('Calendario descargado. Ábrelo con Calendar.');
    } catch (e) { console.error(e); setToast('Error al generar calendario'); }
  };
  const handleDeleteMovement = (type, id) => {
    updateData(prev => {
      const key = type === 'income' ? 'incomes' : 'expenses';
      return { ...prev, [key]: prev[key].filter(x => x.id !== id) };
    });
    setToast('Eliminado');
  };
  const handleQuickTransaction = (type, payload) => {
    updateData(prev => ({ ...prev, transactions: [...prev.transactions, { id: uid(), type, amount: payload.amount, date: new Date().toISOString(), category: payload.category, notes: payload.notes }] }));
    setToast(type === 'income' ? 'Ingreso registrado' : 'Egreso registrado');
  };
  const handleExport = () => {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `finanzas-export-${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      // Record backup time so we can stop nagging
      updateData(prev => ({ ...prev, settings: { ...prev.settings, lastBackupAt: new Date().toISOString() } }));
      setToast('Backup descargado');
    } catch (e) { setToast('Error al exportar'); }
  };

  const handleExportCSV = () => {
    try {
      const csv = generateCSV(data);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `finanzas-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
      setToast('CSV descargado · ábrelo con Excel / Google Sheets');
    } catch (e) { setToast('Error al generar CSV'); }
  };

  // Import a previously-exported JSON backup, replacing current data after confirmation.
  const handleImport = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || typeof parsed !== 'object') throw new Error('Archivo inválido');
        updateData(prev => ({
          ...prev,
          ...parsed,
          // Keep current Supabase-related session intact
          user: { ...prev.user, ...(parsed.user || {}) },
        }));
        setToast('Datos importados');
      } catch (e) { setToast('Archivo inválido o corrupto'); }
    };
    reader.readAsText(file);
  };

  // Update per-category budget (called from MovementsScreen / Settings)
  const handleSetBudget = (categoryId, amount) => {
    updateData(prev => ({
      ...prev,
      budgets: { ...(prev.budgets || {}), [categoryId]: amount > 0 ? amount : 0 },
    }));
  };
  const handleReset = () => {
    const fresh = {
      user: { name: '', currency: 'COP', themeOverride: null },
      debts: [], incomes: [], expenses: [], transactions: [], plans: [],
      savings: { current: 0, goal: 0, goalDate: '', emergencyMonths: 3, lifeBudgetPct: 0.15, bufferPct: 0.10, minLifeBudget: 0, currentBalance: 0, balanceUpdatedAt: '', monthlyContribution: 0 },
      settings: { hideAmounts: false, notificationsEnabled: false },
      confirmations: {},
    };
    safeStorage.set(STORAGE_KEY, JSON.stringify(fresh));
    try { safeStorage.remove(TIP_DISMISSED_KEY); } catch(e) {}
    setData(fresh);
    setTab('home');
    setToast('Todo restablecido');
  };
  const handleRequestNotifs = async () => {
    if (typeof Notification === 'undefined') { setToast('Tu navegador no soporta notificaciones'); return; }
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
    if (perm === 'granted') {
      try {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(reg => reg.showNotification('✓ Notificaciones activadas', {
            body: 'Te avisaremos antes de cada pago, incluso si cierras la app.', tag: 'welcome-notif',
          }));
        } else {
          new Notification('✓ Notificaciones activadas', { body: 'Te avisaremos antes de cada pago.' });
        }
      } catch (e) {}
      setToast('Notificaciones activadas');
    } else setToast('Notificaciones no activadas');
  };

  const upcomingCount = useMemo(() => {
    const now = new Date();
    return data.debts.filter(d => {
      if (d.archived) return false;
      if ((d.totalAmount - (d.paidAmount||0)) <= 0) return false;
      if (isDebtFutureStart(d, now)) return false;
      const days = daysBetween(now, getDebtNextPaymentDate(d, now));
      return days <= 7;
    }).length;
  }, [data.debts]);

  // Ambient mood: tints the aurora background by this month's projected flow.
  // Positive month → calm green; negative month → warm warning hues.
  const mood = useMemo(() => {
    try {
      const proj = buildMonthlyProjection(data, 1);
      if (!proj[0]) return 'neutral';
      return proj[0].cashFlow >= 0 ? 'positive' : 'negative';
    } catch (e) { return 'neutral'; }
  }, [data]);

  // Branded loader: 3D coin flip with the $ logo
  const Loader = ({ label }) => (
    <div className="finanzas-app min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="coin-spin display-font" style={{
          width: 56, height: 56, margin: '0 auto 16px', borderRadius: 16,
          background: 'linear-gradient(135deg, var(--primary), var(--primary-3))',
          color: '#04130D', fontSize: 28, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 10px 30px -8px var(--primary-glow)',
        }}>$</div>
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{label}</p>
      </div>
    </div>
  );
  // While checking auth, show loader
  if (authChecking) return <Loader label="Conectando..." />;
  // If Supabase is configured but the user is not logged in, show the auth screen
  if (SUPABASE_CONFIGURED && !session) {
    return <AuthScreen onLoggedIn={() => { /* session listener will pick it up */ }} />;
  }
  if (!loaded) return <Loader label="Cargando..." />;
  if (!data.user.name) {
    return <Onboarding onComplete={(u) => updateData(prev => ({ ...prev, user: { ...prev.user, ...u } }))} />;
  }

  return (
    <div className={`finanzas-app min-h-screen safe-top${isDesktop ? ' desktop-layout' : ''}`} data-mood={mood}>
      {(() => {
        const screens = (
          <>
            {tab === 'home' && <Dashboard data={data} currency={data.user.currency} hideAmounts={data.settings.hideAmounts} onNavigate={setTab} onPayDebt={(d) => setPayDebtSheet(d)} onAddTransaction={(t) => setQuickAdd(t)} onConfirm={handleConfirm} onConfirmDebt={handleConfirmDebtPayment} onUpdateSavings={handleUpdateSavings} onConfirmSavings={handleConfirmSavings} onSaveNotes={handleSaveNotes} />}
            {tab === 'debts' && <DebtsScreen data={data} currency={data.user.currency} hideAmounts={data.settings.hideAmounts} onSave={handleSaveDebt} onDelete={handleDeleteDebt} onArchive={handleArchiveDebt} onPay={handlePayDebt} />}
            {tab === 'movements' && <MovementsScreen data={data} currency={data.user.currency} hideAmounts={data.settings.hideAmounts} onSave={handleSaveMovement} onDelete={handleDeleteMovement} onBulkAdd={handleBulkAddExpenses} onSetBudget={handleSetBudget} />}
            {tab === 'projection' && <PlanesScreen data={data} currency={data.user.currency} hideAmounts={data.settings.hideAmounts} onUpdateSavings={handleUpdateSavings} onSavePlan={handleSavePlan} onDeletePlan={handleDeletePlan} />}
            {tab === 'settings' && <SettingsScreen data={data} onUpdateUser={(u) => updateData(prev => ({ ...prev, user: { ...prev.user, ...u } }))} onUpdateSettings={(s) => updateData(prev => ({ ...prev, settings: { ...prev.settings, ...s } }))} onExport={handleExport} onExportCSV={handleExportCSV} onImport={handleImport} onExportCalendar={handleExportCalendar} onReset={handleReset} onRequestNotifications={handleRequestNotifs} notifPermission={notifPermission} session={session} syncStatus={syncStatus} onLogout={handleLogout} currency={data.user.currency} />}
          </>
        );
        if (isDesktop) {
          const tabTitles = { home: 'Inicio', debts: 'Deudas', movements: 'Movimientos', projection: 'Planes', settings: 'Ajustes' };
          return (
            <div className="desktop-shell">
              <SideNav
                active={tab} onChange={setTab} name={data.user.name}
                upcomingCount={upcomingCount}
                onOpenNotifications={() => setNotifSheetOpen(true)}
                hideAmounts={data.settings.hideAmounts}
                onToggleHide={() => updateData(prev => ({ ...prev, settings: { ...prev.settings, hideAmounts: !prev.settings.hideAmounts } }))}
              />
              <main className="desktop-main">
                <div className="desktop-topbar">
                  <div>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
                      {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                    <h1 className="display-font" style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1.1, marginTop: 2 }}>
                      {tab === 'home' ? <>Hola, <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{data.user.name || 'amigo'}</span></> : tabTitles[tab]}
                    </h1>
                  </div>
                </div>
                <div className="desktop-content" data-tab={tab}>
                  {/* key={tab} re-mounts the wrapper so the enter animation plays on every switch */}
                  <div key={tab} className="animate-tab">{screens}</div>
                </div>
              </main>
            </div>
          );
        }
        return (
          <div className="relative z-10">
            <Header
              name={data.user.name}
              hideAmounts={data.settings.hideAmounts}
              onToggleHide={() => updateData(prev => ({ ...prev, settings: { ...prev.settings, hideAmounts: !prev.settings.hideAmounts } }))}
              onOpenNotifications={() => setNotifSheetOpen(true)}
              upcomingCount={upcomingCount}
            />
            <div key={tab} className="animate-tab">{screens}</div>
            <BottomNav active={tab} onChange={setTab} />
          </div>
        );
      })()}
      <div className="relative z-10">
        <Sheet open={notifSheetOpen} onClose={() => setNotifSheetOpen(false)} title="Próximos pagos" size="md">
          <NotificationsList data={data} currency={data.user.currency} hideAmounts={data.settings.hideAmounts} onPay={(d) => setPayDebtSheet(d)} onClose={() => setNotifSheetOpen(false)} />
        </Sheet>
        <Sheet open={!!payDebtSheet} onClose={() => setPayDebtSheet(null)} title="Registrar pago" size="md">
          {payDebtSheet && <PayDebtForm debt={data.debts.find(x => x.id === payDebtSheet.id) || payDebtSheet} currency={data.user.currency} onPay={(amount, note) => { handlePayDebt(payDebtSheet.id, amount, note); setPayDebtSheet(null); }} />}
        </Sheet>
        <Sheet open={!!quickAdd} onClose={() => setQuickAdd(null)} title={quickAdd === 'income' ? 'Nuevo ingreso' : 'Nuevo egreso'} size="md">
          {quickAdd && <QuickTransactionForm type={quickAdd} currency={data.user.currency} onSave={(p) => { handleQuickTransaction(quickAdd, p); setQuickAdd(null); }} />}
        </Sheet>
        <Toast message={toast} onClose={() => setToast('')} />
        {/* Conflict resolution dialog: appears when cloud was changed by another device */}
        <Sheet open={!!conflictData} onClose={() => { /* no-op: must choose */ }} title="Cambios en otro dispositivo" size="md">
          <div className="space-y-4">
            <div className="rounded-2xl p-4" style={{ background: 'var(--warning-glow)', border: '1px solid rgba(251,191,36,0.3)' }}>
              <div className="flex items-start gap-2">
                <AlertCircle size={18} color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Tu otro dispositivo guardó algo después de tu última carga.</p>
                  <p style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                    Para evitar pisar esos cambios sin querer, elige qué versión conservar. Si quieres ver primero qué hay en la nube, descarga la última versión.
                  </p>
                </div>
              </div>
            </div>
            <button onClick={handleResolveKeepCloud} className="btn-primary w-full rounded-2xl py-3.5 text-sm font-semibold">
              Usar la versión de mi otro dispositivo (descartar lo que hice aquí)
            </button>
            <button onClick={handleResolveKeepLocal} className="w-full rounded-2xl py-3.5 text-sm font-semibold" style={{ background: 'var(--danger-glow)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.25)' }}>
              Pisar la nube con lo que hice aquí
            </button>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center' }}>
              Esta ventana no se cierra hasta que elijas. No queremos perder tus datos.
            </p>
          </div>
        </Sheet>
      </div>
    </div>
  );
}

export default FinanzasApp;
