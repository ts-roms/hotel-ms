'use client';

import { Button } from '@hotel/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { THEME_KEY } from '@/components/theme-script';

type Theme = 'light' | 'dark' | 'system';

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

const ORDER: Theme[] = ['system', 'light', 'dark'];
const ICONS = { system: Monitor, light: Sun, dark: Moon };

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => setTheme(readTheme()), []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme('system');
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, [theme]);

  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
  const Icon = ICONS[theme];
  const label = `${t('theme.label')}: ${t(`theme.${theme}`)}`;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={label}
      title={label}
      onClick={() => {
        try {
          if (next === 'system') localStorage.removeItem(THEME_KEY);
          else localStorage.setItem(THEME_KEY, next);
        } catch {
          // Storage unavailable: the choice lasts for this page only.
        }
        setTheme(next);
      }}
    >
      <Icon key={theme} className="animate-scale-in" />
    </Button>
  );
}
