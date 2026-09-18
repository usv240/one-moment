'use client';

// Three states, not two: System follows the OS, Light and Dark are explicit.
// Persisted inside try/catch because localStorage throws in private browsing.

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type Choice = 'system' | 'light' | 'dark';
const KEY = 'om-theme';

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage unavailable: the choice still applies for this page view */
  }
}

const OPTIONS: { value: Choice; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'Match my device', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>('system');

  useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme');
    setChoice(t === 'light' || t === 'dark' ? t : 'system');
  }, []);

  return (
    <div role="radiogroup" aria-label="Color theme" className="flex items-center rounded-full border border-line bg-raised p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => {
        const on = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => { setChoice(value); apply(value); }}
            className={`grid h-8 w-8 place-items-center rounded-full transition-colors duration-150 ${
              on ? 'bg-accent text-accent-fg' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon aria-hidden className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
