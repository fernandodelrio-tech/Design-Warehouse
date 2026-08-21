/**
 * Who is using this copy of the app, and which catalog is theirs.
 *
 * Identity lives in localStorage rather than the catalog database, because the
 * database that gets opened *depends* on the identity — each signed-in account
 * gets its own, so one person's designs are never in the same store as
 * another's.
 */

export interface Account {
  /** Google's stable subject id. Unlike the email, this never changes. */
  sub: string;
  email: string;
  name: string;
  picture: string;
  /** The OAuth client this account signed in with. */
  clientId: string;
}

const ACCOUNT_KEY = 'dw-account';
const BINDINGS_KEY = 'dw-client-bindings';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or a full quota. Sign-in still works for this session.
  }
}

export function currentAccount(): Account | null {
  return read<Account | null>(ACCOUNT_KEY, null);
}

export function setCurrentAccount(account: Account | null): void {
  if (account) write(ACCOUNT_KEY, account);
  else {
    try {
      localStorage.removeItem(ACCOUNT_KEY);
    } catch {
      // Nothing stored.
    }
  }
}

/**
 * The catalog database for an account.
 *
 * Signed out, the original database name is kept, so an existing local-only
 * catalog is exactly where it always was.
 */
export function databaseFor(account: Account | null): string {
  return account ? `design-warehouse-${account.sub}` : 'design-warehouse';
}

// --- one OAuth client per person ------------------------------------------

type Bindings = Record<string, string>;

export function clientIdOwner(clientId: string): string | null {
  if (!clientId) return null;
  return read<Bindings>(BINDINGS_KEY, {})[clientId] ?? null;
}

export function bindClientId(clientId: string, sub: string): void {
  const bindings = read<Bindings>(BINDINGS_KEY, {});
  bindings[clientId] = sub;
  write(BINDINGS_KEY, bindings);
}

export function releaseClientId(clientId: string): void {
  const bindings = read<Bindings>(BINDINGS_KEY, {});
  delete bindings[clientId];
  write(BINDINGS_KEY, bindings);
}

export class SharedClientError extends Error {
  constructor(readonly ownerSub: string) {
    super(
      'That OAuth client is already in use by a different Google account on this device. ' +
        'Each person needs their own client ID — create one in your own Google Cloud project.',
    );
    this.name = 'SharedClientError';
  }
}

/**
 * Refuses a client ID that another account already claimed here.
 *
 * This is enforceable on one device only: without a server there is nowhere to
 * hold a registry, so two people on two machines could still pick the same
 * client ID. What genuinely separates them is the account they sign in as,
 * which decides both the catalog opened here and the Drive written to.
 */
export function assertClientNotShared(clientId: string, sub: string): void {
  const owner = clientIdOwner(clientId);
  if (owner && owner !== sub) throw new SharedClientError(owner);
}
