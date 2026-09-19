'use client';

// Bring your own: your words, your name, your key, your model, your voice.
//
// Where each thing lives, and why:
//  - Profile and words: this browser's localStorage, so they survive a reload.
//    Nothing is sent anywhere until you start a call, and then only to the
//    orchestrator for that call. "Forget everything" clears it.
//  - API key: sessionStorage by default, so it is gone when the tab closes.
//    Kept across sessions only if you tick "remember on this device".
//    It is sent to the orchestrator when a call starts, used for that call,
//    and never stored or logged there.

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_VOICE, isVoice, type CallerProfile, type LexiconTerm, type VoiceId } from '@one-moment/core';

export type Settings = {
  name: string;
  pronoun: CallerProfile['pronoun'];
  yesNo: CallerProfile['yesNoReliability'];
  context: string;
  words: LexiconTerm[];
  model: string;
  /** Which AssemblyAI voice speaks for the caller. */
  voice: VoiceId;
};

export const EMPTY_SETTINGS: Settings = { name: '', pronoun: 'they', yesNo: 'unknown', context: '', words: [], model: '', voice: DEFAULT_VOICE };

const PROFILE_KEY = 'om-profile';
const KEY_KEY = 'om-key';

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export function loadSettings(): Settings {
  return safe(() => {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? { ...EMPTY_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : EMPTY_SETTINGS;
  }, EMPTY_SETTINGS);
}

export function saveSettings(s: Settings): void {
  safe(() => localStorage.setItem(PROFILE_KEY, JSON.stringify(s)), undefined);
}

export function loadKey(): { key: string; remembered: boolean } {
  return safe(() => {
    const local = localStorage.getItem(KEY_KEY);
    if (local) return { key: local, remembered: true };
    return { key: sessionStorage.getItem(KEY_KEY) ?? '', remembered: false };
  }, { key: '', remembered: false });
}

export function saveKey(key: string, remember: boolean): void {
  safe(() => {
    localStorage.removeItem(KEY_KEY);
    sessionStorage.removeItem(KEY_KEY);
    if (!key) return;
    (remember ? localStorage : sessionStorage).setItem(KEY_KEY, key);
  }, undefined);
}

export function forgetEverything(): void {
  safe(() => {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(KEY_KEY);
    sessionStorage.removeItem(KEY_KEY);
  }, undefined);
}

/** A profile is usable once it has a name. */
export const hasProfile = (s: Settings) => s.name.trim().length > 0;

export function toProfile(s: Settings): CallerProfile {
  return {
    displayName: s.name.trim(),
    pronoun: s.pronoun,
    yesNoReliability: s.yesNo,
    ...(s.context.trim() ? { context: s.context.trim() } : {}),
  };
}

/** The portable form, for "take it elsewhere". The key is never included. */
export function exportSettings(s: Settings): string {
  return JSON.stringify({ format: 'one-moment-profile', version: 1, ...s }, null, 2);
}

export function importSettings(text: string): Settings {
  const j = JSON.parse(text) as Partial<Settings> & { format?: string };
  if (j.format !== 'one-moment-profile') throw new Error('That file is not a One Moment profile.');
  const words = Array.isArray(j.words) ? j.words.filter((w): w is LexiconTerm => typeof w?.term === 'string').slice(0, 100) : [];
  return {
    ...EMPTY_SETTINGS,
    name: String(j.name ?? '').slice(0, 40),
    pronoun: j.pronoun === 'he' || j.pronoun === 'she' ? j.pronoun : 'they',
    yesNo: j.yesNo === 'reliable' || j.yesNo === 'unreliable' ? j.yesNo : 'unknown',
    context: String(j.context ?? '').slice(0, 500),
    words,
    model: String(j.model ?? ''),
    voice: isVoice(j.voice) ? j.voice : DEFAULT_VOICE,
  };
}

/** Settings as React state, loaded after mount so server and client render the same. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [key, setKeyState] = useState({ key: '', remembered: false });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setSettings(loadSettings());
    setKeyState(loadKey());
    setLoaded(true);
  }, []);
  const update = useCallback((s: Settings) => { setSettings(s); saveSettings(s); }, []);
  const setKey = useCallback((k: string, remember: boolean) => { setKeyState({ key: k, remembered: remember }); saveKey(k, remember); }, []);
  return { settings, update, key, setKey, loaded };
}
