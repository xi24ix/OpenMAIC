# Push protocol

How an authored lesson reaches a running OpenMAIC instance
(production: `https://app.zobeidi.com`).

## Identity and access

- The whole family of `/api/*` routes sits behind the access-code gate when the
  deployment sets `ACCESS_CODE`. The middleware lets the access routes through
  and refuses the rest without a valid `openmaic_access` cookie.
- `OWNER_SINGLE_USER=true` (this deployment) resolves every request to the one
  owner id (default `local`) and mints no anonymous owner cookie. Consequence:
  a lesson pushed by a script lands in the same library the operator's browser
  sees. Without single-user mode, an owner cookie would partition the push into
  a fresh anonymous owner and the browser would not see it.
- Never echo the access code in logs, command output, or chat. The script reads
  it from `--code` or `OPENMAIC_ACCESS_CODE`.

## Endpoints

| Step | Call | Notes |
| --- | --- | --- |
| 1 | `POST /api/access-code/verify` `{code}` | sets `openmaic_access` (HttpOnly, SameSite=Lax, path `/`, max-age ~30 days). Rate-limited (`429` on bursts): verify once, reuse the cooki jar. Sends `Set-Cookie` on success. |
| 2 | `POST /api/stages` `{name, description?}` | `201 {stage:{id, name, ..., sceneCount: 0}}`. `name` required, <= 120 chars. Server mints `stage-<base64url>` id and creates an empty document with a fresh outline. |
| 3 | `PUT /api/stages/{id}` `{stage, scenes, outline?}` | saves the whole document. `stage.id` must equal the path id; the server bumps `stage.updatedAt`. Returns `{success:true}`. Invalid payloads answer `400 "invalid stage document"` with the validator message. |
| — | `GET /api/stages` | list the caller's library (id/name/sceneCount summaries). |
| — | `GET /api/stages/{id}` | full document (stage + scenes + outline). |
| — | `DELETE /api/stages/{id}` | remove course + scenes. |

`POST /api/stages/[id]/publish` exists but requires a principal with the
`course:publish` role; an anonymous owner is refused (`login_required`). It is
not needed for the library to show a course — publishing only flips the public
flag. Do not call it from the push script.

## Cookies

- Keep one in-memory jar per run: collect every `Set-Cookie` (use
  `response.headers.getSetCookie()` in Node) and send all of them back as one
  `Cookie` header on every later request. Store only the `name=value` part
  (split at the first `;`).
- The access cookie is what opens the gate. In single-user mode no other
  cookie is involved; in other modes the jar also carries the minted owner
  cookie — do not drop it.

## Rewrite before PUT

After the server mints `stage.id`:

- `stage.id = mintedId`; every `scene.stageId = mintedId`;
- `stage.createdAt`/`updatedAt` and `outline.createdAt`/`updatedAt` = now
  (the server bumps `stage.updatedAt` anyway);
- `outline = { outlines: [], requirement: <name>, generationComplete: true,
  createdAt: now, updatedAt: now }` for authored lessons.

## Error surface

- `401` — gate (missing/expired access cookie) or route-level auth.
- `403 CREATE_REFUSED` — owner write refused (host policy / claimed owner).
- `404` — no server persistence configured (`DATABASE_URL` absent), or the
  stage is not visible to this owner.
- `400 INVALID_REQUEST "invalid stage document"` — a scene or stage failed the
  write barrier; the response `details`/message names the first failing path.
- `429 RATE_LIMITED` — access-code attempts; wait for `Retry-After`.

## Verification

- `GET /api/stages` with the same cookie jar must list the pushed stage with
  the expected `sceneCount`.
- In the app: the course appears in the home library of the owner; open it to
  play scene by scene; the interactive scenes render in the sandboxed iframe
  and quizzes grade in the player.
