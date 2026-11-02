import { router, type ErrorBoundaryProps } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { restartToHome } from '@/blynk/lib/restart';
import { ERROR_SCREEN } from '@/blynk/ui/errorWords';
import { C, F } from '@/lib/theme';

/**
 * The app's error screen (exported as `ErrorBoundary` from the root layout, so expo-router wraps
 * every screen in it): a friendly "Something went wrong" in the customer's language with one
 * "Try again" that redraws the app and goes Home, instead of a white screen. It sits above the
 * providers (no safe-area, store or cart here): plain padding, plain colours.
 */
export function RootError({ retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.root} accessibilityRole="alert">
      <Text style={styles.mark}>!</Text>
      <Text style={styles.title}>{ERROR_SCREEN.title}</Text>
      <Text style={styles.body}>{ERROR_SCREEN.body}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ERROR_SCREEN.button}
        onPress={() => { void restartToHome(retry, () => router.replace('/home')); }}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonTxt}>{ERROR_SCREEN.button}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  mark: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.brand, color: C.brandInk, textAlign: 'center',
    lineHeight: 56, fontFamily: F.black, fontSize: 28, overflow: 'hidden',
  },
  title: { fontFamily: F.bold, fontSize: 19, color: C.ink, marginTop: 18, textAlign: 'center' },
  body: { fontFamily: F.regular, fontSize: 14, color: C.sub, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  button: { marginTop: 24, minHeight: 48, paddingHorizontal: 28, borderRadius: 24, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: C.brandDeep },
  buttonTxt: { fontFamily: F.bold, fontSize: 15, color: C.brandInk },
});
