// @vitest-environment jsdom

/**
 * The home prompt box carries no model pill: the default course model is set
 * in workspace settings, and the toolbar only surfaces the #580 set-up CTA
 * when no usable chat provider would let generation run. No model name,
 * no picker, and no per-stage notes leak into the prompt box.
 *
 * The i18n hook returns keys (with interpolated values appended).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? [key, ...Object.values(options)].join('|') : key,
    locale: 'en-US',
    setLocale: () => {},
  }),
}));

import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import type { SettingsSection } from '@/lib/types/settings';
import {
  modelSettingsClient,
  type ModelSettingsView,
  type SlotView,
} from '@/lib/model-settings/client';

import { makeView, withLlm, withSlots, workspaceProvider } from '../model-settings/fixtures';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  modelSettingsClient.adopt(null);
});

function own(slot: string, ref: string): Partial<SlotView> {
  const [providerId, modelId] = ref.split(':');
  return {
    assignment: ref,
    effective: {
      status: 'assigned',
      resolvedAt: slot as SlotView['slot'],
      source: 'workspace',
      requirements: [],
      providerId,
      providerSource: 'workspace',
      presetId: providerId,
      registryId: 'x',
      modelId,
    },
  };
}

/** A workspace with the Acme plan and another provider, `llm` on Acme Large. */
function workspace(patch: Record<string, Partial<SlotView>> = {}): ModelSettingsView {
  const other = {
    ...workspaceProvider('other'),
    preset: 'openai-compatible',
    capabilities: { chat: { models: [{ id: 'gpt-5', name: 'GPT-5' }] } },
  };
  return withSlots(
    withLlm(makeView({ providers: [workspaceProvider('acme'), other] }), 'acme:acme-large'),
    patch,
  );
}

function mount(view: ModelSettingsView) {
  modelSettingsClient.adopt(view);
  const opened: SettingsSection[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      createElement(GenerationToolbar, {
        courseMaterials: [],
        onCourseMaterialsAdd: () => {},
        onCourseMaterialRemove: () => {},
        onPdfError: () => {},
        onSettingsOpen: (section: SettingsSection) => opened.push(section),
      }),
    ),
  );
  return { host, opened };
}

function buttonWith(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(text),
  );
}

function click(element: HTMLElement) {
  act(() => {
    element.click();
  });
}

/** The stages course generation resolves before nothing is missing. */
const COURSE_STAGES = [
  'course.outline',
  'course.content.slide',
  'course.content.quiz',
  'course.content.interactive',
  'course.content.pbl',
  'course.actions',
];

describe('the home prompt box model surface', () => {
  it('shows no model name or picker when the course model is set', () => {
    const { host, opened } = mount(
      workspace(
        Object.fromEntries(COURSE_STAGES.map((slot) => [slot, own(slot, 'acme:acme-small')])),
      ),
    );
    expect(host.querySelector('[aria-label="acme / acme-large"]')).toBeNull();
    expect(host.textContent).not.toContain('Acme Large');
    expect(buttonWith('toolbar.configureProvider')).toBeUndefined();
    expect(opened).toEqual([]);
  });

  it('asks to set up a model when nothing usable is configured', () => {
    const { opened } = mount(makeView({ providers: [workspaceProvider('acme')] }));
    const cta = buttonWith('toolbar.configureProvider');
    expect(cta).toBeDefined();
    click(cta!);
    expect(opened.length).toBe(1);
  });

  it('renders nothing when the default model is locked', () => {
    const view = workspace({ 'course.outline': own('course.outline', 'other:gpt-5') });
    view.slots.find((slot) => slot.slot === 'llm')!.locked = true;
    const { host } = mount(view);
    expect(host.querySelector('[aria-label="acme / acme-large"]')).toBeNull();
    expect(host.textContent).not.toContain('Acme Large');
  });

  it('says nothing in the prompt box about stages set separately', () => {
    const { host } = mount(
      workspace({
        ...Object.fromEntries(COURSE_STAGES.map((slot) => [slot, own(slot, 'acme:acme-small')])),
        'course.outline': own('course.outline', 'other:gpt-5'),
        classroom: own('classroom', 'acme:acme-small'),
      }),
    );
    expect(host.textContent).not.toMatch(/separately|perStage/i);
    expect(buttonWith('toolbar.stagesSetSeparately')).toBeUndefined();
  });
});
