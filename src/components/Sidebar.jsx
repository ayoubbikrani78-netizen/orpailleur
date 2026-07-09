import { NavLink } from 'react-router-dom'
import { FileText, Users, ShoppingBag, Truck, Bell, BarChart2, Settings } from 'lucide-react'

const nav = [
  { to: '/factures', label: 'Corbeille factures', icon: FileText },
  { to: '/fournisseurs', label: 'Catalogue fournisseurs', icon: Users },
  { to: '/mercuriale', label: 'Mercuriale', icon: BarChart2 },
  { to: '/commandes', label: 'Commandes', icon: ShoppingBag },
  { to: '/reception', label: 'Réception', icon: Truck },
  { to: '/alertes', label: 'Alertes', icon: Bell },
  { to: '/reglages', label: 'Réglages', icon: Settings },
]

export default function Sidebar() {
  return (
    <aside className="w-64 min-h-screen bg-white border-r border-gray-200 flex flex-col">
      <div className="px-6 py-6 border-b border-gray-200">
        <h1 className="text-2xl font-bold" style={{ color: '#C9A84C' }}>Orpailleur</h1>
        <p className="text-xs text-gray-400 mt-1">Gestion boulangerie</p>
      </div>
      <nav className="flex-1 px-4 py-6 space-y-1">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`
            }
            style={({ isActive }) => isActive ? { backgroundColor: '#C9A84C' } : {}}
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}