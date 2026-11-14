/**
 * The audience and learning-support instruction texts and the profile → skill
 * mapping, in one dependency-free module: the curriculum preparation composes
 * them into its prepared requirement, the engine injects them for free-prompt
 * runs, and the support-profile evaluation imports them without dragging the
 * curriculum client's dependencies along.
 */

export type LessonAudience = 'student' | 'parent' | 'teacher';
export type SupportProfile = 'none' | 'autism' | 'adhd' | 'learning-difficulties';
export type TeachingStyle = 'game' | 'animation';

export function audienceInstruction(audience: LessonAudience): string {
  switch (audience) {
    case 'parent':
      return 'The lesson is being prepared by a parent for a student. Keep the learner-facing language direct, and include one short note for the parent on how to support without giving the answer.';
    case 'teacher':
      return 'The lesson is being prepared by a teacher. Make the classroom actions explicit and include observable evidence of learning.';
    default:
      return 'The lesson is for a high-school student. Use clear, age-appropriate language and invite the learner to do the thinking.';
  }
}

export function supportInstruction(profile: SupportProfile): string {
  switch (profile) {
    case 'autism':
      return 'Use predictable structure, explicit transitions, low-sensory visual hierarchy, literal and unambiguous language, one task at a time, optional response modes, and a clear success criterion. Do not infer or claim a diagnosis; adapt the lesson to the selected support needs.';
    case 'adhd':
      return 'Use short task cycles, visible progress, chunked instructions, active retrieval, frequent meaningful choices, reduced distraction, movement or interaction where useful, and immediate specific feedback. Do not infer or claim a diagnosis; adapt the lesson to the selected support needs.';
    case 'learning-difficulties':
      return 'Use explicit modelling, worked examples, multiple representations, vocabulary support, reduced copying load, guided practice followed by a new independent check, and extra processing time. Do not infer or claim a diagnosis; adapt the lesson to the selected support needs.';
    default:
      return 'Use universal-design supports: clear objectives, readable structure, multiple ways to engage and respond, and a short check for understanding.';
  }
}

/** The built-in learner-support skills a support profile maps to. */
export function supportProfileSkillIds(profile: SupportProfile): string[] {
  switch (profile) {
    case 'autism':
      return ['learner-support-autism'];
    case 'adhd':
      return ['learner-support-adhd'];
    case 'learning-difficulties':
      return ['learner-support-learning-difficulties'];
    default:
      return [];
  }
}

/**
 * The learner directives a free-prompt run carries (audience, support,
 * teaching style), as one prompt block — prepended by the engine at the
 * runRequirements seam so the outline, content and actions steps all read it.
 */
export function learnerDirectiveBlock(input: {
  audience?: LessonAudience;
  supportProfile?: SupportProfile;
  teachingStyle?: TeachingStyle;
}): string {
  const parts: string[] = [];
  if (input.audience) {
    parts.push(`AUDIENCE: ${audienceInstruction(input.audience)}`);
  }
  if (input.supportProfile && input.supportProfile !== 'none') {
    parts.push(
      `LEARNER SUPPORT (selected by the user — honor it without diagnosing): ${supportInstruction(input.supportProfile)}`,
    );
  }
  if (input.teachingStyle === 'game') {
    parts.push(
      'TEACHING STYLE — GAME-BASED: bias practice scenes toward playable widgets (game, simulation); frame checks as challenges with score or immediate feedback; keep the lesson playful without letting the game replace the teaching.',
    );
  } else if (input.teachingStyle === 'animation') {
    parts.push(
      'TEACHING STYLE — ANIMATION-LED: bias explanations toward animated scenes (animation-explainer, 3D visualization, procedural motion) over static text; each concept moves, draws or builds itself on screen.',
    );
  }
  return parts.length > 0
    ? `\n\n## Learner & Teaching Directives (user-selected)\n\n${parts.join('\n')}`
    : '';
}
