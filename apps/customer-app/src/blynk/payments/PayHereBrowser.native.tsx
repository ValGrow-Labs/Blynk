import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useKeyboardCover } from '@/lib/keyboard';
import { C, F } from '@/lib/theme';
import { PAY } from './copy';
import { formHtml, returnKind } from './form';
import type { PayHereBrowserProps } from './PayHereBrowser';

/**
 * Phones: PayHere's hosted page in an in-app browser. The WebView loads a page that posts the
 * checkout form straight away; when PayHere sends the customer to return_url / cancel_url the
 * navigation is stopped and the app checks the order itself (the URL is never trusted).
 */
export function PayHereBrowser({ form, entries, onBack, onClose }: PayHereBrowserProps) {
  const insets = useSafeAreaInsets();
  // edge-to-edge: the modal runs under the gesture / navigation bar and the card form's keyboard, so the page ends above both
  const cover = useKeyboardCover();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff', paddingBottom: cover > 0 ? cover : insets.bottom }}>
      <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
        <Text style={styles.title}>{PAY.payTitle}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button"><Text style={styles.close}>{PAY.closeBrowser}</Text></Pressable>
      </View>
      <WebView
        originWhitelist={['*']}
        source={{ html: formHtml(form.action_url, entries, PAY.redirecting) }}
        javaScriptEnabled
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(req) => {
          const kind = returnKind(req.url, form);
          if (kind) { onBack(kind); return false; }
          return true;
        }}
        style={{ flex: 1 }}
      />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  title: { fontFamily: F.bold, fontSize: 16, color: C.ink },
  close: { fontFamily: F.semi, fontSize: 14.5, color: C.brandText },
});
