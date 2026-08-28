/*
 * Telegram Mini App game adapter
 *
 * Keep all Telegram.WebApp access in this module. Game systems should depend
 * on TelegramGamePlatform, never on the Telegram global directly.
 *
 * Security boundary:
 * - initDataUnsafe is never an authorization source.
 * - rawInitData is sent only to your HTTPS backend for server-side validation.
 * - bot tokens, payment secrets, and privileged Bot API calls stay server-side.
 *
 * This template intentionally uses structural types instead of a Telegram SDK
 * dependency, so it can be copied into Vite, Phaser, Pixi, React, or vanilla
 * TypeScript projects. Narrow or extend TelegramWebApp as your project needs.
 */

export type Unsubscribe = () => void;
export type Insets = Readonly<{ top: number; right: number; bottom: number; left: number }>;
export type ThemeParams = Readonly<Record<string, string>>;
export type HapticKind = "light" | "medium" | "heavy" | "rigid" | "soft" | "success" | "warning" | "error";
export type Orientation = "portrait" | "landscape";

export interface ViewportState {
  readonly width: number;
  readonly height: number;
  readonly stableHeight: number;
  readonly isExpanded: boolean;
  readonly isFullscreen: boolean;
}

export interface TelegramGamePlatform {
  /** True only when a Telegram WebApp object was detected. */
  readonly isTelegram: boolean;
  /** Raw signed launch data. Send to the backend; never parse it for authority in the client. */
  readonly rawInitData: string | null;
  /** A routing hint only. Validate its meaning server-side before awarding anything. */
  readonly startParam: string | null;
  readonly themeParams: ThemeParams;
  readonly safeAreaInset: Insets;
  readonly contentSafeAreaInset: Insets;
  readonly viewport: ViewportState;

  ready(): void;
  expand(): void;
  close(): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;

  requestFullscreen(): Promise<boolean>;
  exitFullscreen(): Promise<boolean>;
  lockOrientation(orientation: Orientation): Promise<boolean>;
  unlockOrientation(): Promise<boolean>;
  haptic(kind: HapticKind): void;

  showBackButton(): void;
  hideBackButton(): void;
  onBackButton(listener: () => void): Unsubscribe;
  onViewportChange(listener: (state: ViewportState) => void): Unsubscribe;
  onThemeChange(listener: (theme: ThemeParams) => void): Unsubscribe;
  onSafeAreaChange(listener: (insets: { safe: Insets; content: Insets }) => void): Unsubscribe;
  onLifecycleChange(listener: (active: boolean) => void): Unsubscribe;
  onFullscreenChange(listener: (fullscreen: boolean) => void): Unsubscribe;
}

interface TelegramHapticFeedback {
  impactOccurred?(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred?(type: "error" | "success" | "warning"): void;
}

interface TelegramWebApp {
  initData?: string;
  // Display/routing convenience only. Never use for authorization.
  initDataUnsafe?: { start_param?: string };
  themeParams?: Record<string, string>;
  viewportWidth?: number;
  viewportHeight?: number;
  viewportStableHeight?: number;
  isExpanded?: boolean;
  isFullscreen?: boolean;
  safeAreaInset?: Partial<Insets>;
  contentSafeAreaInset?: Partial<Insets>;
  ready?(): void;
  expand?(): void;
  close?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  lockOrientation?(): void;
  unlockOrientation?(): void;
  BackButton?: { show?(): void; hide?(): void; onClick?(fn: () => void): void; offClick?(fn: () => void): void };
  HapticFeedback?: TelegramHapticFeedback;
  onEvent?(event: string, callback: () => void): void;
  offEvent?(event: string, callback: () => void): void;
}

type TelegramGlobal = { Telegram?: { WebApp?: TelegramWebApp } };

const EMPTY_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const EMPTY_VIEWPORT: ViewportState = Object.freeze({
  width: 0,
  height: 0,
  stableHeight: 0,
  isExpanded: false,
  isFullscreen: false,
});

function normalizeInsets(value?: Partial<Insets>): Insets {
  return Object.freeze({
    top: Math.max(0, value?.top ?? 0),
    right: Math.max(0, value?.right ?? 0),
    bottom: Math.max(0, value?.bottom ?? 0),
    left: Math.max(0, value?.left ?? 0),
  });
}

function readViewport(webApp: TelegramWebApp | undefined): ViewportState {
  if (!webApp) return EMPTY_VIEWPORT;
  return Object.freeze({
    width: webApp.viewportWidth ?? globalThis.innerWidth ?? 0,
    height: webApp.viewportHeight ?? globalThis.innerHeight ?? 0,
    stableHeight: webApp.viewportStableHeight ?? webApp.viewportHeight ?? globalThis.innerHeight ?? 0,
    isExpanded: Boolean(webApp.isExpanded),
    isFullscreen: Boolean(webApp.isFullscreen),
  });
}

function addListener<T>(set: Set<T>, listener: T): Unsubscribe {
  set.add(listener);
  return () => set.delete(listener);
}

/**
 * Build a Telegram adapter. Outside Telegram it returns a safe browser mock.
 * Inject `webApp` in tests to simulate Telegram events without trusting them.
 */
export function createTelegramGamePlatform(
  webApp: TelegramWebApp | undefined = (globalThis as TelegramGlobal).Telegram?.WebApp,
): TelegramGamePlatform {
  const isTelegram = Boolean(webApp);
  const viewportListeners = new Set<(state: ViewportState) => void>();
  const themeListeners = new Set<(theme: ThemeParams) => void>();
  const safeAreaListeners = new Set<(insets: { safe: Insets; content: Insets }) => void>();
  const lifecycleListeners = new Set<(active: boolean) => void>();
  const fullscreenListeners = new Set<(fullscreen: boolean) => void>();
  const backListeners = new Set<() => void>();
  let viewport = readViewport(webApp);
  let themeParams: ThemeParams = Object.freeze({ ...(webApp?.themeParams ?? {}) });
  let safeAreaInset = normalizeInsets(webApp?.safeAreaInset);
  let contentSafeAreaInset = normalizeInsets(webApp?.contentSafeAreaInset);

  const emitViewport = () => {
    viewport = readViewport(webApp);
    viewportListeners.forEach((listener) => listener(viewport));
  };
  const emitTheme = () => {
    themeParams = Object.freeze({ ...(webApp?.themeParams ?? {}) });
    themeListeners.forEach((listener) => listener(themeParams));
  };
  const emitSafeArea = () => {
    safeAreaInset = normalizeInsets(webApp?.safeAreaInset);
    contentSafeAreaInset = normalizeInsets(webApp?.contentSafeAreaInset);
    const value = { safe: safeAreaInset, content: contentSafeAreaInset };
    safeAreaListeners.forEach((listener) => listener(value));
  };
  const emitActive = (active: boolean) => lifecycleListeners.forEach((listener) => listener(active));
  const emitFullscreen = () => {
    viewport = readViewport(webApp);
    fullscreenListeners.forEach((listener) => listener(viewport.isFullscreen));
  };
  const subscribe = (event: string, callback: () => void) => {
    webApp?.onEvent?.(event, callback);
    return () => webApp?.offEvent?.(event, callback);
  };

  const requestFullscreen = async (): Promise<boolean> => {
    if (!webApp?.requestFullscreen) return false;
    try {
      webApp.requestFullscreen();
      return true; // Telegram reports later failure through fullscreenFailed.
    } catch {
      return false;
    }
  };
  const exitFullscreen = async (): Promise<boolean> => {
    if (!webApp?.exitFullscreen) return false;
    try {
      webApp.exitFullscreen();
      return true;
    } catch {
      return false;
    }
  };
  const lockOrientation = async (orientation: Orientation): Promise<boolean> => {
    if (!webApp?.lockOrientation) return false;
    try {
      // The official WebApp method currently locks the device orientation;
      // retain the parameter in this app-level API for future strategy choice.
      void orientation;
      webApp.lockOrientation();
      return true;
    } catch {
      return false;
    }
  };
  const unlockOrientation = async (): Promise<boolean> => {
    if (!webApp?.unlockOrientation) return false;
    try {
      webApp.unlockOrientation();
      return true;
    } catch {
      return false;
    }
  };

  // Register one stable handler per Telegram event. Each returned unsubscribe
  // removes only the game listener, while the WebApp handler remains stable.
  subscribe("viewportChanged", emitViewport);
  subscribe("themeChanged", emitTheme);
  subscribe("safeAreaChanged", emitSafeArea);
  subscribe("contentSafeAreaChanged", emitSafeArea);
  subscribe("activated", () => emitActive(true));
  subscribe("deactivated", () => emitActive(false));
  subscribe("fullscreenChanged", emitFullscreen);
  subscribe("fullscreenFailed", emitFullscreen);
  const backHandler = () => backListeners.forEach((listener) => listener());
  webApp?.BackButton?.onClick?.(backHandler);

  return {
    get isTelegram() { return isTelegram; },
    get rawInitData() { return webApp?.initData ?? null; },
    get startParam() { return webApp?.initDataUnsafe?.start_param ?? null; },
    get themeParams() { return themeParams; },
    get safeAreaInset() { return safeAreaInset; },
    get contentSafeAreaInset() { return contentSafeAreaInset; },
    get viewport() { return viewport; },
    ready: () => webApp?.ready?.(),
    expand: () => webApp?.expand?.(),
    close: () => webApp?.close?.(),
    enableClosingConfirmation: () => webApp?.enableClosingConfirmation?.(),
    disableClosingConfirmation: () => webApp?.disableClosingConfirmation?.(),
    requestFullscreen,
    exitFullscreen,
    lockOrientation,
    unlockOrientation,
    haptic: (kind) => {
      if (kind === "success" || kind === "warning" || kind === "error") webApp?.HapticFeedback?.notificationOccurred?.(kind);
      else webApp?.HapticFeedback?.impactOccurred?.(kind);
    },
    showBackButton: () => webApp?.BackButton?.show?.(),
    hideBackButton: () => webApp?.BackButton?.hide?.(),
    onBackButton: (listener) => addListener(backListeners, listener),
    onViewportChange: (listener) => addListener(viewportListeners, listener),
    onThemeChange: (listener) => addListener(themeListeners, listener),
    onSafeAreaChange: (listener) => addListener(safeAreaListeners, listener),
    onLifecycleChange: (listener) => addListener(lifecycleListeners, listener),
    onFullscreenChange: (listener) => addListener(fullscreenListeners, listener),
  };
}

export interface TelegramSession {
  readonly sessionToken: string;
  readonly userId: string;
  readonly expiresAt: string;
}

/**
 * Bootstrap an application session. The server must validate raw initData,
 * check freshness/replay, and return a server-issued session. The response
 * must not be accepted as a user identity without server validation.
 */
export async function bootstrapTelegramSession(
  platform: Pick<TelegramGamePlatform, "rawInitData" | "isTelegram">,
  endpoint = "/api/auth/telegram",
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramSession> {
  if (!platform.isTelegram || !platform.rawInitData) {
    throw new Error("Telegram session bootstrap requires a genuine Telegram launch");
  }
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ initData: platform.rawInitData }),
  });
  if (!response.ok) throw new Error(`Telegram session bootstrap failed (${response.status})`);
  const session = (await response.json()) as Partial<TelegramSession>;
  if (!session.sessionToken || !session.userId || !session.expiresAt) {
    throw new Error("Backend returned an incomplete Telegram session");
  }
  return session as TelegramSession;
}

/**
 * Apply Telegram theme and safe-area values to a root element. Use semantic
 * CSS variables in the game UI; do not hard-code a light-only palette.
 */
export function applyTelegramCss(element: HTMLElement, platform: Pick<TelegramGamePlatform, "themeParams" | "safeAreaInset" | "contentSafeAreaInset">): void {
  for (const [name, value] of Object.entries(platform.themeParams)) {
    if (value) element.style.setProperty(`--tg-theme-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value);
  }
  const safe = platform.safeAreaInset;
  const content = platform.contentSafeAreaInset;
  element.style.setProperty("--tg-safe-top", `${safe.top}px`);
  element.style.setProperty("--tg-safe-right", `${safe.right}px`);
  element.style.setProperty("--tg-safe-bottom", `${safe.bottom}px`);
  element.style.setProperty("--tg-safe-left", `${safe.left}px`);
  element.style.setProperty("--tg-content-safe-top", `${content.top}px`);
  element.style.setProperty("--tg-content-safe-right", `${content.right}px`);
  element.style.setProperty("--tg-content-safe-bottom", `${content.bottom}px`);
  element.style.setProperty("--tg-content-safe-left", `${content.left}px`);
}

// Server contract: POST rawInitData to an HTTPS backend, validate it using
// Telegram's current official algorithm, enforce auth_date freshness and replay
// policy, then issue an application session. Never authorize by initDataUnsafe.
