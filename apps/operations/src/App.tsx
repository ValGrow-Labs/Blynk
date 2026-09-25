import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Catalog } from './pages/Catalog';
import { Categories } from './pages/Catalog/Categories';
import { ProductForm } from './pages/Catalog/ProductForm';
import { Products } from './pages/Catalog/Products';
import { Promotions } from './pages/Catalog/Promotions';
import { Detail as DeliveryDetail } from './pages/Delivery/Detail';
import { Queue as DeliveryQueue } from './pages/Delivery/Queue';
import { Appointments as DentalAppointments } from './pages/Dental/Appointments';
import { Availability as DentalAvailability } from './pages/Dental/Availability';
import { ClinicDetail as DentalClinicDetail } from './pages/Dental/ClinicDetail';
import { Clinics as DentalClinics } from './pages/Dental/Clinics';
import { Doctors as DentalDoctors } from './pages/Dental/Doctors';
import { Overview as DentalOverview } from './pages/Dental/Overview';
import { Home } from './pages/Home';
import { Ledger as InventoryLedger } from './pages/Inventory/Ledger';
import { Overview as InventoryOverview } from './pages/Inventory/Overview';
import { Sourcing as InventorySourcing } from './pages/Inventory/Sourcing';
import { Stock as InventoryStock } from './pages/Inventory/Stock';
import { StockDetail as InventoryStockDetail } from './pages/Inventory/StockDetail';
import { Suppliers as InventorySuppliers } from './pages/Inventory/Suppliers';
import { Login } from './pages/Login';
import { More } from './pages/More';
import { OrderDetail } from './pages/OrderDetail';
import { Orders } from './pages/Orders';
import { Riders } from './pages/Riders';

/**
 * Route protection here is for the operator's benefit only. Every
 * Operations-called endpoint is guarded server side by
 * requireAuth + requireRoles (plus rider ownership on rider-scoped routes),
 * so a hand-crafted request from the wrong role/identity is rejected by the
 * API whatever this router does (common.md rule 8).
 */
function RequireOperations({ children }: { children: JSX.Element }) {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="boot" role="status">
        Checking your session…
      </div>
    );
  }
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return children;
}

/**
 * ROUTE-TABLE PATTERN - every later Operations task (F2-F9) reads this
 * before adding a route:
 *
 * One flat `<Routes>` block. `/login` is the only route outside the gate.
 * Every other route is a nested child of the single
 * `<Route element={<RequireOperations><Layout/></RequireOperations>}>`
 * wrapper below, so it automatically renders inside the bottom-tab shell
 * and behind the auth gate - never add a second top-level gated block, and
 * never add a route outside this block unless it is genuinely public like
 * `/login`.
 *
 * To add a screen: add one more `<Route path="..." element={<YourPage/>} />`
 * as a sibling inside that same block - a flat leaf for a top-level tab's
 * real content (e.g. `orders`, replacing the `Orders` placeholder in place)
 * or a nested path for a detail/sub-screen (e.g. `orders/:id`,
 * `delivery/:id` - see F2's report for the exact `/delivery/:id` name F4
 * should register). The catch-all `path="*"` always stays last and always
 * redirects to `/` (matching Admin's own convention) - `/`'s own
 * `RequireOperations` gate then sends an unauthenticated visitor on to
 * `/login`, so there is exactly one redirect rule to reason about, not two.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireOperations>
            <Layout />
          </RequireOperations>
        }
      >
        <Route index element={<Home />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="delivery" element={<DeliveryQueue />} />
        <Route path="delivery/:id" element={<DeliveryDetail />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="catalog/products" element={<Products />} />
        <Route path="catalog/products/new" element={<ProductForm />} />
        <Route path="catalog/products/:id" element={<ProductForm />} />
        <Route path="catalog/categories" element={<Categories />} />
        <Route path="catalog/promotions" element={<Promotions />} />
        <Route path="catalog/inventory" element={<InventoryOverview />} />
        <Route path="catalog/inventory/stock" element={<InventoryStock />} />
        <Route path="catalog/inventory/stock/:productId" element={<InventoryStockDetail />} />
        <Route path="catalog/inventory/ledger" element={<InventoryLedger />} />
        <Route path="catalog/inventory/sourcing" element={<InventorySourcing />} />
        <Route path="catalog/inventory/suppliers" element={<InventorySuppliers />} />
        <Route path="catalog/dental" element={<DentalOverview />} />
        <Route path="catalog/dental/appointments" element={<DentalAppointments />} />
        <Route path="catalog/dental/clinics" element={<DentalClinics />} />
        <Route path="catalog/dental/clinics/:clinicId" element={<DentalClinicDetail />} />
        <Route path="catalog/dental/clinics/:clinicId/doctors/:clinicDoctorId" element={<DentalAvailability />} />
        <Route path="catalog/dental/doctors" element={<DentalDoctors />} />
        <Route path="more" element={<More />} />
        <Route path="more/riders" element={<Riders />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
