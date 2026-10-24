import { useEffect, useState, type FormEvent } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router';
import { api, ApiError } from './api';
import { useResource } from './hooks';
import { NoticeProvider, useNotices } from './notices';
import { Badge } from './ui';
import { BusinessesPage } from './pages/BusinessesPage';
import { BusinessPage } from './pages/BusinessPage';
import { ChipsPage } from './pages/ChipsPage';
import { TagPage } from './pages/TagPage';

export function App() {
  return (
    <NoticeProvider>
      <BrowserRouter>
        <Header />
        <main className="container">
          <Routes>
            <Route path="/" element={<BusinessesPage />} />
            <Route path="/negocios/:id" element={<BusinessPage />} />
            <Route path="/chips" element={<ChipsPage />} />
            <Route path="/inventario" element={<Navigate to="/chips?ver=libres" replace />} />
            <Route path="/chips/:slug" element={<TagPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </BrowserRouter>
    </NoticeProvider>
  );
}

function Header() {
  const { notify, reportError } = useNotices();
  const [syncing, setSyncing] = useState(false);
  const [tick, setTick] = useState(0);
  const status = useResource(api.syncStatus, `sync-status:${tick}`);

  // Los cambios pendientes se reintentan solos en la Pi; aquí solo se muestra cuántos quedan.
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
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="brand">
          Panel NFC
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Negocios
          </NavLink>
          <NavLink to="/chips" end>
            Chips
          </NavLink>
        </nav>
        {pending > 0 ? (
          <span title={status.data?.lastError ?? 'Publicando…'}>
            <Badge tone="warn">
              {pending === 1 ? '1 cambio pendiente' : `${pending} cambios pendientes`}
            </Badge>
          </span>
        ) : null}
        <GoToChip />
        <button type="button" className="button button-small" onClick={resync} disabled={syncing}>
          {syncing ? 'Sincronizando…' : 'Re-sincronizar todo'}
        </button>
      </div>
    </header>
  );
}

/** Salto rápido a un chip por su número (el que se ve escrito en el stand). */
function GoToChip() {
  const navigate = useNavigate();
  const { notify, reportError } = useNotices();
  const [value, setValue] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const number = Number(value.replace(/^#/, '').trim());
    if (!Number.isInteger(number) || number <= 0) return;
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
        inputMode="numeric"
        placeholder="Chip #"
        aria-label="Ir al chip número"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}

function NotFound() {
  return (
    <div className="card">
      <p>Esta página no existe.</p>
      <Link to="/">Volver a negocios</Link>
    </div>
  );
}
