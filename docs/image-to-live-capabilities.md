# Image-to-live provider capabilities

Checked against official documentation on 2026-10-26. Documentation support, adapter implementation, credential presence, account entitlement and successful real validation are **different facts**.

| Provider | Existing selection | Image-based creation | Custom training | Real-time rendering | Reusable provider reference | Account requirements / local evidence |
|---|---|---|---|---|---|---|
| Anam | Yes | `POST /v1/avatars`, multipart imageFile or JSON imageUrl | One-shot generation, not a training workflow in this adapter | Official LiveKit integration | Returned avatar UUID | All plans including Free allow saved custom avatars, subject to creation/moderation limits. Last operator authentication test returned 401; no image-derived avatar validated. |
| Tavus | Yes | `POST /v2/faces` with train_image_url + voice_name | Phoenix-4.5 preview then background tuning; Phoenix-4 full training also documented | Official LiveKit integration | Returned face_id | Custom faces require Starter, Growth or Enterprise. Existing stock-face RTC/PCM test passed, **not custom-training entitlement or image-to-live proof**. |
| LemonSlice | Yes, documented agent_id | Direct single-image live rendering; agentImageUrl / image buffer | No training required for documented direct-image path | Official LiveKit plugin | Persistent creation/deletion API not verified | Active subscription and API key. No local key or implemented provisioning adapter. Do not fabricate a long-lived ID from a session ID. |
| Simli | Yes | Trinity preprocess → generation → generation_status | Trinity-1 face slots or Trinity-2 generation quota | LiveKit integration documented (earlier runtime study used Python plugin) | face ID | Face slots/generation credits required. No local key or implemented adapter. |

## Verified API contracts

### Anam
- [Create avatar](https://anam.ai/docs/api-reference/avatars/create-avatar)
- [Custom avatars and account support](https://anam.ai/docs/personas/avatars/custom-avatars)
- [Delete avatar](https://anam.ai/docs/api-reference/avatars/delete-avatar)
- Input: JPEG, PNG or WebP, ≤4.5MB. Source guidance: square, ≥1152×1152, clear single face and shoulders.
- Persist returned ID, not an expiring preview URL.
- `DELETE /v1/avatars/{id}?hard=true` requests permanent source/generated asset deletion. May reject avatars referenced by personas.

### Tavus
- [Image-to-face quickstart](https://docs.tavus.io/sections/faces/image-to-face-quickstart)
- [Create face](https://docs.tavus.io/api-reference/faces/create-face)
- [Get face](https://docs.tavus.io/api-reference/faces/get-face)
- [Delete face](https://docs.tavus.io/api-reference/faces/delete-face)
- [Account requirements and policies](https://docs.tavus.io/sections/faces/overview)
- Training URL must remain downloadable for at least 24h; AvatarRouter issues a 25h signed GET URL to a private stored object. It never exposes that URL to the browser or stores it in PostgreSQL.
- `voice_name` is required; default `anna` is the official quickstart example, not a cloned voice. No additional dialogue engine is started.
- Fixed explicit `model_name: phoenix-4.5`, `auto_fix_training_image: false`; image transformations beyond orientation/metadata sanitation require a separate product decision.
- Poll `GET /v2/faces/{face_id}`: started → processing; completed → usable provider preview; error → failed. Completed may be watermarked and is not proof that fine-tuning is complete.
- `DELETE /v2/faces/{face_id}?hard=true` requests permanent training/source deletion. It does not delete historical conversations; no conversations are created by this provisioning worker.

### LemonSlice and Simli
- [LemonSlice LiveKit parameters and requirements](https://lemonslice.com/docs/livekit/index.md)
- [LemonSlice API index](https://lemonslice.com/docs/llms.txt)
- [Simli create avatar](https://docs.simli.com/api-reference/create-avatar)
- [Simli preprocess](https://docs.simli.com/api-reference/preprocess-trinity-face-image)
- [Simli generate](https://docs.simli.com/api-reference/generate-trinity-face)
- Simli preprocess accepts JPEG/PNG/WebP under5MB, ≥512×512. Pass the same gsVersion through preprocess/generation and preserve TARGET-RATIO. These APIs are documented but **not implemented here**.

## Emotion/behavior support is not implied

Anam Director Notes, LemonSlice prompt demeanor and enterprise actions, and a provider's naturally expressive face are not interchangeable deterministic event APIs. The standard event contract is independent of provider-specific controls; every current adapter reports emotion and behavior controls **unverified**. No live emotion control was demonstrated.

## Validation boundary

The private source pipeline and durable provider job lifecycle have passed local tests. Provider HTTP create/poll/delete tests use injected responses. No third-party face was uploaded and no actual source image was converted during this implementation. Browser live preview, image-derived live session success and Gemini bridging remain pending. Do not call the image-to-live milestone complete.
