import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import type { DeliveryMethod } from '@/blynk/orders/types';
import { C, F } from '@/lib/theme';
import { methodRows, type BicycleOffer } from './bicycle';
import { BICYCLE_WORDS as W } from './bicycleWords';

/**
 * Checkout's delivery choice (2026-11-05): "Bicycle - cheaper, a bit slower" or "Motorbike - faster",
 * shown only while GET /orders/checkout-info says bicycle delivery is available (the screen renders
 * nothing here otherwise). Same look as the payment choice.
 */
export function DeliveryMethodCard({ offer, motorbikeFee, method, onChange }: {
  offer: BicycleOffer; motorbikeFee: number | null; method: DeliveryMethod; onChange: (m: DeliveryMethod) => void;
}) {
  const rows = methodRows(offer, motorbikeFee);
  return (
    <Animated.View layout={LinearTransition.duration(220)} style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{W.sectionTitle}</Text>
      <View accessibilityRole="radiogroup">
        {rows.map((r) => {
          const on = r.method === method;
          return (
            <Pressable
              key={r.method}
              onPress={() => onChange(r.method)}
              style={[styles.row, on && styles.rowOn]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${r.title}. ${r.sub}`}
            >
              <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{r.title}</Text>
                {!!r.sub && <Text style={styles.rowSub}>{r.sub}</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 15, marginBottom: 15, padding: 15 },
  title: { fontFamily: F.semi, fontSize: 15, color: '#222', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1.2, borderColor: '#E6E6EA', marginTop: 8 },
  rowOn: { borderColor: C.brandInk, backgroundColor: C.brandTint },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#B4B4BC', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: C.brandInk },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.brandInk },
  rowTitle: { fontFamily: F.semi, fontSize: 14.5, color: C.ink },
  rowSub: { fontFamily: F.regular, fontSize: 12, color: '#6E6E76', marginTop: 1, lineHeight: 16 },
});
