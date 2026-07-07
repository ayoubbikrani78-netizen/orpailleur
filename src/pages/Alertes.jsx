import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AlertTriangle, TrendingUp, Package, Truck, CreditCard, DollarSign, Check } from 'lucide-react'

const TYPE_CONFIG = {
  retard_paiement: { label: 'Retard de paiement', icon: CreditCard, color: 'text-red-500 bg-red-50' },
  retard_livraison: { label: 'Retard de livraison', icon: Truck, color: 'text-orange-500 bg-orange-50' },
  sur_stock: { label: 'Sur stock', icon: Package, color: 'text-blue-500 bg-blue-50' },
  ecart_prix: { label: 'Écart de prix', icon: DollarSign, color: 'text-purple-500 bg-purple-50' },
  franco_80: { label: 'Franco 80%', icon: TrendingUp, color: 'text-yellow-600 bg-yellow-50' },
  rupture_stock: { label: 'Rupture de stock / CMP', icon: AlertTriangle, color: 'text-red-500 bg-red-50' },
  hausse_cmp: { label: 'Hausse CMP', icon: TrendingUp, color: 'text-red-500 bg-red-50' }
}

export default function Alertes() {
  const [alertes, setAlertes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchAlertes() }, [])

  async function fetchAlertes() {
    const { data } = await supabase
      .from('alertes')
      .select('*')
      .eq('statut', 'active')
      .order('created_at', { ascending: false })
    setAlertes(data || [])
    setLoading(false)
  }

  async function cloturerAlerte(id) {
    await supabase.from('alertes').delete().eq('id', id)
    fetchAlertes()
  }

  async function qualifierLitige(id) {
    await supabase.from('alertes').update({ etat_litige: 'litige' }).eq('id', id)
    fetchAlertes()
  }

  function groupByType() {
    const groups = {}
    alertes.forEach(a => {
      if (!groups[a.type]) groups[a.type] = []
      groups[a.type].push(a)
    })
    return groups
  }

  const groups = groupByType()
  const types = Object.keys(TYPE_CONFIG)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Alertes</h2>
      </div>

      {loading ? <p className="text-gray-400">Chargement...</p> : (
        <div className="grid grid-cols-2 gap-6">
          {types.map(type => {
            const config = TYPE_CONFIG[type]
            const Icon = config.icon
            const items = groups[type] || []
            return (
              <div key={type} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className={`p-1.5 rounded-lg ${config.color}`}>
                    <Icon size={16} />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-700">{config.label}</h3>
                  {items.length > 0 && (
                    <span className="ml-auto text-xs font-medium text-gray-400">{items.length}</span>
                  )}
                </div>

                {items.length === 0 ? (
                  <p className="text-xs text-gray-300">Aucune alerte</p>
                ) : (
                  <div className="space-y-2">
                    {items.map(a => (
                      <div key={a.id} className="p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs text-gray-600 flex-1">{a.message}</p>
                          <button onClick={() => cloturerAlerte(a.id)} className="shrink-0 p-1 hover:bg-gray-200 rounded">
                            <Check size={14} className="text-green-500" />
                          </button>
                        </div>
                        {type === 'retard_paiement' && (
                          <div className="mt-2 flex items-center justify-between">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.etat_litige === 'litige' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
                              {a.etat_litige === 'litige' ? 'Litige' : 'Non qualifié'}
                            </span>
                            {a.etat_litige !== 'litige' && (
                              <button onClick={() => qualifierLitige(a.id)} className="text-xs text-red-500 font-medium hover:underline">
                                Marquer en litige
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}