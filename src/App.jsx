import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Factures from './pages/Factures'
import Fournisseurs from './pages/Fournisseurs'
import Mercuriale from './pages/Mercuriale'
import BaseEtAppareils from './pages/BaseEtAppareils'
import VosRecettes from './pages/VosRecettes'
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
        <main className="flex-1 min-w-0 p-8 overflow-x-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/factures" replace />} />
            <Route path="/factures" element={<Factures />} />
            <Route path="/fournisseurs" element={<Fournisseurs />} />
            <Route path="/mercuriale" element={<Mercuriale />} />
            <Route path="/base-et-appareils" element={<BaseEtAppareils />} />
            <Route path="/recettes" element={<VosRecettes />} />
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