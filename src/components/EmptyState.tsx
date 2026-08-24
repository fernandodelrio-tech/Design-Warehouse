import { IconClipboard, IconFolder, IconImage } from './Icons';

interface Props {
  onPickFiles: () => void;
  onPickFolder: () => void;
  onPaste: () => void;
  filtered: boolean;
  onClearFilters: () => void;
}

export function EmptyState({
  onPickFiles,
  onPickFolder,
  onPaste,
  filtered,
  onClearFilters,
}: Props) {
  if (filtered) {
    return (
      <div className="empty">
        <h2>No designs match</h2>
        <p>Nothing in the catalog fits the current search and filters.</p>
        <div className="empty-actions">
          <button type="button" className="btn" onClick={onClearFilters}>
            Clear filters
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="empty">
      <h2>Your catalog is empty</h2>
      <p>
        Paste a screenshot, drop a folder of them, or pick files. Each one is analysed on
        the spot — palette, contrast, layout structure — and filed as a vignette with a
        spec Claude Code and Claude Design can build from.
      </p>
      <div className="empty-actions">
        <button type="button" className="btn btn-primary" onClick={onPaste}>
          <IconClipboard /> Paste from clipboard
        </button>
        <button type="button" className="btn" onClick={onPickFiles}>
          <IconImage /> Choose images
        </button>
        <button type="button" className="btn" onClick={onPickFolder}>
          <IconFolder /> Import a folder
        </button>
      </div>
      <div className="empty-hints">
        <div>
          <strong>Paste anywhere.</strong> Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>V</kbd> with
          a screenshot on the clipboard — no dialog, no file to save first.
        </div>
        <div>
          <strong>Drop folders.</strong> Drag a whole directory onto the window and every
          image inside it is catalogued, subfolders included.
        </div>
        <div>
          <strong>Everything stays local.</strong> Images and specs are stored in this
          browser&rsquo;s storage — nothing is uploaded anywhere by default. Sign in with
          Google from the cloud button for a catalog of your own, shared across every
          browser you sign in from and separate from anyone else who uses this machine.
        </div>
      </div>
    </div>
  );
}
