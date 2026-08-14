import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Factures from './pages/Factures'
import Fournisseurs from './pages/Fournisseurs'
import Mercuriale from './pages/Mercuriale'
import Recettes from './pages/Recettes'
import CoutRevient from './pages/CoutRevient'
import Commandes from './pages/Commandes'
import Reception from './pages/Reception'
import Alertes from './pages/Alertes'
import Reglages from './pages/Reglages'

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
            <Route path="/recettes" element={<Recettes />} />
            <Route path="/cout-revient" element={<CoutRevient />} />
            <Route path="/commandes" element={<Commandes />} />
            <Route path="/reception" element={<Reception />} />
            <Route path="/alertes" element={<Alertes />} />
    	    <Route path="/reglages" element={<Reglages />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}