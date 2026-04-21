import React, { useState } from 'react';
import { useParams } from 'react-router-dom'; // Importante para las rutas
import { useAuth0 } from "@auth0/auth0-react";
import { 
  Search, Plus, FileText, Database, BookOpen, LogOut, 
  Network, CheckCircle2, XCircle, AlertCircle 
} from 'lucide-react';

// Definimos las props como opcionales (?) para evitar el error ts(2739)
interface NotebookProps {
  user?: any;
  onLogout?: () => void;
  onViewGraph?: () => void;
}

const NotebookSearch = ({ user: propUser, onLogout, onViewGraph }: NotebookProps) => {
  const { userId } = useParams(); // Obtenemos el ID de la URL (ej: localhost:5173/cuaderno/123)
  const { user: auth0User, logout } = useAuth0();
  const [query, setQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Priorizamos los datos que vienen por props, si no, usamos los del hook
  const activeUser = propUser || auth0User;
  
  const safeUser = {
    name: activeUser?.name || "Investigador IMFD",
    email: activeUser?.email || "usuario@imfd.cl",
    picture: activeUser?.picture || `https://api.dicebear.com/7.x/initials/svg?seed=${userId || 'default'}`
  };

  // Manejo de logout fallback
  const handleLogout = onLogout || (() => logout({ logoutParams: { returnTo: window.location.origin } }));

  const sources = [
    { id: 1, title: "Dataset_Elecciones_2024.csv", status: 'success' },
    { id: 2, title: "Entrevista_Candidato_A.pdf", status: 'success' },
    { id: 3, title: "Manuscrito_Ilegible_1920.pdf", status: 'error' },
  ];

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-[#243166] font-sans">
      {/* SIDEBAR */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col z-20">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-[#A8A3F6] rounded-lg flex items-center justify-center text-white">
              <BookOpen size={18} />
            </div>
            <div className="flex flex-col">
              <span className="font-black text-sm tracking-tight uppercase leading-none">NotebookIMFD</span>
              <span className="text-[9px] font-bold text-slate-400 truncate max-w-[150px]">ID: {userId}</span>
            </div>
          </div>
          <button className="w-full flex items-center justify-center gap-2 bg-[#FBFFA1] py-3 rounded-xl font-bold border-2 border-[#243166] shadow-[3px_3px_0px_0px_rgba(36,49,102,1)] hover:translate-y-[-2px] transition-all">
            <Plus size={18} /> Nueva Colección
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 px-2">Documentos</p>
          <div className="space-y-1">
            {sources.map(source => (
              <div key={source.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors border border-transparent hover:border-slate-100">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${source.status === 'success' ? 'bg-green-50 border-green-100 text-green-600' : 'bg-red-50 border-red-100 text-red-600'}`}>
                  {source.status === 'success' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                </div>
                <p className="text-xs font-bold truncate text-slate-600">{source.title}</p>
              </div>
            ))}
          </div>
        </nav>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="h-20 bg-white border-b flex items-center justify-between px-8 z-10">
          <div className="flex-1 max-w-2xl">
            <div className="relative group">
              <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Busca entidades, patrones o nodos..." 
                className="w-full bg-slate-50 border-2 border-transparent focus:border-[#243166] rounded-2xl pl-12 pr-24 py-3 text-sm outline-none transition-all"
              />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#243166] text-white px-4 py-1.5 rounded-xl text-xs font-bold hover:bg-[#A8A3F6] transition-colors">
                Buscar
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 ml-6">
            <button 
              onClick={onViewGraph || (() => alert("Cargando Grafo..."))}
              className="flex items-center gap-2 bg-[#A8A3F6] px-4 py-2 rounded-xl font-bold text-xs text-white shadow-[3px_3px_0px_0px_rgba(36,49,102,1)] hover:translate-y-[-2px] transition-all"
            >
              <Network size={16} /> Ver Grafo
            </button>
            <div className="relative">
              <img 
                src={safeUser.picture} 
                alt="Avatar"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-10 h-10 rounded-full border-2 border-[#F8D5EE] cursor-pointer object-cover"
                onError={(e) => { e.currentTarget.src = "https://api.dicebear.com/7.x/initials/svg?seed=U"; }}
              />
              {isDropdownOpen && (
                <div className="absolute top-14 right-0 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 p-4 z-50">
                  <div className="mb-4">
                    <p className="font-bold text-sm truncate">{safeUser.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{safeUser.email}</p>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 p-2 bg-red-50 text-red-500 rounded-lg text-xs font-bold hover:bg-red-100 transition-colors"
                  >
                    <LogOut size={14} /> Cerrar Sesión
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-5xl mx-auto">
            <div className="mb-10 bg-red-50 border-2 border-red-100 rounded-[32px] p-6 flex items-start gap-4">
              <AlertCircle size={24} className="text-red-500" />
              <div>
                <h3 className="font-black text-red-600 text-sm uppercase mb-1">Estado de MillenniumDB</h3>
                <p className="text-red-500/80 text-sm font-medium">Hay 1 documento con error de OCR que no ha sido indexado en el grafo.</p>
              </div>
            </div>

            <h2 className="text-3xl font-black italic mb-8 uppercase tracking-tighter text-[#243166]">Resultados de Búsqueda</h2>
            <div className="bg-white p-12 rounded-[40px] shadow-sm border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center">
               <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
                  <Database size={32} />
               </div>
               <p className="text-slate-400 font-medium italic">El motor de búsqueda semántica está listo.<br/>Ingresa un término para explorar la base de conocimiento.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default NotebookSearch;