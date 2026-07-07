import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Factures from './pages/Factures'
import Fournisseurs from './pages/Fournisseurs'
import Mercuriale from './pages/Mercuriale'
import Commandes from './pages/Commandes'
import Reception from './pages/Reception'
import Alertes from './pages/Alertes'

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 p-8">
          <Routes>
            <Route path="/" element={<Navigate to="/factures" replace />} />
            <Route path="/factures" element={<Factures />} />
            <Route path="/fournisseurs" element={<Fournisseurs />} />
            <Route path="/mercuriale" element={<Mercuriale />} />
            <Route path="/commandes" element={<Commandes />} />
            <Route path="/reception" element={<Reception />} />
            <Route path="/alertes" element={<Alertes />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}