import { Linking, Platform } from "react-native";

/**
 * The one module in the client bundle allowed to touch a browser global, so the
 * DOM stays out of `tsconfig.json` and out of every component.
 */

// Declared rather than pulled from `lib: DOM`, which would let every other
// client module reach for `document` without a compile error.
declare const window: {
  open(url: string, target: string, features: string): unknown;
  /**
   * The desktop app's preload bridge. Absent in a plain browser tab, and absent
   * on native, so every read of it is optional.
   */
  paseoDesktop?: {
    opener?: {
      /** Rejects on anything that is not an HTTP(S) URL. */
      openUrl?: (url: string) => Promise<unknown>;
    };
  };
};

/**
 * Opens a URL in the reader's own browser.
 *
 * The desktop app is Electron and installs no window-open handler on its main
 * window, so `window.open` there gets Electron's default: another app window,
 * with no address bar, no extensions, and none of the reader's logins. Its
 * preload bridge hands the URL to `shell.openExternal` instead, which is the
 * default browser. Prefer it whenever it is there.
 *
 * `window.open` stays the fallback for a real browser tab, where
 * `Linking.openURL` hands the client a navigation the host may block. Native
 * clients have neither and use `Linking`.
 */
export async function openExternal(url: string): Promise<void> {
  if (Platform.OS === "web") {
    const opener = window.paseoDesktop?.opener;
    if (opener?.openUrl !== undefined) {
      // Called on its owner, so the bridge keeps its receiver.
      await opener.openUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}
