"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "../../../../components/layout/shell";
import { Header } from "../../../../components/layout/header";
import { apiFetch } from "../../../../lib/api";

export default function NotificationChannelDetailPage() {
  const params = useParams<{ channelId: string }>();
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      const rows = await apiFetch<any[]>("/settings/notifications");
      setChannels(rows);
    };
    void load();
  }, []);

  const channel = useMemo(() => channels.find((row) => row.id === params.channelId), [channels, params.channelId]);

  return (
    <Shell>
      <Header title="Notification Channel" />
      <section className="panel">
        {!channel ? <p>Loading channel...</p> : (
          <>
            <p><strong>Name:</strong> {channel.name}</p>
            <p><strong>Type:</strong> {channel.type}</p>
            <p><strong>Target:</strong> {channel.target}</p>
            <p><strong>Status:</strong> {channel.isActive ? "Active" : "Disabled"}</p>
            <p><strong>Scope:</strong> {channel.project?.name || "Organization default"}</p>
            <p><strong>Last delivery result:</strong> Not yet available</p>
            <p><strong>Last successful delivery:</strong> Not yet available</p>
          </>
        )}
      </section>
    </Shell>
  );
}
