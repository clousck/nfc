import { useEffect, useState, type FormEvent } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';
import { api, ApiError } from './api';
import { useResource } from './hooks';
import { NoticeProvider, useNotices } from './notices';
import { Icon, Mark } from './ui';
import { BusinessesPage } from './pages/BusinessesPage';
import { BusinessPage } from './pages/BusinessPage';
import { ChipsPage } from './pages/ChipsPage';
import { HomePage } from './pages/HomePage';
import { SettingsPage } from './pages/SettingsPage';
import { TagPage } from './pages/TagPage';

export function App() {
  return (
    <NoticeProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </NoticeProvider>
  );
}

/** Marco en L (barra lateral + barra superior) y la hoja blanca con la página (docs/UI.md). */
function Shell() {
  const location = useLocation();
  // En el móvil el menú ocupa la pantalla: se abre para esta ruta, así que al cambiar de página
  // queda cerrado.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuOpen = menuFor === location.pathname;

  return (
    <div className={`app${menuOpen ? ' menu-open' : ''}`}>
      <Sidebar onClose={() => setMenuFor(null)} />
      <header className="topbar">
        <button
          type="button"
          className="button button-quiet menu-button"
          aria-label="Abrir el menú"
          onClick={() => setMenuFor(location.pathname)}
        >
          <Icon name="menu" size={20} />
        </button>
        <GoTo />
      </header>
      <main className="sheet">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/negocios" element={<BusinessesPage />} />
          <Route path="/negocios/:id" element={<BusinessPage />} />
          <Route path="/negocios/:id/:tab" element={<BusinessPage />} />
          <Route path="/chips" element={<ChipsPage />} />
          <Route path="/inventario" element={<Navigate to="/chips?ver=libres" replace />} />
          <Route path="/chips/:slug" element={<TagPage />} />
          <Route path="/ajustes" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function Sidebar({ onClose }: { onClose: () => void }) {
  return (
    <aside className="side" aria-label="Navegación">
      <div className="side-head">
        <Link to="/" className="brand">
          <Mark />
          <span>
            PengineXR <small>Panel</small>
          </span>
        </Link>
        <button
          type="button"
          className="button button-quiet menu-button"
          aria-label="Cerrar el menú"
          onClick={onClose}
        >
          <span className="menu-close" aria-hidden="true">
            ×
          </span>
        </button>
      </div>
      <nav className="nav" onClick={onClose}>
        <NavLink to="/" end>
          <Icon name="inicio" />
          <span>Inicio</span>
        </NavLink>
        <NavLink to="/negocios">
          <Icon name="negocios" />
          <span>Negocios</span>
        </NavLink>
        <NavLink to="/chips">
          <Icon name="chips" />
          <span>Chips</span>
        </NavLink>
        <NavLink to="/ajustes">
          <Icon name="ajustes" />
          <span>Ajustes</span>
        </NavLink>
      </nav>
      <PublishStatus />
    </aside>
  );
}

/** Cola de publicación hacia Cloudflare: se reintenta sola; aquí se ve y se puede forzar. */
function PublishStatus() {
  const { notify, reportError } = useNotices();
  const [syncing, setSyncing] = useState(false);
  const [tick, setTick] = useState(0);
  const status = useResource(api.syncStatus, `sync-status:${tick}`);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  async function resync() {
    if (!confirm('¿Re-publicar todos los chips en Cloudflare desde la base local?')) return;
    setSyncing(true);
    try {
      const result = await api.resync();
      notify(
        'success',
        `Sincronizado: ${result.tags} chips, ${result.businesses} negocios y ${result.reports} enlaces de estadísticas publicados (${result.written} escrituras en Cloudflare); ${result.deleted} claves sobrantes eliminadas.`,
      );
    } catch (err) {
      reportError(err);
    } finally {
      setSyncing(false);
      setTick((t) => t + 1);
    }
  }

  const pending = status.data?.pending ?? 0;
  return (
    <div className="side-status">
      <p className="status-line" title={status.data?.lastError ?? undefined}>
        <span className={`dot${pending > 0 || status.error ? ' dot-warn' : ''}`} />
        {status.error
          ? 'Sin conexión con la API'
          : !status.data
            ? 'Comprobando…'
            : pending === 0
              ? 'Publicación al día'
              : pending === 1
                ? '1 cambio pendiente'
                : `${pending} cambios pendientes`}
      </p>
      <button
        type="button"
        className="button button-small"
        onClick={() => void resync()}
        disabled={syncing}
      >
        {syncing ? 'Sincronizando…' : 'Re-sincronizar todo'}
      </button>
    </div>
  );
}

/** Buscador global: un número abre ese chip (el que se ve en el stand); un texto busca negocios. */
function GoTo() {
  const navigate = useNavigate();
  const { notify, reportError } = useNotices();
  const [value, setValue] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    const number = Number(text.replace(/^#/, ''));
    if (!Number.isInteger(number) || number <= 0) {
      setValue('');
      navigate(`/negocios?q=${encodeURIComponent(text)}`);
      return;
    }
    try {
      const tag = await api.getTagByNumber(number);
      setValue('');
      navigate(`/chips/${tag.slug}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404)
        notify('warning', `No existe el chip #${number}.`);
      else reportError(err);
    }
  }

  return (
    <form className="goto" onSubmit={submit} role="search">
      <input
        className="input"
        type="search"
        placeholder="Ir al chip #12 o buscar un negocio"
        aria-label="Ir a un chip por su número o buscar un negocio"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}

function NotFound() {
  return (
    <div className="empty">
      <p>Esta página no existe.</p>
      <p>
        <Link to="/">Volver al inicio</Link>
      </p>
    </div>
  );
}
