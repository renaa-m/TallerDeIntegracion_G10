import { useState, useEffect } from "react";
import { Search, Plus, FileText, BookOpen, Network, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { useParams } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import "./buscador_coleccion.css";

interface Fuente {
  id: number;
  titulo: string;
  tipo: string;
  fecha: string;
  estado: "ok" | "error";
}

interface Resultado {
  id: number;
  fuenteId: number;
  fuenteTitulo: string;
  fuenteTipo: string;
  extracto: string;
  pagina?: number;
}

const FUENTES: Fuente[] = [
  { id: 1, titulo: "Especificaciones Técnicas Dr. House", tipo: "PDF", fecha: "21 Abr", estado: "ok" },
  { id: 2, titulo: "Notas de Reunión IMFD",               tipo: "Doc", fecha: "Ayer",   estado: "ok" },
  { id: 3, titulo: "Dataset H&M Chile - Outfits",         tipo: "CSV", fecha: "15 Abr", estado: "ok" },
  { id: 4, titulo: "Manuscrito_Ilegible_1920.pdf",        tipo: "PDF", fecha: "10 Abr", estado: "error" },
];

const CORPUS: Resultado[] = [
  { id: 1, fuenteId: 1, fuenteTitulo: "Especificaciones Técnicas Dr. House", fuenteTipo: "PDF", extracto: "El diagnóstico diferencial incluye lupus eritematoso sistémico, sarcoidosis y vasculitis. El equipo de reumatología sugiere iniciar con prednisona 40mg diarios.", pagina: 12 },
  { id: 2, fuenteId: 1, fuenteTitulo: "Especificaciones Técnicas Dr. House", fuenteTipo: "PDF", extracto: "Resultados de laboratorio muestran ANA positivo 1:640 con patrón homogéneo, complemento C3 bajo y anti-dsDNA elevado.", pagina: 18 },
  { id: 3, fuenteId: 2, fuenteTitulo: "Notas de Reunión IMFD",               fuenteTipo: "Doc", extracto: "Se acordó presentar los avances del proyecto de análisis semántico en el congreso de junio. Responsable: equipo de NLP." },
  { id: 4, fuenteId: 2, fuenteTitulo: "Notas de Reunión IMFD",               fuenteTipo: "Doc", extracto: "Hito de junio: entrega de prototipo funcional del motor de búsqueda con indexación de al menos 500 documentos." },
  { id: 5, fuenteId: 3, fuenteTitulo: "Dataset H&M Chile - Outfits",         fuenteTipo: "CSV", extracto: "Columnas: article_id, product_type_name, colour_group_name, perceived_colour_value, department_name. Total filas: 105.542." },
  { id: 6, fuenteId: 3, fuenteTitulo: "Dataset H&M Chile - Outfits",         fuenteTipo: "CSV", extracto: "El 34% de los artículos pertenece a la categoría Ladieswear, seguido por Divided (22%) y Menswear (18%)." },
];

function buscarEnCorpus(q: string, filtroTipo: string): Resultado[] {
  if (!q.trim()) return [];
  const lower = q.toLowerCase();
  return CORPUS.filter(r => {
    const matchTexto = r.extracto.toLowerCase().includes(lower) || r.fuenteTitulo.toLowerCase().includes(lower);
    const matchTipo  = filtroTipo === "todos" || r.fuenteTipo === filtroTipo;
    return matchTexto && matchTipo;
  });
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? <mark key={i} className="bc-hl">{part}</mark> : part
      )}
    </>
  );
}

const BuscadorColeccion = () => {
  const { id_usuario } = useParams();
  const { user } = useAuth0();

  const [filtroBarra,  setFiltroBarra]  = useState("");
  const [busqueda,     setBusqueda]     = useState("");
  const [filtroTipo,   setFiltroTipo]   = useState("todos");
  const [filtroOpen,   setFiltroOpen]   = useState(false);
  const [fuenteActiva, setFuenteActiva] = useState<number | null>(null);
  const [darkMode,     setDarkMode]     = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDarkMode(mq.matches);
    const handler = (e: MediaQueryListEvent) => setDarkMode(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const fuentesFiltradas = FUENTES.filter(f =>
    f.titulo.toLowerCase().includes(filtroBarra.toLowerCase())
  );

  const resultados = buscarEnCorpus(busqueda, filtroTipo);
  const buscando   = busqueda.trim().length > 0;
  const TIPOS      = ["todos", "PDF", "Doc", "CSV"];

  return (
    <div className={`bc-root${darkMode ? " bc-dark" : ""}`}>

      {/* ── SIDEBAR ─────────────────────────── */}
      <aside className="bc-sidebar">
        <div className="bc-sidebar-inner">

          <div className="bc-logo">
            <div className="bc-logo-icon"><BookOpen size={15} /></div>
            <span>NotebookIMFD</span>
          </div>

          <button className="bc-add-btn">
            <Plus size={15} /><span>Nueva Colección</span>
          </button>

          <div className="bc-search-wrap">
            <Search size={13} className="bc-search-icon" />
            <input
              className="bc-search-input"
              type="text"
              placeholder="Filtrar fuentes..."
              value={filtroBarra}
              onChange={e => setFiltroBarra(e.target.value)}
            />
          </div>

          <div className="bc-section-label">Fuentes · {fuentesFiltradas.length}</div>

          <div className="bc-sources-list">
            {fuentesFiltradas.map((f, i) => (
              <button
                key={f.id}
                className={`bc-source-item${fuenteActiva === f.id ? " active" : ""}${f.estado === "error" ? " error" : ""}`}
                style={{ animationDelay: `${i * 50}ms` }}
                onClick={() => setFuenteActiva(fuenteActiva === f.id ? null : f.id)}
              >
                <div className={`bc-source-dot${f.estado === "error" ? " dot-error" : ""}`} />
                <div className="bc-source-text">
                  <span className="bc-source-title">{f.titulo}</span>
                  <span className="bc-source-meta">{f.tipo} · {f.fecha}</span>
                </div>
                <ChevronRight size={11} className="bc-chevron" />
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* ── MAIN ────────────────────────────── */}
      <main className="bc-main">

        <header className="bc-topbar">
          <div className="bc-topbar-left">
            <h1 className="bc-topbar-title">Buscador Semántico</h1>
            <span className="bc-topbar-sub">Colección activa · {FUENTES.filter(f => f.estado === "ok").length} fuentes</span>
          </div>
          <button className="bc-graph-btn">
            <Network size={15} /><span>Ver Grafo</span>
          </button>
        </header>

        {/* barra de búsqueda */}
        <div className="bc-searchbar-wrap">
          <div className="bc-searchbar">
            <Search size={17} className="bc-searchbar-icon" />
            <input
              className="bc-searchbar-input"
              type="text"
              placeholder="Busca en tus fuentes..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              autoFocus
            />
            {busqueda && (
              <button className="bc-searchbar-clear" onClick={() => setBusqueda("")}>
                <X size={14} />
              </button>
            )}
            <div className="bc-searchbar-divider" />
            <button
              className={`bc-filter-btn${filtroOpen ? " active" : ""}`}
              onClick={() => setFiltroOpen(!filtroOpen)}
            >
              <SlidersHorizontal size={14} />
              <span>Filtrar</span>
            </button>
          </div>

          {filtroOpen && (
            <div className="bc-filter-panel">
              <span className="bc-filter-label">Tipo de archivo</span>
              <div className="bc-filter-chips">
                {TIPOS.map(t => (
                  <button
                    key={t}
                    className={`bc-filter-chip${filtroTipo === t ? " selected" : ""}`}
                    onClick={() => setFiltroTipo(t)}
                  >
                    {t === "todos" ? "Todos" : t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* resultados */}
        <div className="bc-results-area">
          {!buscando ? (
            <div className="bc-empty">
              <div className="bc-empty-icon"><Search size={26} /></div>
              <p className="bc-empty-title">Busca en tu colección</p>
              <p className="bc-empty-sub">Escribe un término para encontrar extractos relevantes en todos tus documentos.</p>
            </div>
          ) : resultados.length === 0 ? (
            <div className="bc-empty">
              <div className="bc-empty-icon"><FileText size={26} /></div>
              <p className="bc-empty-title">Sin resultados</p>
              <p className="bc-empty-sub">No se encontraron coincidencias para <strong>"{busqueda}"</strong>.</p>
            </div>
          ) : (
            <>
              <p className="bc-results-count">
                {resultados.length} resultado{resultados.length !== 1 ? "s" : ""} para <strong>"{busqueda}"</strong>
              </p>
              <div className="bc-results-list">
                {resultados.map((r, i) => (
                  <article key={r.id} className="bc-result-card" style={{ animationDelay: `${i * 55}ms` }}>
                    <div className="bc-result-source">
                      <div className="bc-result-source-icon"><FileText size={12} /></div>
                      <span className="bc-result-source-name">{r.fuenteTitulo}</span>
                      <span className="bc-result-badge">{r.fuenteTipo}</span>
                      {r.pagina && <span className="bc-result-page">pág. {r.pagina}</span>}
                    </div>
                    <p className="bc-result-excerpt">
                      <Highlight text={r.extracto} query={busqueda} />
                    </p>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default BuscadorColeccion;