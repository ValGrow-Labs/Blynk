import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * The app's safe-area provider. A phone uses the library's own; the web build (SafeAreaRoot.web.tsx)
 * adds a re-measuring layer for the installed iPhone app.
 */
export const SafeAreaRoot = SafeAreaProvider;
