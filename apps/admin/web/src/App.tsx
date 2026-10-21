import { useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router';
import { api } from './api';
import { NoticeProvider, useNotices } from './notices';
import { BusinessesPage } from './pages/BusinessesPage';
import { BusinessPage } from './pages/BusinessPage';
import { InventoryPage } from './pages/InventoryPage';
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
            <Route path="/inventario" element={<InventoryPage />} />
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

  async function resync() {
    if (!confirm('¿Re-publicar todos los chips en Cloudflare desde la base local?')) return;
    setSyncing(true);
    try {
      const result = await api.resync();
      notify(
        'success',
        `Sincronizado: ${result.published} chips publicados, ${result.deleted} claves sobrantes eliminadas.`,
      );
    } catch (err) {
      reportError(err);
    } finally {
      setSyncing(false);
    }
  }

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
          <NavLink to="/inventario">Chips libres</NavLink>
        </nav>
        <button type="button" className="button button-small" onClick={resync} disabled={syncing}>
          {syncing ? 'Sincronizando…' : 'Re-sincronizar todo'}
        </button>
      </div>
    </header>
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
