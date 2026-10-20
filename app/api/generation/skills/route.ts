/**
 * GET /api/generation/skills — the built-in course-design skills the classic
 * generation composer can attach to a run, independent of the agent runtime
 * gate. The bodies stay on the server: a run names the skills it selected,
 * and the outline step resolves them for the owner.
 */
import { NextResponse } from 'next/server';

import { isOutlineSkill, listSkills } from '@/lib/server/agent-runtime/skills';

export const runtime = 'nodejs';

export async function GET() {
  const skills = (await listSkills()).filter(isOutlineSkill);
  return NextResponse.json(
    {
      skills: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        ...(skill.title ? { title: skill.title } : {}),
        description: skill.description,
        hasConstraints: !!skill.constraints,
      })),
    },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
