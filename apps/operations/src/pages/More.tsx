import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';

/**
 * The More tab (plan §8: rider list, settings, sign-out). Sign-out is real,
 * working functionality. Task F7 replaces the "rider list ... built by a
 * later task" placeholder line with a real entry point to the new
 * `/more/riders` read-only roster (plan §14, common.md rule 9) - a link, not
 * a fabricated action, since the screen it leads to is itself read-only (no
 * rider create/activate/deactivate/edit capability exists in the backend).
 * A future settings screen is still built by a later task, if any.
 */
export function More() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="page">
      <PageHeader title="More" description="Riders, account and sign-out." />
      <section className="card">
        <p className="card__row">
          <span className="card__label">Signed in as</span>
          <span className="card__value">{user?.full_name ?? user?.phone}</span>
        </p>
        <p className="card__row">
          <span className="card__label">Role</span>
          <span className="card__value">{user?.role}</span>
        </p>
      </section>

      <ul className="cat-hub">
        <li>
          <Link className="cat-hub__card" to="/more/riders">
            <span className="cat-hub__title">Riders</span>
          </Link>
        </li>
      </ul>

      <section className="card">
        <button type="button" className="button button--ghost" onClick={() => void handleSignOut()}>
          Sign out
        </button>
      </section>
    </div>
  );
}
