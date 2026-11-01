import { useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, ScrollText, Search } from 'lucide-react';
import { useGuild } from '../lib/guild';
import { useLogs } from '../lib/hooks';
import { formatDate, titleCase } from '../lib/format';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  SectionCard,
  Select,
  Skeleton,
} from '../components/ui';

const CATEGORIES = ['ROOM', 'CONFIG', 'PRIVACY', 'MEMBER', 'RESERVATION', 'QUEUE', 'TEMPLATE', 'AUTH', 'SYSTEM'];

export function LogsPage() {
  const { guildId } = useGuild();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const logs = useLogs(guildId, { page, search, category });
  const data = logs.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="Activity logs"
        description="Every important action is recorded with actor, target, IP hash and metadata. Logs are immutable and pruned by retention policy."
        actions={
          <Button variant="secondary" leftIcon={RefreshCw} onClick={() => void logs.refetch()}>
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <form
          className="flex flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(searchInput.trim());
          }}
        >
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search actions, actors or targets…"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Select
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
          className="lg:w-48"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </Select>
      </div>

      <SectionCard
        icon={ScrollText}
        title="Audit trail"
        description={`${data?.total ?? 0} events recorded.`}
        actions={data ? <Badge tone="muted">Page {data.page} / {data.pages}</Badge> : null}
      >
        {logs.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <Skeleton key={item} className="h-12 w-full" />
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <div className="space-y-1">
            {data.items.map((log) => (
              <details key={log.id} className="group rounded-xl border border-white/5 bg-white/[0.015] px-4 py-2.5 transition hover:border-white/10">
                <summary className="flex cursor-pointer list-none flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-soft">{titleCase(log.action)}</p>
                      <p className="text-[10px] text-faint">
                        {log.actorName ?? 'System'} {log.targetId ? `→ ${log.targetId}` : ''} · {formatDate(log.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="muted">{log.category.toLowerCase()}</Badge>
                    <span className="text-[10px] text-faint group-open:rotate-180 transition">⌄</span>
                  </div>
                </summary>
                <div className="mt-3 space-y-2 border-t border-white/6 pt-3">
                  <div className="grid gap-2 text-[11px] text-faint sm:grid-cols-2">
                    <p>Actor ID: <span className="text-soft">{log.actorId ?? 'system'}</span></p>
                    <p>Target: <span className="text-soft">{log.targetType ?? '—'} {log.targetId ?? ''}</span></p>
                    <p>IP hash: <span className="text-soft">{log.ipHash ?? '—'}</span></p>
                    <p>User agent: <span className="truncate text-soft">{log.userAgent ?? '—'}</span></p>
                  </div>
                  {log.metadata ? (
                    <pre className="scroll-thin max-h-64 overflow-auto rounded-lg border border-white/6 bg-black/30 p-3 text-[10.5px] leading-relaxed text-soft/90">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ScrollText}
            title="No activity yet"
            description="Configuration changes, room actions and moderation all appear here."
          />
        )}

        {data && data.pages > 1 ? (
          <div className="mt-4 flex items-center justify-between border-t border-white/6 pt-4">
            <p className="text-[11px] text-faint">
              Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={ChevronLeft}
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                rightIcon={ChevronRight}
                disabled={page >= data.pages}
                onClick={() => setPage((value) => Math.min(data.pages, value + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

export default LogsPage;
