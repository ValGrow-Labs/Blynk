/*
 * What "Try again" does on the error screen: redraw the app (expo-router's `retry` clears the
 * error), then go to Home, so a screen that keeps failing is not drawn again. Neither step may
 * throw (the error screen is the last thing standing), and Home is reached even if `retry` fails.
 */
export async function restartToHome(retry: () => Promise<void>, goHome: () => void): Promise<void> {
  try {
    await retry();
  } catch {
    /* the screen will be replaced anyway */
  }
  try {
    goHome();
  } catch {
    /* the navigator is not ready: the redrawn app opens on its own start screen */
  }
}
