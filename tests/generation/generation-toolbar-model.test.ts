/**
 * The home prompt box no longer offers a model pill: the course model is
 * picked in workspace settings. The only model surface left here is the
 * #580 set-up CTA, which appears when no usable chat provider exists so
 * the homepage never dead-ends.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en-US' }),
}));

import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { modelSettingsClient, type ModelSettingsView } from '@/lib/model-settings/client';

import { modelSettingsViewFor } from '../helpers/model-settings-view';

function render(view: ModelSettingsView) {
  modelSettingsClient.adopt(view);
  return renderToStaticMarkup(
    createElement(GenerationToolbar, {
      courseMaterials: [],
      onCourseMaterialsAdd: () => {},
      onCourseMaterialRemove: () => {},
      onPdfError: () => {},
      onSettingsOpen: () => {},
    }),
  );
}

function withChatProvider(view: ModelSettingsView): ModelSettingsView {
  view.providers = [
    {
      id: 'openai',
      preset: 'openai',
      presetName: 'OpenAI',
      presetKind: 'single',
      source: 'workspace',
      capabilities: { chat: { models: [{ id: 'gpt-5', name: 'GPT-5' }] } },
      key: { set: true },
    },
  ];
  return view;
}

afterEach(() => modelSettingsClient.adopt(null));

/** The slots course generation needs resolved before nothing is missing. */
function usableCourseView(): ModelSettingsView {
  const target = { registryId: 'openai', providerId: 'openai', modelId: 'gpt-5' };
  return modelSettingsViewFor({
    llm: target,
    'course.outline': target,
    'course.actions': target,
    'course.content.slide': target,
  });
}

describe('the toolbar course model', () => {
  it('shows no model name or picker when the course model is set', () => {
    const markup = render(withChatProvider(usableCourseView()));
    expect(markup).not.toContain('gpt-5');
    expect(markup).not.toContain('toolbar.pickModel');
    expect(markup).not.toContain('toolbar.configureProvider');
  });

  it('asks to set up a model when nothing usable is configured', () => {
    const markup = render(modelSettingsViewFor({}));
    expect(markup).toContain('toolbar.configureProvider');
    expect(markup).not.toContain('toolbar.pickModel');
  });

  it('renders no model control at all when the deployment locks the default model', () => {
    const view = withChatProvider(usableCourseView());
    view.slots.find((slot) => slot.slot === 'llm')!.locked = true;
    const markup = render(view);
    expect(markup).not.toContain('gpt-5');
    expect(markup).not.toContain('toolbar.pickModel');
    expect(markup).not.toContain('toolbar.configureProvider');
  });
});
