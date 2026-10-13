'use client';

import { useI18n } from '@/lib/hooks/use-i18n';
import { supportedLocales } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Languages } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface LanguageSwitcherProps {
  /** Called when the dropdown opens, so parent can close sibling dropdowns. */
  onOpen?: () => void;
}

/**
 * Language icon pill. Alostad is Arabic-first with English as the only
 * alternative, so the trigger is a globe-languages icon plus the active
 * locale's short label (AR / EN) and the menu lists just those two.
 * Backed by Radix DropdownMenu so its content is portaled to
 * `document.body` — important inside Pro mode's CommandBar
 * (which lives under an `overflow-hidden` canvas slot that would
 * otherwise clip the dropdown).
 */
export function LanguageSwitcher({ onOpen }: LanguageSwitcherProps) {
  const { locale, setLocale } = useI18n();

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) onOpen?.();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          aria-label={supportedLocales.find((l) => l.code === locale)?.label ?? locale}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all"
        >
          <Languages className="h-3.5 w-3.5" aria-hidden="true" />
          {supportedLocales.find((l) => l.code === locale)?.shortLabel ?? locale}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[120px]">
        {supportedLocales.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onSelect={() => setLocale(l.code)}
            className={cn(
              'cursor-pointer',
              locale === l.code &&
                'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
            )}
          >
            {l.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
