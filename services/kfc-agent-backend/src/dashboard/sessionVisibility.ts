export interface DashboardSessionTarget {
  channel: "messenger" | "zalo";
  externalUserId: string;
}

export function dashboardSessionTarget(
  sessionId: string,
): DashboardSessionTarget | undefined {
  const separatorIndex = sessionId.indexOf(":");
  if (separatorIndex === -1) return undefined;

  const channel = sessionId.slice(0, separatorIndex);
  const externalUserId = sessionId.slice(separatorIndex + 1);
  if (!externalUserId) return undefined;
  if (channel === "messenger" || channel === "zalo")
    return { channel, externalUserId };
  return undefined;
}
