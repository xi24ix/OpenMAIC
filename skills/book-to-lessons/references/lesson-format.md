# Lesson document format

The lesson document is the `MaicDocument` shape the app stores and the PUT
endpoint accepts: `{ stage, scenes, outline }`. It is validated on the server by
`validateAppStage` / `validateAppScene` (`lib/document-store/validators.ts`),
which delegate `slide`/`quiz` scenes to `@openmaic/dsl` `validateScene`.

## stage

Required by `validateStage`: string `id`, string `name`, number `createdAt`,
number `updatedAt`. Optional: `description`, `languageDirective`, `style`,
`whiteboard`, `agentIds`, `generatedAgentConfigs`, `interactiveMode`,
`taskEngineMode`, `videoManifest`.

`currentSceneId` is device playback state and is refused on the app stage.

The server mints `id` at `POST /api/stages` and bumps `updatedAt` on PUT; the
push script rewrites both fields before saving.

## scenes[]

Every scene:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | unique within the document (e.g. `scene-u1-01`) |
| `stageId` | string | must equal `stage.id`; rewritten at push time |
| `title` | string | learner-facing; shown in page lists |
| `order` | number | 1-based display order |
| `type` | `slide` \| `quiz` \| `interactive` \| `pbl` | must equal `content.type` |
| `content` | object | shape per type below |
| `actions` | array, optional | omit for authored lessons (no narration/TTS in v1) |

### interactive content

```json
{ "type": "interactive", "html": "<!doctype html>..." }
```

- At least one of `html` (string) or `url` (string). `html` is rendered via
  iframe `srcDoc`, sandbox `allow-scripts allow-forms allow-popups`
  (no `allow-same-origin`).
- Optional `widgetType` (`simulation | diagram | code | game | visualization3d
  | procedural-skill`) and `widgetConfig` (object with a valid `type`) — both
  omitted for authored HTML lessons.

### quiz content

```json
{
  "type": "quiz",
  "questions": [
    {
      "id": "q1",
      "type": "single",
      "question": "The main idea of the passage is ...",
      "options": [
        { "label": "Modernisation has changed eating habits.", "value": "A" },
        { "label": "The traditional diet suited pearl diving.", "value": "B" }
      ],
      "answer": ["A"],
      "analysis": "الفكرة الرئيسية ...",
      "points": 1
    }
  ]
}
```

- `type`: `single` (one value in `answer`), `multiple` (several), or
  `short_answer` (`answer` is a list of accepted strings; add
  `hasAnswer: true` when an accepted answer exists).
- `options` order is display order; `value` is what `answer` points to.
- `analysis` is the Arabic explanation; `points` default 1.
- The document write barrier only requires `questions` to be an array; the
  question/option contract above is what the renderers consume — follow it.

### slide / pbl

Not used by authored book lessons. `slide` requires a full PPTist canvas
(`content.canvas`); `pbl` requires `projectV2` containers. Author `interactive`
or `quiz` instead unless there is a concrete reason.

## outline

`AppDocumentOutline`: `{ outlines: [], requirement, generationComplete,
createdAt, updatedAt }`. Authored lessons set `generationComplete: true` so the
workspace treats the stage as finished (no generation run pending). `outline`
is optional on PUT; POST-created documents always have one — keep it.

## Validation mirror (what the push script checks locally)

- document: `stage` object with required fields; `scenes` array.
- scene: `id`/`stageId`/`title` non-empty strings; finite `order`; known `type`;
  object `content`; `content.type === scene.type`.
- quiz: `content.questions` array; each question has string `id`, valid `type`,
  string `question`; each option has string `label` and `value`; `answer` (when
  present) is an array of strings that all point at an existing option value
  (warning — semantic); `text` values non-empty.
- interactive: `html` or `url` a string; `widgetType`/`widgetConfig` valid when
  present.
- actions (when present): array of objects with string `id` and `type`; known
  action types run the DSL action-required-field check (do not author actions).
- warnings (not fatal): scene ids not unique, orders not `1..N`, quiz `single`
  with multiple answers, `answer` values missing from options.

## Sources of truth

- `packages/@openmaic/dsl/src/stage.ts` — `Stage`, `SceneCore`, `SceneType`,
  `QuizContent`, `QuizQuestion`, `QuizOption`.
- `packages/@openmaic/dsl/src/interactive.ts` — `InteractiveContent`,
  `isInteractiveContent`.
- `packages/@openmaic/dsl/src/validate.ts` — `validateStage`, `validateScene`.
- `lib/document-store/validators.ts` — the app write barrier.
- `skills/agent-runtime/stage-dsl/references/quiz.md` and `widget.md` — the
  in-app agent's field manual (same contract, editor-oriented).
