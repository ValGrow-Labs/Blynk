import { Tabs } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { fetchRiderRoute } from '@/blynk/api/tracking';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { appHidden, onVisible } from '@/blynk/lib/visibility';
import { listOrders } from '@/blynk/orders/api';
import { refreshActiveEta } from '@/blynk/orders/activeEta';
import { setKnownOrders } from '@/blynk/orders/openOrders';
import { TabBar } from '@/components/TabBar';
import { DEMO } from '@/demo/mode';
import { InTabsContext } from '@/lib/tabs';

/*
 * The customer shell (Flutter CustomerShell): Shop, Orders, Help and Profile as bottom tabs. Each
 * tab keeps its state while another is shown. Back on Orders, Help or Profile returns to Shop.
 * Detail screens (category, product, cart, order, address) are pushed over the tabs by the root
 * stack, so their URLs and back buttons are unchanged.
 */
export default function TabsLayout() {
  useOpenOrderBadge();
  return (
    <InTabsContext.Provider value>
      <Tabs
        tabBar={(props) => <TabBar {...props} />}
        backBehavior="initialRoute"
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: '#fff' } }}
      >
        <Tabs.Screen name="home" />
        <Tabs.Screen name="orders" />
        <Tabs.Screen name="help" />
        <Tabs.Screen name="account" />
      </Tabs>
    </InTabsContext.Provider>
  );
}

/**
 * Keeps the Orders badge current for a signed-in customer: the first page of GET /orders on
 * sign-in, whenever the app comes back, and every minute while it is open (the Orders tab
 * also reports each list it loads). Nothing for a guest. The same round keeps the slim active-order
 * banner (src/components/ActiveOrderBanner.tsx) current; it adds no loop of its own.
 */
function useOpenOrderBadge() {
  const session = useSession();
  const userId = session && !needsRegistration(session) ? session.user.id : null;
  useEffect(() => {
    if (DEMO || !userId) { setKnownOrders([]); return; }
    let alive = true;
    // the same round feeds the "active order" banner: the order, and while it is on the road the server's time to the door
    const load = () => listOrders(1)
      .then(async (r) => {
        if (!alive) return;
        setKnownOrders(r.orders);
        await refreshActiveEta((id) => fetchRiderRoute(id));
      })
      .catch(() => undefined);
    void load();
    const t = setInterval(() => { if (!appHidden()) void load(); }, 60_000);
    const off = onVisible(() => void load());
    return () => { alive = false; clearInterval(t); off(); };
  }, [userId]);
}
