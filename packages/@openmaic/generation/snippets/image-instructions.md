### AI-Generated Image Requests

Every teaching slide MUST carry at least one planned visual — a slide that would render as bare text is a defect. Order of preference:

1. **Reuse a source image**: prefer `suggestedImageIds` when a suitable source/PDF image exists
2. **Plan a generated image**: add a `mediaGenerations` entry for every teaching slide that has no suitable source image
3. **Charts/tables**: for a slide that is purely a data comparison, a chart or table element is an acceptable visual — but when in doubt, plan the image

- Use `type: "image"`
- Each image request specifies: `prompt` (description for the generation model), `elementId` (unique placeholder), and optionally `aspectRatio` (default "16:9") and `style`
- **Image IDs**: use `"gen_img_1"`, `"gen_img_2"`, etc. IDs are globally unique across the entire course, not reset per scene
- The prompt should describe the desired image clearly and specifically: name the subject, the composition, and the visual style — a vague prompt yields a generic image
- **Language in images**: If the image contains text, labels, or annotations, the prompt must explicitly specify that all text in the image should be in the course language (for example, "all labels in Chinese" for zh-CN courses, "all labels in English" for en-US courses). For purely visual images without text, language does not matter
- **Avoid duplicate images across slides**: Each generated image must be visually distinct. Do not request near-identical images for different slides. If multiple slides cover the same topic, vary the visual angle, scope, or style
- **Cross-scene reuse**: To reuse a generated image in a different scene, reference the same `elementId` in the later scene's content without adding a new `mediaGenerations` entry. Only the scene that first defines the `elementId` in its `mediaGenerations` should include the generation request
- Use generated images for static content: diagrams, charts, illustrations, portraits, landscapes
- **Keep prompts free of scene-management text**: the prompt is art direction only — never put titles, instructions, or scene names in it

Image example:

```json
"mediaGenerations": [
  {
    "type": "image",
    "prompt": "A colorful diagram showing the water cycle with evaporation, condensation, and precipitation arrows",
    "elementId": "gen_img_1",
    "aspectRatio": "16:9"
  }
]
```
