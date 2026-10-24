Title: {{title}}
Concept: {{conceptName}}
Description: {{description}}
Design Idea: {{designIdea}}
Key Points: {{keyPoints}}
Widget Type: {{widgetType}}
Widget Config JSON: {{widgetConfig}}

Element Inventory (from the generated widget HTML — prefer these real selectors over any convention below):
{{elementInventory}}

{{#if startPhase}}
Scene Phase (this scene drives ONE phase of the intro's shared master timeline — this is the scene's play button):
- startPhase: {{startPhase}}
- phaseLabel: {{phaseLabel}}
{{/if}}

{{courseContext}}
{{agents}}

**Language Directive**: {{languageDirective}}

Output as a JSON array directly (no explanation, no code fences, 3-8 speech/widget-action items):
- startPhase is "p0"-style: lead with widget_setState {"state":{"phase":startPhase}}, then 1-2 speech beats for that phase only
[{"type":"action","name":"widget_setState","params":{"state":{"phase":"p0"}}},{"type":"text","content":"Opening speech for this beat"}]
