import { useState } from "react";
import { Search } from "lucide-react";
import {
  useListCategories,
  useListGroups,
  useListLibraryVideos,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/Layout";
import { EmptyState, Input, Select, Spinner } from "@/components/ui";
import { VideoCard } from "@/components/VideoCard";
import { isAdmin, useAuth } from "@/lib/auth";

export default function LibraryPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [groupId, setGroupId] = useState<number | undefined>();

  const params = {
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(groupId ? { groupId } : {}),
    limit: 48,
  };

  const library = useListLibraryVideos(params);
  const categories = useListCategories();
  const groups = useListGroups({ limit: 100 });

  const videos = library.data?.videos ?? [];
  const total = library.data?.total ?? 0;

  return (
    <div className="rise">
      <PageHeader
        kicker={isAdmin(user) ? "Library · all approved titles" : "Library"}
        title="Screening shelf"
      />

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles and descriptions…"
            className="pl-9"
          />
        </div>
        <div className="w-48">
          <Select
            value={categoryId ?? ""}
            onChange={(e) =>
              setCategoryId(e.target.value ? Number(e.target.value) : undefined)
            }
          >
            <option value="">All categories</option>
            {(categories.data?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Select
            value={groupId ?? ""}
            onChange={(e) =>
              setGroupId(e.target.value ? Number(e.target.value) : undefined)
            }
          >
            <option value="">All groups</option>
            {(groups.data?.groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>
        <span className="font-mono text-xs text-muted">
          {total} {total === 1 ? "title" : "titles"}
        </span>
      </div>

      {library.isLoading ? (
        <Spinner label="Rolling the archive…" />
      ) : videos.length === 0 ? (
        <EmptyState
          title="Nothing on the shelf yet"
          body="When an administrator approves a video for one of your groups, it appears here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((video, i) => (
            <VideoCard key={video.id} video={video} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
