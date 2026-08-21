import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeBlob, seedSpec } from './lib/analyze';
import {
  clearCatalog,
  deleteDesign,
  estimateStorage,
  getBlobs,
  listDesigns,
  requestPersistence,
  saveDesign,
} from './lib/db';
import { isDesktop, onMenuAction } from './lib/desktop';
import type { MenuAction } from './lib/desktop';
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
import { copyText, downloadBlob, downloadText, exportCatalog, importCatalog } from './lib/transfer';
import type { DesignRecord } from './lib/types';
import { releaseAllImages, releaseImage } from './hooks/useImageUrl';
import { DesignCard } from './components/DesignCard';
import { DesignDetail } from './components/DesignDetail';
import { EmptyState } from './components/EmptyState';
import { MasonryGrid } from './components/MasonryGrid';
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
} from './components/Icons';

type SortKey = 'newest' | 'oldest' | 'title' | 'largest';
type SchemeFilter = 'all' | 'light' | 'dark' | 'mixed';

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
  const [sort, setSort] = useState<SortKey>('newest');
  const [cardMin, setCardMin] = useState(300);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [usage, setUsage] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('dw-theme') as 'dark' | 'light') || 'dark',
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

  const refreshUsage = useCallback(async () => {
    const estimate = await estimateStorage();
    setUsage(estimate ? formatBytes(estimate.usage) : null);
  }, []);

  useEffect(() => {
    listDesigns()
      .then((loaded) => setRecords(loaded))
      .catch(() => notify('Could not open the catalog database.', 'error'))
      .finally(() => setLoading(false));
    void refreshUsage();
    void requestPersistence();
    return () => releaseAllImages();
  }, [notify, refreshUsage]);

  const addRecords = useCallback(
    (added: DesignRecord[]) => {
      if (added.length === 0) return;
      setRecords((current) => [...added, ...current]);
      void refreshUsage();
    },
    [refreshUsage],
  );

  const handleFiles = useCallback(
    async (files: File[], source: 'file' | 'folder') => {
      if (files.length === 0) return;
      setProgress({ done: 0, total: files.length });
      try {
        const report = await ingestFiles(files, source, (done, total) =>
          setProgress({ done, total }),
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
    [addRecords, notify],
  );

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
      for (const [index, blob] of blobs.entries()) {
        added.push(await ingestBlob(blob, { source: 'clipboard' }));
        setProgress({ done: index + 1, total: blobs.length });
      }
      addRecords(added);
      notify(`Pasted ${added.length} design${added.length === 1 ? '' : 's'}.`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not read the clipboard.', 'error');
    } finally {
      setProgress(null);
    }
  }, [addRecords, notify]);

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
      saveDesign(next).catch(() => notify('Could not save that change.', 'error'));
    },
    [notify],
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
    },
    [],
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
      void refreshUsage();
      notify('Design deleted.', 'success');
    },
    [notify, openId, records, refreshUsage],
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
        notify(
          untouched ? 'Re-analysed and tokens refreshed.' : 'Re-analysed; your edited tokens were kept.',
          'success',
        );
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Re-analysis failed.', 'error');
      }
    },
    [notify, records],
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
      try {
        await copyText(toClaudePrompt(record));
        notify(`Build prompt for "${record.title}" copied.`, 'success');
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

    const sorted = [...filtered];
    switch (sort) {
      case 'oldest':
        sorted.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'largest':
        sorted.sort((a, b) => b.image.width * b.image.height - a.image.width * a.image.height);
        break;
      default:
        sorted.sort((a, b) => b.createdAt - a.createdAt);
    }
    return sorted;
  }, [activeTags, favoritesOnly, query, records, scheme, sort]);

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
    const text = toCatalogMarkdown(selectedRecords);
    await copyText(text);
    notify(`Copied ${selectedRecords.length} spec(s) as one document.`, 'success');
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
    void refreshUsage();
    notify('Catalog cleared.', 'success');
  };

  // --- desktop application menu -------------------------------------------

  // Held in a ref so the subscription is made once, while the handlers it calls
  // are always the current render's — several of them close over `records`.
  const menuDispatch = useRef<(action: MenuAction) => void>(() => {});
  menuDispatch.current = (action) => {
    switch (action) {
      case 'paste':
        void pasteFromButton();
        break;
      case 'add-files':
        fileInput.current?.click();
        break;
      case 'add-folder':
        folderInput.current?.click();
        break;
      case 'backup':
        void backupCatalog();
        break;
      case 'restore':
        importInput.current?.click();
        break;
      case 'search':
        searchInput.current?.focus();
        searchInput.current?.select();
        break;
    }
  };

  useEffect(() => onMenuAction((action) => menuDispatch.current(action)), []);

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
            <span style={{ background: '#38bdf8' }} />
            <span style={{ background: '#f472b6' }} />
            <span style={{ background: '#fbbf24' }} />
            <span style={{ background: '#34d399' }} />
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

        <div className="topbar-actions">
          <button type="button" className="btn btn-primary" onClick={pasteFromButton}>
            <IconClipboard /> Paste
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            <IconImage /> Files
          </button>
          <button type="button" className="btn" onClick={() => folderInput.current?.click()}>
            <IconFolder /> Folder
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

          <span className="filter-label">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title A–Z</option>
            <option value="largest">Largest capture</option>
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

          <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 12 }}>
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
            desktop={isDesktop}
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
        ) : (
          <MasonryGrid items={visible} keyFor={(record) => record.id} minWidth={cardMin}>
            {(record) => (
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
            )}
          </MasonryGrid>
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
