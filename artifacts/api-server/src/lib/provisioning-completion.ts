/** Provider creation completion is not session/playback verification. Never mark acceptance as success. */
export function provisioningCompletion(row: { status: string; providerAvatarId: string | null }) {
  const complete = row.status === "ready" && !!row.providerAvatarId;
  return {
    completionMessage: complete ? "Custom avatar creation completed. Live playback is verified separately." : null,
    completionMessageKo: complete ? "커스텀 아바타 생성이 완료되었습니다. 실제 라이브 재생 검증은 별도입니다." : null,
  };
}
