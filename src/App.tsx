import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeBlob, seedSpec } from './lib/analyze';
import {
  clearCatalog,
  currentDatabase,
  deleteDesign,
  estimateStorage,
  getBlobs,
  listDesigns,
  requestPersistence,
  saveDesign,
} from './lib/db';
import { GROUPS, SORTS, groupRecords } from './lib/grouping';
import { formatBytes } from './lib/image';
import {
  filesFromDataTransfer,
  imagesFromClipboard,
  ingestBlob,
  ingestFiles,
  readClipboardImages,
} from './lib/ingest';
import {
  slugify,
  toCatalogMarkdown,
  toClaudePrompt,
  toMarkdownSpec,
} from './lib/spec';
import { currentTarget, rememberTarget } from './lib/target';
import { copyText, downloadBlob, downloadText, exportCatalog, importCatalog } from './lib/transfer';
import type { DesignRecord } from './lib/types';
import { connectionStatus, disconnect, lastSyncAt, readSettings, runSync } from './lib/sync';
import { currentAccount, databaseFor } from './lib/accounts';
import type { Account } from './lib/accounts';
import { forgetCatalog, openCatalogFor } from './lib/session';
import type { SyncSummary } from './lib/sync';
import { releaseAllImages, releaseImage } from './hooks/useImageUrl';
import { SyncPanel } from './components/SyncPanel';
import { DesignCard } from './components/DesignCard';
import { DesignDetail } from './components/DesignDetail';
import { EmptyState } from './components/EmptyState';
import { CatalogGrid } from './components/CatalogGrid';
import { useNotify } from './components/Toast';
import {
  IconClipboard,
  IconDownload,
  IconFolder,
  IconImage,
  IconMoon,
  IconSearch,
  IconSun,
  IconUpload,
  IconCloud,
} from './components/Icons';

type SchemeFilter = 'all' | 'light' | 'dark' | 'mixed';

/** Remembers how you last chose to look at the catalog. */
function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

const CARD_SIZES: Array<[string, number]> = [
  ['Compact', 220],
  ['Comfortable', 300],
  ['Large', 420],
];

function searchIndex(record: DesignRecord): string {
  const { spec, auto } = record;
  return [
    record.title,
    record.notes,
    record.fileName,
    record.sourceUrl,
    ...record.tags,
    spec.category,
    spec.platform,
    ...spec.styleKeywords,
    ...spec.components,
    spec.typography.headingFamily,
    spec.typography.bodyFamily,
    spec.typography.monoFamily,
    spec.layout.structure,
    spec.replicationNotes,
    ...spec.colorTokens.map((t) => `${t.name} ${t.value} ${t.usage}`),
    ...auto.palette.map((c) => `${c.hex} ${c.name} ${c.role}`),
    auto.colorScheme,
    auto.saturation,
    auto.layout.densityLabel,
  ]
    .join(' ')
    .toLowerCase();
}

export default function App() {
  const notify = useNotify();
  const [records, setRecords] = useState<DesignRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [scheme, setScheme] = useState<SchemeFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState(() => stored('dw-sort', 'newest'));
  const [groupKey, setGroupKey] = useState(() => stored('dw-group', 'none'));
  const [cardMin, setCardMin] = useState(() => Number(stored('dw-size', '300')));
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [usage, setUsage] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('dw-theme') as 'dark' | 'light') || 'light',
  );

  /**
   * Auto-sync, driven by catalog events: adding, editing, favouriting,
   * re-analysing, restoring and deleting all bump this counter.
   *
   * The trigger used to be the highest `updatedAt` across the records, which a
   * deletion can never raise — removing a design left the catalog out of step
   * with Drive until the next launch or a manual sync. A counter every mutation
   * bumps has no such blind spot. Pulls are excluded: they are what a sync
   * writes, and treating them as changes would sync in a loop.
   */
  const [changeCount, setChangeCount] = useState(0);
  const markChanged = useCallback(() => setChangeCount((count) => count + 1), []);
  const syncedThrough = useRef(0);

  // Read by the ingest callbacks, which must stay referentially stable: they
  // back the window-level paste and drop listeners.
  const recordsRef = useRef<DesignRecord[]>([]);
  recordsRef.current = records;
  const takenTitles = useCallback(
    () => new Set(recordsRef.current.map((record) => record.title)),
    [],
  );

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('dw-theme', theme);
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('dw-sort', sortKey);
      localStorage.setItem('dw-group', groupKey);
      localStorage.setItem('dw-size', String(cardMin));
    } catch {
      // Private browsing, or storage is full. The view still works.
    }
  }, [sortKey, groupKey, cardMin]);

  const refreshUsage = useCallback(async () => {
    const estimate = await estimateStorage();
    setUsage(estimate ? formatBytes(estimate.usage) : null);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        // Open the signed-in account's catalog before reading anything, or the
        // first paint shows the wrong person's designs.
        const signedIn = currentAccount();
        setAccount(signedIn);
        await openCatalogFor(signedIn);
        setRecords(await listDesigns());
      } catch {
        notify('Could not open the catalog database.', 'error');
      } finally {
        setLoading(false);
      }
      void refreshUsage();
      void requestPersistence();
    })();
    return () => releaseAllImages();
  }, [notify, refreshUsage]);

  const addRecords = useCallback(
    (added: DesignRecord[]) => {
      if (added.length === 0) return;
      setRecords((current) => [...added, ...current]);
      markChanged();
      void refreshUsage();
    },
    [markChanged, refreshUsage],
  );

  const handleFiles = useCallback(
    async (files: File[], source: 'file' | 'folder') => {
      if (files.length === 0) return;
      setProgress({ done: 0, total: files.length });
      try {
        const report = await ingestFiles(
          files,
          source,
          (done, total) => setProgress({ done, total }),
          takenTitles(),
        );
        addRecords(report.added);

        const parts: string[] = [];
        if (report.added.length) {
          parts.push(`Catalogued ${report.added.length} design${report.added.length === 1 ? '' : 's'}.`);
        }
        if (report.skipped.length) parts.push(`Skipped ${report.skipped.length} non-image file(s).`);
        if (report.failed.length) parts.push(`${report.failed.length} could not be read.`);
        notify(
          parts.join(' ') || 'Nothing to import.',
          report.added.length ? 'success' : 'error',
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Import failed.', 'error');
      } finally {
        setProgress(null);
      }
    },
    [addRecords, notify, takenTitles],
  );

  // --- google drive sync ---------------------------------------------------

  const refreshConnection = useCallback(async () => {
    const [status, when] = await Promise.all([connectionStatus(), lastSyncAt()]);
    setConnected(status.connected);
    setLastSync(when);
    setAccount(status.account);
  }, []);

  /** Called after a sign-in or sign-out: swap catalogs and re-read. */
  const switchAccount = useCallback(
    async (next: Account | null) => {
      setLoading(true);
      try {
        await openCatalogFor(next);
        setAccount(next);
        setSelected(new Set());
        setOpenId(null);
        setRecords(await listDesigns());
        setLastSummary(null);
        setLastSync(await lastSyncAt());
        void refreshUsage();
      } catch {
        notify('Could not open that account\u2019s catalog.', 'error');
      } finally {
        setLoading(false);
      }
    },
    [notify, refreshUsage],
  );

  const sync = useCallback(
    async (quiet = false) => {
      if (syncing) return;
      setSyncing(true);
      try {
        const summary = await runSync();
        setLastSummary(summary);
        // Anything pulled changed the database underneath us, so re-read it.
        if (summary.pulled > 0 || summary.deletedLocally > 0) {
          releaseAllImages();
          setRecords(await listDesigns());
          void refreshUsage();
        }
        setLastSync(Date.now());
        if (!quiet) {
          const parts = [];
          if (summary.pulled) parts.push(`${summary.pulled} in`);
          if (summary.pushed) parts.push(`${summary.pushed} out`);
          const deletions = summary.deletedLocally + summary.deletedRemotely;
          if (deletions) parts.push(`${deletions} deleted`);
          notify(parts.length ? `Synced — ${parts.join(', ')}.` : 'Already up to date.', 'success');
        }
        if (summary.failed.length && !quiet) {
          notify(`${summary.failed.length} design(s) could not be synced.`, 'error');
        }
      } catch (error) {
        if (!quiet) {
          notify(error instanceof Error ? error.message : 'Sync failed.', 'error');
        }
      } finally {
        setSyncing(false);
      }
    },
    [notify, refreshUsage, syncing],
  );

  // Sync once on launch when a connection is already set up.
  useEffect(() => {
    void (async () => {
      const [status, settings] = await Promise.all([connectionStatus(), readSettings()]);
      setConnected(status.connected);
      setLastSync(await lastSyncAt());
      // Checking the connection can decide the stored account is no longer
      // signed in — a revoked grant, say — and the open catalog has to follow.
      // Compare against the database actually open, not against the stored
      // account: the check above may already have cleared that.
      if (databaseFor(status.account) !== currentDatabase()) {
        await switchAccount(status.account);
      } else {
        setAccount(status.account);
      }
      if (status.connected && settings.autoSync) void sync(true);
    })();
    // Intentionally launch-only; later syncs are driven by edits or the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push catalog events to Drive once they settle.
  useEffect(() => {
    if (!connected || loading || changeCount === syncedThrough.current) return;

    const flush = () => {
      const through = changeCount;
      void (async () => {
        if (!(await readSettings()).autoSync) return;
        // Claimed before the run rather than after it: a failed sync that reset
        // this would re-arm the timer immediately and retry every couple of
        // seconds for as long as Drive stayed unreachable. Launch and the Sync
        // now button are the recovery paths.
        syncedThrough.current = through;
        void sync(true);
      })();
    };

    // Coalesce a burst — a folder import fires once per file — while keeping
    // the wait short enough that one edit reaches Drive before you look away.
    const timer = setTimeout(flush, 2500);

    // Backgrounding the tab is the last reliable moment to push: a phone may
    // freeze or discard the page before the timer ever runs.
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      clearTimeout(timer);
      flush();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [changeCount, connected, loading, sync]);

  // --- clipboard -----------------------------------------------------------

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const images = imagesFromClipboard(event);
      if (images.length === 0) return;
      event.preventDefault();
      void handleFiles(images, 'file').then(() => undefined);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFiles]);

  const pasteFromButton = useCallback(async () => {
    try {
      const blobs = await readClipboardImages();
      if (blobs.length === 0) {
        notify('No image on the clipboard — copy a screenshot first.', 'error');
        return;
      }
      setProgress({ done: 0, total: blobs.length });
      const added: DesignRecord[] = [];
      const taken = takenTitles();
      for (const [index, blob] of blobs.entries()) {
        added.push(await ingestBlob(blob, { source: 'clipboard', takenTitles: taken }));
        setProgress({ done: index + 1, total: blobs.length });
      }
      addRecords(added);
      notify(`Pasted ${added.length} design${added.length === 1 ? '' : 's'}.`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not read the clipboard.', 'error');
    } finally {
      setProgress(null);
    }
  }, [addRecords, notify, takenTitles]);

  // --- drag and drop -------------------------------------------------------

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      dragDepth.current++;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      void filesFromDataTransfer(event.dataTransfer).then((files) =>
        handleFiles(files, files.length > 1 ? 'folder' : 'file'),
      );
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFiles]);

  // --- record mutations ----------------------------------------------------

  const updateRecord = useCallback(
    (next: DesignRecord) => {
      setRecords((current) => current.map((r) => (r.id === next.id ? next : r)));
      markChanged();
      saveDesign(next).catch(() => notify('Could not save that change.', 'error'));
    },
    [markChanged, notify],
  );

  const toggleFavorite = useCallback(
    (id: string) => {
      setRecords((current) =>
        current.map((r) => {
          if (r.id !== id) return r;
          const next = { ...r, favorite: !r.favorite, updatedAt: Date.now() };
          saveDesign(next).catch(() => undefined);
          return next;
        }),
      );
      markChanged();
    },
    [markChanged],
  );

  const removeRecord = useCallback(
    async (id: string) => {
      const record = records.find((r) => r.id === id);
      if (record && !confirm(`Delete "${record.title}" from the catalog?`)) return;
      await deleteDesign(id);
      releaseImage(id);
      setRecords((current) => current.filter((r) => r.id !== id));
      setSelected((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      if (openId === id) setOpenId(null);
      markChanged();
      void refreshUsage();
      notify('Design deleted.', 'success');
    },
    [markChanged, notify, openId, records, refreshUsage],
  );

  const reanalyze = useCallback(
    async (id: string) => {
      const record = records.find((r) => r.id === id);
      const blobs = await getBlobs(id);
      if (!record || !blobs) {
        notify('The stored image for that design is missing.', 'error');
        return;
      }
      try {
        const { image, auto, thumb } = await analyzeBlob(blobs.full);
        // Only re-seed the tokens if they are still exactly what the last
        // analysis produced — an edited token list is the user's work.
        const previousSeed = seedSpec(record.image, record.auto).colorTokens;
        const untouched =
          JSON.stringify(previousSeed) === JSON.stringify(record.spec.colorTokens);
        const next: DesignRecord = {
          ...record,
          image,
          auto,
          updatedAt: Date.now(),
          spec: untouched
            ? { ...record.spec, colorTokens: seedSpec(image, auto).colorTokens }
            : record.spec,
        };
        await saveDesign(next, { id, full: blobs.full, thumb });
        releaseImage(id);
        setRecords((current) => current.map((r) => (r.id === id ? next : r)));
        markChanged();
        notify(
          untouched ? 'Re-analysed and tokens refreshed.' : 'Re-analysed; your edited tokens were kept.',
          'success',
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Re-analysis failed.', 'error');
      }
    },
    [markChanged, notify, records],
  );

  const downloadImage = useCallback(
    async (record: DesignRecord) => {
      const blobs = await getBlobs(record.id);
      if (!blobs) {
        notify('The stored image is missing.', 'error');
        return;
      }
      const ext = (record.image.mimeType.split('/')[1] || 'png').replace('jpeg', 'jpg');
      downloadBlob(`${slugify(record.title)}.${ext}`, blobs.full);
    },
    [notify],
  );

  const copySpec = useCallback(
    async (record: DesignRecord) => {
      const target = currentTarget();
      try {
        await copyText(toClaudePrompt(record, target));
        rememberTarget(target);
        notify(
          target
            ? `Prompt for "${record.title}" copied — applies to ${target}.`
            : `Prompt for "${record.title}" copied — applies to whatever you're working on.`,
          'success',
        );
      } catch {
        notify('The browser blocked the clipboard write.', 'error');
      }
    },
    [notify],
  );

  // --- filtering -----------------------------------------------------------

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of records) {
      for (const tag of record.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [records]);

  const sortOption = useMemo(
    () => SORTS.find((option) => option.key === sortKey) ?? SORTS[0],
    [sortKey],
  );
  const groupOption = useMemo(
    () => GROUPS.find((option) => option.key === groupKey) ?? GROUPS[0],
    [groupKey],
  );

  const visible = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = records.filter((record) => {
      if (favoritesOnly && !record.favorite) return false;
      if (scheme !== 'all' && record.auto.colorScheme !== scheme) return false;
      if (activeTags.length && !activeTags.every((tag) => record.tags.includes(tag))) return false;
      if (terms.length) {
        const haystack = searchIndex(record);
        if (!terms.every((term) => haystack.includes(term))) return false;
      }
      return true;
    });

    return [...filtered].sort(sortOption.compare);
  }, [activeTags, favoritesOnly, query, records, scheme, sortOption]);

  const sections = useMemo(
    () => groupRecords(visible, groupOption, sortOption),
    [visible, groupOption, sortOption],
  );

  const toggleTag = useCallback((tag: string) => {
    setActiveTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedRecords = useMemo(
    () => visible.filter((record) => selected.has(record.id)),
    [selected, visible],
  );

  // --- bulk + catalog actions ---------------------------------------------

  const copySelectedSpecs = async () => {
    const target = currentTarget();
    await copyText(toCatalogMarkdown(selectedRecords, target));
    rememberTarget(target);
    notify(
      target
        ? `Copied ${selectedRecords.length} spec(s) to apply to ${target}.`
        : `Copied ${selectedRecords.length} spec(s) — they apply to whatever you're working on.`,
      'success',
    );
  };

  const downloadSelectedSpecs = () => {
    downloadText(
      selectedRecords.length === 1
        ? `${slugify(selectedRecords[0].title)}.md`
        : 'design-warehouse-specs.md',
      selectedRecords.length === 1
        ? toMarkdownSpec(selectedRecords[0])
        : toCatalogMarkdown(selectedRecords),
      'text/markdown',
    );
  };

  const deleteSelected = async () => {
    if (!confirm(`Delete ${selectedRecords.length} design(s) from the catalog?`)) return;
    for (const record of selectedRecords) {
      await deleteDesign(record.id);
      releaseImage(record.id);
    }
    const ids = new Set(selectedRecords.map((r) => r.id));
    setRecords((current) => current.filter((r) => !ids.has(r.id)));
    setSelected(new Set());
    markChanged();
    void refreshUsage();
    notify(`Deleted ${ids.size} design(s).`, 'success');
  };

  const backupCatalog = async () => {
    if (records.length === 0) return;
    notify('Building the backup file…');
    try {
      const blob = await exportCatalog(records);
      downloadBlob(`design-warehouse-${new Date().toISOString().slice(0, 10)}.json`, blob);
      notify('Backup downloaded.', 'success');
    } catch {
      notify('Could not build the backup.', 'error');
    }
  };

  const restoreCatalog = async (file: File) => {
    try {
      const count = await importCatalog(file);
      releaseAllImages();
      setRecords(await listDesigns());
      markChanged();
      void refreshUsage();
      notify(`Restored ${count} design(s).`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Import failed.', 'error');
    }
  };

  const wipeCatalog = async () => {
    if (!confirm(`Delete all ${records.length} designs? This cannot be undone.`)) return;
    await clearCatalog();
    releaseAllImages();
    setRecords([]);
    setSelected(new Set());
    markChanged();
    void refreshUsage();
    notify('Catalog cleared.', 'success');
  };

  /**
   * Signing out, optionally taking this device's copy of the catalog with it.
   *
   * Anything unsynced is pushed first and the wipe abandoned if that fails —
   * "forget this device" must never be the thing that loses a design.
   */
  const signOut = useCallback(async (): Promise<void> => {
    const settings = await readSettings();
    const leaving = account;
    const forgetting = settings.forgetOnSignOut && leaving !== null;

    if (forgetting) {
      if (connected) {
        try {
          await runSync();
        } catch (error) {
          notify(
            `Not signing out: this device's designs could not be saved to Drive first (${
              error instanceof Error ? error.message : 'sync failed'
            }).`,
            'error',
          );
          return;
        }
      } else if (
        !confirm(
          'This device has never synced to Drive, so deleting its copy would lose these designs for good.\n\nSign out and delete anyway?',
        )
      ) {
        return;
      }
    }

    await disconnect();
    await switchAccount(null);

    if (forgetting && leaving) {
      const removed = await forgetCatalog(leaving);
      notify(
        removed
          ? 'Signed out, and this device\u2019s copy was deleted.'
          : 'Signed out, but the local copy could not be deleted \u2014 close other tabs and try again.',
        removed ? 'success' : 'error',
      );
      return;
    }
    notify('Signed out. Your designs stay in Drive and on this device.', 'success');
  }, [account, connected, notify, switchAccount]);

  const renderCard = (record: DesignRecord) => (
    <DesignCard
      record={record}
      selected={selected.has(record.id)}
      onOpen={setOpenId}
      onToggleSelect={toggleSelect}
      onToggleFavorite={toggleFavorite}
      onCopySpec={copySpec}
      onDelete={removeRecord}
      onTagClick={toggleTag}
    />
  );

  const openRecord = openId ? records.find((r) => r.id === openId) ?? null : null;
  const filtersActive =
    query.trim().length > 0 || scheme !== 'all' || favoritesOnly || activeTags.length > 0;

  return (
    <div className="app">
      {progress && (
        <div className="progress-bar">
          <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
        </div>
      )}

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <span style={{ background: 'var(--accent)' }} />
            <span style={{ background: 'var(--text)' }} />
            <span style={{ background: 'var(--muted-fill-2)' }} />
            <span style={{ background: 'var(--success)' }} />
          </span>
          Design Warehouse
          <span className="brand-count">
            {records.length}
            {usage ? ` · ${usage}` : ''}
          </span>
        </div>

        <div className="search">
          <span className="search-icon">
            <IconSearch />
          </span>
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, tags, hex values, fonts, components…"
            aria-label="Search the catalog"
          />
        </div>

        {/*
          Two groups rather than one row of buttons: on a phone the bar wraps,
          and the three ways of getting a design in have to stay reachable while
          the utilities move up beside the wordmark.
        */}
        <div className="topbar-actions">
          <div className="topbar-primary">
            <button type="button" className="btn btn-primary" onClick={pasteFromButton}>
              <IconClipboard /> Paste
            </button>
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
              <IconImage /> Files
            </button>
            <button type="button" className="btn" onClick={() => folderInput.current?.click()}>
              <IconFolder /> Folder
            </button>
          </div>

          <div className="topbar-utility">
            {account && (
              <button
                type="button"
                className="btn btn-ghost account-chip"
                onClick={() => setSyncOpen(true)}
                title={`Signed in as ${account.email || account.name}`}
              >
                {/* Drawn locally rather than fetched: a Google-hosted avatar would
                    mean a request to Google on every launch, and nothing here
                    otherwise touches the network unless you ask it to. */}
                <span className="account-avatar account-initial">
                  {(account.email || account.name || '?').charAt(0).toUpperCase()}
                </span>
              </button>
            )}
            <button
              type="button"
              className={`btn btn-ghost btn-icon${syncing ? ' spinning' : ''}`}
              title={
                connected
                  ? `Shared catalog${lastSync ? ` — last synced ${new Date(lastSync).toLocaleString()}` : ''}`
                  : 'Share this catalog across devices'
              }
              onClick={() => setSyncOpen(true)}
            >
              <IconCloud connected={connected} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              title="Back up the whole catalog to a file"
              onClick={backupCatalog}
            >
              <IconDownload />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              title="Restore a catalog backup"
              onClick={() => importInput.current?.click()}
            >
              <IconUpload />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
          </div>
        </div>
      </header>

      {records.length > 0 && (
        <div className="filters">
          <span className="filter-label">Scheme</span>
          <select value={scheme} onChange={(e) => setScheme(e.target.value as SchemeFilter)}>
            <option value="all">Any</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="mixed">Mixed</option>
          </select>

          <span className="filter-label">Sort by</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            aria-label="Sort the catalog"
          >
            {SORTS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>

          <span className="filter-label">Group by</span>
          <select
            value={groupKey}
            onChange={(e) => setGroupKey(e.target.value)}
            aria-label="Group the catalog into sections"
          >
            {GROUPS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>

          <span className="filter-label">Size</span>
          <select value={cardMin} onChange={(e) => setCardMin(Number(e.target.value))}>
            {CARD_SIZES.map(([label, value]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`chip${favoritesOnly ? ' chip-accent' : ''}`}
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            ★ Favourites
          </button>

          {allTags.length > 0 && (
            <div className="tag-filter">
              {allTags.slice(0, 14).map(([tag, count]) => (
                <button
                  type="button"
                  key={tag}
                  className={`chip${activeTags.includes(tag) ? ' chip-accent' : ''}`}
                  onClick={() => toggleTag(tag)}
                >
                  {tag} <span style={{ opacity: 0.6 }}>{count}</span>
                </button>
              ))}
            </div>
          )}

          <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 'var(--t-label)' }}>
            {visible.length} shown
          </span>
          <button type="button" className="btn btn-ghost btn-danger" onClick={wipeCatalog}>
            Clear all
          </button>
        </div>
      )}

      <main className="main">
        {loading ? (
          <div className="empty">
            <p>Opening the catalog…</p>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            filtered={filtersActive}
            onClearFilters={() => {
              setQuery('');
              setScheme('all');
              setFavoritesOnly(false);
              setActiveTags([]);
            }}
            onPickFiles={() => fileInput.current?.click()}
            onPickFolder={() => folderInput.current?.click()}
            onPaste={pasteFromButton}
          />
        ) : sections.length > 0 ? (
          sections.map((section) => (
            <section className="group" key={section.id}>
              <h2 className="group-heading">
                {section.label}
                <span className="group-count">{section.records.length}</span>
              </h2>
              <CatalogGrid
                items={section.records}
                keyFor={(record) => record.id}
                minWidth={cardMin}
              >
                {(record) => renderCard(record)}
              </CatalogGrid>
            </section>
          ))
        ) : (
          <CatalogGrid items={visible} keyFor={(record) => record.id} minWidth={cardMin}>
            {(record) => renderCard(record)}
          </CatalogGrid>
        )}
      </main>

      {selectedRecords.length > 0 && (
        <div className="selection-bar">
          <strong>{selectedRecords.length}</strong> selected
          <button type="button" className="btn" onClick={copySelectedSpecs}>
            Copy specs
          </button>
          <button type="button" className="btn" onClick={downloadSelectedSpecs}>
            Download .md
          </button>
          <button type="button" className="btn btn-danger" onClick={deleteSelected}>
            Delete
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {dragging && (
        <div className="dropzone-overlay">
          <div className="dropzone-inner">
            <h2>Drop to catalog</h2>
            <p>Images and folders are both fine — subfolders are walked too.</p>
          </div>
        </div>
      )}

      {syncOpen && (
        <SyncPanel
          onClose={() => setSyncOpen(false)}
          onSync={() => void sync(false)}
          syncing={syncing}
          lastSync={lastSync}
          lastSummary={lastSummary}
          account={account}
          onAccountChange={switchAccount}
          onSignOut={signOut}
          onConnectionChange={() => void refreshConnection()}
        />
      )}

      {openRecord && (
        <DesignDetail
          record={openRecord}
          onChange={updateRecord}
          onClose={() => setOpenId(null)}
          onDelete={(id) => void removeRecord(id)}
          onReanalyze={(id) => void reanalyze(id)}
          onDownloadImage={(record) => void downloadImage(record)}
        />
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="visually-hidden"
        onChange={(e) => {
          void handleFiles(Array.from(e.target.files ?? []), 'file');
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="visually-hidden"
        // @ts-expect-error - non-standard but supported in Chromium, Safari and Firefox
        webkitdirectory=""
        directory=""
        onChange={(e) => {
          void handleFiles(Array.from(e.target.files ?? []), 'folder');
          e.target.value = '';
        }}
      />
      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void restoreCatalog(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
